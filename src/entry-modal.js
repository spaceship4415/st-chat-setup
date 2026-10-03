import { characters, formatCharacterAvatar, getThumbnailUrl } from '../../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { getUserAvatar } from '../../../../personas.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../popup.js';
import { METADATA_KEY } from '../../../../world-info.js';
import { createCharLoreSection } from './char-lore-section.js';
import { createChatLoreSection } from './chat-lore-section.js';
import { createChatSection } from './chat-section.js';
import { EXTENSION_NAME, LOG_PREFIX, RESULT_EDIT_CHARACTER, RESULT_EDIT_FULL } from './constants.js';
import { enterExistingChat, enterNewChat, openCharacterEditor } from './entry-actions.js';
import { tr } from './i18n.js';
import { promptCreateLorebook } from './lorebook-create.js';
import { createPersonaLoreSection } from './persona-lore-section.js';
import { createPersonaSection } from './persona-section.js';
import { getSettings, setSetting } from './settings.js';
import { openQuickEdit, QUICK_EDIT_OUTCOME } from './quick-edit.js';

/** @type {Popup|null} 지금 떠 있는 입장창. 한 번에 하나만 둔다 */
let activePopup = null;

/** 입장창을 열 때마다 증가한다. 늦게 도착한 비동기 결과가 새 입장창을 덮어쓰지 않도록 비교용으로 쓴다 */
let currentToken = 0;

/**
 * 입장창을 연다. 이미 열려 있으면 그 창을 취소로 닫고 새로 연다.
 * @param {number} chid
 */
export async function openEntryModal(chid) {
    const character = characters[chid];
    if (!character) return;

    const token = ++currentToken;
    await closeActiveModal();

    // 앞의 창을 닫는 사이에 또 다른 캐릭터가 눌렸으면 이 요청은 버린다
    if (token !== currentToken) return;

    // 큰 이미지 설정이면 썸네일(96×144)을 키우면 흐려지므로 원본 이미지를 쓴다
    const largeAvatars = getSettings().avatarSize === 'large';
    const hasAvatar = character.avatar && character.avatar !== 'none';

    let html;
    try {
        html = await renderExtensionTemplateAsync(EXTENSION_NAME, 'templates/entry-modal', {
            name: character.name,
            avatarUrl: largeAvatars && hasAvatar ? formatCharacterAvatar(character.avatar) : getThumbnailUrl('avatar', character.avatar),
            largeAvatars,
            editBoth: getSettings().editButtonMode === 'both',
        });
    } catch (error) {
        console.error(LOG_PREFIX, 'failed to render entry modal', error);
        toastr.error(tr('entry_open_failed', 'Could not open the entry dialog.'));
        return;
    }
    if (token !== currentToken) return;

    /** @type {ReturnType<typeof createChatSection>} */
    let chatSection;
    /** 검증·확인·입장 처리 중. 이 동안에는 어떤 이유로도 창을 닫지 않는다(ESC·바깥 클릭·버튼 재탭 포함) */
    let isBusy = false;
    /** 섹션들이 서로를 부르며 만들어지는 동안에는 요약을 갱신하지 않는다(아직 없는 섹션을 건드리지 않도록) */
    let summaryReady = false;

    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        okButton: tr('enter', 'Enter'),
        cancelButton: tr('cancel', 'Cancel'),
        allowVerticalScrolling: true,
        onOpen: bindOutsideClickToCancel,
        // [입장]이면 검증 → (필요하면) 확인 → 실제 입장까지 창을 연 채로 처리한다.
        // 처리 중에는 버튼에 '입장 중…'을 보여 주고, 실패하면 창을 닫지 않아 바로 다시 시도할 수 있다
        onClosing: async (p) => {
            if (isBusy) return false;
            if (p.result !== POPUP_RESULT.AFFIRMATIVE) return true;

            isBusy = true;
            try {
                if (!await chatSection.validate()) return false;
                // 다른 채팅에도 영향을 주는 변경은 한 번 확인받는다. 취소하면 입장창으로 돌아간다
                const confirmed = await confirmScopedChanges({
                    personaLore: personaLoreSection.getChange(),
                    charLore: charLoreSection.getChange(),
                });
                if (!confirmed) return false;

                setLoading(popup, true);
                const entered = await enterAsChosen();
                if (entered) {
                    // '지난번 선택 기억' 설정용으로 이번에 고른 방식을 남긴다
                    const { mode } = chatSection.getValue();
                    if (getSettings().lastChatMode !== mode) setSetting('lastChatMode', mode);
                } else {
                    chatSection.showError(tr('enter_retry', 'Could not enter the chat. Please try again.'));
                }
                return entered;
            } finally {
                setLoading(popup, false);
                isBusy = false;
            }
        },
    });
    popup.dlg.classList.add('st-chat-setup-popup');
    const editButton = popup.dlg.querySelector('.st-chat-setup-edit:not(.st-chat-setup-edit-full)');
    editButton?.addEventListener('click', () => {
        popup.complete(RESULT_EDIT_CHARACTER);
    });
    // '둘 다' 모드에서만 있는 [ST 수정]
    popup.dlg.querySelector('.st-chat-setup-edit-full')?.addEventListener('click', () => {
        popup.complete(RESULT_EDIT_FULL);
    });
    // 기본 수정(ST 편집 화면) 모드면 버튼 설명도 그에 맞게. ST 가 data-i18n 을 다시 번역하므로 키를 바꾼다
    if (editButton && getSettings().editButtonMode === 'full') {
        editButton.setAttribute('data-i18n', '[title]chat_setup.edit_button_title_full');
        editButton.setAttribute('title', tr('edit_button_title_full', 'Open SillyTavern\'s character editor'));
    }
    // 페르소나 영역은 채팅 영역의 모드/선택에 따라 달라지므로 먼저 만든다.
    // 반대로 새 채팅 기본 이름에는 페르소나 이름이 들어가므로, 페르소나가 바뀌면 채팅 영역에 알린다
    /** @type {ReturnType<typeof createPersonaLoreSection>} */
    let personaLoreSection;
    const personaSection = createPersonaSection(popup.dlg, {
        chid,
        avatarUrl: largeAvatars ? getUserAvatar : (id) => getThumbnailUrl('persona', id),
        onNewChatPersonaChange: (name) => chatSection?.setPersonaName(name),
        onTargetPersonaChange: (id) => {
            personaLoreSection?.setTarget(id);
            updateLoreSummary();
        },
    });
    personaLoreSection = createPersonaLoreSection(popup.dlg, {
        personaId: personaSection.getTargetPersonaId(),
        onCreateRequest: (personaName) => createLorebookFor('persona', personaName),
    });
    const charLoreSection = createCharLoreSection(popup.dlg, {
        chid,
        onCreateRequest: (target) => createLorebookFor(target === 'extras' ? 'char-extras' : 'char', character.name),
    });
    const chatLoreSection = createChatLoreSection(popup.dlg, {
        onCreateRequest: () => createLorebookFor('chat', chatSection?.getValue().fileName || character.name),
    });

    /**
     * 각 로어북 칸의 '새 로어북 만들기'. 만든 로어북은 모든 로어북 칸의 목록에 추가하고, 누른 칸에서는 바로 고른다.
     * 로어북 파일은 이 시점에 바로 만들어진다(입장을 취소해도 남는다 — 명시적으로 만든 것이므로).
     * @param {'chat' | 'persona' | 'char' | 'char-extras'} origin
     * @param {string} defaultName
     */
    async function createLorebookFor(origin, defaultName) {
        if (isBusy) return;
        const name = await promptCreateLorebook(defaultName);
        if (!name) return;
        chatLoreSection.addLorebook(name, { select: origin === 'chat' });
        personaLoreSection.addLorebook(name, { select: origin === 'persona' });
        charLoreSection.addLorebook(name, { select: origin === 'char' ? 'primary' : origin === 'char-extras' ? 'extras' : null });
        updateLoreSummary();
    }
    chatSection = createChatSection(popup.dlg, {
        chid,
        isStale: () => token !== currentToken,
        onSubmit: () => popup.completeAffirmative(),
        onChange: (state) => {
            personaSection.update(state);
            chatLoreSection.update(state);
            updateLoreSummary();
        },
        personaName: personaSection.getNewChatPersonaName(),
        initialMode: getInitialChatMode(),
        stampStyle: getSettings().chatNameStamp,
    });

    // 접힌 로어북 묶음의 요약. 이름이 길어도 높이가 늘지 않도록 항목마다 한 줄로 두고 넘치면 …으로 자른다.
    // 전체 이름은 묶음을 펼친 칸에서 보이고, 마우스가 있으면 title 툴팁으로도 보인다
    const loreGroup = /** @type {HTMLElement} */ (popup.dlg.querySelector('.st-chat-setup-lore-group'));
    const loreSummary = /** @type {HTMLElement} */ (popup.dlg.querySelector('.st-chat-setup-lore-summary'));
    function updateLoreSummary() {
        if (!summaryReady || !loreSummary) return;
        // 입장창 위쪽 순서(캐릭터 → 페르소나 → 채팅)와 같게
        const rows = [
            [tr('lore_summary_character', 'Character'), charLoreSection.getSummary()],
            [tr('lore_summary_persona', 'Persona'), personaLoreSection.getSummary()],
            [tr('lore_summary_chat', 'Chat'), chatLoreSection.getSummary()],
        ];
        loreSummary.replaceChildren(...rows.map(([label, value]) => {
            const row = document.createElement('span');
            row.className = 'st-chat-setup-lore-summary-row';
            const labelEl = document.createElement('span');
            labelEl.className = 'st-chat-setup-lore-summary-label';
            labelEl.textContent = label;
            const valueEl = document.createElement('span');
            valueEl.className = 'st-chat-setup-lore-summary-value';
            valueEl.textContent = value;
            valueEl.title = value;
            row.append(labelEl, valueEl);
            return row;
        }));
    }
    loreGroup?.addEventListener('change', updateLoreSummary);
    summaryReady = true;
    updateLoreSummary();

    /** 입장창에서 고른 대로 입장한다 */
    async function enterAsChosen() {
        const choice = chatSection.getValue();
        const persona = personaSection.getValue();
        const chatLore = chatLoreSection.getValue();
        const personaLore = personaLoreSection.getChange();
        const charLore = charLoreSection.getChange();
        console.info(LOG_PREFIX, 'entry requested', { chid, mode: choice.mode, fileName: choice.fileName, persona, chatLore, personaLore, charLore });

        if (choice.mode === 'existing') {
            return await enterExistingChat(chid, choice.fileName, {
                persona: persona.existingOverride,
                chatLore: chatLore.existingOverride,
                personaLore,
                charLore,
            });
        }
        /** @type {Record<string, any>} 새 채팅 헤더에 미리 넣을 chat_metadata */
        const metadata = {};
        if (persona.newChatLock) metadata.persona = persona.newChatLock;
        if (chatLore.newChatLore) metadata[METADATA_KEY] = chatLore.newChatLore;
        return await enterNewChat(chid, choice.fileName, metadata, { personaLore, charLore, greetingIndex: choice.greetingIndex });
    }

    activePopup = popup;

    const result = await popup.show();
    if (activePopup === popup) activePopup = null;

    // 입장(AFFIRMATIVE)은 이미 onClosing 에서 끝났다.
    // 취소 버튼(NEGATIVE), ESC·바깥 클릭(CANCELLED), 다른 창에 밀려 닫힌 경우는 아무것도 하지 않는다
    if (token !== currentToken) return;
    if (result === RESULT_EDIT_CHARACTER) {
        await editCharacter(chid, token);
    } else if (result === RESULT_EDIT_FULL) {
        await openCharacterEditor(chid);
    }
}

/**
 * 입장창을 열 때 처음 고를 채팅 방식(설정 defaultChatMode).
 * @returns {'new' | 'existing'}
 */
function getInitialChatMode() {
    const settings = getSettings();
    const mode = settings.defaultChatMode === 'remember' ? settings.lastChatMode : settings.defaultChatMode;
    return mode === 'existing' ? 'existing' : 'new';
}

/**
 * 입장 처리 중 표시. [입장] 버튼에 스피너와 '입장 중…'을 띄우고 창 안 입력과 다른 버튼을 막는다.
 * @param {Popup} popup
 * @param {boolean} loading
 */
function setLoading(popup, loading) {
    const ok = /** @type {HTMLElement} */ (popup.okButton);
    if (loading) {
        ok.dataset.label ??= ok.textContent ?? '';
        ok.replaceChildren();
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-spinner fa-spin';
        ok.append(icon, ` ${tr('entering', 'Entering…')}`);
    } else if (ok.dataset.label !== undefined) {
        ok.textContent = ok.dataset.label;
        delete ok.dataset.label;
    }
    popup.dlg.classList.toggle('st-chat-setup-loading', loading);
    popup.dlg.setAttribute('aria-busy', String(loading));
    const content = popup.dlg.querySelector('.st-chat-setup-modal');
    if (content) /** @type {HTMLElement} */ (content).inert = loading;
}

/**
 * 입장창의 [수정].
 * - 간편 수정(기본): 채팅을 열지 않는 빠른 수정 창. 닫으면(저장/뒤로) 같은 캐릭터의 입장창으로 돌아오고,
 *   '전체 수정'을 고르면 ST 편집 화면으로 간다.
 * - 기본 수정(설정 editButtonMode = 'full'): 바로 ST 편집 화면.
 * ST 편집 화면은 다른 캐릭터면 그 캐릭터의 마지막 채팅도 함께 연다(지금 캐릭터면 채팅은 그대로).
 * @param {number} chid
 * @param {number} token
 */
async function editCharacter(chid, token) {
    if (getSettings().editButtonMode === 'full') {
        await openCharacterEditor(chid);
        return;
    }

    let outcome;
    try {
        outcome = await openQuickEdit(chid);
    } catch (error) {
        console.error(LOG_PREFIX, 'quick edit failed', error);
        toastr.error(tr('quick_edit_failed', 'Could not open the character editor.'));
        return;
    }

    // 빠른 수정 중에 다른 캐릭터를 눌러 새 입장창이 열렸으면 돌아가지 않는다
    if (token !== currentToken) return;

    if (outcome === QUICK_EDIT_OUTCOME.FULL_EDITOR) {
        await openCharacterEditor(chid);
    } else {
        await openEntryModal(chid);
    }
}

/**
 * 페르소나·캐릭터에 붙는 연결(다른 채팅에도 적용됨)을 바꾸기 전에 확인받는다.
 * 설정 confirmScopedLoreChange 가 꺼져 있거나 바뀐 것이 없으면 묻지 않는다.
 * 카드에 내장된 로어북이 지워지는 경우는 되돌릴 수 없으므로 설정과 관계없이 항상 묻는다.
 * @param {{
 *   personaLore: import('./persona-lore-section.js').PersonaLoreChange | null,
 *   charLore: import('./char-lore-section.js').CharLoreChange | null,
 * }} changes
 * @returns {Promise<boolean>} 계속 진행하면 true
 */
async function confirmScopedChanges({ personaLore, charLore }) {
    const mustConfirm = !!charLore?.removesEmbedded;
    if (!getSettings().confirmScopedLoreChange && !mustConfirm) return true;

    const none = tr('lore_none', 'None');
    const list = (/** @type {string[]} */ items) => (items.length ? items.join(', ') : none);
    const lines = [];
    if (personaLore) {
        lines.push(tr('confirm_persona_lore', 'Persona "{0}": lorebook {1} → {2}')
            .replace('{0}', personaLore.personaName)
            .replace('{1}', personaLore.previous || none)
            .replace('{2}', personaLore.lorebook || none));
    }
    if (charLore?.primary) {
        lines.push(tr('confirm_char_lore', 'Character "{0}": lorebook {1} → {2}')
            .replace('{0}', charLore.characterName)
            .replace('{1}', charLore.primary.from || none)
            .replace('{2}', charLore.primary.to || none));
    }
    if (charLore?.extras) {
        lines.push(tr('confirm_char_lore_extras', 'Character "{0}": additional lorebooks {1} → {2}')
            .replace('{0}', charLore.characterName)
            .replace('{1}', list(charLore.extras.from))
            .replace('{2}', list(charLore.extras.to)));
    }
    if (!lines.length) return true;

    const body = document.createElement('div');
    // 로어북·페르소나 이름이 띄어쓰기 없이 길어도 창 밖으로 넘치지 않게
    body.className = 'st-chat-setup-confirm';
    for (const text of [...lines, tr('confirm_scoped_note', 'This also applies to other chats.')]) {
        const p = document.createElement('p');
        p.textContent = text;
        body.append(p);
    }
    if (charLore?.removesEmbedded) {
        const warning = document.createElement('p');
        warning.className = 'st-chat-setup-warning';
        warning.textContent = tr('confirm_embedded_warning', 'The lorebook embedded in this character card will be removed from the card. This cannot be undone.');
        body.append(warning);
    }
    const result = await Popup.show.confirm(tr('confirm_scoped_title', 'Change shared settings?'), body.outerHTML, {
        okButton: tr('confirm_scoped_ok', 'Change and enter'),
        cancelButton: tr('cancel', 'Cancel'),
    });
    return result === POPUP_RESULT.AFFIRMATIVE;
}

async function closeActiveModal() {
    const popup = activePopup;
    if (!popup) return;
    activePopup = null;
    await popup.completeCancelled();
}

/**
 * ST Popup 에는 바깥 클릭으로 닫는 옵션이 없어 직접 붙인다.
 * <dialog> 의 backdrop 을 눌러도 이벤트 대상은 dialog 자체이므로, 좌표가 dialog 사각형 밖인지로 판단한다.
 * 안에서 눌러 밖에서 뗀 경우(텍스트 드래그 등)에 닫히지 않도록 누른 위치와 뗀 위치가 모두 밖이어야 한다.
 * @param {Popup} popup
 */
function bindOutsideClickToCancel(popup) {
    const dlg = popup.dlg;
    let pressedOutside = false;

    /** @param {MouseEvent} event */
    const isOutside = (event) => {
        if (event.target !== dlg) return false;
        const rect = dlg.getBoundingClientRect();
        return event.clientX < rect.left || event.clientX > rect.right
            || event.clientY < rect.top || event.clientY > rect.bottom;
    };

    dlg.addEventListener('pointerdown', (event) => {
        pressedOutside = isOutside(event);
    });
    dlg.addEventListener('click', (event) => {
        if (pressedOutside && isOutside(event)) {
            popup.completeCancelled();
        }
        pressedOutside = false;
    });
}
