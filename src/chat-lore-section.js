import { METADATA_KEY, world_names } from '../../../../world-info.js';
import { CREATE, KEEP, NONE } from './constants.js';
import { tr } from './i18n.js';
import { createLorebookOption } from './lorebook-create.js';

/** @typedef {import('./data-source.js').ChatInfo} ChatInfo */
/** @typedef {import('./chat-section.js').ChatMode} ChatMode */

/**
 * @typedef {Object} ChatLoreChoice
 * @property {string | null} newChatLore 새 채팅 헤더의 chat_metadata.world_info 로 넣을 로어북. null = 없음
 * @property {string | null} existingOverride 기존 채팅에 입장한 뒤 적용할 값. 로어북 이름 또는 NONE(연결 해제). null = 유지
 */

/** 지금 있는 로어북 이름들 (world-info.js 가 아직 목록을 못 받았으면 빈 배열) */
const getLorebookNames = () => (Array.isArray(world_names) ? [...world_names] : [])
    .sort((a, b) => a.localeCompare(b));

/**
 * 입장창의 '채팅 로어북' 영역. 이 채팅에만 연결되는 로어북(chat_metadata.world_info).
 *
 * - 새 채팅: 기본 '없음'. 고르면 헤더에 미리 넣어 ST 가 불러올 때 바로 적용된다.
 * - 기존 채팅: 기본 '유지'(현재 연결 표시). 바꾼 경우에만 입장 후 덮어쓴다.
 *
 * @param {HTMLElement} root
 * @param {{ onCreateRequest?: () => void }} [options] '새 로어북 만들기…'를 골랐을 때
 */
export function createChatLoreSection(root, { onCreateRequest = () => { } } = {}) {
    const section = /** @type {HTMLElement} */ (root.querySelector('.st-chat-setup-chat-lore'));
    const select = /** @type {HTMLSelectElement} */ (section.querySelector('select'));
    const hint = /** @type {HTMLElement} */ (section.querySelector('.st-chat-setup-hint'));

    /** @type {ChatMode} */
    let mode = 'new';
    /** @type {ChatInfo | null} */
    let chat = null;
    let dirty = false;

    const names = getLorebookNames();

    const describeExisting = () => {
        const current = chat?.metadata?.[METADATA_KEY];
        if (!current) return tr('lore_none_short', 'none');
        return names.includes(current) ? current : tr('lore_missing', 'deleted lorebook');
    };

    const renderOptions = () => {
        const previous = select.value;
        select.replaceChildren();

        if (mode === 'existing') {
            select.append(new Option(tr('lore_keep', 'Keep current ({0})').replace('{0}', describeExisting()), KEEP));
            select.append(new Option(tr('lore_unlink', 'None (unlink)'), NONE));
        } else {
            select.append(new Option(tr('lore_none', 'None'), NONE));
        }
        for (const name of names) {
            select.append(new Option(name, name));
        }
        select.append(createLorebookOption());

        const fallback = mode === 'existing' ? KEEP : NONE;
        const canKeepPrevious = dirty && [...select.options].some(o => o.value === previous);
        select.value = canKeepPrevious ? previous : fallback;
        if (!canKeepPrevious) dirty = false;
        renderHint();
    };

    const renderHint = () => {
        const value = select.value;
        if (mode === 'existing') {
            hint.textContent = value === KEEP ? '' : tr('lore_hint_override', 'This chat\'s lorebook will be changed when you enter.');
        } else {
            hint.textContent = value === NONE ? '' : tr('lore_hint_new', 'Linked only to this chat.');
        }
        hint.hidden = !hint.textContent;
    };

    // '새 로어북 만들기…'는 값이 아니라 동작이다. 고르면 이전 값으로 되돌리고 만들기 창을 띄운다
    let lastValue = select.value;
    select.addEventListener('change', () => {
        if (select.value === CREATE) {
            select.value = lastValue;
            onCreateRequest();
            return;
        }
        lastValue = select.value;
        dirty = true;
        renderHint();
    });

    renderOptions();
    lastValue = select.value;

    return {
        /**
         * 새로 만든 로어북을 목록에 넣는다. select 가 true 면 이 칸에서 바로 고른다.
         * @param {string} name
         * @param {{ select?: boolean }} [options]
         */
        addLorebook(name, { select: pick = false } = {}) {
            if (!names.includes(name)) {
                names.push(name);
                names.sort((a, b) => a.localeCompare(b));
            }
            renderOptions();
            if (pick) {
                select.value = name;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            lastValue = select.value;
        },

        /** @param {{ mode: ChatMode, chat: ChatInfo | null }} state */
        update(state) {
            const modeChanged = state.mode !== mode;
            const chatChanged = (state.chat?.fileName ?? null) !== (chat?.fileName ?? null);
            mode = state.mode;
            chat = state.chat;
            if (!modeChanged && !chatChanged) return;
            // 채팅이 바뀌면 그 채팅 기준으로 다시 맞춘다(앞 채팅용으로 고른 값을 다른 채팅에 조용히 적용하지 않게)
            dirty = false;
            renderOptions();
            lastValue = select.value;
        },

        /** 접힌 로어북 묶음의 요약에 쓸 짧은 값 */
        getSummary() {
            const value = select.value;
            if (value === KEEP) return describeExisting();
            return value === NONE ? tr('lore_none_short', 'none') : value;
        },

        /** @returns {ChatLoreChoice} */
        getValue() {
            const value = select.value;
            if (mode === 'existing') {
                return { newChatLore: null, existingOverride: (dirty && value !== KEEP) ? value : null };
            }
            return { newChatLore: names.includes(value) ? value : null, existingOverride: null };
        },
    };
}
