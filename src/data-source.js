import { characters, getRequestHeaders } from '../../../../../script.js';
import { timestampToMoment } from '../../../../utils.js';

/**
 * @typedef {Object} ChatInfo
 * @property {string} fileName 확장자 없는 채팅 이름 (= characters[chid].chat 에 들어가는 값)
 * @property {number} lastTime 마지막 메시지 시각(ms). 알 수 없으면 0
 * @property {string} lastDate 화면 표시용 날짜
 * @property {string} preview 마지막 메시지 일부
 * @property {number} count 메시지 수
 * @property {Record<string, any>} metadata 채팅 메타데이터(고정 페르소나, 채팅 로어북 등)
 */

/**
 * 같은 이름의 채팅 파일이 서버에 있는지 확인한다(대소문자 무시).
 *
 * 새 채팅 파일을 만들기 직전에 부른다. 서버의 무결성 검사는 설정으로 꺼져 있거나 기존 파일에 무결성 표시가
 * 없으면(옛 채팅) 같은 이름 파일을 그대로 덮어쓰므로, 덮어쓰기 방지를 서버에 맡길 수 없다.
 * @param {number} chid
 * @param {string} fileName 확장자 없는 채팅 이름
 * @returns {Promise<boolean>}
 */
export async function chatFileExists(chid, fileName) {
    const character = characters[chid];
    if (!character) throw new Error('Character not found');

    const response = await fetch('/api/characters/chats', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ avatar_url: character.avatar, simple: true }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    // 채팅 폴더가 없으면 { error: true } = 파일도 없음
    if (!Array.isArray(data)) return false;

    const target = fileName.toLocaleLowerCase();
    return data.some(item => String(item?.file_id ?? '').toLocaleLowerCase() === target);
}

/**
 * 캐릭터의 채팅 목록을 최근 순으로 가져온다.
 * ST 의 getPastCharacterChats 대신 직접 부르는 이유: `metadata: true` 로 각 채팅의 메타데이터(헤더 한 줄)를
 * 함께 받을 수 있어, 채팅 파일 전체를 내려받지 않고도 기존 채팅의 페르소나/로어북 설정을 알 수 있다.
 * @param {number} chid
 * @returns {Promise<ChatInfo[]>}
 */
export async function getChatList(chid) {
    const character = characters[chid];
    if (!character) return [];

    const response = await fetch('/api/characters/chats', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ avatar_url: character.avatar, metadata: true }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    // 채팅 폴더가 아직 없으면 서버는 { error: true } 를 돌려준다 = 채팅 없음
    if (!Array.isArray(data)) return [];

    return data
        .filter(item => typeof item?.file_name === 'string')
        .map(item => {
            const moment = timestampToMoment(item.last_mes);
            return {
                fileName: item.file_name.replace(/\.jsonl$/, ''),
                lastTime: moment.isValid() ? moment.valueOf() : 0,
                lastDate: moment.isValid() ? moment.format('YYYY-MM-DD HH:mm') : '',
                preview: typeof item.mes === 'string' ? item.mes : '',
                count: Number(item.chat_items) || 0,
                metadata: (item.chat_metadata && typeof item.chat_metadata === 'object') ? item.chat_metadata : {},
            };
        })
        .sort((a, b) => b.lastTime - a.lastTime || b.fileName.localeCompare(a.fileName));
}
