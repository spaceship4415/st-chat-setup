import {
    characters,
    eventSource,
    event_types,
    getCurrentChatId,
    getRequestHeaders,
    is_send_press,
    isChatSaving,
    reloadCurrentChat,
    this_chid,
    updateRemoteChatName,
} from '../../../../../script.js';
import { humanizedDateTime } from '../../../../RossAscends-mods.js';

/**
 * 입장창의 기존 채팅 이름 바꾸기·삭제.
 *
 * ST 의 renameGroupOrCharacterChat / deleteCharacterChatByName 은 실패해도 알려 주지 않고(오류 팝업만 띄움)
 * 지금 채팅이 아니어도 현재 채팅을 다시 불러오므로, 같은 서버 API 를 직접 부르고 뒤처리만 ST 와 맞춘다.
 */

/**
 * 지금 화면에 열려 있는 채팅인지
 * @param {number} chid
 * @param {string} fileName
 */
export function isOpenChat(chid, fileName) {
    return this_chid !== undefined && String(this_chid) === String(chid) && getCurrentChatId() === fileName;
}

/** 응답 생성·저장 중이면 열린 채팅 파일을 건드리지 않는다 */
export function isChatBusy() {
    return !!is_send_press || !!isChatSaving;
}

/**
 * 채팅 파일 이름을 바꾼다. 같은 이름이 있으면 서버가 거절한다(덮어쓰지 않음).
 * @param {number} chid
 * @param {string} oldName 확장자 없는 이름
 * @param {string} newName 확장자 없는 이름(정리된 것)
 * @returns {Promise<string>} 서버가 정리한 실제 새 이름
 */
export async function renameCharacterChat(chid, oldName, newName) {
    const character = characters[chid];
    if (!character) throw new Error('Character not found');
    const wasOpen = isOpenChat(chid, oldName);

    const body = {
        is_group: false,
        avatar_url: character.avatar,
        original_file: `${oldName}.jsonl`,
        renamed_file: `${newName}.jsonl`,
    };
    const response = await fetch('/api/chats/rename', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) throw new Error(`Rename failed (HTTP ${response.status})`);
    const actualName = typeof data?.sanitizedFileName === 'string' && data.sanitizedFileName ? data.sanitizedFileName : newName;

    // 캐릭터가 '마지막으로 연 채팅'으로 기억하던 파일이면 그 기록도 새 이름으로.
    // 지금 캐릭터면 편집 폼의 숨은 칸도 맞춘다(나중에 폼이 저장될 때 옛 이름을 되쓰지 않도록)
    if (character.chat === oldName) {
        await updateRemoteChatName(chid, actualName);
        if (String(this_chid) === String(chid)) $('#selected_chat_pole').val(actualName);
    }
    if (wasOpen) await reloadCurrentChat();

    await eventSource.emit(event_types.CHAT_RENAMED, {
        avatarId: character.avatar,
        groupId: undefined,
        oldFileName: body.original_file,
        newFileName: `${actualName}.jsonl`,
    });
    return actualName;
}

/**
 * 채팅 파일을 지운다(되돌릴 수 없음). 열려 있는 채팅은 지우지 않는다(부르기 전에 isOpenChat 으로 막는다).
 * @param {number} chid
 * @param {string} fileName 확장자 없는 이름
 * @param {string[]} remaining 지운 뒤 남는 채팅 이름(최근 순). '마지막으로 연 채팅'을 옮길 곳
 */
export async function deleteCharacterChat(chid, fileName, remaining) {
    const character = characters[chid];
    if (!character) throw new Error('Character not found');
    if (isOpenChat(chid, fileName)) throw new Error('Refusing to delete the open chat');

    const response = await fetch('/api/chats/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ chatfile: `${fileName}.jsonl`, avatar_url: character.avatar }),
    });
    if (!response.ok) throw new Error(`Delete failed (HTTP ${response.status})`);

    // ST(deleteCharacterChatByName)와 같이: 마지막으로 연 채팅을 지웠으면 가장 최근 채팅으로, 없으면 새 이름으로
    if (character.chat === fileName) {
        await updateRemoteChatName(chid, remaining[0] ?? `${character.name} - ${humanizedDateTime()}`);
    }
    await eventSource.emit(event_types.CHAT_DELETED, fileName);
}
