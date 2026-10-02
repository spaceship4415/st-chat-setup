import {
    characters,
    createOrEditCharacter,
    getOneCharacter,
    getRequestHeaders,
    getThumbnailUrl,
    menu_type,
    saveCharacterDebounced,
    select_selected_character,
    this_chid,
    unshallowCharacter,
} from '../../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { selected_group } from '../../../../group-chats.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../popup.js';
import { cancelDebounce } from '../../../../utils.js';
import { EXTENSION_NAME, LOG_PREFIX } from './constants.js';
import { tr } from './i18n.js';

/** 빠른 수정 창의 결과 */
export const QUICK_EDIT_OUTCOME = Object.freeze({
    SAVED: 'saved',
    CLOSED: 'closed',
    FULL_EDITOR: 'full_editor',
});

const RESULT_FULL_EDITOR = 2;

/**
 * 채팅을 열지 않고 고칠 수 있는 카드 항목.
 * legacy: V1 최상위 필드(ST 편집 화면과 프롬프트가 읽는 곳), data: V2 `data.*` 필드. 저장할 때 둘 다 맞춘다.
 * @type {ReadonlyArray<{ key: string, label: string, legacy?: string, data: string, rows: number }>}
 */
const FIELDS = Object.freeze([
    { key: 'description', label: 'Description', legacy: 'description', data: 'description', rows: 6 },
    { key: 'personality', label: 'Personality summary', legacy: 'personality', data: 'personality', rows: 3 },
    { key: 'scenario', label: 'Scenario', legacy: 'scenario', data: 'scenario', rows: 3 },
    { key: 'first_mes', label: 'First message', legacy: 'first_mes', data: 'first_mes', rows: 6 },
    { key: 'mes_example', label: 'Examples of dialogue', legacy: 'mes_example', data: 'mes_example', rows: 4 },
    { key: 'system_prompt', label: 'Main prompt override', data: 'system_prompt', rows: 3 },
    { key: 'post_history_instructions', label: 'Post-history instructions', data: 'post_history_instructions', rows: 3 },
    { key: 'creator_notes', label: "Creator's notes", legacy: 'creatorcomment', data: 'creator_notes', rows: 3 },
]);

/**
 * @param {any} character
 * @param {typeof FIELDS[number]} field
 * @returns {string}
 */
function readField(character, field) {
    // ST 편집 화면과 같은 우선순위: V1 필드가 있으면 그것, 없으면 V2
    const legacyValue = field.legacy ? character[field.legacy] : undefined;
    const value = (field.legacy === 'creatorcomment')
        ? (character.data?.creator_notes || legacyValue)
        : (legacyValue ?? character.data?.[field.data]);
    return typeof value === 'string' ? value : '';
}

/**
 * 채팅을 열지 않고 캐릭터 카드의 텍스트 항목을 고치는 창을 연다.
 * @param {number} chid
 * @returns {Promise<string>} QUICK_EDIT_OUTCOME 값
 */
export async function openQuickEdit(chid) {
    await flushPendingEditorSave(chid);

    // 목록의 캐릭터는 가벼운(shallow) 데이터일 수 있어서 전체 카드를 먼저 받아 둔다
    await unshallowCharacter(chid);
    const character = characters[chid];
    if (!character) return QUICK_EDIT_OUTCOME.CLOSED;

    const html = await renderExtensionTemplateAsync(EXTENSION_NAME, 'templates/quick-edit', {
        name: character.name,
        avatarUrl: getThumbnailUrl('avatar', character.avatar),
    });

    const form = createForm(character);

    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        okButton: tr('save', 'Save'),
        cancelButton: tr('back', 'Back'),
        allowVerticalScrolling: true,
        // 긴 글을 고치는 창이라 Enter 로 저장되면 안 된다
        defaultResult: POPUP_RESULT.CANCELLED,
        onClosing: async (p) => {
            if (p.result === POPUP_RESULT.AFFIRMATIVE) {
                return await save(character.avatar, chid, form);
            }
            if (!form.isDirty()) return true;
            return await confirmDiscard();
        },
    });
    popup.dlg.classList.add('st-chat-setup-popup');
    form.mount(popup.dlg);
    popup.dlg.querySelector('.st-chat-setup-full-edit')?.addEventListener('click', () => {
        popup.complete(RESULT_FULL_EDITOR);
    });
    // 지금 열린 캐릭터라면 전체 수정은 채팅을 다시 열지 않고 편집 화면만 연다(ST: 같은 캐릭터 재선택 = 편집 패널)
    if (this_chid !== undefined && String(this_chid) === String(chid) && !selected_group) {
        const fullEditHint = popup.dlg.querySelector('.st-chat-setup-full-edit-hint');
        if (fullEditHint) {
            // ST 는 화면에 붙는 요소의 data-i18n 을 다시 번역하므로 글자만 바꾸면 원래 문구로 되돌아간다. 키도 함께 바꾼다
            fullEditHint.setAttribute('data-i18n', 'chat_setup.full_edit_hint_current');
            fullEditHint.textContent = tr('full_edit_hint_current', 'Name, avatar, tags and other settings are edited in SillyTavern\'s editor. The current chat stays open.');
        }
    }

    const result = await popup.show();
    if (result === POPUP_RESULT.AFFIRMATIVE) return QUICK_EDIT_OUTCOME.SAVED;
    if (result === RESULT_FULL_EDITOR) return QUICK_EDIT_OUTCOME.FULL_EDITOR;
    return QUICK_EDIT_OUTCOME.CLOSED;
}

/**
 * ST 편집 화면은 입력 후 약 1초 뒤에 저장한다(saveCharacterDebounced).
 * 그 사이에 빠른 수정을 열면 저장 전 값이 보이고, 이후 늦게 도착한 ST 저장과 엉킨다.
 * 대기 중인지 밖에서 알 수 없으므로, 수정 대상이 편집 화면에 올라 있는 캐릭터면 대기 저장을 취소하고 즉시 저장한다.
 * (변경이 없었다면 같은 값을 한 번 더 쓰는 것뿐이다)
 * @param {number} chid
 */
async function flushPendingEditorSave(chid) {
    // 새 캐릭터 만들기 화면이면 폼이 이 캐릭터가 아니다(createOrEditCharacter 가 '생성'으로 동작해 버림)
    const isInEditorForm = menu_type !== 'create'
        && $('#form_create').attr('actiontype') === 'editcharacter'
        && this_chid !== undefined && String(this_chid) === String(chid);
    if (!isInEditorForm) return;

    cancelDebounce(saveCharacterDebounced);
    try {
        await createOrEditCharacter();
    } catch (error) {
        console.warn(LOG_PREFIX, 'failed to flush pending character save', error);
    }
}

async function confirmDiscard() {
    const answer = await Popup.show.confirm(
        tr('discard_title', 'Discard changes?'),
        tr('discard_text', 'Your edits to this character have not been saved.'),
        { okButton: tr('discard_ok', 'Discard'), cancelButton: tr('discard_cancel', 'Keep editing') },
    );
    return answer === POPUP_RESULT.AFFIRMATIVE;
}

/**
 * 입력칸을 만들고 값과 변경 여부를 관리한다. textarea 값은 템플릿 대신 DOM 속성으로 넣어
 * 카드 본문에 HTML·Handlebars 문법이 있어도 그대로 보존한다.
 * @param {any} character
 */
function createForm(character) {
    /** @type {Map<string, { field: typeof FIELDS[number], textarea: HTMLTextAreaElement, initial: string }>} */
    const inputs = new Map();
    // textarea 는 줄바꿈을 \n 으로 바꿔 담는다(\r\n → \n). 원본과 그대로 비교하면 Windows 줄바꿈이 든 카드는
    // 손대지 않아도 '바뀜'이 되고, 다른 칸을 저장할 때 그 칸까지 함께 저장돼 줄바꿈이 조용히 바뀐다.
    // 그래서 비교 기준(initial)은 textarea 에 넣은 뒤의 값으로 잡는다
    const normalizeNewlines = (/** @type {string} */ text) => text.replace(/\r\n?/g, '\n');
    const initialGreetings = Array.isArray(character.data?.alternate_greetings)
        ? character.data.alternate_greetings.filter(g => typeof g === 'string').map(normalizeNewlines)
        : [];
    /** @type {HTMLElement|null} */
    let greetingsBox = null;

    const createTextarea = (value, rows) => {
        const textarea = document.createElement('textarea');
        textarea.className = 'text_pole st-chat-setup-textarea';
        textarea.rows = rows;
        textarea.value = value;
        return textarea;
    };

    /**
     * '크게 열어서 쓰기' 버튼. ST 의 editor_maximize 기능을 그대로 쓴다 — 클래스와 data-for(대상 textarea id)만
     * 달면 ST(chats.js)가 큰 편집 창을 띄우고, 거기서 쓴 내용을 원래 칸에 input 이벤트로 바로 반영한다.
     * @param {string} targetId
     */
    const createExpandButton = (targetId) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'editor_maximize menu_button st-chat-setup-icon-button';
        button.dataset.for = targetId;
        button.title = tr('expand_editor', 'Expand the editor');
        button.innerHTML = '<i class="fa-solid fa-maximize"></i>';
        return button;
    };

    // 대체 인사말은 추가·삭제되므로 겹치지 않는 id 를 계속 늘려 가며 쓴다
    let greetingSeq = 0;
    const addGreetingRow = (value) => {
        const row = document.createElement('div');
        row.className = 'st-chat-setup-greeting';
        const textarea = createTextarea(value, 3);
        textarea.id = `st_chat_setup_greeting_${greetingSeq++}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'menu_button st-chat-setup-icon-button';
        remove.title = tr('remove_greeting', 'Remove greeting');
        remove.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        remove.addEventListener('click', () => row.remove());
        const buttons = document.createElement('div');
        buttons.className = 'st-chat-setup-greeting-buttons';
        buttons.append(createExpandButton(textarea.id), remove);
        row.append(textarea, buttons);
        greetingsBox?.append(row);
        return textarea;
    };

    const getGreetings = () => [...(greetingsBox?.querySelectorAll('textarea') ?? [])]
        .map(t => /** @type {HTMLTextAreaElement} */ (t).value)
        .filter(v => v.trim() !== '');

    return {
        /** @param {HTMLElement} root */
        mount(root) {
            const fieldsBox = root.querySelector('.st-chat-setup-fields');
            for (const field of FIELDS) {
                const section = document.createElement('section');
                section.className = 'st-chat-setup-section';
                const head = document.createElement('div');
                head.className = 'st-chat-setup-field-head';
                const label = document.createElement('label');
                label.className = 'st-chat-setup-label';
                label.textContent = tr(`field_${field.key}`, field.label);
                const textarea = createTextarea(readField(character, field), field.rows);
                label.htmlFor = textarea.id = `st_chat_setup_field_${field.key}`;
                head.append(label, createExpandButton(textarea.id));
                section.append(head, textarea);
                fieldsBox?.append(section);
                inputs.set(field.key, { field, textarea, initial: textarea.value });
            }

            greetingsBox = root.querySelector('.st-chat-setup-greetings');
            initialGreetings.forEach(addGreetingRow);
            root.querySelector('.st-chat-setup-add-greeting')?.addEventListener('click', () => {
                const textarea = addGreetingRow('');
                textarea.focus();
                // 모바일: 가상 키보드가 올라와도 새 칸이 보이도록
                textarea.scrollIntoView({ block: 'center', behavior: 'smooth' });
            });
        },
        isDirty() {
            for (const { textarea, initial } of inputs.values()) {
                if (textarea.value !== initial) return true;
            }
            const greetings = getGreetings();
            return greetings.length !== initialGreetings.length || greetings.some((g, i) => g !== initialGreetings[i]);
        },
        /** 서버로 보낼 변경분(merge-attributes 형식). 바뀐 것이 없으면 null */
        buildUpdate() {
            const update = {};
            const data = {};
            for (const { field, textarea, initial } of inputs.values()) {
                if (textarea.value === initial) continue;
                if (field.legacy) update[field.legacy] = textarea.value;
                data[field.data] = textarea.value;
            }
            const greetings = getGreetings();
            if (greetings.length !== initialGreetings.length || greetings.some((g, i) => g !== initialGreetings[i])) {
                // 서버 병합은 배열을 통째로 바꾼다
                data.alternate_greetings = greetings;
            }
            if (!Object.keys(update).length && !Object.keys(data).length) return null;
            return { ...update, data };
        },
    };
}

/**
 * @param {string} avatar
 * @param {number} chid
 * @param {ReturnType<typeof createForm>} form
 * @returns {Promise<boolean>} 창을 닫아도 되면 true
 */
async function save(avatar, chid, form) {
    const update = form.buildUpdate();
    if (!update) return true;

    try {
        const response = await fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar, ...update }),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
    } catch (error) {
        console.error(LOG_PREFIX, 'failed to save character', error);
        toastr.error(tr('save_failed', 'Could not save the character.'));
        return false;
    }

    // 메모리 속 캐릭터를 새 카드로 교체
    await getOneCharacter(avatar);

    // 지금 열린 캐릭터라면 ST 편집 화면의 입력칸(숨은 json_data 포함)도 새 값으로 다시 채운다.
    // 안 그러면 ST 가 다음에 편집 화면 기준으로 저장할 때(채팅 전환 등) 옛 값으로 되돌려 버린다
    if (this_chid !== undefined && String(this_chid) === String(chid)) {
        select_selected_character(chid, { switchMenu: false });
    }

    toastr.success(tr('saved', 'Character saved.'), characters[chid]?.name);
    return true;
}
