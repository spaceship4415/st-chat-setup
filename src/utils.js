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

/** @typedef {'st' | 'date' | 'minute' | 'second' | 'number'} ChatStampStyle */

/** 설정 화면에 보일 순서 */
export const CHAT_STAMP_STYLES = /** @type {const} */ (['st', 'date', 'minute', 'second', 'number']);

/**
 * 새 채팅 기본 이름에 붙이는 날짜·시각(설정 chatNameStamp).
 * - st: ST 기본 그대로 (2026-10-03@03h08m20s063ms)
 * - date: 2026-10-03
 * - minute: 2026-10-03 03h08 (기본)
 * - second: 2026-10-03 03h08m20s
 * - number: 날짜 없이 번호만. 날짜 자리는 비우고 이름 뒤에 (1), (2) … 를 붙인다(chat-section)
 * 채팅 이름은 파일 이름이라 ':' 를 쓸 수 없다(서버가 지운다). 그래서 ST 처럼 h·m·s 로 쓴다.
 * @param {ChatStampStyle | string} [style]
 * @param {Date} [date]
 */
export function formatChatStamp(style = 'minute', date = new Date()) {
    if (style === 'st') return humanizedDateTime(date.getTime());
    if (style === 'number') return '';

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

/**
 * 미리보기용 평문. 채팅 메시지·인사말은 마크다운과 HTML 이 섞여 있어 그대로 보이면
 * `*웃는다*`, `<div …>` 같은 기호가 내용을 가린다. 표시용으로만 걷어내고 원본은 건드리지 않는다.
 *
 * HTML 은 DOMParser 로 글자만 꺼낸다(만든 문서는 화면에 붙지 않아 스크립트·이미지가 실행·로드되지 않는다).
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.keepLines] 줄바꿈 유지(인사말 미리보기). 아니면 한 줄로 합친다(채팅 목록)
 * @returns {string}
 */
export function toPlainPreview(text, { keepLines = false } = {}) {
    if (!text) return '';
    let plain = String(text)
        // 생각(추론) 블록과 코드 블록 표시는 미리보기에 필요 없다
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, ' ')
        .replace(/```[^\n]*\n?/g, '')
        // 이미지 ![설명](주소) 는 빼고, 링크 [글자](주소) 는 글자만
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        // <br> 은 HTML 을 걷어낸 뒤에도 줄바꿈으로 남긴다
        .replace(/<br\s*\/?>/gi, '\n');

    if (/<[a-z!/][^>]*>/i.test(plain)) {
        plain = new DOMParser().parseFromString(plain, 'text/html').body.textContent ?? '';
    }

    plain = plain
        // 줄 앞의 제목 #, 인용 >, 목록 기호
        .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+)/gm, '')
        // 강조 기호(*, _, ~~, `) — 낱자 하나짜리 * 나 _ 도 대화체 서술 표시라 모두 뺀다
        .replace(/\*+|~~|`+/g, '')
        .replace(/(^|[\s(])_+|_+(?=[\s).,!?]|$)/gm, '$1');

    if (keepLines) {
        return plain
            .split('\n')
            .map(line => line.replace(/[ \t]+/g, ' ').trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
    return plain.replace(/\s+/g, ' ').trim();
}
