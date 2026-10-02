import {
    characters,
    chat_metadata,
    event_types,
    eventSource,
    getCurrentChatId,
    getRequestHeaders,
    menu_type,
    openCharacterChat,
    saveMetadata,
    saveSettingsDebounced,
    selectCharacterById,
    setActiveCharacter,
    setActiveGroup,
    this_chid,
    unshallowCharacter,
    updateRemoteChatName,
} from '../../../../../script.js';
import { selected_group } from '../../../../group-chats.js';
import { setPersonaLockState, setUserAvatar, user_avatar } from '../../../../personas.js';
import { power_user } from '../../../../power-user.js';
import { isMobile } from '../../../../RossAscends-mods.js';
import { getCharaFilename, uuidv4 } from '../../../../utils.js';
import { charSetAuxWorlds, charUpdatePrimaryWorld, METADATA_KEY, world_names } from '../../../../world-info.js';
import { AUTO, LOG_PREFIX, NONE } from './constants.js';
import { chatFileExists } from './data-source.js';
import { tr } from './i18n.js';

/** 입장 처리 중 중복 실행 방지 */
let isEntering = false;

/**
 * 입장 후처리: 가로채면서 막힌 RossAscends-mods 의 클릭 핸들러가 하던 일
 * (새로고침 시 자동으로 다시 열 캐릭터 기억)을 대신한다.
 * @param {number} chid
 */
function rememberActiveCharacter(chid) {
    setActiveCharacter(chid);
    setActiveGroup(null);
    saveSettingsDebounced();
}

/**
 * 입장 후 채팅이 보이게 한다.
 * 휴대폰에서는 오른쪽 패널이 화면 전체를 덮는데, ST 는 다른 캐릭터를 선택하면 패널을 캐릭터 편집 화면으로 바꾼 채 열어 둔다.
 * '입장'은 채팅방에 들어가는 동작이므로 좁은 화면에서는 패널을 닫는다. 넓은 화면이나 고정(pin)된 패널은 건드리지 않는다.
 */
function revealChat() {
    const panel = $('#right-nav-panel');
    const isNarrow = isMobile() || window.matchMedia('(max-width: 1000px)').matches;
    if (isNarrow && panel.hasClass('openDrawer') && !panel.hasClass('pinnedOpen')) {
        $('#rightNavDrawerIcon').trigger('click');
    }
}

/** 지금 열린 1:1 채팅의 캐릭터인지 */
function isCurrentCharacter(chid) {
    return !selected_group && this_chid !== undefined && String(this_chid) === String(chid);
}

/**
 * 입장 함수 공통 껍데기: 중복 실행 방지, 오류 처리, 성공 시 후처리.
 * @param {number} chid
 * @param {() => Promise<boolean>} body
 * @returns {Promise<boolean>}
 */
async function runEntry(chid, body) {
    if (isEntering) return false;
    isEntering = true;

    try {
        const ok = await body();
        if (ok) {
            rememberActiveCharacter(chid);
            revealChat();
        }
        return ok;
    } catch (error) {
        console.error(LOG_PREFIX, 'failed to enter chat', error);
        toastr.error(tr('enter_failed', 'Could not open the selected chat.'));
        return false;
    } finally {
        isEntering = false;
    }
}

/**
 * 채팅 파일을 연다.
 *
 * ST 는 '채팅 진입 = characters[id].chat 에 파일 이름을 넣고 getChat()' 구조라서,
 * 다른 캐릭터면 selectCharacterById 직전에 chat 을 바꿔 두어 마지막 채팅을 거치지 않고 한 번에 연다.
 * (ST 첫 화면의 최근 채팅은 선택 → openCharacterChat 으로 두 번 불러온다)
 * @param {number} chid unshallowCharacter 를 마친 캐릭터
 * @param {string} fileName
 * @returns {Promise<boolean>} 원하는 채팅이 열렸으면 true
 */
async function openChatFile(chid, fileName) {
    const character = characters[chid];
    if (!character) return false;

    if (isCurrentCharacter(chid)) {
        // 같은 캐릭터: ST 의 채팅 전환과 같은 경로. 카드의 chat 필드 저장까지 해 준다
        if (getCurrentChatId() !== fileName) {
            await openCharacterChat(fileName);
        }
    } else {
        const previousChat = character.chat;
        character.chat = fileName;
        await selectCharacterById(chid);

        if (getCurrentChatId() === fileName) {
            // 새로고침 후에도 이 채팅이 '마지막 채팅'이 되도록 카드에 기록 (openCharacterChat 이 하는 일과 같은 효과).
            // 채팅은 이미 열렸으므로 기록 실패는 입장 실패로 보지 않는다
            try {
                await updateRemoteChatName(chid, fileName);
            } catch (error) {
                console.warn(LOG_PREFIX, 'failed to remember the last chat on the card', error);
            }
        } else if (characters[chid]?.chat === fileName) {
            // 진입하지 못했으면 메모리 속 '마지막 채팅'을 되돌린다. 안 그러면 다음 선택 때 이 이름으로 빈 채팅이 생긴다
            characters[chid].chat = previousChat;
        }
    }

    if (getCurrentChatId() !== fileName) {
        console.warn(LOG_PREFIX, 'chat was not opened as requested', { chid, fileName, current: getCurrentChatId() });
        toastr.warning(tr('enter_failed', 'Could not open the selected chat.'));
        return false;
    }
    return true;
}

/**
 * 열린 채팅의 페르소나를 바꾼다(기존 채팅에서 입장창으로 바꾼 경우).
 *
 * 반드시 채팅이 열린 뒤에 부른다. 열기 전에 setUserAvatar 하면 persona_auto_lock 설정 때문에
 * '이전' 채팅에 페르소나가 고정돼 버린다.
 * @param {string} override 페르소나 id 또는 AUTO(고정 해제)
 */
async function applyPersonaToOpenChat(override) {
    if (override === AUTO) {
        if (chat_metadata.persona) await setPersonaLockState(false, 'chat');
        return;
    }
    if (!Object.hasOwn(power_user.personas ?? {}, override)) {
        console.warn(LOG_PREFIX, 'persona not found, skipped', override);
        return;
    }
    if (user_avatar !== override) {
        await setUserAvatar(override, { toastPersonaNameChange: false });
    }
    if (chat_metadata.persona !== override) {
        await setPersonaLockState(true, 'chat');
    }
}

/**
 * 페르소나 로어북을 바꾼다. 채팅이 아니라 페르소나에 붙는 설정이라 그 페르소나를 쓰는 모든 채팅에 적용된다.
 *
 * 채팅을 열기 **전에** 부른다. 진입 중 페르소나가 바뀌면 ST(selectCurrentPersona)가 descriptor.lorebook 을
 * power_user.persona_description_lorebook 으로 복사하므로 따로 맞출 필요가 없고, 이미 지금 페르소나라면 직접 맞춘다.
 * ST 의 페르소나 로어북 선택 창(personas.js onPersonaLoreButtonClick)과 같은 절차를 '지금 페르소나가 아닌' 페르소나에도 적용한다.
 * @param {import('./persona-lore-section.js').PersonaLoreChange} change
 */
async function applyPersonaLorebook({ personaId, lorebook }) {
    const descriptor = power_user.persona_descriptions?.[personaId];
    if (!descriptor || !Object.hasOwn(power_user.personas ?? {}, personaId)) {
        console.warn(LOG_PREFIX, 'persona not found, skipped persona lorebook', personaId);
        return;
    }
    if (lorebook && !world_names?.includes(lorebook)) {
        console.warn(LOG_PREFIX, 'lorebook not found, skipped persona lorebook', lorebook);
        return;
    }

    descriptor.lorebook = lorebook;
    if (personaId === user_avatar) {
        power_user.persona_description_lorebook = lorebook;
        $('#persona_lore_button').toggleClass('world_set', !!lorebook);
    }
    saveSettingsDebounced();
    await eventSource.emit(event_types.PERSONA_UPDATED, personaId);
}

/**
 * 채팅을 열기 전에 적용하는 설정(페르소나·캐릭터에 붙는 연결). 실패해도 입장은 계속하고 알리기만 한다.
 * @param {EntryOptions} options
 */
async function applyBeforeOpen({ personaLore, charLore }) {
    if (personaLore) {
        try {
            await applyPersonaLorebook(personaLore);
        } catch (error) {
            console.error(LOG_PREFIX, 'failed to apply persona lorebook', error);
            toastr.warning(tr('persona_lore_apply_failed', 'Could not change the persona lorebook.'));
        }
    }
    // 추가 로어북은 전역 설정(world_info.charLore)이라 시점과 무관하다. 첫 생성 전에 반영되도록 먼저 적용
    if (charLore?.extras) {
        try {
            charSetAuxWorlds(getCharaFilename(charLore.chid), charLore.extras.to);
        } catch (error) {
            console.error(LOG_PREFIX, 'failed to apply extra character lorebooks', error);
            toastr.warning(tr('char_lore_apply_failed', 'Could not change the character lorebook.'));
        }
    }
}

/**
 * 채팅을 연 뒤에 적용하는 캐릭터 기본 로어북.
 *
 * ST 의 charUpdatePrimaryWorld 는 '지금 열린 캐릭터의 편집 폼'(#character_world, createOrEditCharacter)으로 저장하므로
 * 반드시 그 캐릭터가 열린 뒤에 부른다. 다른 캐릭터에서 부르면 엉뚱한 캐릭터 카드가 저장된다.
 * 해제할 때 카드에 내장된 로어북(character_book)을 지우는 것도 ST 기본 동작이다(입장창 확인 창에서 미리 경고).
 * @param {EntryOptions} options
 */
async function applyAfterOpen({ charLore }) {
    if (!charLore?.primary) return;
    if (!isCurrentCharacter(charLore.chid) || menu_type === 'create') {
        console.warn(LOG_PREFIX, 'character is not open, skipped primary lorebook', charLore.chid);
        toastr.warning(tr('char_lore_apply_failed', 'Could not change the character lorebook.'));
        return;
    }
    try {
        await charUpdatePrimaryWorld(charLore.primary.to);
    } catch (error) {
        console.error(LOG_PREFIX, 'failed to apply primary character lorebook', error);
        toastr.warning(tr('char_lore_apply_failed', 'Could not change the character lorebook.'));
    }
}

/**
 * @typedef {Object} EntryOptions
 * @property {import('./persona-lore-section.js').PersonaLoreChange | null} [personaLore] 페르소나 로어북 변경
 * @property {import('./char-lore-section.js').CharLoreChange | null} [charLore] 캐릭터 로어북 변경
 */

/**
 * 열린 채팅의 채팅 로어북을 바꾼다. ST 의 채팅 로어북 선택 창(world-info.js assignLorebookToChat)과 같은 절차.
 * @param {string} override 로어북 이름 또는 NONE(연결 해제)
 */
async function applyChatLoreToOpenChat(override) {
    if (override === NONE) {
        if (!chat_metadata[METADATA_KEY]) return;
        delete chat_metadata[METADATA_KEY];
    } else {
        if (!world_names?.includes(override)) {
            console.warn(LOG_PREFIX, 'lorebook not found, skipped', override);
            return;
        }
        if (chat_metadata[METADATA_KEY] === override) return;
        chat_metadata[METADATA_KEY] = override;
    }
    $('.chat_lorebook_button').toggleClass('world_set', override !== NONE);
    await saveMetadata();
}

/**
 * 캐릭터의 기존 채팅으로 들어간다.
 * @param {number} chid
 * @param {string} fileName 확장자 없는 채팅 이름
 * @param {object} [options]
 * @param {string | null} [options.persona] 입장 후 적용할 페르소나(id 또는 AUTO). null 이면 채팅에 저장된 설정 유지
 * @param {string | null} [options.chatLore] 입장 후 적용할 채팅 로어북(이름 또는 NONE). null 이면 유지
 * @param {EntryOptions['personaLore']} [options.personaLore]
 * @param {EntryOptions['charLore']} [options.charLore]
 * @returns {Promise<boolean>} 원하는 채팅이 열렸으면 true
 */
export function enterExistingChat(chid, fileName, { persona = null, chatLore = null, personaLore = null, charLore = null } = {}) {
    return runEntry(chid, async () => {
        // 꼭 먼저: getChat() 이 가벼운(shallow) 캐릭터를 서버 데이터로 통째로 교체하므로,
        // 그 전에 받아 두지 않으면 openChatFile 에서 넣은 chat 값이 서버의 옛 값으로 되돌아간다
        await unshallowCharacter(chid);
        await applyBeforeOpen({ personaLore, charLore });
        const opened = await openChatFile(chid, fileName);
        if (!opened) return false;
        await applyAfterOpen({ charLore });

        // 채팅은 이미 열렸으므로 설정 적용 실패는 입장 실패로 보지 않고 알리기만 한다
        if (persona) {
            try {
                await applyPersonaToOpenChat(persona);
            } catch (error) {
                console.error(LOG_PREFIX, 'failed to apply persona', error);
                toastr.warning(tr('persona_apply_failed', 'Entered the chat, but could not change the persona.'));
            }
        }
        if (chatLore) {
            try {
                await applyChatLoreToOpenChat(chatLore);
            } catch (error) {
                console.error(LOG_PREFIX, 'failed to apply chat lorebook', error);
                toastr.warning(tr('lore_apply_failed', 'Entered the chat, but could not change the chat lorebook.'));
            }
        }
        return true;
    });
}

/**
 * 새 채팅을 만들어 들어간다.
 *
 * 메타데이터(고정 페르소나, 채팅 로어북 등)를 헤더에 담은 '빈 채팅 파일'을 먼저 만들고 ST 기본 경로로 연다.
 * ST 가 불러오는 순간 메타데이터가 이미 있으므로 페르소나 자동 선택·로어북 버튼 등이 ST 자체 로직으로 처리되고,
 * 채팅이 비어 있으니 첫 메시지(대체 인사말 포함) 생성과 저장, CHAT_CREATED 이벤트도 ST 가 한다.
 *
 * @param {number} chid
 * @param {string} fileName 정리된(sanitizeChatName) 채팅 이름
 * @param {Record<string, any>} [metadata] 헤더에 넣을 chat_metadata (고정 페르소나·채팅 로어북)
 * @param {EntryOptions} [options]
 * @returns {Promise<boolean>}
 */
export function enterNewChat(chid, fileName, metadata = {}, { personaLore = null, charLore = null } = {}) {
    return runEntry(chid, async () => {
        await unshallowCharacter(chid);
        const character = characters[chid];
        if (!character) return false;

        // 서버는 같은 이름 파일을 덮어쓸 수 있으므로(무결성 검사가 꺼져 있거나 옛 채팅) 만들기 직전에 다시 확인한다
        if (await chatFileExists(chid, fileName)) {
            toastr.warning(tr('name_duplicate', 'A chat with this name already exists.'));
            return false;
        }

        await applyBeforeOpen({ personaLore, charLore });

        const integrity = uuidv4();
        const header = {
            chat_metadata: { ...metadata, integrity },
            user_name: 'unused',
            character_name: 'unused',
        };
        const response = await fetch('/api/chats/save', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ch_name: character.name,
                file_name: fileName,
                chat: [header],
                avatar_url: character.avatar,
                force: false,
            }),
        });
        if (!response.ok) {
            throw new Error(`Failed to create chat file: HTTP ${response.status} ${await response.text()}`);
        }

        let opened = false;
        try {
            opened = await openChatFile(chid, fileName);
        } finally {
            // 진입에 실패하면(예외 포함) 방금 만든 파일을 치운다. 사용자는 실패한 줄 모르는데 빈 채팅만 목록에 쌓이면 안 된다
            if (!opened) {
                await discardUnusedChatFile(chid, fileName, integrity);
            }
        }
        if (opened) await applyAfterOpen({ charLore });
        return opened;
    });
}

/**
 * 확장이 만들었지만 쓰이지 않은 채팅 파일을 지운다.
 *
 * 남의 채팅을 지우는 일이 절대 없도록, 아래를 모두 만족할 때만 지운다.
 * - 지금 열려 있는 채팅이 아니다
 * - 파일 헤더의 integrity 가 이번에 만든 값과 같다 (같은 이름의 다른 파일이 아니다)
 * - 사용자 메시지가 없다 (ST 가 첫 인사말까지는 저장했을 수 있다)
 * 확인이 하나라도 안 되면 지우지 않는다.
 *
 * @param {number} chid
 * @param {string} fileName
 * @param {string} integrity enterNewChat 이 헤더에 넣은 값
 * @returns {Promise<boolean>} 지웠으면 true
 */
export async function discardUnusedChatFile(chid, fileName, integrity) {
    try {
        const character = characters[chid];
        if (!character || getCurrentChatId() === fileName) return false;

        const response = await fetch('/api/chats/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ ch_name: character.name, file_name: fileName, avatar_url: character.avatar }),
        });
        if (!response.ok) return false;

        const data = await response.json();
        if (!Array.isArray(data) || data.length === 0) return false;

        const [savedHeader, ...messages] = data;
        const isOurs = savedHeader?.chat_metadata?.integrity === integrity;
        const isUnused = messages.every(message => !message?.is_user);
        if (!isOurs || !isUnused) {
            console.warn(LOG_PREFIX, 'kept the chat file after a failed entry', { fileName, isOurs, isUnused });
            return false;
        }

        const deleteResponse = await fetch('/api/chats/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ chatfile: `${fileName}.jsonl`, avatar_url: character.avatar }),
        });
        if (!deleteResponse.ok) return false;

        console.info(LOG_PREFIX, 'removed the unused chat file after a failed entry', fileName);
        return true;
    } catch (error) {
        console.warn(LOG_PREFIX, 'failed to clean up the chat file', error);
        return false;
    }
}

/**
 * 캐릭터 수정 화면을 연다. 가로채기 전 ST 의 클릭 동작을 그대로 재현한다.
 *
 * ST 의 캐릭터 편집 패널은 선택된 캐릭터(this_chid)에 묶여 있어서, 다른 캐릭터를 수정하려면
 * 그 캐릭터를 선택해야 하고 이때 마지막 채팅도 함께 열린다(ST 기본 동작과 같음).
 * @param {number} chid
 */
export async function openCharacterEditor(chid) {
    if (!characters[chid]) return;
    await selectCharacterById(chid);
    rememberActiveCharacter(chid);

    // 패널이 닫혀 있으면(휴대폰에서 직접 닫은 뒤 등) 편집 화면이 보이도록 연다
    if (!$('#right-nav-panel').hasClass('openDrawer')) {
        $('#rightNavDrawerIcon').trigger('click');
    }
}
