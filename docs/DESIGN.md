# st-chat-setup — 채팅방 입장 관리 확장 설계

> 대상: SillyTavern `staging` @ `bc81b9f7e` (2026-10-03 재검증). 아래 라인 번호는 이 커밋 기준이며 업스트림 변경 시 달라질 수 있음.

## 0. 한 줄 요약

캐릭터 카드 클릭을 **캡처 단계에서 가로채** 입장 모달을 띄우고, `[입장]` 시
**(신규) 메타데이터가 미리 들어간 채팅 파일을 먼저 만든 뒤 → ST 기본 로드 경로로 진입**,
**(기존) ST 기본 로드 후 → 사용자가 바꾼 항목만 덮어쓰기** 한다.
ST 내부 로직(페르소나 자동 선택, 첫 메시지, 로어북 버튼 상태 등)은 최대한 그대로 타게 만든다.

---

## 1. ST 내부 분석 결과 (설계 근거)

### 1.1 캐릭터 클릭 → 채팅 로드 경로

| 단계 | 위치 | 내용 |
|---|---|---|
| 클릭 핸들러 | `public/script.js:11192` | `$(document).on('click', '.character_select', …)` → `selectCharacterById(id)` (jQuery **위임**, document 버블 단계) |
| 활성 캐릭터 저장 | `public/scripts/RossAscends-mods.js:849` | 같은 클릭에 `setActiveCharacter(chid)` + `saveSettingsDebounced()` (재시작 시 자동 로드용) |
| 캐릭터 전환 | `script.js:875 selectCharacterById` | 다른 캐릭터면: `clearChat` → `setCharacterId(id)` → `chat_metadata = {}` → `getChat()`. **같은 캐릭터면 채팅 로드 없이 캐릭터 편집 패널만 염** |
| 채팅 로드 | `script.js:7634 getChat` | `characters[this_chid].chat` 파일명을 `/api/chats/get`으로 읽음. 헤더의 `chat_metadata` 복원 |
| 로드 후처리 | `script.js getChatResult` | 채팅이 비었으면 첫 메시지 생성 + `saveChatConditional()`(파일 생성), `CHAT_CHANGED` emit(await), 신규면 `CHAT_CREATED` |
| 기존 채팅 열기 | `script.js:7744 openCharacterChat(file)` | **현재 캐릭터 한정**. `characters[this_chid].chat = file` → `getChat()` → `createOrEditCharacter('newChat')`(캐릭터 카드의 `chat` 필드 영속화) |
| 새 채팅 | `script.js:10618 doNewChat` | **현재 캐릭터 한정**. 파일명 `${name2} - ${humanizedDateTime()}` 지정 후 `getChat()` |
| 채팅 목록 | `script.js:8506 getPastCharacterChats(chid)` | `/api/characters/chats` → `{file_name, last_mes, mes, chat_items, file_size…}[]`, 파일명 역순 |

**핵심 관찰**: ST는 “채팅 진입 = `characters[id].chat`에 파일명을 꽂고 `getChat()`” 구조다.
따라서 `selectCharacterById` 호출 **직전**에 `characters[id].chat`을 원하는 파일명으로 바꿔두면
캐릭터 전환과 원하는 채팅 진입이 **한 번의 로드**로 끝난다(마지막 채팅을 먼저 로드했다 다시 바꾸는 깜빡임 없음).

### 1.2 페르소나

| 항목 | 위치 | 내용 |
|---|---|---|
| 현재 페르소나 | `personas.js:108 user_avatar` | 항상 하나가 선택됨(“페르소나 없음” 개념은 ST에 없음) |
| 목록 | `power_user.personas` (avatarId → 이름), `getUserAvatars(false)` | |
| 채팅 고정 | `chat_metadata.persona = avatarId` | `lockPersona('chat')`가 이 값을 세팅 |
| 자동 선택 | `personas.js:1543 loadPersonaForCurrentChat` (CHAT_CHANGED 리스너) | 우선순위: **채팅 고정 → 캐릭터 연결 → 기본 페르소나**. 캐릭터 연결이 여러 개면 **선택 팝업**을 띄움 |
| 변경 | `personas.js:154 setUserAvatar(id)` | `persona_auto_lock`이 켜져 있으면 **현재 열린 채팅**에 자동 고정됨 → 호출 시점 주의 |

→ 채팅 메타데이터에 `persona`가 **로드 시점에 이미 들어 있으면** ST가 알아서 그 페르소나를 선택하고, 다중 연결 팝업도 뜨지 않는다.

### 1.3 로어북

전역 로어북(`selected_world_info`)은 **이 확장에서 다루지 않음** — ST 설정 그대로 유지.
확장이 다루는 세 종류의 로어북은 **저장 위치(=적용 범위)가 서로 다르다**는 점이 설계의 핵심.

| 종류 | 저장 위치 | 적용 범위 | 변경 방법 |
|---|---|---|---|
| 전체 목록 | `world-info.js:68 world_names` | — | — |
| **페르소나 로어북** (단일) | `power_user.persona_descriptions[avatarId].lorebook`<br>현재 페르소나 값은 `power_user.persona_description_lorebook`에 복사됨(`personas.js:914`, 페르소나 전환 시 `selectCurrentPersona`가 복사) | **그 페르소나를 쓰는 모든 채팅** | descriptor의 `lorebook` 갱신 → 현재 페르소나면 `persona_description_lorebook`도 갱신, `#persona_lore_button` `world_set` 토글, `saveSettingsDebounced()`, `PERSONA_UPDATED` emit (`personas.js:1297` 핸들러와 동일 절차) |
| **캐릭터 로어북 – 기본** (단일) | `characters[chid].data.extensions.world` (캐릭터 카드 파일) | **그 캐릭터의 모든 채팅** | `charUpdatePrimaryWorld(name)` (`world-info.js:6097`) — **현재 열린 캐릭터 폼**(`#character_world`) 기준으로 `createOrEditCharacter()` 저장 → 캐릭터 진입 **후**에만 호출 가능. 해제 시 내장 로어북(`character_book`) 제거 토스트가 뜨는 부작용 있음 |
| **캐릭터 로어북 – 추가** (복수) | `world_info.charLore[{ name: 캐릭터파일명, extraBooks }]` (전역 설정) | **그 캐릭터의 모든 채팅** | `charSetAuxWorlds(getCharaFilename(chid), books)` (`world-info.js:6145`) — 시점 무관 |
| **채팅 로어북** (단일) | `chat_metadata[METADATA_KEY]` (`METADATA_KEY = 'world_info'`) | **이 채팅만** | 세팅 후 `saveMetadata()` + `.chat_lorebook_button` 클래스 갱신 (`world-info.js:1013` CHAT_CHANGED 리스너가 로드 시 자동 갱신) |

→ 입장창에서 페르소나/캐릭터 로어북을 바꾸는 것은 **“이번 채팅 설정”이 아니라 페르소나·캐릭터 자체의 연결을 바꾸는 것**. UI에 적용 범위를 명시해야 함.

### 1.4 서버 채팅 저장 (`src/endpoints/chats.js`)

- `/api/chats/save` body: `{ ch_name, file_name, avatar_url, chat: [header, ...messages], force }`
- 헤더 형식: `{ chat_metadata: {...}, user_name: 'unused', character_name: 'unused' }` (`script.js saveChat`)
- 파일명은 서버에서 `sanitize-filename` 처리 → **클라이언트에서도 같은 규칙으로 정리**해야 `characters[id].chat`과 실제 파일명이 어긋나지 않음
- `chat_metadata.integrity`가 기존 파일과 다르면 저장 거부(새 파일이면 문제 없음)

### 1.5 가로채기 시 주의할 다른 경로

- `bulk-edit.js` / `BulkEditOverlay.js`: 일괄 편집·그룹 선택 모드에서 `.character_select` 클릭은 **선택 동작** → 가로채면 안 됨
- `keyboard.js:10`: 포커스된 카드에서 Enter → `click()` 디스패치 → 동일 경로로 잡힘(OK)
- 슬래시 커맨드(`/go` 등), 웰컴 스크린 최근 채팅(`welcome-screen.js:486,840,891`)은 `selectCharacterById`를 **직접 호출** → 클릭 가로채기 대상이 아님(의도적으로 건드리지 않음)

---

## 2. 범위

| 단계 | 포함 |
|---|---|
| **1차 MVP** | 클릭 가로채기 / 입장 모달 / 페르소나 / 페르소나 로어북 / 캐릭터 로어북(기본·추가) / 채팅 로어북 / 신규·기존 채팅 / 입장 처리 / 취소·ESC·바깥 클릭 / 캐릭터 재클릭 처리 / ON·OFF 설정 |
| 제외 | 전역 로어북 — ST 설정을 건드리지 않음 |
| 2차 | 채팅 목록 개선(마지막 메시지 미리보기·날짜·검색·정렬), 기본 채팅 방식(신규/기존/마지막 선택 기억), 기본값 설정 |
| 3차 | 캐릭터별 프리셋(페르소나·로어북), 채팅명 템플릿 자동 생성, 즐겨찾기, 이름 변경·삭제 |

그룹 채팅(`.group_select`)은 범위 밖.

### 2.1 모바일 우선 원칙

주 사용 환경은 **휴대폰(터치, 폭 ~375px)**. 모든 UI는 모바일 기준으로 만들고 넓은 화면은 보정만 한다.

| 원칙 | 적용 |
|---|---|
| CSS는 모바일 기본 + `@media (min-width: 768px)`에서만 데스크톱 보정 | `style.css` |
| 터치 대상 최소 높이 44px (버튼·드롭다운·라디오 행·채팅 목록 항목) | 입장/취소 버튼은 반반 폭 44px |
| 폭은 ST `.popup`(500px, `max-width: 100dvw - 2em`)에 맡김 | 휴대폰에서 화면 폭에 맞춰지고, 넓은 화면에서는 500px |
| hover·우클릭·수정키에 의존하는 기능은 보조 수단으로만 | Shift/Ctrl 우회는 데스크톱 전용 편의 기능. 모바일에는 설정의 ON/OFF가 탈출구 |
| 길게 누르기(2.5초)는 ST 일괄 편집 진입 → 건드리지 않음 | 인터셉터가 일괄 편집 모드를 통과시킴 |
| 긴 목록(채팅·로어북)은 모달 안에서 세로 스크롤 | `allowVerticalScrolling: true`, 4단계 이후 목록 높이 제한 |
| 텍스트 입력(채팅 이름) 시 가상 키보드가 버튼을 가리지 않게 | 4단계에서 입력란 포커스 시 `scrollIntoView` 확인 |
| 드롭다운은 네이티브 `<select>` 우선 | 모바일 OS의 선택 UI를 그대로 사용(복수 선택인 캐릭터 추가 로어북만 체크리스트) |
| 입장 후 모바일에서는 캐릭터 패널이 닫히고 채팅이 보여야 함 | ST 기본 동작으로 확인됨(3단계) |

---

## 3. 아키텍처

### 3.1 파일 구조

```text
st-chat-setup/
├─ manifest.json
├─ index.js                 # 진입점: 설정 로드, 인터셉터 등록, 설정 UI 마운트
├─ style.css
├─ templates/
│  ├─ modal.html            # 입장 모달 본문
│  └─ settings.html         # 확장 설정 패널(Extensions 탭)
├─ src/
│  ├─ constants.js          # MODULE_NAME, sentinel 값, 기본 설정
│  ├─ settings.js           # extension_settings 읽기/쓰기/마이그레이션
│  ├─ interceptor.js        # 캐릭터 클릭 가로채기
│  ├─ data-source.js        # 페르소나/로어북/채팅 목록 조회 (읽기 전용)
│  ├─ entry-modal.js        # 모달 생성·상태·렌더·검증 (UI)
│  ├─ entry-actions.js      # 입장 실행: enterNewChat / enterExistingChat (부작용)
│  ├─ quick-edit.js         # 채팅을 열지 않는 캐릭터 빠른 수정
│  ├─ i18n.js               # tr(key, english) — chat_setup.* 전용 번역
│  └─ utils.js              # 파일명 정리, 중복 검사, 날짜 포맷
├─ locales/{ko,en}.json
└─ docs/DESIGN.md
```

**의존 방향**: `index → interceptor → entry-modal → (data-source, entry-actions)`.
`entry-actions`는 UI를 모르고, `entry-modal`은 ST 내부 함수를 직접 부르지 않는다(테스트·교체 용이).

### 3.2 사용하는 ST API (import)

```js
// script.js
import {
  characters, this_chid, chat_metadata, is_send_press, isChatSaving,
  selectCharacterById, openCharacterChat, getPastCharacterChats,
  saveMetadata, getRequestHeaders, getThumbnailUrl, setActiveCharacter,
  saveSettingsDebounced, eventSource, event_types,
} from '../../../../script.js';
// personas.js
import { user_avatar, setUserAvatar, setPersonaLockState, getUserAvatars } from '../../../personas.js';
import { power_user } from '../../../power-user.js';
// world-info.js
import { world_names, world_info, METADATA_KEY, charUpdatePrimaryWorld, charSetAuxWorlds } from '../../../world-info.js';
// 기타
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { humanizedDateTime } from '../../../RossAscends-mods.js';
import { uuidv4, getCharaFilename } from '../../../utils.js';
```

> `chat_metadata`, `this_chid` 등은 `let` 재할당 변수이므로 **ES 모듈 live binding**으로 import해야 최신값이 보인다.
> `getContext().chatMetadata`는 호출 시점 스냅샷이라 입장 처리 도중 값이 어긋날 수 있어 사용하지 않는다.
> `isChatSaving`(script.js:419), `is_send_press`(:603), `setActiveCharacter`(:836), `humanizedDateTime`(RossAscends-mods.js:169) 모두 export 확인됨.

---

## 4. 모듈 상세

### 4.1 interceptor.js — 캐릭터 클릭 가로채기

**방식**: `window`에 **capture 단계** 리스너 등록 → jQuery 위임 핸들러(document 버블 단계)보다 먼저 실행됨.
조건 충족 시 `stopImmediatePropagation()` + `preventDefault()`로 ST 기본 핸들러(`selectCharacterById`, `setActiveCharacter`) 모두 차단.

```js
export function installInterceptor() {
  window.addEventListener('click', onCaptureClick, { capture: true });
}

function onCaptureClick(e) {
  const card = e.target.closest?.('#rm_print_characters_block .character_select');
  if (!card) return;
  if (!shouldIntercept(card, e)) return;   // 아래 조건
  e.stopImmediatePropagation();
  e.preventDefault();
  openEntryModal(Number(card.dataset.chid));
}
```

**가로채지 않는 경우 (원래 ST 동작 유지)**

| 조건 | 이유 |
|---|---|
| 설정 `enabled === false` | 확장 OFF |
| `#rm_print_characters_block`이 `.bulk_select` 또는 `.group_overlay_mode_select` | 일괄 편집/그룹 선택 모드 |
| `e.target`이 `.bulk_select_checkbox`, 태그 등 카드 내부 별도 컨트롤 | 다른 기능 클릭 |
| 수정키(Shift/Ctrl/Alt) 클릭 | **우회 단축키**: 기존 ST처럼 즉시 입장 (사용자 탈출구) |
| `String(chid) === String(this_chid)` && 그룹 아님 | **현재 캐릭터 재클릭 = ST에선 ‘캐릭터 편집 패널 열기’** 동작. 이걸 막으면 카드 편집 진입로가 사라짐 → 기본은 통과 (설정 `interceptCurrentCharacter`로 변경 가능, §8 결정사항 D2) |

### 4.2 data-source.js — 읽기 전용 조회

```js
getCharacterInfo(chid)      → { chid, name, avatar, avatarUrl }
getPersonaOptions()         → [{ id: avatarId, name, isDefault, isCurrent, isConnected }]  // power_user.personas 기반
getLorebookNames()          → [...world_names]
getPersonaLorebook(avatarId)→ power_user.persona_descriptions[avatarId]?.lorebook ?? ''
getCharacterLorebooks(chid) → { primary: characters[chid].data?.extensions?.world ?? '',
                                extra: world_info.charLore?.find(e => e.name === getCharaFilename(chid))?.extraBooks ?? [] }
getChatList(chid)           → getPastCharacterChats(chid) 매핑
                              → [{ fileName (확장자 제거), lastDate, preview, count }]
```

캐릭터 연결 페르소나(`isConnected`)는 MVP에서 정렬/표시용 힌트로만 사용(“★ 연결됨”).

### 4.3 entry-modal.js — UI와 상태

**상태 모델**

```js
/** @typedef {Object} EntryState */
{
  token: number,            // 모달 세션 ID (비동기 응답 폐기용)
  chid: number,
  mode: 'new' | 'existing',
  newChatName: string,
  existingChat: string|null,           // fileName
  persona:      { value: string,   dirty: boolean },  // avatarId | KEEP | AUTO        — 이 채팅
  personaLore:  { value: string,   dirty: boolean },  // name | NONE                  — 선택한 페르소나 전체
  charLore:     { value: string,   dirty: boolean },  // name | NONE (기본)            — 이 캐릭터 전체
  charLoreExtra:{ value: string[], dirty: boolean },  // 추가 로어북                   — 이 캐릭터 전체
  chatLore:     { value: string,   dirty: boolean },  // name | NONE | KEEP           — 이 채팅
}
```

**Sentinel 값** (`constants.js`)

| 값 | 의미 | 사용 모드 |
|---|---|---|
| `__keep__` | 기존 채팅의 설정 그대로 | 기존 채팅 전용(기본값) |
| `__auto__` | 고정하지 않음 → ST 규칙(캐릭터 연결 → 기본 페르소나)에 맡김 | 페르소나 |
| `__none__` | 없음 | 페르소나 로어북 / 캐릭터 로어북(기본) / 채팅 로어북 |

**모드별 초기값**

| 필드 | 새 채팅 | 기존 채팅 |
|---|---|---|
| 페르소나 | 현재 `user_avatar` (설정에 기본값 있으면 그것) | `__keep__` |
| 페르소나 로어북 | 드롭다운에서 고른 페르소나의 현재 연결값 | 동일 (페르소나가 `__keep__`/`__auto__`면 **비활성**) |
| 캐릭터 로어북 (기본/추가) | 캐릭터의 현재 연결값 | 동일 (캐릭터 속성이므로 모드 무관) |
| 채팅 로어북 | `__none__` | `__keep__` |

**페르소나 로어북 ↔ 페르소나 연동**

- 페르소나 드롭다운이 바뀌면, 페르소나 로어북이 `dirty=false`일 때 **새로 고른 페르소나의 연결값으로 다시 채움**.
  `dirty=true`면 “이전 페르소나용으로 바꾼 값”을 다른 페르소나에 적용하게 되므로 **값을 다시 채우고 dirty 해제** (조용한 오적용 방지).
- 페르소나가 `__keep__`(기존 채팅 기본) 또는 `__auto__`이면 어떤 페르소나가 쓰일지 입장 전엔 확정할 수 없음 →
  페르소나 로어북 필드를 **비활성** + “페르소나를 지정하면 변경할 수 있습니다” 안내.

**적용 범위 표시** — 로어북 필드마다 라벨 옆에 범위 배지:
`페르소나 로어북 [이 페르소나의 모든 채팅]`, `캐릭터 로어북 [이 캐릭터의 모든 채팅]`, `채팅 로어북 [이 채팅만]`.
페르소나/캐릭터 로어북을 바꾼 상태로 입장하면 확인 문구를 한 번 보여줌(설정으로 끌 수 있음).
| 채팅 이름 | `${캐릭터명} - ${humanizedDateTime()}` 미리 채움 | — |
| 채팅 선택 | — | 목록 첫 항목(=가장 최근, `characters[chid].chat`과 같으면 그걸 우선) |

> **기존 채팅은 “유지”가 기본** (요구사항 §8 합의 내용). 사용자가 드롭다운을 바꾼 경우에만 `dirty=true` → 입장 시 덮어씀.
> 기존 채팅 파일을 열어보지 않고는 그 채팅의 현재 페르소나/로어북을 알 수 없으므로(전체 파일 다운로드 필요) MVP는 “유지” sentinel로 표시한다. 2차에서 미리보기 추가 검토.

**레이아웃** (`templates/entry-modal.html`, ST `Popup` 사용) — 2026-10-03 사용자 요청으로 확정: **캐릭터(누구와) → 페르소나(누구로) → 채팅(어느 채팅에서) → (선택) 로어북**. 로어북 칸과 요약 줄도 같은 순서(캐릭터 → 페르소나 → 채팅)

```text
┌ 채팅방 입장 ───────────────────────────────┐
│ 캐릭터   [아바타] Seraphina        [✎ 수정] │
│ 페르소나 [Alice ▼]                          │
│ 채팅     ● 새 채팅 [Seraphina - Alice - …]  │
│          ○ 기존 채팅 (3)  [목록]            │
│ ▼ 로어북                                    │ ← 기본 접힘
│   캐릭터   Eldoria                          │   요약: 항목별 한 줄, 길면 …
│   페르소나 없음                             │
│   채팅     없음                             │
│    ├ 캐릭터 로어북    [▼] + ▸추가 로어북 ☑… │
│    ├ 페르소나 로어북  [▼] 이 페르소나의 모든 채팅 │
│    └ 채팅 로어북      [▼] 이 채팅만         │
│ (오류 문구 — 버튼 바로 위)                  │
│              [입장] [취소]                  │
└─────────────────────────────────────────────┘
```

- **수정 버튼 옵션**(설정 `editButtonMode: 'quick' | 'full'`, 기본 quick): full 이면 [수정]이 빠른 수정 없이 `openCharacterEditor`로 바로 ST 편집 화면(다른 캐릭터면 마지막 채팅도 열림, 현재 캐릭터면 채팅 재로드 0회 — 확인함). 버튼 title 도 모드에 맞게(`data-i18n` 키째 교체)
  - 추가(사용자 요청): `'both'` = [수정](빠른 수정) + [ST 수정](`RESULT_EDIT_FULL` → `openCharacterEditor`). 큰 배치는 이미지 아래 두 버튼을 반씩, 작은 배치는 휴대폰에서 이름이 'Se…'로 줄어들어 [✎](아이콘만) [↗ ST]로 줄임(768px 이상은 원래 글자). 확인(375×812): 작은 배치 이름 76px·버튼 44px, 큰 배치 두 버튼과 페르소나 select 높이·위치 일치, [✎] → 빠른 수정 → 뒤로 → 입장창, [ST] → ST 편집 화면. 설정·열린 채팅 없음 원복
- **큰 이미지 옵션**(설정 `avatarSize: 'small' | 'large'`, 기본 small): large 면 템플릿의 `{{#if largeAvatars}}` 블록으로 캐릭터 | 페르소나 두 칸(2:3 틀, 원본 이미지 `formatCharacterAvatar`/`getUserAvatar` — 썸네일은 96×144 라 키우면 흐림), 캐릭터 이름은 이미지 하단에 겹쳐 `[수정] | [페르소나 선택]`이 같은 줄. 클래스 이름이 작은 배치와 같아 페르소나 로직은 그대로(이미지 주소 함수만 주입). 페르소나를 미리 알 수 없으면 빈 자리 아이콘. 작은 배치의 원형 아바타 규칙(border-radius 50%)을 큰 틀에서 덮어씀. 넓은 화면은 틀 높이 45dvh 제한. 이미지 아래 `[수정] | [페르소나 선택]`은 위치·크기가 같아도 버튼(가운데 글자·진한 배경)과 select(왼쪽 글자·반투명 배경) 모양 차이로 어긋나 보여(사용자 지적) 배경·테두리·모서리·16px 글자·가운데 정렬(select 는 ▼ 폭만큼 좌우 여백)을 맞춤. (간편 수정 창에도 큰 이미지를 넣었다가, 사용자가 원한 건 ‘입력칸 크게 열기’였음이 확인돼 되돌림 — 간편 수정 이미지는 작게 고정, 설정 이름도 ‘입장창 이미지’로 원복)
- **작은 배치 통일**(사용자 지적): 캐릭터는 카드 안 44px 이미지 + 16.5px 이름, 페르소나는 카드 없이 36px 이미지 + 드롭다운 상자로 모양이 달랐음 → 페르소나 줄도 같은 카드(`.st-chat-setup-character`)에 넣고 이미지 44px 원(미리 모를 땐 사람 아이콘 자리 유지), select 는 카드 안에서 테두리·배경 없이 이름처럼, 이름·선택 글자 모두 16px. 확인: 두 카드 298×62 동일, 이미지 위치·글자 시작 위치 일치, 큰 배치 영향 없음
- **간편 수정 입력칸 크게 열기**: 각 항목 제목 오른쪽과 대체 인사말마다 ⤢ 버튼. ST 의 `editor_maximize` 기능을 그대로 사용(클래스 + `data-for`=대상 textarea id → ST chats.js 가 큰 편집 창을 띄우고 input 이벤트로 원래 칸에 실시간 반영). 대체 인사말은 추가·삭제되므로 증가하는 고유 id 부여. 확인: 큰 창 입력이 원래 칸에 반영, 큰 창 닫아도 빠른 수정 유지, 큰 창에서 고친 것도 ‘변경됨’으로 잡혀 뒤로 시 버릴지 확인(카드 무변경 확인)
- **채팅이 바뀌면 페르소나·채팅 로어북 칸을 그 채팅 기준으로 다시 맞춘다**(모드 전환 또는 다른 기존 채팅 선택 시 `dirty` 해제). 초기 구현은 ‘직접 고른 값은 모드가 바뀌어도 유지’였는데, 페르소나를 채팅 위로 올린 뒤 ‘B 선택 → A 가 고정된 기존 채팅 선택’ 시 칸이 B 로 남아 **A 채팅을 B 로 덮어쓰는** 위험이 있었음(사용자 발견). 확인: 새 채팅 B·Eldoria → 기존 채팅 전환 시 `유지 (Alice)`/`유지 (없음)`, 다른 기존 채팅 선택 시 `유지 (User)`, 기존 채팅에서 덮어쓰기 고른 뒤 채팅 바꾸면 해제, 새 채팅 복귀 시 처음 값
- 중간 개편안(채팅 → 페르소나)에서 사용자 요청으로 페르소나를 채팅 위로 되돌림. 아래에서 기존 채팅을 고르면 위의 페르소나 칸이 ‘기존 설정 유지 (현재값)’로 즉시 바뀐다(채팅 영역 → 페르소나 영역 알림은 그대로)
- 로어북은 자주 바꾸지 않으므로 `<details>`로 접고, 요약은 각 섹션의 `getSummary()`로 만든다(값이 바뀌면 즉시 갱신). 휴대폰 한 화면에 스크롤 없이 들어감
- **입장 처리는 창을 연 채로**(`onClosing` 안에서 검증 → 확인 → 입장): 처리 중엔 [입장]에 스피너 + ‘입장 중…’, 내용 `inert`, 취소·ESC·바깥 클릭·재탭 무시. 실패하면 창을 닫지 않고 버튼 위 오류 칸에 안내 → 바로 재시도 가능

- 라디오 전환 시 반대쪽 입력 영역 `disabled` + 접힘 (§7 “동시에 입력받지 않음”)
- 기존 채팅이 0개면 `기존 채팅` 라디오 비활성
- 모드 전환 시 페르소나/채팅 로어북 값이 `dirty=false`이면 해당 모드 초기값으로 리셋, `dirty=true`면 유지 (단, `__keep__`은 새 채팅 모드에서 선택 불가이므로 초기값으로 치환)

**Popup 구성**

```js
const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
  okButton: t`입장`, cancelButton: t`취소`,
  allowVerticalScrolling: true, wide: false,
  onOpen: bindHandlers,          // 바깥(backdrop) 클릭 → popup.complete(POPUP_RESULT.CANCELLED)
  onClosing: validateBeforeClose // 입장일 때만 검증, 실패 시 false 반환해 닫힘 취소
});
const result = await popup.show();
if (result === POPUP_RESULT.AFFIRMATIVE && state.token === currentToken) await runEntry(state);
```

- ESC: `Popup` 기본 지원(`allowEscapeClose`)
- Enter: `Popup` 기본이 AFFIRMATIVE → 입장 (텍스트 입력 중 Enter 포함)
- 바깥 클릭: `Popup`에 옵션이 없으므로 `onOpen`에서 `dialog` 요소의 click 중 `e.target === dialog`인 경우 취소 처리

**캐릭터 수정 진입 — 채팅을 열지 않는 빠른 수정** (`src/quick-edit.js`)

ST 의 수정 패널은 선택된 캐릭터(`this_chid`)에 묶여 있고, 1:1 채팅에서 `this_chid`는 곧 열린 채팅의 주인이다.
그래서 ST 패널로는 **채팅을 열지 않고 다른 캐릭터를 수정할 수 없다.**
(채팅은 A 로 둔 채 `this_chid`만 B 로 바꾸거나, 채팅을 닫고 B 만 선택해 두는 방식은 다음 저장/전송 때
B 의 채팅 파일을 덮어쓸 위험이 있어 기각.) → 확장 자체 빠른 수정 창을 둔다.

```text
입장창 [수정] ─▶ 빠른 수정 창 ─┬─ [저장]  → merge-attributes 저장 → 입장창으로 복귀
                              ├─ [뒤로]/ESC/바깥 → (변경 있으면 버릴지 확인) → 입장창으로 복귀
                              └─ [ST 전체 수정 열기] → openCharacterEditor(chid)  ※ 이때만 마지막 채팅이 열림
```

| 항목 | 내용 |
|---|---|
| 수정 가능 필드 | 설명, 성격 요약, 시나리오, 첫 메시지, 대화 예시, 메인 프롬프트 덮어쓰기, 기록 후 지침, 제작자 노트, 대체 인사말(추가/삭제) |
| ST 전체 수정 필요 | 이름(채팅 폴더 이름 변경 동반), 아바타, 태그, 로어북 연결, depth prompt, 수다스러움 등 |
| 읽기 | `unshallowCharacter(chid)`로 전체 카드 확보 후 ST 편집 화면과 같은 우선순위(V1 최상위 → V2 `data.*`, 제작자 노트는 `data.creator_notes` → `creatorcomment`) |
| 저장 | `/api/characters/merge-attributes` (single mode, `{ avatar, ...변경된 V1 필드, data: {...변경된 V2 필드} }`). 서버 `deepMerge`는 객체는 병합, **배열은 통째로 교체** → `alternate_greetings`는 전체 배열 전송. 빈 인사말은 제외 |
| 저장 후 | `getOneCharacter(avatar)`로 메모리 갱신. **수정 대상이 현재 캐릭터면 `select_selected_character(chid, { switchMenu: false })`로 ST 편집 폼(숨은 `#character_json_data` 포함)을 다시 채움** — 안 그러면 ST 가 이후 폼 기준으로 저장할 때(`createOrEditCharacter`: 채팅 전환·새 채팅 등) 옛 값으로 되돌림 |
| 열기 전 (ST → 확장 동기화) | ST 편집 화면은 입력 후 1초 뒤 저장(`saveCharacterDebounced`)하고, 대기 여부를 밖에서 알 수 없다. 수정 대상이 편집 폼에 올라 있는 캐릭터면(`menu_type !== 'create'` && `#form_create[actiontype=editcharacter]` && `this_chid === chid`) `cancelDebounce(saveCharacterDebounced)` 후 `createOrEditCharacter()`로 **즉시 저장**하고 연다. 안 그러면 방금 ST 에서 고친 값이 안 보이고 늦게 도착한 ST 저장과 엉킨다 |
| Enter 키 | 긴 글 편집 창이라 `defaultResult: CANCELLED` (Enter 로 저장되지 않음) |
| 모바일 | textarea 글자 16px 이상(iOS 포커스 확대 방지), 버튼·삭제 아이콘 44px, 새 인사말 추가 시 `scrollIntoView` |

다른 진입 경로(ST 기본 유지): 현재 캐릭터 다시 클릭(D2), 상단 캐릭터 이름 탭(`#rm_button_selected_ch`), Shift/Ctrl/Alt + 클릭(데스크톱).

**런타임 문구 변경 주의**: ST(i18n.js)는 `MutationObserver`로 화면에 붙는 요소의 `data-i18n`을 다시 번역한다. `data-i18n`이 있는 요소의 글자만 바꾸면 원래 문구로 되돌아가므로 **키(`data-i18n`)도 함께 바꾼다**(예: 빠른 수정의 전체 수정 안내 — 현재 캐릭터면 ‘지금 채팅은 그대로 유지됩니다’). 런타임에 글자를 바꾸는 다른 요소(로딩 버튼·힌트·개수·요약)는 `data-i18n`이 없어 해당 없음.

D2 변경 후 확인(모바일): 현재 캐릭터 실제 탭 → 입장창 / [수정] → ‘ST 전체 수정 열기’ → 채팅 재로드 0회로 편집 패널 / 같은 캐릭터 새 채팅(키보드 Enter 입장) / 같은 캐릭터 기존 채팅으로 복귀(로드 1회) / 사용자 상태(열린 채팅·고정 페르소나·마지막 채팅·active_character) 원복 확인

**번역 키 규칙**: ST 기본 번역에 이미 있는 키는 확장이 덮어쓸 수 없고(`addLocaleData`), ST 쪽 번역이 비어 있는 키도 많다(`Edit`, `Copy` 등).
→ 확장 문구는 전부 **`chat_setup.` 접두 키**를 쓴다. JS 는 `tr(key, english)`(`src/i18n.js`), 템플릿은 `data-i18n="chat_setup.xxx"` + 영어 본문.
번역이 없으면 영어 원문이 그대로 보인다.

**싱글턴 / 캐릭터 재클릭 (§10)**

- 모듈 전역 `activePopup`, `currentToken`.
- `openEntryModal(chid)`: 열린 모달이 있으면 `activePopup.complete(CANCELLED)`로 닫고 `currentToken++` 후 새로 연다.
- 채팅 목록 등 비동기 조회 결과는 **자기 token이 현재 token과 같을 때만** 반영 → A의 늦은 응답이 B 모달을 덮어쓰는 문제 방지.
- `Popup`은 `<dialog>` 모달이라 열린 상태에선 캐릭터 목록 클릭이 backdrop 클릭이 되어 먼저 닫힘 → 실제로는 “닫힘 → 재클릭”으로 자연 처리됨. 위 싱글턴 로직은 슬래시 커맨드/프로그램적 호출 대비 안전장치.

**검증 (`onClosing`, 입장 시에만)**

| 조건 | 메시지 |
|---|---|
| 새 채팅 & 이름 공백 | 채팅 이름을 입력하세요 |
| 새 채팅 & 정리된 이름이 기존 채팅과 동일(대소문자 무시) | 같은 이름의 채팅이 이미 있습니다 |
| 기존 채팅 & 미선택 | 채팅을 선택하세요 |
| `is_send_press` 또는 `isChatSaving` | 생성/저장 중에는 입장할 수 없습니다 |

### 4.4 entry-actions.js — 입장 처리 (핵심)

공통 전처리

```js
async function runEntry(state) {
  const fileName = state.mode === 'new'
    ? sanitizeChatName(state.newChatName)
    : state.existingChat;

  // 진입 전: 시점 무관한 연결 변경 (ST가 진입하면서 자연스럽게 반영하도록)
  if (state.personaLore.dirty)   applyPersonaLorebook(state.persona.value, state.personaLore.value); // (C)
  if (state.charLoreExtra.dirty) charSetAuxWorlds(getCharaFilename(state.chid), state.charLoreExtra.value);

  if (state.mode === 'new') await enterNewChat(state, fileName);
  else                      await enterExistingChat(state, fileName);

  // 진입 후: 현재 열린 캐릭터 폼이 필요한 변경
  if (state.charLore.dirty) await charUpdatePrimaryWorld(state.charLore.value === NONE ? '' : state.charLore.value);

  setActiveCharacter(characters[state.chid].avatar);   // 가로챈 RossAscends 핸들러 대체
  saveSettingsDebounced();
}
```

**적용 순서가 중요한 이유**

| 항목 | 시점 | 이유 |
|---|---|---|
| 페르소나 로어북 | 진입 **전** | descriptor만 바꿔 두면, 진입 중 페르소나가 전환될 때 `selectCurrentPersona`가 그 값을 `persona_description_lorebook`으로 복사 → 별도 동기화 불필요. 이미 현재 페르소나인 경우만 직접 미러링 |
| 캐릭터 추가 로어북 | 진입 전 | `world_info.charLore`는 전역 설정이라 언제 바꿔도 됨. 첫 생성 전에 반영되도록 먼저 |
| 캐릭터 기본 로어북 | 진입 **후** | `charUpdatePrimaryWorld`가 `#character_world`·`createOrEditCharacter()` 즉 **현재 선택 캐릭터 폼**을 저장하므로, 다른 캐릭터에서 호출하면 엉뚱한 캐릭터가 저장됨 |
| 페르소나 / 채팅 로어북 | (A)·(B) 참고 | 채팅 메타데이터 |

#### (A) 새 채팅 — “메타데이터 선기록 후 진입”

```text
1. 헤더 구성
   chat_metadata = { integrity: uuidv4() }
   persona  ≠ __auto__  → chat_metadata.persona   = avatarId
   chatLore ≠ __none__  → chat_metadata.world_info = name
2. POST /api/chats/save { ch_name, avatar_url, file_name, chat: [header], force: false }
   → 헤더만 있는 빈 채팅 파일 생성
3. characters[chid].chat = fileName
4. 진입
   - chid ≠ this_chid → await selectCharacterById(chid)
   - chid = this_chid → await openCharacterChat(fileName)
5. (선택) 카드의 chat 필드 영속화: chid ≠ this_chid 경로였으면 updateRemoteChatName 또는
   createOrEditCharacter('newChat') 호출 — openCharacterChat과 동일한 효과를 내기 위함
```

이렇게 하면 ST가 로드하는 순간 이미 메타데이터가 있으므로:
- `loadPersonaForCurrentChat`가 **채팅 고정 페르소나**를 선택(다중 연결 팝업도 안 뜸)
- 채팅이 비었으므로 `getChatResult`가 **첫 메시지/대체 인사말** 생성 및 저장, `CHAT_CREATED` 발생
- 페르소나 변경으로 이름이 바뀌면 ST의 `retriggerFirstMessageOnEmptyChat`이 첫 메시지 재생성
- 채팅 로어북 버튼 상태는 `world-info.js` CHAT_CHANGED 리스너가 갱신

> **대안(기각)**: `selectCharacterById` → `doNewChat` → 이후 메타데이터 세팅.
> 마지막 채팅을 한 번 로드했다 버리는 이중 로드 + `persona_auto_lock` 때문에 **이전 채팅에 페르소나가 잘못 고정**되는 부작용이 있음.

#### (B) 기존 채팅 — “기본 로드 후 변경분만 덮어쓰기”

```text
1. characters[chid].chat = fileName
2. 진입 (A-4와 동일 분기)
   → 이 시점에 ST가 기존 메타데이터 기준으로 페르소나/채팅 로어북 자동 적용 완료
     (selectCharacterById → getChat → CHAT_CHANGED 리스너까지 await 됨)
3. 덮어쓰기 (dirty && 값 ≠ __keep__ 인 것만)
   persona:
     - avatarId → await setUserAvatar(id); await setPersonaLockState(true, 'chat')
     - __auto__ → await setPersonaLockState(false, 'chat')
   chatLore:
     - name     → chat_metadata[METADATA_KEY] = name
     - __none__ → delete chat_metadata[METADATA_KEY]
     → await saveMetadata(); $('.chat_lorebook_button').toggleClass('world_set', !!name)
```

> 페르소나 변경은 **반드시 새 채팅이 열린 뒤** 수행 (열리기 전에 `setUserAvatar`하면 `persona_auto_lock`이 이전 채팅에 고정해버림).

#### (C) 페르소나 로어북 적용

`personas.js:1297`의 `#persona_lore` change 핸들러와 같은 절차를 **임의 페르소나 대상**으로 수행
(`getOrCreatePersonaDescriptor`는 현재 페르소나 전용이라 사용 불가).

```js
async function applyPersonaLorebook(avatarId, value) {
  if (!avatarId || avatarId === KEEP || avatarId === AUTO) return;   // UI에서 이미 비활성
  const name = value === NONE ? '' : value;
  const descriptor = power_user.persona_descriptions[avatarId];
  if (!descriptor) return;            // 미등록 페르소나: MVP에선 건너뜀(경고 로그)
  descriptor.lorebook = name;
  if (avatarId === user_avatar) {
    power_user.persona_description_lorebook = name;
    $('#persona_lore_button').toggleClass('world_set', !!name);
  }
  saveSettingsDebounced();
  await eventSource.emit(event_types.PERSONA_UPDATED, avatarId);
}
```

#### (D) 캐릭터 로어북 적용

- 기본: 진입 후 `charUpdatePrimaryWorld(name | '')`. 진입 직후이므로 `this_chid === state.chid`임을 확인하고 호출(아니면 중단 + 경고).
  - `''`(해제)일 때 ST가 내장 로어북 제거 토스트를 띄움 → ST 기본 동작이므로 그대로 둠. 다만 입장창에서 “없음” 선택 시 안내 문구 표시.
- 추가: 진입 전 `charSetAuxWorlds(getCharaFilename(chid), books)`. 기본 로어북과 같은 이름은 목록에서 제외.

#### 오류 처리

| 실패 지점 | 처리 |
|---|---|
| 2(파일 생성) 실패 | 토스트, 진입 중단. 현재 채팅 그대로 유지 |
| 4(진입) 실패/무시 (`selectCharacterById`는 생성 중이면 조용히 return) | 사전 검증으로 차단. 진입 후 `getCurrentChatId() !== fileName`이면 경고 토스트 |
| 진입 중 중복 클릭 | `isEntering` 플래그로 재진입 차단 + `loader.show()`로 로딩 표시 |

### 4.5 utils.js

```js
// 서버 sanitize-filename과 동일 규칙: 금지문자 / \ ? < > : * | " 및 제어문자 제거,
// 끝의 . 과 공백 제거, 예약어(CON, NUL…) 회피, 255바이트 제한
sanitizeChatName(name) → string
isDuplicateChatName(name, chatList) → boolean  // 대소문자·악센트 무시
```

### 4.6 settings.js

```js
extension_settings.st_chat_setup = {
  version: 1,
  enabled: true,                    // ☑ 캐릭터 선택 시 채팅방 입장 UI 사용
  interceptCurrentCharacter: false, // 현재 캐릭터 재클릭도 모달로 (D2)
  bypassWithModifier: true,         // Shift/Ctrl 클릭 시 기존 동작
  confirmScopedLoreChange: true,    // 페르소나/캐릭터 로어북 변경 시 입장 전 확인
  // ── 2차 ──
  defaultMode: 'new',               // 'new' | 'existing' | 'remember'
  lastMode: 'new',
  defaultPersona: '__current__',
  defaultChatLorebook: '__none__',
  perCharacter: {},                 // 3차: { [avatar]: { persona, chatLore, mode } }
};
```

설정 UI(`templates/settings.html`)는 `#extensions_settings2`에 inline-drawer로 마운트.

---

## 5. 시퀀스 요약

```text
[클릭 .character_select]
   │ window capture
   ▼
interceptor ──(통과조건?)──yes──▶ ST 기본 동작
   │ no
   ▼
openEntryModal(chid)
   ├─ 이전 모달 닫기, token++
   ├─ data-source 조회 (페르소나·로어북 동기 / 채팅목록 비동기)
   └─ Popup.show()
         │ 취소·ESC·바깥클릭 → 종료(아무 변화 없음)
         │ 입장 → onClosing 검증
         ▼
runEntry(state)
   ├─ [진입 전] 페르소나 로어북 · 캐릭터 추가 로어북 (dirty 시)
   ├─ 신규: 헤더 선기록(페르소나·채팅 로어북) → chat 필드 지정 → selectCharacterById / openCharacterChat
   ├─ 기존: chat 필드 지정 → selectCharacterById / openCharacterChat → 페르소나·채팅 로어북 dirty 덮어쓰기
   └─ [진입 후] 캐릭터 기본 로어북 (dirty 시)
   ▼
setActiveCharacter + saveSettings → 채팅방 진입 완료
```

---

## 6. 구현 순서 (MVP 체크리스트)

1. [x] `manifest.json`, `index.js` 골격, 설정 로드/저장, 설정 패널(ON/OFF)
2. [x] `interceptor.js` — 가로채서 로그 + 임시로 ST 기본 진입. 일괄편집·수정키·현재캐릭터 통과 확인 (T1·T5·T6·T7·T12 브라우저 확인 완료)
3. [x] `entry-modal.js` — 정적 모달(캐릭터 표시 + 취소/ESC/바깥클릭), 싱글턴. 입장은 임시로 ST 기본 진입(`entry-actions.enterWithDefaultBehavior`). 모바일(375px)·데스크톱 확인 완료
4. [x] 채팅 섹션 — 신규/기존 라디오 전환, 목록 로드(token 가드), 이름 검증 (`src/chat-section.js`, `src/data-source.js`, `src/utils.js`). 입장은 아직 임시(ST 기본 진입) — 선택값은 `getValue()`로 준비됨
   - 목록: `/api/characters/chats` 에 `metadata: true` → 채팅마다 `chat_metadata`(고정 페르소나·채팅 로어북)까지 받음. **파일 전체를 내려받지 않고 기존 채팅의 현재 설정을 알 수 있으므로 7·8단계에서 “현재: ○○” 표시에 사용**
   - 정렬: 마지막 메시지 시각 내림차순. 기본 선택은 `characters[chid].chat`(배지 “마지막으로 연 채팅”) → 없으면 가장 최근
   - 기본 모드: 새 채팅(2차 설정 `defaultMode`에서 변경 예정). 채팅이 0개이거나 목록 실패 시 ‘기존 채팅’ 비활성
   - 검증(입장 시 `onClosing`, 실패하면 창 유지 + 창 안 오류 문구): 생성/저장 중, 빈 이름, 중복 이름(대소문자 무시), 목록 로딩 중, 기존 채팅 미선택. 금지 문자는 지우고 실제 쓰일 이름을 칸에 반영
   - ~~목록 실패 시 새 채팅은 중복 검사 없이 허용, 서버 무결성 검사가 덮어쓰기를 막아 줌~~ → **6단계에서 정정**: 서버 무결성 검사는 설정(`checkIntegrity`)으로 꺼질 수 있고, 기존 파일에 `integrity`가 없으면(옛 채팅) 통과시켜 **덮어쓴다**. 그래서 검증 때와 파일 생성 직전에 서버에 직접 존재 여부를 확인한다(`chatFileExists`, `simple: true` 목록)
   - 모바일: 이름 칸 `enterkeyhint="go"` + Enter 제출(**한글 조합 중 Enter 는 무시**), 포커스 시 `scrollIntoView`, 자동 포커스 안 함(키보드가 바로 뜨지 않게), 목록은 `max-height: 40dvh` 내부 스크롤 + 항목 `flex-shrink: 0`(줄어들면 겹침), 줄 전체가 터치 대상
   - 미검증: 실제 휴대폰 가상 키보드가 이름 칸/버튼을 가리는지(에뮬레이터로는 확인 불가) → 실기기 확인 필요
5. [x] `entry-actions.enterExistingChat` 기존 채팅 진입 (다른 캐릭터 / 같은 캐릭터 두 경로)
   - **함정: 반드시 `unshallowCharacter(chid)` 먼저.** `getChat()`이 가벼운(shallow) 캐릭터를 서버 데이터로 통째로 교체하므로, 그 전에 `characters[chid].chat`을 바꾸면 서버의 옛 값으로 되돌아가 엉뚱한(마지막) 채팅이 열린다
   - 다른 캐릭터: `chat` 지정 → `selectCharacterById` (채팅 파일 1회 로드) → `updateRemoteChatName`으로 카드의 `chat` 기록(새로고침 후에도 마지막 채팅 유지). ST 첫 화면 ‘최근 채팅’은 선택→`openCharacterChat`으로 2회 로드하는 것과 대비
   - 같은 캐릭터: 다른 채팅이면 `openCharacterChat`, 이미 열린 채팅이면 아무것도 안 함
   - 진입 후 `getCurrentChatId() === fileName` 확인, 아니면 경고. `isEntering`으로 중복 실행 방지
   - **모바일: 입장 성공 시 오른쪽 패널 닫기(`revealChat`)** — ST 는 다른 캐릭터 선택 시 패널을 캐릭터 편집 화면으로 바꿔 열어 두고(팝업 안 클릭은 바깥 클릭 닫기에서 제외), 휴대폰에선 그 패널이 채팅을 덮는다. 좁은 화면(`isMobile()` 또는 ≤1000px)이고 고정(pinnedOpen)이 아닐 때만
   - 확인: 다른 캐릭터(shallow 강제 포함)·같은 캐릭터 다른 채팅·같은 채팅(재로드 0회)·카드 chat 기록·모바일 실제 탭 흐름
   - 알려진 한계: 목록을 띄운 뒤 다른 곳에서 그 채팅 파일을 지우면, ST 기본 동작대로 같은 이름의 빈 채팅이 새로 만들어진다
6. [x] `entry-actions.enterNewChat` 새 채팅 진입 (헤더 선기록)
   - 순서: `unshallowCharacter` → `chatFileExists`(있으면 거부) → `/api/chats/save`로 `[header]`만 저장(`chat_metadata: { ...metadata, integrity: uuidv4() }`, `force: false`) → `openChatFile`(5단계와 공통)
   - ST 가 이어서 처리: 빈 채팅 → 첫 메시지(대체 인사말 스와이프) 생성·저장, `CHAT_CHANGED` → `CHAT_CREATED`. 헤더의 integrity 는 이후 저장에도 유지됨
   - `metadata` 인자는 7·8단계(고정 페르소나, 채팅 로어북)에서 채움
   - 이름 중복 검사 2중: 입장창 검증(목록 + 서버 직접 확인 → 창 안 오류) / 파일 생성 직전(토스트). 검증이 비동기라 검증 중 [입장] 재탭은 무시
   - 확인: 다른 캐릭터·같은 캐릭터 새 채팅, 서버 호출 순서(save → get → save), 이벤트, 카드 chat 기록, 대소문자만 다른 중복, **목록 실패 시에도 중복 차단**, **기존 파일 이름으로 직접 호출 시 거부 + 원본 무손상**, 금지 문자 정리 후 화면·서버 이름 일치, 모바일 패널 닫힘
   - **진입 실패 시 정리(`discardUnusedChatFile`)**: 파일 생성 후 진입이 실패하면(예외 포함) 방금 만든 파일을 지운다. 남의 채팅을 지우지 않도록 **모두 만족할 때만** 삭제 — 지금 열린 채팅이 아님 / 헤더 integrity 가 이번에 만든 값과 같음 / 사용자 메시지 없음(첫 인사말은 허용). 하나라도 확인 못 하면 남긴다. 메모리 속 `characters[chid].chat`도 이전 값으로 되돌린다(안 그러면 다음 선택 때 그 이름으로 빈 채팅이 다시 생김). 카드 `chat` 기록 실패는 채팅이 이미 열렸으므로 입장 실패로 보지 않음
   - 확인: 저장 중 캐릭터 전환 거부로 실패 유도 → 파일 삭제·`chat` 복원·원래 채팅 유지 / 다른 파일(integrity 불일치)·열린 채팅·사용자 메시지 있는 파일은 **지우지 않음** / 인사말만 있는 우리 파일은 지움
   - ST 서버 백업(`data/<user>/backups`)에는 사본이 남지만 캐릭터별 개수 제한(기본 50)으로 자동 삭제되고 채팅 목록에는 보이지 않음
7. [x] 페르소나 드롭다운 + 신규(선기록)/기존(덮어쓰기) 적용 (`src/persona-section.js`, `entry-actions.applyPersonaToOpenChat`)
   - 새 채팅 초기값 = **ST 가 고를 페르소나 예측**(`loadPersonaForCurrentChat`와 같은 순서: 캐릭터 연결 → 기본 페르소나 → 지금 페르소나). 설계 초안의 “현재 user_avatar”에서 변경 — 그대로 두면 ST 기본 동작과 결과가 같아야 하므로
   - 새 채팅 고정(헤더 `chat_metadata.persona`): **칸에 보이는 페르소나를 항상 고정**(2026-10-03 사용자 결정 — 입장창에서 직접 보고 고르는 화면이라 ‘보이는 대로 고정’이 자연스러움. 초기 구현은 ‘바꿨을 때만 고정’이었음). `자동(SillyTavern 규칙)`을 고르면 고정 안 함. 연결 페르소나가 여럿이어도 고정되므로 ST 선택 팝업이 뜨지 않음
   - 기존 채팅: `기존 설정 유지 (현재 고정값)` 기본 — 4단계 목록의 `metadata.persona`로 표시(고정 안 됨/삭제된 페르소나 포함). `고정 해제` 또는 특정 페르소나를 고르면 입장 **후** `setUserAvatar` + `setPersonaLockState`. 적용 실패는 입장 실패로 보지 않고 경고만
   - 옵션 표시: 이름순, `(연결됨)`·`(기본)` 표시, 선택한 페르소나 아바타 미리보기. 네이티브 `<select>` 44px/16px
   - 확인(임시 페르소나 2개 생성 후 삭제): 그대로 두면 미고정 / 바꾸면 헤더 선기록·즉시 적용 / 기존 채팅 유지 라벨(고정 안 됨·고정값) / **`persona_auto_lock` ON 에서 덮어써도 떠나는 채팅의 고정값 불변** / 고정 해제 시 파일에서도 제거 / 다중 연결 + 미변경 → 선택 팝업 없이 고정
8. [x] 채팅 로어북 드롭다운 + 적용 (`src/chat-lore-section.js`, `entry-actions.applyChatLoreToOpenChat`)
   - 새 채팅: 기본 `없음`. 고르면 헤더 `chat_metadata.world_info`로 선기록 → ST 가 불러올 때 적용, 로어북 버튼(`.chat_lorebook_button.world_set`)은 ST 의 CHAT_CHANGED 리스너가 갱신
   - 기존 채팅: `기존 설정 유지 (현재 로어북/없음/삭제된 로어북)` 기본 — 4단계 목록 메타데이터로 표시. 바꾼 경우에만 입장 후 ST 의 `assignLorebookToChat`과 같은 절차(값 설정/삭제 → 버튼 클래스 → `saveMetadata()`)
   - 라벨 옆 적용 범위 배지 `이 채팅만` (9·10단계의 `이 페르소나의 모든 채팅` / `이 캐릭터의 모든 채팅`과 같은 스타일)
   - 로어북이 하나도 없어도 칸은 비활성화하지 않음(삭제된 로어북이 연결된 채팅의 연결 해제를 위해)
   - 확인: 새 채팅 로어북 선기록·버튼 / 없음 / 유지 라벨(로어북·없음) / 기존 채팅 변경·연결 해제가 파일까지 반영 / 유지 시 불변. **사용자 채팅은 건드리지 않고 테스트 채팅에서만 확인 후 삭제**
9. [x] 페르소나 로어북 드롭다운 + 페르소나 연동(재채움/비활성) + 적용 (`src/persona-lore-section.js`, `entry-actions.applyPersonaLorebook`)
   - 대상 페르소나 = **입장 후 쓰일 페르소나**(`personaSection.getTargetPersonaId`): 특정 페르소나 선택 → 그것 / 기존 채팅 ‘유지’ + 채팅에 고정된 페르소나 → 그것(설계 초안의 ‘유지면 무조건 비활성’에서 개선) / 그 외(자동·고정 해제·고정 없는 채팅 유지) → 확정 불가라 칸 잠금 + 안내
   - 대상이 바뀌면 그 페르소나의 현재 값으로 다시 채움(앞 페르소나용으로 고른 값을 다른 페르소나에 조용히 적용하지 않음). 연결된 로어북이 삭제됐으면 `(삭제된 로어북)`으로 표시
   - 적용은 채팅을 열기 **전**(`applyBeforeOpen`): `descriptor.lorebook` 갱신 → 지금 페르소나면 `persona_description_lorebook`·`#persona_lore_button` 직접 맞춤(아니면 진입 중 페르소나 전환 때 ST 가 복사) → `saveSettingsDebounced` → `PERSONA_UPDATED`. ST 화면은 ‘지금 페르소나’만 바꿀 수 있어 슬래시 명령(`/persona-set … lorebook=`)과 같은 방식으로 임의 페르소나에 적용
   - **확인 창**(설정 `confirmScopedLoreChange`, 기본 ON, 설정 패널에 체크박스 추가): 입장 검증 통과 후 `페르소나 'X': 로어북 A → B / 이 변경은 다른 채팅에도 적용됩니다` → 취소하면 입장창으로 돌아가고 아무것도 바뀌지 않음. 10단계 캐릭터 로어북도 같은 창에 줄로 추가
   - 확인(**사용자 페르소나는 건드리지 않고 임시 페르소나로**, 전후 스냅숏 비교): 칸 연동·잠금·재채움 / 확인 창 취소 시 무변경 / 확인 시 적용·미러·버튼·다른 페르소나 불변 / 기존 채팅 유지(고정된 페르소나 대상)로 해제 / 설정 OFF 시 확인 창 없음 / 고정 없는 채팅은 칸 잠금
10. [x] 캐릭터 로어북 기본(진입 후)·추가(진입 전) + 적용 범위 배지 + 확인 문구 (`src/char-lore-section.js`, `entry-actions.applyBeforeOpen/applyAfterOpen`)
   - UI: 기본 = 네이티브 `<select>`, 추가 = 접이식(`<details>`) 체크박스 목록(줄 전체 44px 터치, 내부 스크롤). 기본으로 고른 로어북은 추가 목록에서 잠금·제외. 모드(새/기존)와 무관(캐릭터 속성)
   - 추가(`world_info.charLore`)는 진입 **전** `charSetAuxWorlds`, 기본은 진입 **후** `charUpdatePrimaryWorld`(현재 캐릭터 편집 폼으로 저장 — 열린 캐릭터가 대상과 다르면 건너뛰고 경고)
   - **카드 내장 로어북(`character_book`)이 있는 캐릭터의 기본 로어북을 해제하면 ST 가 내장 로어북을 카드에서 지운다(되돌릴 수 없음)** → 칸 아래 안내 + 확인 창에 굵은 경고, 이 경우는 확인 창 설정이 꺼져 있어도 **항상** 묻는다
   - 확인 창: 페르소나 로어북과 같은 창에 `캐릭터 'X': 로어북 A → B`, `추가 로어북 [..] → [..]` 줄 추가
   - **버그 수정**: 추가 로어북 변경 비교를 ‘원래 목록에서 새 기본 로어북을 뺀 목록’과 하던 것을 ‘원래 목록 그대로’와 하도록 수정 — 기본을 Eldoria 로 되돌리며 추가의 Eldoria 체크를 푼 경우를 ‘변경 없음’으로 놓쳐 중복이 남았음
   - 확인(사용자 캐릭터 2명 모두 기본 Eldoria + 내장 로어북 보유 → **해제는 경고·취소까지만**, 실제 적용은 다른 로어북으로 바꿨다 되돌리는 방식): 해제 경고(설정 OFF 에서도) / 취소 시 무변경 / 새 채팅에서 기본·추가 적용, 내장 로어북 유지, 다른 캐릭터 카드 불변 / 기존 채팅에서 원복 후 **카드 data 전체가 테스트 전과 동일** / 중복 정리
11. [x] 로딩 표시, 중복 입장 방지, 오류 토스트, i18n(ko/en) + **입장창 순서 개편**(위 레이아웃 참고)
   - 로딩: 창을 연 채로 처리, [입장] 스피너·‘입장 중…’, 처리 중 닫기 시도 전부 무시(`isBusy`), 실패 시 창 유지 + 오류 칸 안내 → 재시도
   - 확인: 휴대폰 한 화면 배치, 로어북 접힘/펼침·요약 갱신, 로딩 중 버튼·inert·취소/ESC/재탭 무시, 실패(서버 500) 시 창 유지·파일 미생성·재시도 성공, 수정 버튼·기존 채팅 회귀
   - 접힘 표시: 로어북 묶음·추가 로어북 요약 앞에 화살표(▼ 접힘 / ▲ 펼침). `summary`에 flex 를 주면 브라우저 기본 삼각형이 사라지므로 직접 그림
   - **로어북 새로 만들기** (`src/lorebook-create.js`): 각 로어북 드롭다운 맨 아래 `＋ 새 로어북 만들기…`(값이 아니라 동작 — 고르면 이전 값으로 되돌리고 이름 입력 창), 추가 로어북 목록 아래 버튼. 기본 이름은 칸에 맞게(채팅 이름 / 페르소나 이름 / 캐릭터 이름). 만들면 **모든 로어북 칸 목록에 추가**하고 누른 칸에서는 바로 선택. ST `createNewWorldInfo(name, { interactive: false })` 사용 — interactive 를 켜면 같은 이름일 때 ‘기존 로어북 삭제 후 덮어쓰기’를 제안하므로 끔. 같은 이름(대소문자 무시)이면 만들지 않고 경고. 서버가 이름을 정리할 수 있어 만들기 전후 `world_names` 비교로 실제 이름을 찾음. 로어북 파일은 그 즉시 생성(입장을 취소해도 남음)
   - **긴 이름 처리**: 접힌 요약을 ‘채팅 / 페르소나 / 캐릭터’ 세 줄 고정 + 줄마다 `…` 말줄임(전체 이름은 펼친 칸, 데스크톱은 title 툴팁). 이전엔 한 문단으로 이어져 6줄까지 늘었음. 추가 로어북 목록·확인 창은 띄어쓰기 없는 긴 이름도 `overflow-wrap: anywhere`로 줄바꿈(이전엔 목록에 가로 스크롤 생김). 닫힌 드롭다운은 칸 너비에서 잘리고 열면 OS 선택 화면에 전체 이름 — 그대로 둠
   - **이름 입력칸 여러 줄**(사용자 지적): 채팅 로어북 기본 이름이 채팅 이름이라 길어서 한 줄 입력칸에선 휴대폰에서 잘림 → ST 입력 팝업을 `rows: 3`(원래 textarea)로 직접 만들어 감싸 보이게, 16px. 여러 줄이면 ST 가 Enter 를 줄바꿈으로 두므로(Ctrl+Enter 만 제출) Enter=만들기로 직접 처리(한글 조합 중·Shift 제외), 붙여넣은 줄바꿈은 공백으로. 확인: 긴 기본 이름이 스크롤 없이 다 보임, Enter 로 생성·선택, 줄바꿈 → 공백, 테스트 로어북 삭제해 목록 원복
   - 추가 로어북 설명 문구를 목록 위에 추가: ‘이 캐릭터와 대화할 때 기본 로어북과 함께 켜지는 로어북. 캐릭터 카드가 아니라 이 SillyTavern 에만 저장’
   - 확인: 화살표 회전, 채팅 칸에서 생성 → 세 칸 모두 목록 반영·채팅 칸 선택·요약 갱신, 기본 이름(채팅명/페르소나명/캐릭터명), 중복 이름 거부·경고, 이름 입력 취소 시 무변경, 추가 목록 버튼으로 생성 → 체크됨. 테스트 로어북은 삭제해 `world_names` 원복
   - **빠른 수정 버그 수정(발견: 이 단계 회귀 테스트)**: textarea 가 `\r\n`을 `\n`으로 바꿔 담아, Windows 줄바꿈이 든 카드는 손대지 않아도 ‘변경됨’(뒤로 시 버릴지 확인 창) + 다른 칸 저장 때 그 칸까지 함께 저장돼 줄바꿈이 조용히 바뀌던 문제 → 비교 기준을 textarea 에 넣은 뒤 값으로. 확인: 무변경 뒤로 시 확인 창 없음, 시나리오만 고치면 시나리오만 전송(요청 가로채 확인, 사용자 카드에 쓰지 않음)
11. [ ] 로딩 표시, 중복 입장 방지, 오류 토스트, i18n(ko/en)

### 사용성 개선 (2026-10-03, 사용자 선택 1~3)

1. **처음 고를 채팅**(설정 `defaultChatMode: 'new' | 'existing' | 'remember'`, `lastChatMode`): 입장 성공 시 고른 방식을 `lastChatMode`에 남김. 기존 채팅으로 시작하면 목록을 받는 동안 ‘불러오는 중’, 받은 뒤 채팅이 0개거나 실패면 새 채팅으로 바꿈(검증도 ‘불러오는 중’ 안내). 확인: existing → 마지막으로 연 채팅 선택·페르소나 ‘유지’, remember → 직전 방식, 채팅 없음 → new
2. **시작 인사말 고르기**: 새 채팅 아래 드롭다운 + 앞부분 미리보기(4줄, `substituteParams`로 고른 페르소나·캐릭터 이름 치환). 후보 순서는 ST `getFirstMessage`와 같음([첫 메시지, 대체…], 첫 메시지가 비면 빼기) = 스와이프 번호. 가벼운 캐릭터는 `unshallowCharacter` 후 채움, 후보 1개면 숨김. 입장 후 `syncSwipeToMes(0, i)` → `updateMessageBlock` → `refreshSwipeButtons(true)` → `saveChatConditional` → `MESSAGE_SWIPED`(ST 스와이프와 같은 절차, 채팅 재로드 없음). **캐릭터 기본 로어북 변경(`charUpdatePrimaryWorld`)이 빈 채팅의 첫 메시지를 다시 만들어 0번으로 되돌리므로 그 뒤에 적용**. 확인: 미리보기 치환, 고른 인사말로 시작·카운터 3/3·파일 저장·이벤트 1회, 로어북 변경과 함께여도 유지(테스트용 대체 인사말은 카드에 임시로 넣고 원복, 카드 data 동일 확인)
3. **기본 이름**: `캐릭터 - 페르소나 - 2026-10-03 03h08`(`formatChatStamp`, ST 의 `…@03h08m20s063ms`는 길고 로어북 기본 이름에도 쓰여 잘렸음). 분 단위라 목록을 받은 뒤 중복이면 ` (2)`, ` (3)`… 자동(이름을 직접 고쳤으면 손대지 않음)
4. **기본 이름의 날짜 형식**(사용자 요청, 설정 `chatNameStamp: 'st' | 'date' | 'minute' | 'second'`, 기본 minute): ST 기본 `humanizedDateTime` / `2026-10-03` / `2026-10-03 03h08` / `2026-10-03 03h08m20s`. 파일 이름에 `:` 불가라 `h`·`m`·`s`로 표기. 설정 선택지는 `index.js`가 지금 시각 예시를 붙여 직접 채움(data-i18n 없음 → ST 재번역에 안 덮임). 확인: 네 형식 모두 입장창 기본 이름 반영, 설정 원복

### 사용성 개선 (2026-10-03, 사용자 선택 4~6)

4. **검색·정렬**: 채팅 4개 이상이면 검색칸(이름 + 평문 미리보기)과 정렬(`chatListSort: 'recent' | 'oldest' | 'name' | 'messages'`, 마지막 선택 기억). 원본 목록은 최근 순 그대로 두고 표시할 때만 정렬. 고른 채팅이 검색에서 빠지면 보이는 첫 채팅을 고름(안 보이는 채팅으로 입장 방지, 검증도 보이는 목록 기준). 검색칸 Enter 는 입장이 아니라 키보드 닫기
5. **미리보기 평문화**(`utils.toPlainPreview`): `<think>`, 코드 펜스, 이미지, 링크 → 글자, `<br>` → 줄바꿈, HTML 은 DOMParser 로 textContent(붙지 않는 문서라 스크립트·이미지 실행/로드 없음), 줄 앞 `# > -`, 강조 `*` `**` `~~` 와 백틱, 단어 경계의 `_`(snake_case 는 유지). 채팅 목록은 한 줄, 인사말 미리보기는 줄 유지
6. **이름 바꾸기·삭제**(`src/chat-manage.js`): ST 의 renameGroupOrCharacterChat / deleteCharacterChatByName 은 실패를 돌려주지 않고 오류 팝업만 띄우며 지금 채팅이 아니어도 현재 채팅을 다시 불러오므로, 같은 서버 API(`/api/chats/rename`, `/api/chats/delete`)를 직접 부르고 뒤처리만 맞춤
   - 이름: `askName`(로어북 만들기와 같은 여러 줄 입력, `src/name-prompt.js`로 분리) → `sanitizeChatName` → 목록·서버 중복 검사(대소문자만 다른 이름도 Windows 에선 같은 파일이라 거절). 마지막으로 연 채팅이면 `updateRemoteChatName` + 지금 캐릭터면 `#selected_chat_pole`, 열린 채팅이면 `reloadCurrentChat`. `CHAT_RENAMED` 발생. ChatInfo 객체를 그대로 고쳐 페르소나·채팅 로어북 칸이 '다른 채팅'으로 보고 선택을 되돌리지 않게 함. 열린 채팅은 생성·저장 중이면 거절
   - 삭제: 확인 창(이름·날짜·메시지 수, 되돌릴 수 없음). **열린 채팅은 거절**(버튼은 흐리게, 누르면 이유 안내 — 휴대폰은 title 을 못 봄). 마지막으로 연 채팅을 지우면 ST 처럼 가장 최근 채팅으로(없으면 `캐릭터 - humanizedDateTime`). `CHAT_DELETED` 발생. 다 지우면 새 채팅으로
   - 처리 중에는 입장 검증이 '잠시 후' 안내
   - 확인(모바일 375×812, ZZ_ 테스트 채팅 3개): 평문 미리보기, 검색(이름·내용·없음), 정렬 + 설정 저장, 중복 이름 거절, 금지 문자 제거 후 이름 바꾸기·선택 유지, 삭제 확인·목록·개수 갱신, 열린 채팅 삭제 거절, 열린 채팅 이름 바꾸기 → 현재 채팅 id·카드 chat·편집 폼 갱신·옛 파일 안 남음. 정리 후 채팅 목록·카드 chat·설정·열린 채팅 없음 스냅숏과 일치

### MVP 전체 점검 (2026-10-03, 모바일 375×812 실제 탭 위주)

| # | 흐름 | 결과 |
|---|---|---|
| 1 | 캐릭터 목록 → Seraphina 탭 → 새 채팅(이름 직접 입력, 채팅 로어북 지정) → 입장 | ✅ 파일 생성·Alice 고정·채팅 로어북·버튼·첫 인사말, 패널 닫힘 |
| 2 | 현재 캐릭터(Seraphina) 다시 탭 | ✅ 입장창 없이 ST 편집 패널(D2) |
| 3 | Assistant 탭 → 기존 채팅(마지막 채팅 미리 선택, 페르소나 ‘유지 (Alice)’) → 입장 | ✅ 저장된 고정 페르소나 적용 |
| 4 | Seraphina → 1에서 만든 채팅을 기존 채팅으로 재입장 | ✅ 페르소나·채팅 로어북 유지, 메시지 중복 없음, ‘마지막으로 연 채팅’ 배지 |
| 5 | [수정] → 빠른 수정 → [뒤로] | ✅ 확인 창 없이 입장창 복귀 |
| 6 | 바깥 탭 / ESC 키 / 취소 버튼 | ✅ 모두 채팅 변화 없이 닫힘 |
| 7 | 설정 체크박스로 확장 끄기 → 캐릭터 탭 → 다시 켜기 | ✅ 꺼지면 ST 기본 즉시 입장 |
| 8 | 확장으로 입장 → 새로고침 | ✅ `active_character`·카드 `chat` 기록. (사용자 설정 `auto_load_chat=false`라 첫 화면이 뜨는 것은 ST 기본 동작) |
| 9 | 콘솔 | ✅ 오류·경고 없음(확장 로그는 info 2줄) |

- 점검 중 ‘바깥 탭이 안 닫힌다’로 보였던 건 탭 좌표가 에뮬레이션 화면(높이 812) 밖이었던 테스트 실수 — 화면 안 바깥 탭은 정상
- 점검 후 테스트 채팅 삭제, 두 캐릭터의 마지막 채팅·로어북·내장 로어북, 페르소나·페르소나 로어북, 추가 로어북, 로어북 목록, `active_character`, 확장 설정을 점검 전과 비교해 동일 확인
- **알려진 범위 밖/미검증**: ST 첫 화면 ‘최근 채팅’·슬래시 커맨드는 `selectCharacterById`를 직접 불러 입장창을 거치지 않음(의도) / 그룹 채팅 미지원 / 실제 휴대폰의 가상 키보드 가림·네이티브 드롭다운 탭 조작은 에뮬레이터로 확인 불가 → 실기기 확인 필요

### 수동 테스트 시나리오

| # | 시나리오 | 기대 결과 |
|---|---|---|
| T1 | 다른 캐릭터 클릭 → 취소 | 채팅·캐릭터 변화 없음 |
| T2 | 다른 캐릭터 → 새 채팅(이름 지정, 페르소나 P, 채팅로어북 L) | 지정 이름 파일 생성, 첫 메시지 1개, 페르소나 P 고정, 로어북 버튼 활성 |
| T3 | T2 채팅을 나갔다 다시 기존 채팅으로 진입(전부 유지) | P, L 유지 |
| T4 | 기존 채팅 진입 시 페르소나만 Q로 변경 | Q로 고정, L 유지 |
| T5 | 현재 캐릭터 재클릭 | 기본: 캐릭터 편집 패널(ST 기본) |
| T6 | Shift+클릭 | ST 기본 즉시 입장 |
| T7 | 일괄 편집 모드에서 클릭 | 선택 토글만, 모달 없음 |
| T8 | 응답 생성 중 입장 시도 | 차단 토스트 |
| T9 | 중복 이름 / 금지문자 포함 이름 | 검증 메시지 / 정리된 이름으로 생성 |
| T10 | 페르소나가 캐릭터에 2개 연결된 상태에서 새 채팅 | 선택 팝업 없이 지정 페르소나로 진입 |
| T11 | `persona_auto_lock` ON 상태에서 T4 | 이전 채팅의 고정 페르소나는 변하지 않음 |
| T12 | 확장 OFF | 완전히 ST 기본 동작 |
| T13 | 새로고침 후 | 마지막 진입 캐릭터·채팅이 자동 로드 |
| T14 | 다른 캐릭터 B로 진입하며 캐릭터 기본 로어북 변경 | **B 카드**에만 저장, 이전 캐릭터 A 카드는 변화 없음 |
| T15 | 페르소나 P→Q로 바꾸며 진입, 페르소나 로어북 변경 | Q의 descriptor에만 저장, 진입 후 `#persona_lore_button` 상태 일치 |
| T16 | 페르소나 로어북 수정 후 페르소나 드롭다운 변경 | 로어북 값이 새 페르소나 연결값으로 재채움(dirty 해제) |
| T17 | 기존 채팅 모드(페르소나 `__keep__`) | 페르소나 로어북 필드 비활성 |
| T18 | 캐릭터 추가 로어북 변경 | `world_info.charLore` 갱신, 캐릭터 편집 패널의 추가 로어북 목록과 일치 |
| T19 | 전역 로어북이 설정된 상태에서 입장 | 전역 로어북 설정 변화 없음 |
| T20 | (모바일) 다른 캐릭터 입장창 [수정] → 필드 수정 → 저장 | **채팅·현재 캐릭터 변화 없음**, 서버 카드(V1·V2 필드, 대체 인사말) 갱신, 입장창으로 복귀 ✅ |
| T21 | 빠른 수정에서 변경 후 [뒤로] | 버릴지 확인 → '계속 수정' 시 창 유지 ✅ |
| T22 | 현재 캐릭터를 빠른 수정으로 저장 | ST 편집 폼·`#character_json_data`가 새 값으로 갱신 ✅ |
| T23 | 빠른 수정 → [ST 전체 수정 열기] | 해당 캐릭터 선택 + ST 편집 패널 열림(마지막 채팅 열림) ✅ |
| T24 | ST 편집 화면에서 수정(자동 저장 후) → 빠른 수정 열기 | 새 값 표시 ✅ |
| T25 | ST 편집 화면에서 수정 직후(0.1초, 자동 저장 전) → 빠른 수정 열기 | 즉시 저장 후 새 값 표시 ✅ (수정 전에는 옛 값이 보이던 버그) |
| T26 | 다른 캐릭터를 빠른 수정으로 저장 → 나중에 ST 에서 그 캐릭터 선택 | ST 편집 폼에 새 값 ✅ |

---

## 7. 리스크 / 업스트림 의존

| 리스크 | 대응 |
|---|---|
| `selectCharacterById` 내부 구조 변경(특히 `characters[id].chat` 사용 방식) | `entry-actions.js` 한 파일에 격리. 진입 후 `getCurrentChatId()` 검증으로 이상 감지 |
| `.character_select` / `#rm_print_characters_block` 마크업 변경 | 셀렉터를 `constants.js`에 상수로 |
| 다른 확장이 같은 클릭을 가로챔 | capture 단계 + `loading_order` 조정. 충돌 시 설정에서 끄도록 안내 |
| 페르소나/캐릭터 로어북은 채팅별이 아님 → 사용자가 “이 채팅만”으로 오해 | 필드별 적용 범위 배지 + 변경 시 입장 전 확인 문구 |
| `charUpdatePrimaryWorld`가 현재 캐릭터 폼에 의존 | 진입 후 `this_chid` 일치 검증 후 호출. 업스트림이 chid 인자를 받도록 바뀌면 진입 전 적용으로 단순화 가능 |
| 페르소나 로어북 반영 절차(`#persona_lore` 핸들러) 내부 변경 | `applyPersonaLorebook` 한 함수에 격리 |
| 헤더 선기록 시 서버 저장 형식 변경 | `saveChat`의 헤더 형식을 따라감. 실패 시 대안 경로(진입 후 메타데이터 세팅)로 폴백 가능하도록 함수 분리 |

---

## 8. 개발 전 결정 필요 사항

| ID | 질문 | 제안(기본값) |
|---|---|---|
| ~~D1~~ | ~~전역 로어북 처리~~ | **결정됨: 제외** (페르소나/캐릭터/채팅 로어북으로 대체) |
| ~~D2~~ | ~~현재 선택된 캐릭터 재클릭 시 모달을 띄울지~~ | **변경(2026-10-03): 기본 ON — 현재 캐릭터를 눌러도 입장창**(같은 캐릭터의 다른 채팅·새 채팅으로 갈아타기). 처음엔 편집 화면 진입로가 없어 OFF 였으나, 입장창 [수정] → ‘ST 전체 수정 열기’(현재 캐릭터면 채팅 재로드 없이 편집 패널)·상단 캐릭터 이름 탭이 생겨 이유가 사라짐. 설정 v1→v2 마이그레이션으로 기존 저장값도 한 번 켬(이후 사용자가 끄면 유지) |
| ~~D3~~ | ~~페르소나/캐릭터 로어북 적용 방식~~ | **결정됨: 연결 자체를 변경 + 범위 배지** (채팅별 덮어쓰기는 하지 않음) |
| D4 | 페르소나 “없음” 의미 | ST엔 무(無) 페르소나가 없으므로 **“자동(고정 안 함)”**으로 대체 |
| D5 | 새 채팅 기본 이름 | ST와 동일 `캐릭터명 - 날짜시간` 미리 채움(사용자 수정 가능) |
| D6 | 캐릭터 추가 로어북을 MVP에 포함할지 | 포함(접이식). ST 캐릭터 로어북 UI가 기본+추가 구성이라 한쪽만 있으면 혼란 |
