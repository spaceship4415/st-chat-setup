import { humanizedDateTime } from '../../../../RossAscends-mods.js';

/**
 * 서버의 sanitize-filename 과 같은 규칙으로 채팅 이름을 정리한다.
 * 서버는 저장할 때 `${이름}.jsonl` 을 이 규칙으로 바꾸므로, 클라이언트가 미리 맞춰 두지 않으면
 * characters[chid].chat 과 실제 파일 이름이 어긋난다.
 * @param {string} name
 * @returns {string} 정리된 이름. 쓸 수 있는 글자가 없으면 빈 문자열
 */
export function sanitizeChatName(name) {
    let result = String(name ?? '')
        .replace(/[/?<>\\:*|"]/g, '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x80-\x9f]/g, '')
        .trim()
        .replace(/[. ]+$/, '');

    if (/^\.+$/.test(result)) return '';
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(result)) return '';

    // 파일 이름 전체(이름 + .jsonl)가 255바이트를 넘으면 서버가 잘라 버린다
    const encoder = new TextEncoder();
    const maxBytes = 255 - '.jsonl'.length;
    while (encoder.encode(result).length > maxBytes) {
        result = [...result].slice(0, -1).join('');
    }
    return result.replace(/[. ]+$/, '');
}

/** @typedef {'st' | 'date' | 'minute' | 'second'} ChatStampStyle */

/** 설정 화면에 보일 순서 */
export const CHAT_STAMP_STYLES = /** @type {const} */ (['st', 'date', 'minute', 'second']);

/**
 * 새 채팅 기본 이름에 붙이는 날짜·시각(설정 chatNameStamp).
 * - st: ST 기본 그대로 (2026-10-03@03h08m20s063ms)
 * - date: 2026-10-03
 * - minute: 2026-10-03 03h08 (기본)
 * - second: 2026-10-03 03h08m20s
 * 채팅 이름은 파일 이름이라 ':' 를 쓸 수 없다(서버가 지운다). 그래서 ST 처럼 h·m·s 로 쓴다.
 * @param {ChatStampStyle | string} [style]
 * @param {Date} [date]
 */
export function formatChatStamp(style = 'minute', date = new Date()) {
    if (style === 'st') return humanizedDateTime(date.getTime());

    const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const minute = `${pad(date.getHours())}h${pad(date.getMinutes())}`;
    switch (style) {
        case 'date': return day;
        case 'second': return `${day} ${minute}m${pad(date.getSeconds())}s`;
        default: return `${day} ${minute}`;
    }
}

/**
 * 같은 이름의 채팅이 이미 있는지. Windows 등 대소문자를 구분하지 않는 파일 시스템도 있어서 대소문자를 무시한다.
 * @param {string} name 정리된 이름
 * @param {{ fileName: string }[]} chats
 */
export function isDuplicateChatName(name, chats) {
    const target = name.toLocaleLowerCase();
    return chats.some(chat => chat.fileName.toLocaleLowerCase() === target);
}
