import { this_chid } from '../../../../../script.js';
import { selected_group } from '../../../../group-chats.js';
import { SELECTORS } from './constants.js';
import { getSettings } from './settings.js';

/** @type {(chid: number) => void} */
let onIntercept = () => { };

/**
 * 캐릭터 카드 클릭을 가로챈다.
 *
 * ST는 `$(document).on('click', '.character_select', ...)`(버블 단계 위임)으로 캐릭터를 바로 연다.
 * window의 캡처 단계 리스너는 그보다 먼저 실행되므로, 여기서 전파를 끊으면
 * selectCharacterById 와 활성 캐릭터 저장(RossAscends-mods) 둘 다 실행되지 않는다.
 *
 * @param {(chid: number) => void} handler 가로챈 캐릭터 인덱스를 받는 콜백
 */
export function installInterceptor(handler) {
    onIntercept = handler;
    window.addEventListener('click', onCaptureClick, { capture: true });
}

/**
 * @param {MouseEvent} event
 */
function onCaptureClick(event) {
    if (!(event.target instanceof Element)) return;
    // [복제] 버튼은 duplicate.js 가 처리한다
    if (event.target.closest(SELECTORS.duplicateButton)) return;

    const card = event.target.closest(`${SELECTORS.characterList} ${SELECTORS.characterCard}`);
    if (!(card instanceof HTMLElement)) return;

    const chid = Number(card.dataset.chid);
    if (!Number.isInteger(chid)) return;

    if (!shouldIntercept(card, chid, event)) return;

    event.stopImmediatePropagation();
    event.preventDefault();
    onIntercept(chid);
}

/**
 * 원래 ST 동작을 그대로 둬야 하는 경우를 걸러 낸다.
 * @param {HTMLElement} card
 * @param {number} chid
 * @param {MouseEvent} event
 * @returns {boolean}
 */
function shouldIntercept(card, chid, event) {
    const settings = getSettings();
    if (!settings.enabled) return false;

    // 일괄 편집 모드: 카드 클릭은 선택 토글이다. BulkEditOverlay는 카드 자체에 리스너를 달기 때문에
    // 여기서 끊으면 선택이 아예 안 된다
    const list = card.closest(SELECTORS.characterList);
    if (list && SELECTORS.bulkSelectModeClasses.some(cls => list.classList.contains(cls))) return false;
    if (event.target instanceof Element && event.target.closest(SELECTORS.bulkSelectCheckbox)) return false;

    // 수정키 클릭은 기존처럼 바로 입장하는 탈출구
    if (settings.bypassWithModifier && (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey)) return false;

    // 이미 열려 있는 캐릭터를 다시 누르면 ST는 캐릭터 편집 패널을 연다. 기본은 그 동작을 살린다
    const isCurrentCharacter = !selected_group && this_chid !== undefined && String(this_chid) === String(chid);
    if (isCurrentCharacter && !settings.interceptCurrentCharacter) return false;

    return true;
}
