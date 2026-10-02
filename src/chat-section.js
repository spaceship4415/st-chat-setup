import { characters, is_send_press, isChatSaving, substituteParams, unshallowCharacter } from '../../../../../script.js';
import { Popup } from '../../../../popup.js';
import { deleteCharacterChat, isChatBusy, isOpenChat, renameCharacterChat } from './chat-manage.js';
import { LOG_PREFIX } from './constants.js';
import { chatFileExists, getChatList } from './data-source.js';
import { tr } from './i18n.js';
import { askName } from './name-prompt.js';
import { getSettings, setSetting } from './settings.js';
import { formatChatStamp, isDuplicateChatName, sanitizeChatName, toPlainPreview } from './utils.js';

/** @typedef {import('./data-source.js').ChatInfo} ChatInfo */
/** @typedef {'new' | 'existing'} ChatMode */
/** @typedef {'recent' | 'oldest' | 'name' | 'messages'} ChatSort */

/** 채팅이 이보다 적으면 검색·정렬 칸을 숨긴다(몇 개뿐이면 오히려 방해) */
const TOOLS_MIN_CHATS = 4;
const CHAT_SORTS = ['recent', 'oldest', 'name', 'messages'];

/**
 * 목록 표시 순서. 원본 배열(최근 순)은 그대로 두고 복사해서 정렬한다
 * @param {ChatInfo[]} chats
 * @param {ChatSort} sort
 */
function sortChats(chats, sort) {
    const sorted = [...chats];
    switch (sort) {
        case 'oldest': return sorted.reverse();
        case 'name': return sorted.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' }));
        case 'messages': return sorted.sort((a, b) => b.count - a.count || b.lastTime - a.lastTime);
        default: return sorted;
    }
}

/**
 * 새 채팅의 시작 인사말 후보. ST(getFirstMessage)가 첫 메시지를 만드는 순서와 같다:
 * [첫 메시지, 대체 인사말 1, 2, …] 를 스와이프로 묶고, 첫 메시지가 비어 있으면 그 자리를 뺀다.
 * 그래서 배열의 순서가 곧 스와이프 번호다.
 * @param {any} character
 * @returns {{ label: string, text: string }[]}
 */
function buildGreetings(character) {
    const first = typeof character?.first_mes === 'string' ? character.first_mes : '';
    const alternates = Array.isArray(character?.data?.alternate_greetings)
        ? character.data.alternate_greetings.filter((/** @type {any} */ g) => typeof g === 'string')
        : [];
    const greetings = [
        { label: tr('greeting_first', 'First message'), text: first },
        ...alternates.map((/** @type {string} */ text, /** @type {number} */ i) => ({
            label: tr('greeting_alternate', 'Alternate greeting {0}').replace('{0}', String(i + 1)),
            text,
        })),
    ];
    if (!first) greetings.shift();
    return greetings;
}

/**
 * 입장창의 '채팅' 영역: 새 채팅(이름 입력·시작 인사말) / 기존 채팅(목록 선택) 중 하나만 받는다.
 *
 * @param {HTMLElement} root 입장창 dialog
 * @param {object} options
 * @param {number} options.chid
 * @param {() => boolean} options.isStale 이 입장창이 이미 다른 창으로 대체됐는지 (늦게 온 목록 응답 무시용)
 * @param {() => void} options.onSubmit 이름 칸에서 Enter
 * @param {(state: { mode: ChatMode, chat: ChatInfo | null }) => void} [options.onChange] 모드나 선택한 기존 채팅이 바뀔 때
 * @param {string} [options.personaName] 새 채팅 기본 이름에 넣을 페르소나 이름. 빈 값이면 넣지 않는다
 * @param {ChatMode} [options.initialMode] 처음 고를 채팅 방식. 기존 채팅이 없으면 목록을 불러온 뒤 새 채팅으로 바꾼다
 * @param {string} [options.stampStyle] 새 채팅 기본 이름의 날짜·시각 형식(utils.formatChatStamp)
 */
export function createChatSection(root, { chid, isStale, onSubmit, onChange = () => { }, personaName = '', initialMode = 'new', stampStyle = 'minute' }) {
    const character = characters[chid];
    // 이름 바꾸기·삭제로 달라질 수 있다
    let lastOpenedChat = String(character?.chat ?? '');

    /** @type {ChatMode} */
    let mode = 'new';
    /** @type {ChatInfo[] | null} null = 아직 불러오는 중 */
    let chats = null;
    let loadFailed = false;
    /** @type {string | null} */
    let selectedChat = null;
    let query = '';
    /** @type {ChatSort} */
    let sort = /** @type {ChatSort} */ (CHAT_SORTS.includes(getSettings().chatListSort) ? getSettings().chatListSort : 'recent');
    /** 이름 바꾸기·삭제 처리 중(그 사이 입장하지 않도록) */
    let managing = false;
    /** 검색용 평문 미리보기(채팅마다 한 번만 만든다) */
    const plainPreviews = new WeakMap();
    const plainPreviewOf = (/** @type {ChatInfo} */ chat) => {
        if (!plainPreviews.has(chat)) plainPreviews.set(chat, toPlainPreview(chat.preview));
        return plainPreviews.get(chat);
    };

    const section = /** @type {HTMLElement} */ (root.querySelector('.st-chat-setup-chat'));
    const modeInputs = /** @type {NodeListOf<HTMLInputElement>} */ (section.querySelectorAll('input[data-mode-radio]'));
    const nameInput = /** @type {HTMLInputElement} */ (section.querySelector('.st-chat-setup-chat-name'));
    const list = /** @type {HTMLElement} */ (section.querySelector('.st-chat-setup-chat-list'));
    const countBadge = /** @type {HTMLElement} */ (section.querySelector('.st-chat-setup-chat-count'));
    const tools = /** @type {HTMLElement} */ (section.querySelector('.st-chat-setup-chat-tools'));
    const searchInput = /** @type {HTMLInputElement} */ (section.querySelector('.st-chat-setup-chat-search'));
    const sortSelect = /** @type {HTMLSelectElement} */ (section.querySelector('.st-chat-setup-chat-sort'));
    const greetingBox = /** @type {HTMLElement} */ (section.querySelector('.st-chat-setup-greeting-pick'));
    const greetingSelect = /** @type {HTMLSelectElement} */ (section.querySelector('.st-chat-setup-greeting-select'));
    const greetingPreview = /** @type {HTMLElement} */ (section.querySelector('.st-chat-setup-greeting-preview'));
    // 오류 칸은 버튼 바로 위(입장창 맨 아래)에 있다. 입장 실패 안내도 같은 칸을 쓴다
    const errorBox = /** @type {HTMLElement} */ (root.querySelector('.st-chat-setup-error'));
    const existingRadio = [...modeInputs].find(input => input.value === 'existing');

    // 닫히는 중인 이전 입장창과 라디오 그룹이 섞이지 않도록 창마다 고유한 name 을 쓴다
    const modeGroupName = `st_chat_setup_mode_${Math.random().toString(36).slice(2)}`;
    for (const input of modeInputs) input.name = modeGroupName;

    // ── 새 채팅 기본 이름 ──
    // '캐릭터 - 페르소나 - 날짜·시각'(형식은 설정). 시각은 창을 연 때로 고정하고, 페르소나가 바뀌면 그 부분만 바꾼다.
    // 날짜·분 단위면 같은 이름이 이미 있을 수 있으므로 목록을 받은 뒤 ' (2)', ' (3)' … 을 붙인다.
    // 사용자가 이름을 직접 고치면 더는 건드리지 않는다
    const stamp = formatChatStamp(stampStyle);
    let currentPersonaName = personaName;
    let nameEdited = false;
    const buildDefaultName = () => {
        const base = [character?.name ?? '', currentPersonaName, stamp]
            .filter(part => part && part.trim())
            .join(' - ');
        if (!chats) return base;
        let candidate = base;
        for (let n = 2; isDuplicateChatName(sanitizeChatName(candidate), chats); n++) {
            candidate = `${base} (${n})`;
        }
        return candidate;
    };
    const refreshDefaultName = () => {
        if (!nameEdited) nameInput.value = buildDefaultName();
    };
    refreshDefaultName();
    nameInput.addEventListener('input', () => { nameEdited = true; });

    // ── 시작 인사말 ──
    // 가벼운(shallow) 캐릭터는 대체 인사말이 아직 없을 수 있어 전체 카드를 받은 뒤 채운다
    /** @type {{ label: string, text: string }[]} */
    let greetings = [];
    const renderGreetingPreview = () => {
        const greeting = greetings[Number(greetingSelect.value)] ?? greetings[0];
        greetingPreview.textContent = greeting
            ? toPlainPreview(substituteParams(greeting.text, { name1Override: currentPersonaName || undefined, name2Override: character?.name }), { keepLines: true })
            : '';
    };
    const renderGreetings = () => {
        greetings = buildGreetings(characters[chid]);
        greetingSelect.replaceChildren(...greetings.map((g, i) => new Option(g.label, String(i))));
        greetingSelect.value = '0';
        // 고를 게 하나뿐이면 보여 줄 필요가 없다
        greetingBox.hidden = greetings.length < 2;
        renderGreetingPreview();
    };
    greetingSelect.addEventListener('change', renderGreetingPreview);
    greetingBox.hidden = true;
    unshallowCharacter(chid)
        .then(() => { if (!isStale()) renderGreetings(); })
        .catch(error => console.warn(LOG_PREFIX, 'failed to load greetings', error));

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

    /** 검색어에 맞는 채팅을 지금 정렬 순서로 */
    const getVisibleChats = () => {
        if (!chats) return [];
        const needle = query.trim().toLocaleLowerCase();
        const matched = needle
            ? chats.filter(chat => chat.fileName.toLocaleLowerCase().includes(needle) || plainPreviewOf(chat).toLocaleLowerCase().includes(needle))
            : chats;
        return sortChats(matched, sort);
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

        const visible = getVisibleChats();
        if (visible.length === 0) {
            list.append(createMessage(tr('chat_search_empty', 'No chats match your search.')));
            return;
        }

        const groupName = `st_chat_setup_chat_${Math.random().toString(36).slice(2)}`;
        for (const chat of visible) {
            list.append(createChatItem(chat, {
                groupName,
                checked: chat.fileName === selectedChat,
                isLastOpened: chat.fileName === lastOpenedChat,
                isOpen: isOpenChat(chid, chat.fileName),
                preview: plainPreviewOf(chat),
                onSelect: () => {
                    selectedChat = chat.fileName;
                    hideError();
                    notify();
                },
                onRename: () => renameChat(chat),
                onDelete: () => deleteChat(chat),
            }));
        }
    };

    /** 고른 채팅이 목록 안에 보이도록(목록만 스크롤하고 창 전체는 움직이지 않는다) */
    const revealSelected = () => {
        const checked = list.querySelector('input[type="radio"]:checked');
        const item = checked?.closest('.st-chat-setup-chat-item');
        if (!(item instanceof HTMLElement)) return;
        const listRect = list.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
            list.scrollTop += itemRect.top - listRect.top - 6;
        }
    };

    /** 채팅 수 표시, 기존 채팅 선택 가능 여부, 검색·정렬 칸 표시를 목록에 맞춘다 */
    const syncCount = () => {
        const count = chats?.length ?? 0;
        countBadge.textContent = chats ? `(${count})` : '';
        if (existingRadio) existingRadio.disabled = !count;
        tools.hidden = count < TOOLS_MIN_CHATS;
    };

    // ── 검색·정렬 ──
    sortSelect.value = sort;
    sortSelect.addEventListener('change', () => {
        sort = /** @type {ChatSort} */ (sortSelect.value);
        if (getSettings().chatListSort !== sort) setSetting('chatListSort', sort);
        renderList();
        list.scrollTop = 0;
    });
    searchInput.addEventListener('input', () => {
        query = searchInput.value;
        // 고른 채팅이 검색 결과에서 빠지면 보이는 첫 채팅을 고른다(안 보이는 채팅으로 입장하지 않도록)
        const visible = getVisibleChats();
        if (visible.length && !visible.some(chat => chat.fileName === selectedChat)) {
            selectedChat = visible[0].fileName;
            notify();
        }
        hideError();
        renderList();
        list.scrollTop = 0;
    });
    searchInput.addEventListener('keydown', (event) => {
        // 검색칸의 Enter 는 입장이 아니라 키보드 닫기
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        searchInput.blur();
    });

    // ── 이름 바꾸기·삭제 ──
    const renameChat = async (/** @type {ChatInfo} */ chat) => {
        if (managing) return;
        hideError();
        if (isOpenChat(chid, chat.fileName) && isChatBusy()) {
            showError(tr('busy', 'Please wait until the reply is finished and the chat is saved.'));
            return;
        }
        const input = await askName({
            title: tr('chat_rename_title', 'Rename chat'),
            text: tr('chat_rename_text', 'Enter a new name for this chat.'),
            defaultName: chat.fileName,
            okButton: tr('chat_rename_ok', 'Rename'),
        });
        if (!input || isStale()) return;
        const name = sanitizeChatName(input);
        if (!name) {
            showError(tr('name_required', 'Enter a chat name.'));
            return;
        }
        if (name === chat.fileName) return;

        managing = true;
        try {
            // 대소문자만 바꾸는 것도 Windows 에서는 같은 파일이라 서버가 거절한다. 미리 같은 이름으로 막는다
            const others = (chats ?? []).filter(c => c !== chat);
            if (isDuplicateChatName(name, others) || name.toLocaleLowerCase() === chat.fileName.toLocaleLowerCase()
                || await chatFileExists(chid, name)) {
                showError(tr('name_duplicate', 'A chat with this name already exists.'));
                return;
            }
            const oldName = chat.fileName;
            const actual = await renameCharacterChat(chid, oldName, name);
            if (isStale()) return;
            // 객체를 그대로 고쳐서, 다른 칸(페르소나·채팅 로어북)이 '다른 채팅으로 바뀜'으로 보고 선택을 되돌리지 않게 한다
            chat.fileName = actual;
            if (selectedChat === oldName) selectedChat = actual;
            if (lastOpenedChat === oldName) lastOpenedChat = actual;
            toastr.success(tr('chat_renamed', 'Chat renamed.'), actual);
            refreshDefaultName();
            renderList();
            notify();
        } catch (error) {
            console.error(LOG_PREFIX, 'failed to rename chat', error);
            showError(tr('chat_rename_failed', 'Could not rename the chat.'));
        } finally {
            managing = false;
        }
    };

    const deleteChat = async (/** @type {ChatInfo} */ chat) => {
        if (managing) return;
        hideError();
        if (isOpenChat(chid, chat.fileName)) {
            showError(tr('chat_delete_open', 'The chat that is open right now cannot be deleted here.'));
            return;
        }

        const body = document.createElement('div');
        const nameLine = document.createElement('div');
        nameLine.className = 'st-chat-setup-confirm-name';
        nameLine.textContent = chat.fileName;
        const metaLine = document.createElement('div');
        metaLine.textContent = [chat.lastDate, tr('message_count', '{0} messages').replace('{0}', String(chat.count))].filter(Boolean).join(' · ');
        const warning = document.createElement('p');
        warning.className = 'st-chat-setup-confirm-warning';
        warning.textContent = tr('chat_delete_warning', 'The chat file will be deleted. This cannot be undone.');
        body.append(nameLine, metaLine, warning);

        const confirmed = await Popup.show.confirm(tr('chat_delete_title', 'Delete this chat?'), body.outerHTML, {
            okButton: tr('chat_delete_ok', 'Delete'),
            cancelButton: tr('cancel', 'Cancel'),
        });
        if (!confirmed || isStale() || !chats?.includes(chat)) return;

        managing = true;
        try {
            const remaining = chats.filter(c => c !== chat);
            await deleteCharacterChat(chid, chat.fileName, remaining.map(c => c.fileName));
            if (isStale()) return;
            chats = remaining;
            // 마지막으로 연 채팅을 지웠으면 ST 처럼 옮긴 곳을 따른다
            lastOpenedChat = String(characters[chid]?.chat ?? '');
            if (selectedChat === chat.fileName) {
                const visible = getVisibleChats();
                selectedChat = visible[0]?.fileName ?? chats[0]?.fileName ?? null;
            }
            toastr.success(tr('chat_deleted', 'Chat deleted.'), chat.fileName);
            syncCount();
            refreshDefaultName();
            renderList();
            if (!chats.length) {
                setMode('new');
            } else {
                notify();
            }
        } catch (error) {
            console.error(LOG_PREFIX, 'failed to delete chat', error);
            showError(tr('chat_delete_failed', 'Could not delete the chat.'));
        } finally {
            managing = false;
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

    // 처음 고를 채팅(설정). 기존 채팅은 목록을 불러오는 동안 '불러오는 중'을 보여 주고, 없으면 새 채팅으로 바꾼다
    setMode(initialMode);
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
            syncCount();
            refreshDefaultName();
            renderList();
            revealSelected();
            if (mode === 'existing' && !count) {
                setMode('new');
            } else {
                notify();
            }
        });

    return {
        showError,

        /**
         * 페르소나 선택이 바뀌면 새 채팅 기본 이름의 페르소나 부분과 인사말 미리보기의 {{user}} 를 바꾼다.
         * 사용자가 이름을 고쳤으면 이름은 그대로 둔다.
         * @param {string} persona 페르소나 이름. 빈 값이면 이름에서 뺀다
         */
        setPersonaName(persona) {
            currentPersonaName = persona;
            refreshDefaultName();
            renderGreetingPreview();
        },

        /**
         * 입장 전에 확인한다. 문제가 있으면 창 안에 이유를 보여 주고 해당 칸으로 포커스를 옮긴다.
         * @returns {Promise<boolean>}
         */
        async validate() {
            if (managing || is_send_press || isChatSaving) {
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

            if (chats === null && !loadFailed) {
                showError(tr('chat_list_wait', 'Still loading the chat list. Try again in a moment.'));
                return false;
            }
            if (!selectedChat || !getVisibleChats().some(c => c.fileName === selectedChat)) {
                showError(tr('chat_required', 'Select a chat.'));
                return false;
            }
            return true;
        },

        /** validate() 를 통과한 뒤의 선택값. greetingIndex 는 새 채팅의 시작 인사말(스와이프 번호) */
        getValue() {
            return mode === 'new'
                ? { mode, fileName: sanitizeChatName(nameInput.value), greetingIndex: greetings.length > 1 ? Number(greetingSelect.value) || 0 : 0 }
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
 * 기존 채팅 한 줄. 왼쪽(라디오·이름·미리보기)은 통째로 label 이라 어디를 눌러도 선택되고(모바일 터치 대상 확보),
 * 오른쪽에 이름 바꾸기·삭제 버튼을 둔다(label 밖이라 눌러도 선택이 바뀌지 않는다).
 * 채팅 이름·미리보기는 사용자 데이터라 textContent 로만 넣는다.
 * @param {ChatInfo} chat
 * @param {object} options
 * @param {string} options.groupName
 * @param {boolean} options.checked
 * @param {boolean} options.isLastOpened
 * @param {boolean} options.isOpen 지금 열려 있는 채팅(삭제 불가)
 * @param {string} options.preview 평문 미리보기
 * @param {() => void} options.onSelect
 * @param {() => void} options.onRename
 * @param {() => void} options.onDelete
 */
function createChatItem(chat, { groupName, checked, isLastOpened, isOpen, preview, onSelect, onRename, onDelete }) {
    const item = document.createElement('div');
    item.className = 'st-chat-setup-chat-item';

    const label = document.createElement('label');
    label.className = 'st-chat-setup-chat-pick';

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

    const previewLine = document.createElement('div');
    previewLine.className = 'st-chat-setup-chat-preview';
    previewLine.textContent = preview;

    body.append(name, meta, previewLine);
    label.append(radio, body);

    const actions = document.createElement('div');
    actions.className = 'st-chat-setup-chat-actions';
    const renameButton = createActionButton('fa-pen', tr('chat_rename_title', 'Rename chat'), onRename);
    const deleteButton = createActionButton('fa-trash-can', tr('chat_delete_button', 'Delete chat'), onDelete);
    deleteButton.classList.add('st-chat-setup-chat-delete');
    if (isOpen) {
        // 막아 두되 누르면 이유를 알려 준다(휴대폰에서는 비활성 버튼의 설명을 볼 수 없다)
        deleteButton.setAttribute('aria-disabled', 'true');
        deleteButton.title = tr('chat_delete_open', 'The chat that is open right now cannot be deleted here.');
    }
    actions.append(renameButton, deleteButton);

    item.append(label, actions);
    return item;
}

/**
 * @param {string} icon Font Awesome 아이콘 클래스
 * @param {string} title
 * @param {() => void} onClick
 */
function createActionButton(icon, title, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu_button st-chat-setup-chat-action';
    button.title = title;
    button.setAttribute('aria-label', title);
    const i = document.createElement('i');
    i.className = `fa-solid ${icon}`;
    i.setAttribute('aria-hidden', 'true');
    button.append(i);
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    return button;
}
