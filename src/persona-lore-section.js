import { power_user } from '../../../../power-user.js';
import { world_names } from '../../../../world-info.js';
import { CREATE, NONE } from './constants.js';
import { tr } from './i18n.js';
import { createLorebookOption } from './lorebook-create.js';

/**
 * @typedef {Object} PersonaLoreChange
 * @property {string} personaId
 * @property {string} personaName
 * @property {string} lorebook 새 로어북 이름. 빈 값 = 연결 해제
 * @property {string} previous 바꾸기 전 로어북 이름
 */

/** @param {string} id */
const getPersonaLorebook = (id) => String(power_user.persona_descriptions?.[id]?.lorebook ?? '');

/**
 * 입장창의 '페르소나 로어북' 영역.
 *
 * 페르소나 로어북은 채팅이 아니라 페르소나에 붙는 설정이라, 바꾸면 그 페르소나를 쓰는 모든 채팅에 적용된다.
 * 그래서 대상은 '입장 후 쓰일 페르소나'이고(페르소나 칸을 따라간다), 그 페르소나를 확정할 수 없으면 칸을 잠근다.
 * 대상 페르소나가 바뀌면 그 페르소나의 현재 값으로 다시 채운다 — 앞 페르소나용으로 고른 값을 다른 페르소나에
 * 조용히 적용하지 않기 위해서다.
 *
 * @param {HTMLElement} root
 * @param {{ personaId: string | null, onCreateRequest?: (defaultName: string) => void }} options
 *   personaId: 처음 대상 페르소나 / onCreateRequest: '새 로어북 만들기…'를 골랐을 때(기본 이름 = 페르소나 이름)
 */
export function createPersonaLoreSection(root, { personaId, onCreateRequest = () => { } }) {
    const section = /** @type {HTMLElement} */ (root.querySelector('.st-chat-setup-persona-lore'));
    const select = /** @type {HTMLSelectElement} */ (section.querySelector('select'));
    const hint = /** @type {HTMLElement} */ (section.querySelector('.st-chat-setup-hint'));

    const names = (Array.isArray(world_names) ? [...world_names] : []).sort((a, b) => a.localeCompare(b));

    /** @type {string | null} */
    let target = null;
    let original = '';

    /**
     * 목록을 다시 그린다.
     * @param {string | null} [keep] 이 값을 계속 선택해 둔다(로어북을 새로 만들어 목록만 늘어난 경우). 없으면 페르소나에 저장된 값
     */
    const render = (keep = null) => {
        select.replaceChildren();
        select.append(new Option(tr('lore_none', 'None'), NONE));
        for (const name of names) select.append(new Option(name, name));

        if (!target) {
            select.value = NONE;
            select.disabled = true;
            hint.textContent = tr('persona_lore_unknown', 'Choose a persona above to change its lorebook.');
            hint.hidden = false;
            lastValue = select.value;
            return;
        }

        original = getPersonaLorebook(target);
        // 연결된 로어북이 삭제됐으면 목록에 없으므로 그 사실을 보여 준다
        if (original && !names.includes(original)) {
            select.append(new Option(`${original} (${tr('lore_missing', 'deleted lorebook')})`, original));
        }
        select.append(createLorebookOption());
        select.value = keep ?? (original || NONE);
        select.disabled = false;
        lastValue = select.value;
        renderHint();
    };

    const renderHint = () => {
        const changed = target && currentValue() !== original;
        hint.textContent = changed
            ? tr('persona_lore_hint_changed', 'Applies to every chat that uses {0}.').replace('{0}', power_user.personas?.[target] ?? target)
            : '';
        hint.hidden = !hint.textContent;
    };

    const currentValue = () => (select.value === NONE ? '' : select.value);

    // '새 로어북 만들기…'는 값이 아니라 동작이다. 고르면 이전 값으로 되돌리고 만들기 창을 띄운다
    let lastValue = NONE;
    select.addEventListener('change', () => {
        if (select.value === CREATE) {
            select.value = lastValue;
            onCreateRequest(target ? (power_user.personas?.[target] ?? '') : '');
            return;
        }
        lastValue = select.value;
        renderHint();
    });

    /** @param {string | null} id */
    const setTarget = (id) => {
        if (id === target) return;
        target = id;
        render();
    };

    setTarget(personaId);
    if (!target) render();

    return {
        setTarget,

        /**
         * 새로 만든 로어북을 목록에 넣는다. select 가 true 면 이 칸에서 바로 고른다.
         * @param {string} name
         * @param {{ select?: boolean }} [options]
         */
        addLorebook(name, { select: pick = false } = {}) {
            if (!names.includes(name)) {
                names.push(name);
                names.sort((a, b) => a.localeCompare(b));
            }
            const current = target ? select.value : null;
            render(pick && target ? name : current);
            if (pick && target) select.dispatchEvent(new Event('change', { bubbles: true }));
        },

        /** 접힌 로어북 묶음의 요약에 쓸 짧은 값. 대상 페르소나를 모르면 '—' */
        getSummary() {
            if (!target) return '—';
            return currentValue() || tr('lore_none_short', 'none');
        },

        /** @returns {PersonaLoreChange | null} 바뀐 것이 없으면 null */
        getChange() {
            if (!target) return null;
            const lorebook = currentValue();
            if (lorebook === original) return null;
            return {
                personaId: target,
                personaName: power_user.personas?.[target] ?? target,
                lorebook,
                previous: original,
            };
        },
    };
}
