import { characters, eventSource, event_types, getCharacters, getRequestHeaders, saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { power_user } from '../../../../power-user.js';
import { world_info } from '../../../../world-info.js';
import { LOG_PREFIX, SELECTORS } from './constants.js';
import { tr } from './i18n.js';
import { getSettings } from './settings.js';

const LIST = SELECTORS.characterList;
const CARD = SELECTORS.characterCard;
const BUTTON = SELECTORS.duplicateButton;

/** 복제 중인 원본 아바타. 같은 캐릭터를 연달아 눌러 두 번 복제되지 않게 한다 */
const pending = new Set();

/**
 * 캐릭터 목록의 각 캐릭터에 [복제] 버튼을 붙인다.
 * ST 는 목록을 페이지마다 통째로 다시 그리므로 다 그린 뒤(CHARACTER_PAGE_LOADED)마다 붙인다.
 */
function addButtons() {
    if (!getSettings().listDuplicateButton) return;
    for (const card of document.querySelectorAll(`${LIST} ${CARD}`)) {
        if (card.querySelector(BUTTON)) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'st-chat-setup-dupe';
        button.title = tr('duplicate_title', 'Duplicate character');
        button.setAttribute('aria-label', button.title);
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-clone';
        button.append(icon);
        card.append(button);
    }
}

/**
 * 카드 클릭은 ST 가 버블 단계(document 위임)에서 받아 캐릭터를 연다.
 * 버튼 클릭은 캡처 단계에서 먼저 받아 끊어서 캐릭터가 열리지 않게 한다.
 * @param {MouseEvent} event
 */
function onCaptureClick(event) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest(`${LIST} ${BUTTON}`);
    if (!(button instanceof HTMLElement)) return;

    event.stopImmediatePropagation();
    event.preventDefault();

    const card = button.closest(CARD);
    const character = characters[Number(card instanceof HTMLElement ? card.dataset.chid : NaN)];
    if (character) duplicate(character.avatar, button);
}

/**
 * 묻지 않고 바로 복제하고, 복제본 이름을 '이름 (2)' 처럼 겹치지 않게 바꾼다.
 * 카드 파일 밖에 아바타 파일 이름으로 저장되는 캐릭터 설정(추가 로어북·작가 노트·정규식 허용·페르소나 연결)도 함께 옮긴다.
 * @param {string} avatar 원본 아바타 파일 이름
 * @param {HTMLElement} button
 */
async function duplicate(avatar, button) {
    if (pending.has(avatar)) return;
    const original = characters.find(c => c.avatar === avatar);
    if (!original) return;

    pending.add(avatar);
    button.classList.add('st-chat-setup-dupe-busy');
    try {
        const response = await fetch('/api/characters/duplicate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatar }),
        });
        const result = response.ok ? await response.json() : null;
        if (!result?.path) throw new Error(`HTTP ${response.status}`);
        const newAvatar = result.path;

        const name = nextCopyName(original.name);
        const rename = await fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar: newAvatar, name, data: { name } }),
        });

        copyLinkedSettings(avatar, newAvatar);
        // 태그는 ST 가 이 이벤트를 받아 복사한다
        await eventSource.emit(event_types.CHARACTER_DUPLICATED, { oldAvatar: avatar, newAvatar });
        saveSettingsDebounced();
        await getCharacters();

        if (rename.ok) {
            toastr.success(name, tr('duplicate_done', 'Character duplicated'));
        } else {
            // 복제는 됐으니 실패로 치지 않는다. 이름만 원본과 같게 남는다
            console.warn(LOG_PREFIX, 'failed to rename duplicate', newAvatar, await rename.text());
            toastr.warning(tr('duplicate_rename_failed', 'Duplicated, but could not rename the copy.'));
        }
    } catch (error) {
        console.error(LOG_PREFIX, 'failed to duplicate character', avatar, error);
        toastr.error(tr('duplicate_failed', 'Could not duplicate the character.'));
    } finally {
        pending.delete(avatar);
        // 목록을 다시 그렸으면 이 버튼은 이미 사라졌다
        button.classList.remove('st-chat-setup-dupe-busy');
    }
}

/**
 * 카드 파일에 들어 있지 않고 ST 설정에 아바타 파일 이름으로 저장되는 것들을 복제본에도 붙인다.
 * @param {string} oldAvatar
 * @param {string} newAvatar
 */
function copyLinkedSettings(oldAvatar, newAvatar) {
    const oldKey = stripExtension(oldAvatar);
    const newKey = stripExtension(newAvatar);

    // 추가 로어북(캐릭터 로어북의 '추가' 목록). 로어북 파일 자체는 같은 것을 함께 쓴다
    const lore = world_info.charLore?.find(e => e.name === oldKey);
    if (lore?.extraBooks?.length && !world_info.charLore.some(e => e.name === newKey)) {
        world_info.charLore.push({ ...structuredClone(lore), name: newKey });
    }

    // 작가 노트의 캐릭터 노트
    const notes = extension_settings.note?.chara;
    const note = notes?.find(e => e.name === oldKey);
    if (note && !notes.some(e => e.name === newKey)) {
        notes.push({ ...structuredClone(note), name: newKey });
    }

    // 카드에 든 정규식 스크립트 실행 허용
    const allowed = extension_settings.character_allowed_regex;
    if (Array.isArray(allowed) && allowed.includes(oldAvatar) && !allowed.includes(newAvatar)) {
        allowed.push(newAvatar);
    }

    // 페르소나 연결(이 캐릭터에 고정된 페르소나)
    for (const persona of Object.values(power_user.persona_descriptions ?? {})) {
        const connections = persona?.connections;
        if (!Array.isArray(connections)) continue;
        const linked = connections.some(c => c.type === 'character' && c.id === oldAvatar);
        if (linked && !connections.some(c => c.type === 'character' && c.id === newAvatar)) {
            connections.push({ type: 'character', id: newAvatar });
        }
    }
}

/** @param {string} fileName */
function stripExtension(fileName) {
    return fileName.replace(/\.[^/.]+$/, '');
}

/**
 * 복제본 이름. 'A' 나 'A (2)' 를 복제하면 둘 다 'A (n)' 중 아직 없는 가장 작은 n(2부터)을 쓴다.
 * @param {string} name
 * @returns {string}
 */
export function nextCopyName(name) {
    const base = name.replace(/\s*\(\d+\)$/, '') || name;
    const taken = new Set(characters.map(c => c.name));
    let n = 2;
    while (taken.has(`${base} (${n})`)) n++;
    return `${base} (${n})`;
}

/**
 * 캐릭터 목록의 [복제] 버튼을 켠다. 버튼 클릭은 입장창 가로채기(interceptor.js)가 건너뛴다.
 */
export function installDuplicateButtons() {
    eventSource.on(event_types.CHARACTER_PAGE_LOADED, addButtons);
    window.addEventListener('click', onCaptureClick, { capture: true });
    addButtons();
}

/** 설정을 바꾼 직후 지금 보이는 목록에도 반영한다 */
export function refreshDuplicateButtons() {
    document.querySelectorAll(`${LIST} ${BUTTON}`).forEach(el => el.remove());
    addButtons();
}
