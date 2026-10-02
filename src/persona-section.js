import { characters, getThumbnailUrl } from '../../../../../script.js';
import { getConnectedPersonas, user_avatar } from '../../../../personas.js';
import { power_user } from '../../../../power-user.js';
import { AUTO, KEEP } from './constants.js';
import { tr } from './i18n.js';

/** @typedef {import('./data-source.js').ChatInfo} ChatInfo */
/** @typedef {import('./chat-section.js').ChatMode} ChatMode */

/**
 * @typedef {Object} PersonaChoice
 * @property {string | null} newChatLock 새 채팅 헤더의 chat_metadata.persona 로 넣을 페르소나. null = 넣지 않음(ST 규칙에 맡김)
 * @property {string | null} existingOverride 기존 채팅에 입장한 뒤 적용할 값. 페르소나 id 또는 AUTO(고정 해제). null = 유지
 */

/** @param {string} id */
const personaName = (id) => power_user.personas?.[id] || id;
/** @param {string} id */
const personaExists = (id) => !!id && Object.hasOwn(power_user.personas ?? {}, id);

/**
 * 새 채팅에서 ST 가 고를 페르소나를 미리 계산한다 (personas.js loadPersonaForCurrentChat 와 같은 우선순위).
 * 채팅 고정 → (새 채팅이라 없음) → 캐릭터 연결 → 기본 페르소나 → 지금 페르소나
 * @param {number} chid
 * @returns {string} 페르소나 id
 */
function predictNewChatPersona(chid) {
    const connected = getConnectedPersonas(characters[chid]?.avatar).filter(personaExists);
    if (connected.length) return connected[0];
    if (personaExists(power_user.default_persona)) return power_user.default_persona;
    return user_avatar;
}

/**
 * 입장창의 '페르소나' 영역.
 *
 * - 새 채팅: ST 가 고를 페르소나를 미리 선택해 두고, 칸에 보이는 페르소나를 그대로 이 채팅에 고정(헤더 선기록)한다.
 *   입장창에서 직접 보고 고르는 화면이므로 '보이는 대로 고정'이 사용자 기대와 맞다.
 *   '자동'을 고르면 고정하지 않고 ST 규칙에 맡긴다.
 * - 기존 채팅: 기본은 '유지'(현재 값 표시). 바꾼 경우에만 입장 후 덮어쓴다.
 * 캐릭터의 기본 페르소나 연결 자체는 바꾸지 않는다.
 *
 * @param {HTMLElement} root
 * @param {{ chid: number, onNewChatPersonaChange?: (name: string) => void, onTargetPersonaChange?: (id: string | null) => void }} options
 *   onNewChatPersonaChange: 새 채팅 모드에서 선택한 페르소나의 이름('자동'이면 빈 값)이 바뀔 때
 *   onTargetPersonaChange: 입장 후 쓰일 페르소나가 바뀔 때(알 수 없으면 null). 페르소나 로어북 칸이 따라간다
 *   avatarUrl: 페르소나 이미지 주소(작게: 썸네일 / 크게: 원본)
 */
export function createPersonaSection(root, {
    chid,
    onNewChatPersonaChange = () => { },
    onTargetPersonaChange = () => { },
    avatarUrl = (id) => getThumbnailUrl('persona', id),
}) {
    const section = /** @type {HTMLElement} */ (root.querySelector('.st-chat-setup-persona'));
    const select = /** @type {HTMLSelectElement} */ (section.querySelector('.st-chat-setup-persona-select'));
    const avatar = /** @type {HTMLImageElement} */ (section.querySelector('.st-chat-setup-persona-avatar'));
    const hint = /** @type {HTMLElement} */ (section.querySelector('.st-chat-setup-persona-hint'));

    const prediction = predictNewChatPersona(chid);
    const connected = new Set(getConnectedPersonas(characters[chid]?.avatar));

    /** @type {ChatMode} */
    let mode = 'new';
    /** @type {ChatInfo | null} */
    let chat = null;
    let dirty = false;

    const personaIds = Object.keys(power_user.personas ?? {})
        .sort((a, b) => personaName(a).localeCompare(personaName(b)));

    /** @param {string} id */
    const labelFor = (id) => {
        const marks = [];
        if (connected.has(id)) marks.push(tr('persona_connected', 'connected'));
        if (id === power_user.default_persona) marks.push(tr('persona_default', 'default'));
        return marks.length ? `${personaName(id)} (${marks.join(', ')})` : personaName(id);
    };

    /** 기존 채팅에 지금 고정된 페르소나 설명 */
    const describeExisting = () => {
        const locked = chat?.metadata?.persona;
        if (!locked) return tr('persona_not_locked', 'not locked');
        return personaExists(locked) ? personaName(locked) : tr('persona_missing', 'deleted persona');
    };

    const renderOptions = () => {
        const previous = select.value;
        select.replaceChildren();

        if (mode === 'existing') {
            select.append(new Option(tr('persona_keep', 'Keep current ({0})').replace('{0}', describeExisting()), KEEP));
            select.append(new Option(tr('persona_unlock', 'Unlock (follow SillyTavern rules)'), AUTO));
        } else {
            select.append(new Option(tr('persona_auto', 'Automatic (follow SillyTavern rules)'), AUTO));
        }
        for (const id of personaIds) {
            select.append(new Option(labelFor(id), id));
        }

        const fallback = mode === 'existing' ? KEEP : (personaExists(prediction) ? prediction : AUTO);
        const canKeepPrevious = dirty && [...select.options].some(o => o.value === previous);
        select.value = canKeepPrevious ? previous : fallback;
        if (!canKeepPrevious) dirty = false;
        renderPreview();
    };

    const renderPreview = () => {
        const value = select.value;
        const shownId = personaExists(value) ? value
            : (value === KEEP && personaExists(chat?.metadata?.persona)) ? chat.metadata.persona
                : null;
        avatar.hidden = !shownId;
        if (shownId) avatar.src = avatarUrl(shownId);

        if (mode === 'existing') {
            hint.textContent = value === KEEP
                ? tr('persona_hint_keep', 'The persona saved in this chat is used as is.')
                : tr('persona_hint_override', 'This chat\'s persona will be changed when you enter.');
        } else if (value === AUTO) {
            hint.textContent = tr('persona_hint_auto', 'Not locked. SillyTavern picks the persona each time this chat opens.');
        } else {
            hint.textContent = tr('persona_hint_lock', 'This persona will be locked to the new chat.');
        }
        hint.hidden = !hint.textContent;

        if (mode === 'new') onNewChatPersonaChange(getNewChatPersonaName());
        onTargetPersonaChange(getTargetPersonaId());
    };

    /** 새 채팅에 쓰일 페르소나 이름. '자동'이면 빈 값 */
    const getNewChatPersonaName = () => personaExists(select.value) ? personaName(select.value) : '';

    /**
     * 입장 후 쓰일 페르소나. 확정할 수 없으면 null.
     * - 특정 페르소나 선택 → 그 페르소나
     * - 기존 채팅 '유지' → 채팅에 고정된 페르소나가 있으면 그것, 없으면 열어 봐야 알 수 있으므로 null
     * - 자동 / 고정 해제 → ST 가 열 때 정하므로 null
     */
    const getTargetPersonaId = () => {
        const value = select.value;
        if (personaExists(value)) return value;
        if (value === KEEP && personaExists(chat?.metadata?.persona)) return chat.metadata.persona;
        return null;
    };

    select.addEventListener('change', () => {
        dirty = true;
        renderPreview();
    });

    renderOptions();

    return {
        getNewChatPersonaName,
        getTargetPersonaId,

        /**
         * 채팅 영역의 모드/선택이 바뀔 때 호출된다.
         * @param {{ mode: ChatMode, chat: ChatInfo | null }} state
         */
        update(state) {
            const modeChanged = state.mode !== mode;
            const chatChanged = (state.chat?.fileName ?? null) !== (chat?.fileName ?? null);
            mode = state.mode;
            chat = state.chat;
            if (!modeChanged && !chatChanged) return;
            // 채팅(모드나 고른 기존 채팅)이 바뀌면 페르소나 칸은 그 채팅 기준으로 다시 맞춘다.
            // 앞에서 고른 페르소나를 남겨 두면, 다른 페르소나가 고정된 기존 채팅을 모르는 사이 덮어쓰게 된다
            dirty = false;
            renderOptions();
        },

        /** @returns {PersonaChoice} */
        getValue() {
            const value = select.value;
            if (mode === 'existing') {
                return { newChatLock: null, existingOverride: (dirty && value !== KEEP) ? value : null };
            }
            // 새 채팅: 칸에 보이는 페르소나를 그대로 고정한다. '자동'이면 고정하지 않는다
            return { newChatLock: personaExists(value) ? value : null, existingOverride: null };
        },
    };
}
