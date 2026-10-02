export const MODULE_NAME = 'st_chat_setup';
export const EXTENSION_NAME = 'third-party/st-chat-setup';
export const LOG_PREFIX = '[ChatSetup]';

// ST 마크업에 의존하는 셀렉터는 업스트림이 바뀌면 여기만 고치면 되도록 모아 둔다
export const SELECTORS = Object.freeze({
    characterList: '#rm_print_characters_block',
    characterCard: '.character_select',
    // 일괄 편집(BulkEditOverlay)·레거시 일괄 선택 모드에서는 카드 클릭이 '선택' 동작이다
    bulkSelectModeClasses: ['group_overlay_mode_select', 'bulk_select'],
    bulkSelectCheckbox: '.bulk_select_checkbox',
});

// 드롭다운의 특수 값. 실제 페르소나/로어북 이름과 겹치지 않도록 밑줄로 감싼다
export const KEEP = '__keep__';
export const AUTO = '__auto__';
export const NONE = '__none__';
/** 로어북 드롭다운의 '새 로어북 만들기…' 항목 */
export const CREATE = '__create__';

// 입장창 결과값. POPUP_RESULT(AFFIRMATIVE=1, NEGATIVE=0, CANCELLED=null)와 겹치지 않게 2부터
export const RESULT_EDIT_CHARACTER = 2;

export const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS = Object.freeze({
    version: SETTINGS_VERSION,
    enabled: true,
    // 지금 열린 캐릭터를 다시 눌러도 입장창을 띄운다(같은 캐릭터의 다른 채팅/새 채팅으로 갈아타기).
    // 편집 화면은 입장창 [수정] → 'ST 전체 수정 열기' 또는 상단 캐릭터 이름 탭으로 간다
    interceptCurrentCharacter: true,
    bypassWithModifier: true,
    confirmScopedLoreChange: true,
    // 입장창의 캐릭터·페르소나 이미지 크기. 'large' 면 두 이미지를 나란히 크게(원본 이미지) 보여 준다
    avatarSize: 'small',
    // 입장창 [수정] 버튼: 'quick' = 채팅을 열지 않는 빠른 수정 창 / 'full' = 바로 ST 편집 화면
    editButtonMode: 'quick',
});
