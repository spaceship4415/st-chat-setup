import { Popup } from '../../../../popup.js';
import { createNewWorldInfo, world_names } from '../../../../world-info.js';
import { CREATE, LOG_PREFIX } from './constants.js';
import { tr } from './i18n.js';

/**
 * 이름을 물어 새 로어북(빈 world info)을 만든다.
 *
 * - ST 의 createNewWorldInfo 를 쓰되 interactive 는 끈다. 켜면 같은 이름이 있을 때 '기존 로어북을 지우고 덮어쓰기'를
 *   제안하므로, 입장창에서 실수로 남의 로어북을 날릴 수 있다. 같은 이름이면 만들지 않고 알리기만 한다.
 * - 서버가 파일 이름을 정리하므로 실제 이름이 입력과 다를 수 있다. 만들기 전후 목록을 비교해 새로 생긴 이름을 찾는다.
 *
 * @param {string} defaultName 입력칸에 미리 채울 이름
 * @returns {Promise<string | null>} 만들어진 로어북 이름. 취소·실패면 null
 */
export async function promptCreateLorebook(defaultName) {
    const input = await Popup.show.input(
        tr('lore_create_title', 'New lorebook'),
        tr('lore_create_text', 'Enter a name for the new lorebook.'),
        defaultName,
    );
    const name = String(input ?? '').trim();
    if (!name) return null;

    const existing = (Array.isArray(world_names) ? world_names : []).find(n => n.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) {
        toastr.warning(tr('lore_create_exists', 'A lorebook with this name already exists. Select it from the list.'), existing);
        return null;
    }

    const before = new Set(world_names ?? []);
    try {
        const created = await createNewWorldInfo(name, { interactive: false });
        if (!created) return null;
    } catch (error) {
        console.error(LOG_PREFIX, 'failed to create lorebook', error);
        toastr.error(tr('lore_create_failed', 'Could not create the lorebook.'));
        return null;
    }

    const added = (world_names ?? []).find(n => !before.has(n)) ?? ((world_names ?? []).includes(name) ? name : null);
    if (added) toastr.success(tr('lore_created', 'Lorebook created.'), added);
    return added;
}

/** 드롭다운 맨 아래의 '새 로어북 만들기…' 항목 */
export function createLorebookOption() {
    return new Option(`＋ ${tr('lore_create_option', 'New lorebook…')}`, CREATE);
}
