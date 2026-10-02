import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { EXTENSION_NAME, LOG_PREFIX } from './src/constants.js';
import { openEntryModal } from './src/entry-modal.js';
import { installInterceptor } from './src/interceptor.js';
import { getSettings, loadSettings, setSetting } from './src/settings.js';

async function mountSettingsPanel() {
    const html = await renderExtensionTemplateAsync(EXTENSION_NAME, 'templates/settings');
    const root = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    root.append(html);

    const settings = getSettings();
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
