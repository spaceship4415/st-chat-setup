import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { EXTENSION_NAME, LOG_PREFIX } from './src/constants.js';
import { openEntryModal } from './src/entry-modal.js';
import { installInterceptor } from './src/interceptor.js';
import { tr } from './src/i18n.js';
import { getSettings, loadSettings, setSetting } from './src/settings.js';
import { CHAT_STAMP_STYLES, formatChatStamp } from './src/utils.js';

async function mountSettingsPanel() {
    const html = await renderExtensionTemplateAsync(EXTENSION_NAME, 'templates/settings');
    const root = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    root.append(html);

    const settings = getSettings();
    fillChatNameStampOptions();
    $('#st_chat_setup_settings input[type="checkbox"][data-setting]').each(function () {
        const key = this.dataset.setting;
        $(this).prop('checked', !!settings[key]);
        $(this).on('change', function () {
            setSetting(/** @type {any} */ (key), $(this).prop('checked'));
        });
    });
    $('#st_chat_setup_settings select[data-setting]').each(function () {
        const key = this.dataset.setting;
        $(this).val(String(settings[key]));
        $(this).on('change', function () {
            setSetting(/** @type {any} */ (key), String($(this).val()));
        });
    });
}

/**
 * '새 채팅 이름의 날짜' 선택지. 형식 이름만으로는 감이 안 오므로 지금 시각으로 만든 예시를 붙인다.
 * data-i18n 없이 직접 채워 ST 의 재번역이 덮어쓰지 않게 한다.
 */
function fillChatNameStampOptions() {
    const select = document.getElementById('st_chat_setup_name_stamp');
    if (!(select instanceof HTMLSelectElement)) return;
    const labels = {
        st: tr('stamp_st', 'SillyTavern default'),
        date: tr('stamp_date', 'Date'),
        minute: tr('stamp_minute', 'Date + hour:minute'),
        second: tr('stamp_second', 'Date + hour:minute:second'),
    };
    const now = new Date();
    select.replaceChildren(...CHAT_STAMP_STYLES.map(style => new Option(`${labels[style]} — ${formatChatStamp(style, now)}`, style)));
}

jQuery(async () => {
    loadSettings();
    installInterceptor(openEntryModal);

    try {
        await mountSettingsPanel();
    } catch (error) {
        // 설정 패널이 실패해도 가로채기는 이미 동작 중이므로 확장은 계속 쓸 수 있다
        console.error(LOG_PREFIX, 'failed to mount settings panel', error);
    }
});
