# V2 운영 검증 기록

## 2026-11-19 — 운영 배포·공지 게시 완료

사용자가 의존성 대응과 나머지 운영 작업 진행을 승인했습니다.

- 대상: hlglstdtgcodblynicmh / codexora-dev/SchoolPot. 원격 owner/moderator 목록은 지정된 두 계정과 일치합니다.
- V1 핵심 4개 함수 본문 hash가 로컬 검증 기준과 일치함을 확인하고 변경 전 함수 정의를 tests/.local/v2에 보관했습니다.
- 변경 직전 회원 17, 글 4, 댓글 3, 공지 1, 알림 35개. 기본 V2 적용 직후 동일 건수를 확인했습니다.
- 추가 스키마, Vault 서버 설정, pg_cron/pg_net, 서명 스케줄러 migration을 적용했습니다. 모든 서비스 테이블은 private/RLS를 유지합니다.
- Edge push-dispatch를 배포했습니다. 일반 회원 JWT 호출은 HTTP 403입니다. 실제 서명 스케줄 호출은 HTTP 200이며 permanent Authorization 헤더가 대기열에 없고 nonce가 기록됩니다.
- VAPID 키는 서버에서 최초 1회 생성하여 Vault에만 보관했습니다. 공개 키만 로컬 제외 환경 파일과 Pages 빌드 변수에 설정했습니다. 기존 사용자 키를 교체하지 않았습니다.
- 실제 임시 QA 계정 2개로 accounts/Auth/PostgREST/Edge 인증 및 소유권/권한 거절을 확인했습니다. 공개 콘텐츠 이벤트는 원격 rollback 트랜잭션으로 검증하여 테스트 공지·게시글·댓글·제재·이의 제기를 남기지 않았습니다. 두 임시 계정은 실제 탈퇴 API로 정리했고 QA 계정·세션·구독 잔여 0건을 확인했습니다.
- 로컬: 단위 32, PGlite 121, 브라우저 74, PWA 3, Deno 21개 통과. 전체 npm audit 0, fork 무결성 및 모든 소비자 연결 확인.
- picomatch 공식 패치가 없는 상태에서 복잡한 반복 wildcard extglob을 리터럴로 처리하는 비공개 수정판을 고정했습니다. 공식 수정판이라고 표시하지 않으며 위험 패턴의 시간 제한 테스트와 provenance를 유지합니다.

## 배포와 실제 게시 결과

- [운영 사이트](https://codexora-dev.github.io/SchoolPot/): 버전 2.0.0, 빌드 `289db00d6007bd74e19eac1cccb91007925da00a`.
- [Checks 성공](https://github.com/codexora-dev/SchoolPot/actions/runs/44333598964), [Pages 성공](https://github.com/codexora-dev/SchoolPot/actions/runs/44333598962). Linux 새 체크아웃의 npm ci·감사·fork 무결성 검사·테스트·빌드를 포함합니다.
- 실제 HTML 빌드 SHA, 참조 JS/CSS 16개 및 manifest·SW·아이콘·오프라인 파일의 HTTP 응답을 확인했습니다. 이후 문서/QA 정리 커밋과 운영 빌드 SHA는 구분합니다.
- 회원용 중요 공지 **SchoolPot V2 업데이트 안내**: `deff0cab-de7c-4e1b-83fc-18560ad3d041`, [공지 링크](https://codexora-dev.github.io/SchoolPot/#/notice/deff0cab-de7c-4e1b-83fc-18560ad3d041). 신규 공지 알림을 활성화했습니다.
- 공개 팝업 **스쿨팟 앱 설치 · 알림 이용 안내**: `4f92bd60-38b9-4d16-a123-1965fbf7a858`. Markdown, 기본 닫기/오늘/다시 보지 않기, 정확한 공지 링크를 유지합니다. 기존 팝업을 보존했고 활성 팝업은 총 2개입니다.
- 실제 owner 계정·현재 DB 세션·DB 역할을 확인한 관리형 SQL 트랜잭션에서 기존 `manage_notices`/`manage_popups`를 호출했습니다. 두 게시를 원자적으로 처리하고 `v2_release_management` 감사 기록에 관리 경로와 빌드 SHA를 남겼습니다. owner 비밀번호/JWT로 외부 HTTP 로그인한 검증과는 구분합니다.
- 비회원 실제 팝업 조회·390px 브라우저 표시·공지 링크를 확인했습니다. 비회원의 공지 본문 조회는 거절됩니다.

## 실제 서버·푸시 검증 범위

- `tests/integration/v2-live.mjs`: 실제 아이디 가입·Auth 로그인·소속 등록, 타인 ID 설정 위조 무효화, 관리자/worker RPC 거절, 본인 기기 CRUD, 일반 회원의 발송 Edge 호출 HTTP 403.
- `tests/integration/v2-smoke.sql`: 실제 운영 PostgreSQL의 authenticated 역할·기존 세션·서버 계정으로 멘션/익명 ID 비노출/답글·구독 중복/타인 알림 접근 거절/삭제 댓글/공지 수정 재발송 방지/제재·이의·해제를 실행 후 롤백했습니다. 실제 PostgREST 요청과 구분합니다.
- 운영 `push-dispatch` v3 ACTIVE. 서명 스케줄 HTTP 200, 매분 cron 활성, nonce 기록과 영구 Authorization 헤더 대기열 0건을 확인했습니다.
- 격리한 실제 Chrome 테스트 프로필에서 운영 SW·QA 로그인·FCM 구독 성공. QA 전송 3회 HTTP 201, worker 결과 `claimed:1,sent:1,failed:0`, Chrome SW의 실제 `push` 이벤트 수신을 확인했습니다.
- 자동화 Chrome의 `getNotifications()`는 빈 목록이어서 OS 팝업 표시를 확인했다고 주장하지 않습니다. 설치 실기기/iOS·Android/알림 클릭은 별도 검증이 필요합니다. 공개 화면의 모바일 크기 브라우저 검증은 실기기 검증을 대신하지 않습니다.
- 최종 건수는 회원 17, 글 4, 댓글 3, 공지 2, 알림 45입니다. 기존 글·댓글·공지와 두 관리자 역할을 보존했고 새 운영 공지 1개 및 서버 수신 조건을 충족한 회원 알림 10개만 추가됐습니다. private 서비스 테이블 43개 모두 RLS를 유지합니다.
- QA 자격 증명 파일·격리 Chrome 프로필과 동기화 표식은 정리했습니다. 실제 키/세션/비밀번호는 Git에 포함하지 않았습니다. 검증 보고서와 공개 팝업 캡처는 Git 제외 `tests/.local/v2`에 한정합니다.

## Migration 적용 대응표

기존부터 로컬/원격 시각이 달랐으며 관리형 도구가 원격 버전을 부여했습니다. 아래는 **이미 적용 완료**된 내용으로 전체 db push/reset 또는 파일 재실행을 하지 않습니다.

| 로컬 파일 (`supabase/migrations/`)                  | 원격 버전      |
| --------------------------------------------------- | -------------- |
| 20261118134623_schoolpot_v2.sql                     | 20261118145157 |
| 20261118145000_push_vault_configuration.sql         | 20261118145246 |
| 20261118145309_push_scheduler_bootstrap.sql         | 20261118145333 |
| 20261118150256_restrict_scheduler_schema_access.sql | 20261118150346 |
| 20261118150550_signed_push_scheduler.sql            | 20261118150807 |
| 20261118150702_activate_signed_scheduler.sql        | 20261118150814 |

## 발견·해결

- 첫 배포 커밋에서 public PWA 파일이 빠져 새 체크아웃의 빌드가 실패했습니다. 로컬에만 존재하던 파일을 추적에 포함해 수정했으며 배포 검사는 생략하지 않았습니다.

- 원격 게시판 구성이 V1 기본값과 달라 QA SQL이 처음 실패했습니다. 운영 게시판을 변경하지 않고 실제 활성 일반 게시판을 선택하도록 수정했고 rollback 검사가 통과했습니다.
- 로컬 Supabase CLI 계정은 대상 관리 권한이 없어 사용하지 않았습니다. 올바른 연결의 DB/Edge 도구와 Vault를 사용했습니다.
- pg_net 관리형 기본 PUBLIC 대기열 권한을 확인했습니다. 관리자가 소유한 cron 권한은 줄였고, managed Vault 암호 함수 권한은 변경하지 않았습니다. 영구 토큰을 대기열에서 제거하는 짧은 서명·nonce 방식으로 보완하고 bootstrap 토큰을 폐기했습니다. VAPID 키는 유지했습니다.
- Edge 갱신 도구의 기존 import-map 절대 경로 오류는 `import_map_path: deno.json` 명시로 해결했습니다.

## 남은 실기기·운영 확인

실제 iOS/Android/Windows의 설치·OS 표시·알림 클릭은 기기별 확인이 필요합니다. 다른 실제 기기 간 읽음 동기화·권한 거부·장시간 백그라운드 동작·부하도 추가 확인 대상입니다. 로컬 자동화와 실제 공급자 수신 결과를 구분합니다.

기존 Auth 유출 비밀번호 차단 비활성 WARN 1건은 남아 있습니다. 실제 조직은 Free 플랜이고 [공식 문서](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)상 해당 기능은 Pro 이상입니다. 유료 플랜 변경은 수행하지 않았습니다. 기본 거부 private RLS/no-policy INFO 43건을 없애려고 허용 정책을 추가하지 않았습니다. picomatch 로컬 fork는 upstream 공식 패치가 나오면 교체 검토가 필요합니다. 법적 운영 완료나 모든 실기기 검증 완료를 주장하지 않습니다.
