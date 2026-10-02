import { characters, is_send_press, isChatSaving } from '../../../../../script.js';
import { humanizedDateTime } from '../../../../RossAscends-mods.js';
import { LOG_PREFIX } from './constants.js';
import { chatFileExists, getChatList } from './data-source.js';
import { tr } from './i18n.js';
import { isDuplicateChatName, sanitizeChatName } from './utils.js';

/** @typedef {import('./data-source.js').ChatInfo} ChatInfo */
/** @typedef {'new' | 'existing'} ChatMode */

/**
 * 입장창의 '채팅' 영역: 새 채팅(이름 입력) / 기존 채팅(목록 선택) 중 하나만 받는다.
 *
 * @param {HTMLElement} root 입장창 dialog
 * @param {object} options
 * @param {number} options.chid
 * @param {() => boolean} options.isStale 이 입장창이 이미 다른 창으로 대체됐는지 (늦게 온 목록 응답 무시용)
 * @param {() => void} options.onSubmit 이름 칸에서 Enter
 * @param {(state: { mode: ChatMode, chat: ChatInfo | null }) => void} [options.onChange] 모드나 선택한 기존 채팅이 바뀔 때
 * @param {string} [options.personaName] 새 채팅 기본 이름에 넣을 페르소나 이름. 빈 값이면 넣지 않는다
 */
export function createChatSection(root, { chid, isStale, onSubmit, onChange = () => { }, personaName = '' }) {
    const character = characters[chid];
    const lastOpenedChat = String(character?.chat ?? '');

    /** @type {ChatMode} */
    let mode = 'new';
    /** @type {ChatInfo[] | null} null = 아직 불러오는 중 */
    let chats = null;
    let loadFailed = false;
    /** @type {string | null} */
    let selectedChat = null;

    const section = /** @type {HTMLElement} */ (root.querySelector('.st-chat-setup-chat'));
    const modeInputs = /** @type {NodeListOf<HTMLInputElement>} */ (section.querySelectorAll('input[data-mode-radio]'));
    const nameInput = /** @type {HTMLInputElement} */ (section.querySelector('.st-chat-setup-chat-name'));
    const list = /** @type {HTMLElement} */ (section.querySelector('.st-chat-setup-chat-list'));
    const countBadge = /** @type {HTMLElement} */ (section.querySelector('.st-chat-setup-chat-count'));
    // 오류 칸은 버튼 바로 위(입장창 맨 아래)에 있다. 입장 실패 안내도 같은 칸을 쓴다
    const errorBox = /** @type {HTMLElement} */ (root.querySelector('.st-chat-setup-error'));
    const existingRadio = [...modeInputs].find(input => input.value === 'existing');

    // 닫히는 중인 이전 입장창과 라디오 그룹이 섞이지 않도록 창마다 고유한 name 을 쓴다
    const modeGroupName = `st_chat_setup_mode_${Math.random().toString(36).slice(2)}`;
    for (const input of modeInputs) input.name = modeGroupName;

    // 기본 이름: '캐릭터명 - 페르소나명 - 날짜시간' (ST 기본 '캐릭터명 - 날짜시간' 사이에 페르소나명).
    // 시각은 창을 연 때로 고정하고, 페르소나가 바뀌면 그 부분만 바꾼다. 사용자가 이름을 직접 고치면 더는 건드리지 않는다
    const stamp = humanizedDateTime();
    let nameEdited = false;
    const buildDefaultName = (/** @type {string} */ persona) => [character?.name ?? '', persona, stamp]
        .filter(part => part && part.trim())
        .join(' - ');
    nameInput.value = buildDefaultName(personaName);
    nameInput.addEventListener('input', () => { nameEdited = true; });

    const getSelectedChatInfo = () => chats?.find(c => c.fileName === selectedChat) ?? null;
    const notify = () => onChange({ mode, chat: mode === 'existing' ? getSelectedChatInfo() : null });

    const setMode = (/** @type {ChatMode} */ next) => {
        mode = next;
        for (const input of modeInputs) input.checked = input.value === mode;
        for (const body of section.querySelectorAll('[data-mode-body]')) {
            /** @type {HTMLElement} */ (body).hidden = body.getAttribute('data-mode-body') !== mode;
        }
        hideError();
        notify();
    };

    const showError = (/** @type {string} */ message) => {
        errorBox.textContent = message;
        errorBox.hidden = false;
        // 휴대폰: 오류가 화면 밖(창 아래쪽)에 생겨도 보이도록
        errorBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    const hideError = () => {
        errorBox.hidden = true;
        errorBox.textContent = '';
    };

    const renderList = () => {
        list.replaceChildren();

        if (loadFailed) {
            list.append(createMessage(tr('chat_list_failed', 'Could not load the chat list.')));
            return;
        }
        if (chats === null) {
            list.append(createMessage(tr('chat_list_loading', 'Loading chats…')));
            return;
        }
        if (chats.length === 0) {
            list.append(createMessage(tr('chat_list_empty', 'This character has no chats yet.')));
            return;
        }

        const groupName = `st_chat_setup_chat_${Math.random().toString(36).slice(2)}`;
        for (const chat of chats) {
            list.append(createChatItem(chat, groupName, chat.fileName === selectedChat, chat.fileName === lastOpenedChat, () => {
                selectedChat = chat.fileName;
                hideError();
                notify();
            }));
        }
    };

    for (const input of modeInputs) {
        input.addEventListener('change', () => input.checked && setMode(/** @type {ChatMode} */ (input.value)));
    }

    nameInput.addEventListener('input', hideError);
    nameInput.addEventListener('keydown', (event) => {
        // 한글 조합 중의 Enter 는 글자 확정이지 제출이 아니다
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        onSubmit();
    });
    // 모바일: 가상 키보드가 올라온 뒤에도 입력칸이 보이도록
    nameInput.addEventListener('focus', () => {
        setTimeout(() => nameInput.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
    });

    setMode('new');
    renderList();

    getChatList(chid)
        .then(result => {
            if (isStale()) return;
            chats = result;
            // 마지막으로 연 채팅이 있으면 그것을, 없으면 가장 최근 채팅을 미리 골라 둔다
            selectedChat = chats.find(c => c.fileName === lastOpenedChat)?.fileName ?? chats[0]?.fileName ?? null;
        })
        .catch(error => {
            if (isStale()) return;
            console.error(LOG_PREFIX, 'failed to load chat list', error);
            loadFailed = true;
        })
        .finally(() => {
            if (isStale()) return;
            const count = chats?.length ?? 0;
            countBadge.textContent = chats ? `(${count})` : '';
            if (existingRadio) existingRadio.disabled = !count;
            renderList();
            notify();
        });

    return {
        showError,

        /**
         * 페르소나 선택이 바뀌면 새 채팅 기본 이름의 페르소나 부분을 바꾼다. 사용자가 이름을 고쳤으면 그대로 둔다.
         * @param {string} persona 페르소나 이름. 빈 값이면 이름에서 뺀다
         */
        setPersonaName(persona) {
            if (nameEdited) return;
            nameInput.value = buildDefaultName(persona);
        },

        /**
         * 입장 전에 확인한다. 문제가 있으면 창 안에 이유를 보여 주고 해당 칸으로 포커스를 옮긴다.
         * @returns {Promise<boolean>}
         */
        async validate() {
            if (is_send_press || isChatSaving) {
                showError(tr('busy', 'Please wait until the reply is finished and the chat is saved.'));
                return false;
            }

            if (mode === 'new') {
                const name = sanitizeChatName(nameInput.value);
                if (!name) {
                    showError(tr('name_required', 'Enter a chat name.'));
                    nameInput.focus();
                    return false;
                }
                // 목록이 아직 없거나 실패했어도 서버에 직접 물어 확인한다(그 사이 다른 곳에서 만들어졌을 수도 있다)
                let exists = !!chats && isDuplicateChatName(name, chats);
                if (!exists) {
                    try {
                        exists = await chatFileExists(chid, name);
                    } catch (error) {
                        console.error(LOG_PREFIX, 'failed to check chat name', error);
                        showError(tr('name_check_failed', 'Could not check the chat name. Try again in a moment.'));
                        return false;
                    }
                }
                if (exists) {
                    showError(tr('name_duplicate', 'A chat with this name already exists.'));
                    nameInput.focus();
                    return false;
                }
                // 금지 문자가 빠졌다면 실제로 쓰일 이름을 보여 준다
                nameInput.value = name;
                return true;
            }

            if (!selectedChat || !chats?.some(c => c.fileName === selectedChat)) {
                showError(tr('chat_required', 'Select a chat.'));
                return false;
            }
            return true;
        },

        /** validate() 를 통과한 뒤의 선택값 */
        getValue() {
            return mode === 'new'
                ? { mode, fileName: sanitizeChatName(nameInput.value) }
                : { mode, fileName: /** @type {string} */ (selectedChat), chat: chats?.find(c => c.fileName === selectedChat) };
        },
    };
}

/** @param {string} text */
function createMessage(text) {
    const div = document.createElement('div');
    div.className = 'st-chat-setup-chat-message';
    div.textContent = text;
    return div;
}

/**
 * 기존 채팅 한 줄. 줄 전체가 라디오 버튼의 label 이라 어디를 눌러도 선택된다(모바일 터치 대상 확보).
 * 채팅 이름·미리보기는 사용자 데이터라 textContent 로만 넣는다.
 * @param {ChatInfo} chat
 * @param {string} groupName
 * @param {boolean} checked
 * @param {boolean} isLastOpened
 * @param {() => void} onSelect
 */
function createChatItem(chat, groupName, checked, isLastOpened, onSelect) {
    const label = document.createElement('label');
    label.className = 'st-chat-setup-chat-item';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = groupName;
    radio.value = chat.fileName;
    radio.checked = checked;
    radio.addEventListener('change', () => radio.checked && onSelect());

    const body = document.createElement('div');
    body.className = 'st-chat-setup-chat-body';

    const name = document.createElement('div');
    name.className = 'st-chat-setup-chat-title';
    name.textContent = chat.fileName;

    const meta = document.createElement('div');
    meta.className = 'st-chat-setup-chat-meta';
    const parts = [chat.lastDate, tr('message_count', '{0} messages').replace('{0}', String(chat.count))].filter(Boolean);
    meta.textContent = parts.join(' · ');
    if (isLastOpened) {
        const badge = document.createElement('span');
        badge.className = 'st-chat-setup-badge';
        badge.textContent = tr('last_opened', 'Last opened');
        meta.append(' ', badge);
    }

    const preview = document.createElement('div');
    preview.className = 'st-chat-setup-chat-preview';
    preview.textContent = chat.preview;

    body.append(name, meta, preview);
    label.append(radio, body);
    return label;
}
