import { characters } from '../../../../../script.js';
import { getCharaFilename } from '../../../../utils.js';
import { world_info, world_names } from '../../../../world-info.js';
import { CREATE, NONE } from './constants.js';
import { tr } from './i18n.js';
import { createLorebookOption } from './lorebook-create.js';

/**
 * @typedef {Object} CharLoreChange
 * @property {number} chid
 * @property {string} characterName
 * @property {{ from: string, to: string } | null} primary 기본 로어북 변경. 빈 값 = 없음
 * @property {{ from: string[], to: string[] } | null} extras 추가 로어북 변경
 * @property {boolean} removesEmbedded 기본 로어북을 해제하면 카드에 내장된 로어북(character_book)도 ST 가 지운다
 */

/** @param {number} chid */
const getPrimary = (chid) => String(characters[chid]?.data?.extensions?.world ?? '');

/** @param {number} chid */
const getExtras = (chid) => {
    const fileName = getCharaFilename(chid);
    const entry = world_info?.charLore?.find(e => e.name === fileName);
    return Array.isArray(entry?.extraBooks) ? [...entry.extraBooks] : [];
};

const sameList = (/** @type {string[]} */ a, /** @type {string[]} */ b) =>
    a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/**
 * 입장창의 '캐릭터 로어북' 영역 (기본 1개 + 추가 여러 개).
 * 채팅이 아니라 캐릭터에 붙는 설정이라, 바꾸면 이 캐릭터의 모든 채팅에 적용된다. 모드(새/기존 채팅)와 무관하다.
 *
 * @param {HTMLElement} root
 * @param {{ chid: number, onCreateRequest?: (target: 'primary' | 'extras') => void }} options
 *   onCreateRequest: '새 로어북 만들기'를 눌렀을 때(기본 드롭다운 / 추가 목록 버튼)
 */
export function createCharLoreSection(root, { chid, onCreateRequest = () => { } }) {
    const section = /** @type {HTMLElement} */ (root.querySelector('.st-chat-setup-char-lore'));
    const primarySelect = /** @type {HTMLSelectElement} */ (section.querySelector('.st-chat-setup-char-lore-primary'));
    const extrasBox = /** @type {HTMLElement} */ (section.querySelector('.st-chat-setup-char-lore-extras'));
    const extrasCount = /** @type {HTMLElement} */ (section.querySelector('.st-chat-setup-char-lore-extras-count'));
    const hint = /** @type {HTMLElement} */ (section.querySelector('.st-chat-setup-char-lore-hint'));

    const names = (Array.isArray(world_names) ? [...world_names] : []).sort((a, b) => a.localeCompare(b));
    const originalPrimary = getPrimary(chid);
    const originalExtras = getExtras(chid);
    const hasEmbedded = !!characters[chid]?.data?.character_book;
    const missing = tr('lore_missing', 'deleted lorebook');

    // 기본 로어북
    primarySelect.append(new Option(tr('lore_none', 'None'), NONE));
    for (const name of names) primarySelect.append(new Option(name, name));
    if (originalPrimary && !names.includes(originalPrimary)) {
        primarySelect.append(new Option(`${originalPrimary} (${missing})`, originalPrimary));
    }
    const createOption = createLorebookOption();
    primarySelect.append(createOption);
    primarySelect.value = originalPrimary || NONE;

    // 추가 로어북: 휴대폰에서도 고르기 쉽게 체크박스 목록(줄 전체가 터치 대상)
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'st-chat-setup-chat-message';
    emptyMessage.textContent = tr('lore_list_empty', 'No lorebooks yet.');

    /** @param {string} name @param {boolean} checked */
    const createExtraItem = (name, checked) => {
        const label = document.createElement('label');
        label.className = 'st-chat-setup-check-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = name;
        checkbox.checked = checked;
        const text = document.createElement('span');
        text.textContent = names.includes(name) ? name : `${name} (${missing})`;
        label.append(checkbox, text);
        return label;
    };

    const extraNames = [...names, ...originalExtras.filter(n => !names.includes(n))];
    for (const name of extraNames) extrasBox.append(createExtraItem(name, originalExtras.includes(name)));
    if (!extraNames.length) extrasBox.append(emptyMessage);

    section.querySelector('.st-chat-setup-char-lore-create')?.addEventListener('click', () => onCreateRequest('extras'));

    // '새 로어북 만들기…'는 값이 아니라 동작이다. 고르면 이전 값으로 되돌리고 만들기 창을 띄운다
    let lastPrimary = primarySelect.value;
    primarySelect.addEventListener('change', () => {
        if (primarySelect.value === CREATE) {
            primarySelect.value = lastPrimary;
            onCreateRequest('primary');
            return;
        }
        lastPrimary = primarySelect.value;
    });

    const currentPrimary = () => (primarySelect.value === NONE ? '' : primarySelect.value);
    // 기본 로어북과 같은 이름이 추가 목록에도 있으면 중복이므로 뺀다
    const currentExtras = () => [...extrasBox.querySelectorAll('input:checked')]
        .map(input => /** @type {HTMLInputElement} */ (input).value)
        .filter(name => name !== currentPrimary());

    const render = () => {
        const extras = currentExtras();
        extrasCount.textContent = `(${extras.length})`;
        for (const input of extrasBox.querySelectorAll('input')) {
            const el = /** @type {HTMLInputElement} */ (input);
            // 기본으로 고른 로어북은 추가 목록에서 고를 수 없게 표시
            el.disabled = el.value === currentPrimary();
        }

        const change = getChange();
        const messages = [];
        if (change) messages.push(tr('char_lore_hint_changed', 'Applies to every chat with {0}.').replace('{0}', change.characterName));
        if (change?.removesEmbedded) messages.push(tr('char_lore_hint_embedded', 'The lorebook embedded in the character card will also be removed.'));
        hint.textContent = messages.join(' ');
        hint.hidden = !hint.textContent;
    };

    /** @returns {CharLoreChange | null} */
    const getChange = () => {
        const primary = currentPrimary();
        const extras = currentExtras();
        const primaryChanged = primary !== originalPrimary;
        // 원래 목록 그대로와 비교한다. 새 기본 로어북이 원래 추가 목록에 있었다면 중복 제거로 빠지는 것도 변경이다
        // (원래 목록에서 기본 로어북을 빼고 비교하면, 사용자가 체크를 푼 것을 '변경 없음'으로 놓친다)
        const extrasChanged = !sameList(extras, originalExtras);
        if (!primaryChanged && !extrasChanged) return null;
        return {
            chid,
            characterName: characters[chid]?.name ?? '',
            primary: primaryChanged ? { from: originalPrimary, to: primary } : null,
            extras: extrasChanged ? { from: originalExtras, to: extras } : null,
            removesEmbedded: primaryChanged && !primary && !!originalPrimary && hasEmbedded,
        };
    };

    primarySelect.addEventListener('change', render);
    extrasBox.addEventListener('change', render);
    render();

    return {
        getChange,

        /**
         * 새로 만든 로어북을 기본 드롭다운과 추가 목록에 넣는다. target 칸에서는 바로 고른다.
         * @param {string} name
         * @param {{ select?: 'primary' | 'extras' | null }} [options]
         */
        addLorebook(name, { select = null } = {}) {
            if (!names.includes(name)) names.push(name);
            if (![...primarySelect.options].some(o => o.value === name)) {
                primarySelect.insertBefore(new Option(name, name), createOption);
            }
            if (![...extrasBox.querySelectorAll('input')].some(i => /** @type {HTMLInputElement} */ (i).value === name)) {
                emptyMessage.remove();
                extrasBox.append(createExtraItem(name, false));
            }
            if (select === 'primary') {
                primarySelect.value = name;
                primarySelect.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (select === 'extras') {
                const input = /** @type {HTMLInputElement | undefined} */ (
                    [...extrasBox.querySelectorAll('input')].find(i => /** @type {HTMLInputElement} */ (i).value === name));
                if (input) {
                    input.checked = true;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } else {
                render();
            }
        },

        /** 접힌 로어북 묶음의 요약에 쓸 짧은 값. 추가 로어북은 개수로 붙인다 */
        getSummary() {
            const primary = currentPrimary() || tr('lore_none_short', 'none');
            const extras = currentExtras().length;
            return extras ? `${primary} +${extras}` : primary;
        },
    };
}
