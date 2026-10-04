import { characters, deleteCharacter, eventSource, event_types, getRequestHeaders, this_chid } from '../../../../../script.js';
import { t } from '../../../../i18n.js';
import { Popup } from '../../../../popup.js';
import { favsToHotswap } from '../../../../RossAscends-mods.js';
import { renderTemplateAsync } from '../../../../templates.js';
import { LOG_PREFIX, SELECTORS } from './constants.js';
import { duplicateCharacter } from './duplicate.js';
import { tr } from './i18n.js';
import { getSettings } from './settings.js';

const LIST = SELECTORS.characterList;
const CARD = SELECTORS.characterCard;
const BUTTON = SELECTORS.listMenuButton;
const MENU = SELECTORS.listMenu;
const OPEN_CLASS = 'st-chat-setup-list-menu-open';
const BUSY_CLASS = 'st-chat-setup-list-menu-busy';

/**
 * 캐릭터 목록의 각 캐릭터에 [⋯] 버튼을 붙인다. 누르면 즐겨찾기·복제·삭제 메뉴가 펼쳐진다.
 * 휴대폰에서 버튼 여러 개를 나란히 두면 이름 자리가 좁아지므로 하나로 묶었다.
 * ST 는 목록을 페이지마다 통째로 다시 그리므로 다 그린 뒤(CHARACTER_PAGE_LOADED)마다 붙인다.
 */
function addButtons() {
    if (!getSettings().listDuplicateButton) return;
    for (const card of document.querySelectorAll(`${LIST} ${CARD}`)) {
        if (card.querySelector(BUTTON)) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = BUTTON.slice(1);
        button.title = tr('list_menu_title', 'More');
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-ellipsis-vertical';
        button.append(icon);
        card.append(button);
    }
}

/**
 * 카드 클릭은 ST 가 버블 단계(document 위임)에서 받아 캐릭터를 연다.
 * 버튼·메뉴 클릭은 캡처 단계에서 먼저 받아 끊어서 캐릭터가 열리지 않게 한다.
 * @param {MouseEvent} event
 */
function onCaptureClick(event) {
    if (!(event.target instanceof Element)) return;

    const item = event.target.closest(`${LIST} ${MENU} [data-action]`);
    const button = event.target.closest(`${LIST} ${BUTTON}`);
    if (!item && !event.target.closest(`${LIST} ${MENU}`) && !button) return;

    event.stopImmediatePropagation();
    event.preventDefault();

    if (item instanceof HTMLElement) {
        const card = item.closest(CARD);
        const character = characters[Number(card instanceof HTMLElement ? card.dataset.chid : NaN)];
        closeMenu();
        if (character) runAction(item.dataset.action, character.avatar, card);
        return;
    }
    if (button instanceof HTMLElement) {
        const wasOpen = button.getAttribute('aria-expanded') === 'true';
        closeMenu();
        if (!wasOpen) openMenu(button);
    }
}

/**
 * @param {HTMLElement} button
 */
function openMenu(button) {
    const card = button.closest(CARD);
    const character = characters[Number(card instanceof HTMLElement ? card.dataset.chid : NaN)];
    if (!(card instanceof HTMLElement) || !character) return;

    const menu = document.createElement('div');
    menu.className = MENU.slice(1);
    menu.setAttribute('role', 'menu');
    const fav = isFavorite(character);
    menu.append(
        menuItem('favorite', fav ? 'fa-solid fa-star' : 'fa-regular fa-star',
            fav ? tr('list_menu_unfavorite', 'Remove from favorites') : tr('list_menu_favorite', 'Add to favorites')),
        menuItem('duplicate', 'fa-solid fa-clone', tr('duplicate_title', 'Duplicate character')),
        menuItem('delete', 'fa-solid fa-trash-can', tr('list_menu_delete', 'Delete character')),
    );
    card.classList.add(OPEN_CLASS);
    card.append(menu);
    button.setAttribute('aria-expanded', 'true');

    // 목록 영역 아래쪽에서 잘리면 위로 펼친다
    const list = card.closest(LIST);
    const bottomLimit = list ? list.getBoundingClientRect().bottom : window.innerHeight;
    if (menu.getBoundingClientRect().bottom > bottomLimit) menu.classList.add('st-chat-setup-list-popover-up');

    menu.querySelector('button')?.focus({ preventScroll: true });
}

/**
 * @param {string} action
 * @param {string} iconClass
 * @param {string} label
 */
function menuItem(action, iconClass, label) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.dataset.action = action;
    const icon = document.createElement('i');
    icon.className = iconClass;
    const text = document.createElement('span');
    text.textContent = label;
    item.append(icon, text);
    return item;
}

function closeMenu() {
    document.querySelectorAll(MENU).forEach(el => el.remove());
    document.querySelectorAll(`.${OPEN_CLASS}`).forEach(el => el.classList.remove(OPEN_CLASS));
    document.querySelectorAll(`${BUTTON}[aria-expanded="true"]`).forEach(el => el.setAttribute('aria-expanded', 'false'));
}

/** 메뉴 밖을 누르면 닫는다 */
function onPointerDown(event) {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(`${MENU}, ${BUTTON}`)) return;
    closeMenu();
}

/** @param {KeyboardEvent} event */
function onKeyDown(event) {
    if (event.key !== 'Escape' || !document.querySelector(MENU)) return;
    const button = document.querySelector(`${BUTTON}[aria-expanded="true"]`);
    closeMenu();
    if (button instanceof HTMLElement) button.focus({ preventScroll: true });
    event.stopPropagation();
}

/**
 * @param {string} action
 * @param {string} avatar
 * @param {Element} card
 */
async function runAction(action, avatar, card) {
    const button = card.querySelector(BUTTON);
    button?.classList.add(BUSY_CLASS);
    try {
        if (action === 'favorite') await toggleFavorite(avatar, card);
        else if (action === 'duplicate') await duplicateCharacter(avatar);
        else if (action === 'delete') await confirmAndDelete(avatar);
    } finally {
        // 목록을 다시 그렸으면 이 버튼은 이미 사라졌다
        button?.classList.remove(BUSY_CLASS);
    }
}

/** @param {any} character */
function isFavorite(character) {
    return character.fav === true || character.fav === 'true';
}

/**
 * ST 일괄 편집의 즐겨찾기(BulkEditOverlay)와 같은 방식으로 카드의 fav 를 바꾼다.
 * 지금 편집 화면에 열린 캐릭터면 ST 의 즐겨찾기 버튼을 대신 누른다. 그래야 편집 화면이 저장할 때 옛 값으로 되돌리지 않는다.
 * @param {string} avatar
 * @param {Element} card
 */
async function toggleFavorite(avatar, card) {
    const chid = characters.findIndex(c => c.avatar === avatar);
    const character = characters[chid];
    if (!character) return;

    if (this_chid !== undefined && Number(this_chid) === chid) {
        $('#favorite_button').trigger('click');
        return;
    }

    const fav = !isFavorite(character);
    const response = await fetch('/api/characters/merge-attributes', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name: character.name, avatar, data: { extensions: { fav } }, fav }),
    });
    if (!response.ok) {
        console.error(LOG_PREFIX, 'failed to toggle favorite', avatar, await response.text());
        toastr.error(tr('list_menu_favorite_failed', 'Could not change the favorite.'));
        return;
    }

    character.fav = fav;
    if (character.data?.extensions) character.data.extensions.fav = fav;
    card.classList.toggle('is_fav', fav);
    await favsToHotswap();
}

/**
 * ST 편집 화면의 [삭제] 버튼과 같은 확인창(채팅 파일도 지울지 체크)과 삭제 함수를 쓴다.
 * 어느 캐릭터인지 헷갈리지 않게 이름만 위에 덧붙인다.
 * @param {string} avatar
 */
async function confirmAndDelete(avatar) {
    const character = characters.find(c => c.avatar === avatar);
    if (!character) return;

    const name = document.createElement('div');
    name.className = 'st-chat-setup-delete-name';
    name.textContent = character.name;

    let deleteChats = false;
    const confirm = await Popup.show.confirm(t`Delete the character?`, name.outerHTML + await renderTemplateAsync('deleteConfirm'), {
        onClose: () => { deleteChats = !!$('#del_char_checkbox').prop('checked'); },
    });
    if (!confirm) return;

    await deleteCharacter(avatar, { deleteChats });
}

/**
 * 캐릭터 목록의 [⋯] 메뉴를 켠다. 버튼·메뉴 클릭은 입장창 가로채기(interceptor.js)가 건너뛴다.
 */
export function installListMenu() {
    eventSource.on(event_types.CHARACTER_PAGE_LOADED, () => {
        closeMenu();
        addButtons();
    });
    window.addEventListener('click', onCaptureClick, { capture: true });
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    document.addEventListener('keydown', onKeyDown, { capture: true });
    addButtons();
}

/** 설정을 바꾼 직후 지금 보이는 목록에도 반영한다 */
export function refreshListMenu() {
    closeMenu();
    document.querySelectorAll(`${LIST} ${BUTTON}`).forEach(el => el.remove());
    addButtons();
}
