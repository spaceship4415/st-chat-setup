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

/**
 * 같은 이름의 채팅이 이미 있는지. Windows 등 대소문자를 구분하지 않는 파일 시스템도 있어서 대소문자를 무시한다.
 * @param {string} name 정리된 이름
 * @param {{ fileName: string }[]} chats
 */
export function isDuplicateChatName(name, chats) {
    const target = name.toLocaleLowerCase();
    return chats.some(chat => chat.fileName.toLocaleLowerCase() === target);
}
