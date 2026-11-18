# V2 운영 검증 기록

## 2026-11-19 — 진행 중

사용자가 의존성 대응과 나머지 운영 작업 진행을 승인했습니다.

- 대상: hlglstdtgcodblynicmh / codexora-dev/SchoolPot. 원격 owner/moderator 목록은 지정된 두 계정과 일치합니다.
- V1 핵심 4개 함수 본문 hash가 로컬 검증 기준과 일치함을 확인하고 변경 전 함수 정의를 tests/.local/v2에 보관했습니다.
- 변경 직전 회원 17, 글 4, 댓글 3, 공지 1, 알림 35개. 기본 V2 적용 직후 동일 건수를 확인했습니다.
- 추가 스키마, Vault 서버 설정, pg_cron/pg_net, 서명 스케줄러 migration을 적용했습니다. 모든 서비스 테이블은 private/RLS를 유지합니다.
- Edge push-dispatch를 배포했습니다. 일반 회원 JWT 호출은 HTTP 403입니다. 실제 서명 스케줄 호출은 HTTP 200이며 permanent Authorization 헤더가 대기열에 없고 nonce가 기록됩니다.
- VAPID 키는 서버에서 최초 1회 생성하여 Vault에만 보관했습니다. 공개 키만 로컬 제외 환경 파일과 Pages 빌드 변수에 설정했습니다. 기존 사용자 키를 교체하지 않았습니다.
- 실제 임시 QA 계정 2개로 accounts/Auth/PostgREST/Edge 인증 및 소유권/권한 거절을 확인했습니다. 공개 콘텐츠 이벤트는 원격 rollback 트랜잭션으로 검증하여 테스트 공지·게시글·댓글·제재·이의 제기를 남기지 않았습니다. 임시 계정은 검증 완료 후 탈퇴 API로 정리합니다.
- 로컬: 단위 32, PGlite 121, 브라우저 74, PWA 3, Deno 21개 통과. 전체 npm audit 0, fork 무결성 및 모든 소비자 연결 확인.
- picomatch 공식 패치가 없는 상태에서 복잡한 반복 wildcard extglob을 리터럴로 처리하는 비공개 수정판을 고정했습니다. 공식 수정판이라고 표시하지 않으며 위험 패턴의 시간 제한 테스트와 provenance를 유지합니다.

Pages 배포 SHA, 실제 UI/PWA/푸시 수신 시도, 공지·팝업 ID와 최종 데이터 보존 결과는 확인 후 이 문서에 추가합니다.

## 발견·해결

- 첫 배포 커밋에서 public PWA 파일이 빠져 새 체크아웃의 빌드가 실패했습니다. 로컬에만 존재하던 파일을 추적에 포함해 수정했으며 배포 검사는 생략하지 않았습니다.

- 원격 게시판 구성이 V1 기본값과 달라 QA SQL이 처음 실패했습니다. 운영 게시판을 변경하지 않고 실제 활성 일반 게시판을 선택하도록 수정했고 rollback 검사가 통과했습니다.
- 로컬 Supabase CLI 계정은 대상 관리 권한이 없어 사용하지 않았습니다. 올바른 연결의 DB/Edge 도구와 Vault를 사용했습니다.
- pg_net 관리형 기본 PUBLIC 대기열 권한을 확인했습니다. 관리자가 소유한 cron 권한은 줄였고, managed Vault 암호 함수 권한은 변경하지 않았습니다. 영구 토큰을 대기열에서 제거하는 짧은 서명·nonce 방식으로 보완하고 bootstrap 토큰을 폐기했습니다. VAPID 키는 유지했습니다.
- Edge 갱신 도구의 기존 import-map 절대 경로 오류는 `import_map_path: deno.json` 명시로 해결했습니다.

## 남은 실기기·운영 확인

실제 iOS/Android/Windows의 설치·OS 수신·알림 클릭은 기기별 확인이 필요합니다. 서버 접수 성공과 OS 표시를 구분합니다. 기존 Auth 유출 비밀번호 차단 비활성 경고는 별도 운영 설정 확인 사항입니다.
