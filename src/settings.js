import { saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { DEFAULT_SETTINGS, MODULE_NAME } from './constants.js';

/**
 * 저장된 설정을 읽어 빠진 값을 기본값으로 채운다.
 * 설정 파일이 손상돼 있어도 확장이 통째로 죽지 않도록 타입이 다르면 기본값으로 되돌린다.
 */
export function loadSettings() {
    const stored = extension_settings[MODULE_NAME];
    const settings = (stored && typeof stored === 'object') ? stored : {};

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (typeof settings[key] !== typeof value) {
            settings[key] = value;
        }
    }

    migrate(settings);

    extension_settings[MODULE_NAME] = settings;
    return settings;
}

/**
 * 저장된 설정을 현재 버전에 맞춘다. 버전마다 한 번만 실행된다.
 * @param {Record<string, any>} settings
 */
function migrate(settings) {
    let changed = false;

    // v1 → v2: '현재 캐릭터를 다시 눌러도 입장창' 기본값을 켬으로 변경.
    // v1 에서 꺼져 있던 건 사용자의 선택이 아니라 당시 기본값이었으므로 한 번 켜 준다(이후 끄면 그대로 유지)
    if (settings.version < 2) {
        settings.interceptCurrentCharacter = true;
        settings.version = 2;
        changed = true;
    }

    if (changed) saveSettingsDebounced();
}

/** @returns {typeof DEFAULT_SETTINGS} */
export function getSettings() {
    return extension_settings[MODULE_NAME] ?? loadSettings();
}

/**
 * @param {keyof typeof DEFAULT_SETTINGS} key
 * @param {any} value
 */
export function setSetting(key, value) {
    getSettings()[key] = value;
    saveSettingsDebounced();
}
