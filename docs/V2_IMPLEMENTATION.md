# SchoolPot V2 구현 계획 및 검증 현황

## 최신 상태 — 2026-11-19

사용자의 후속 승인으로 V2 DB·Vault·Edge·서명 스케줄러·Pages 운영 배포와 업데이트 공지·공개 팝업 게시를 완료했습니다. 실제 배포 빌드는 `289db00d6007bd74e19eac1cccb91007925da00a`입니다.

- 기존 picomatch 취약점은 빌드 도구용 로컬 보안 수정판으로 대응했습니다. 공식 릴리스가 아니며 upstream 라이선스/해시, 수정 해시와 시간 제한 위험 패턴 테스트를 보존합니다. 전체 npm audit 0건, 모든 Vite/Vitest 소비자의 수정판 연결과 무결성 검사를 통과했습니다.
- 현재 로컬 결과: 단위 32, PGlite 121, 브라우저 74, 프로덕션 PWA 3, Deno 21개 통과. 기존 전체 감사 실패 기록은 이전 단계 기록입니다.
- 실제 Auth 가입·로그인·소속과 PostgREST 소유권/권한, 일반 회원의 Edge 발송 호출 차단을 확인했습니다. 알림/멘션/답글·구독 중복/공지 수정/제재·해제·이의 제기는 원격 PostgreSQL 롤백 트랜잭션에서 검증했습니다. 공개 테스트 콘텐츠를 남기지 않았습니다.
- 운영 발송 키는 Vault에 보관하고 공개 키만 .env.local과 Pages 빌드 변수에 설정했습니다. pg_net의 관리형 기본 권한 때문에 영구 토큰 대신 60초 HMAC 서명과 1회 nonce를 사용합니다. 실제 서명 호출 HTTP 200, nonce 기록과 대기열의 영구 Authorization 헤더 0건을 확인했습니다.
- 실제 Chrome 구독·FCM HTTP 201·브라우저 push 이벤트 수신을 확인했습니다. 자동화 환경의 OS 팝업 표시와 iOS/Android 실기기 동작은 별도 검증 대상입니다. 임시 QA 계정과 연결 데이터는 탈퇴 API로 정리했습니다.
- 기존 Auth 유출 비밀번호 차단 WARN은 남아 있습니다. 현재 Free 플랜이며 공식 문서상 Pro 이상 기능이므로 유료 변경은 수행하지 않았습니다.

[운영 검증 기록](V2_RELEASE_VERIFICATION.md)을 우선 참고하세요. 아래는 11월 18일 분석과 1차 로컬 구현 기록이며, 최신 상태와 다르면 위 내용이 우선합니다.

## 분석 (2026-11-18)

- Vite 8 + JavaScript ES Modules, 직접 DOM 컴포넌트, hash 라우터. React 미사용.
- Supabase JS 2.119.0, 아이디 계정 및 실제 세션 검사, private 테이블/RLS/직접 접근 회수, public invoker → private definer.
- 기존 댓글·답글·공지·운영 알림, owner/moderator, 제재 내역/이의 제기, 공지 revision, 안전한 rich text 재사용.
- GitHub Pages `/SchoolPot/` 하위 경로 배포. main push가 실제 배포를 유발하므로 자동 push하지 않음.
- 원격 읽기 조사: 35개 private 테이블 RLS 활성화, 지정 관리자 2명 역할 일치. 데이터 변경 없음. 로컬/원격 migration timestamp는 기존부터 다르므로 원격 적용 전 이력 대조 필요.

## 구현 순서

1. PWA: manifest/기존 로고 PNG/정적 UI 캐시/설치 안내/명시적 업데이트/오프라인 화면.
2. 알림: 기존 notifications 확장, 서버 이벤트/중복 제거/조회와 쓰기 소유권/설정/읽음 동기화.
3. 푸시: 기기·세션별 구독, outbox, 서버 전용 claim/finish, VAPID 전송, 재시도/방해금지/빈도 제한.
4. 커뮤니티: 구독/북마크/내 활동/선택형 멘션 검색/자동 임시 저장.
5. 운영: 기존 제재·이의 제기 재사용, 만료 통지/신고 결과/owner 전송 현황/공지 알림 선택.
6. PGlite 보안·회귀 테스트, 단위/브라우저/빌드/Deno 검증, 한국어 문서와 게시용 공지·팝업 준비.

## 운영 경계

운영 migration/Edge/Pages 배포는 개발 지시서 14절의 사전 승인 대상이다. 로컬 검증 완료 후 구체적인 변경을 제시한다. 공지와 팝업은 사용자가 게시를 요청했으나 V2 배포 완료를 확인하기 전에는 완료 공지를 게시하지 않는다. VAPID 비밀키는 서버 전용이며 신규 키를 임의로 운영 설정하지 않는다.

## 구현 결과

- PWA 설치·아이콘·오프라인·명시적 빌드 업데이트와 이전 캐시 정리 구현.
- 기존 notifications 보존, 댓글/답글/선택 ID 멘션/공지/구독/신고/기존 운영 통지 연결, 서버 미읽음 개수와 inbox_revision 동기화 구현.
- 20개 페이지·읽음/읽지 않음/삭제·알림 링크·설정·기기별 구독·방해 금지 UI 구현.
- 서버 전용 Web Push 암호화/VAPID·발송 outbox·lease·3회 재시도·구독 만료 정리·빈도 제한·owner 통계 구현. 실제 외부 발송은 미실행.
- 글 구독·북마크·내 활동·검색 허용 회원의 멘션·24시간 초안 자동 저장/삭제 구현.
- 기존 제재/해제/이의 제기 권한 유지, 서버 표시 상태·만료 알림·제재별 이의 제기 3회 제한, 신고 검토 중/결과 안내 구현.
- 중요 공지 구분·신규 알림 선택·신규 알림 공지 시간당 3회·수정 재발송 금지 구현.
- 실제 배포를 확인한 뒤 게시할 회원용 중요 공지와 공개 설치/알림 팝업 원고 및 idempotent 게시 스크립트 준비. 실제 게시하지 않음.

## 주요 파일

| 범위        | 파일                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| PWA         | public/manifest.webmanifest, public/icons, public/offline.*, src/worker.js, src/services/pwa.js, scripts/pwa-plugin.js |
| 사용자 화면 | src/pages/notifications.js, notification-settings.js, activity.js, app-install.js                                      |
| 커뮤니티    | src/components/mention-picker.js, src/pages/community.js, src/lib/drafts.js                                            |
| API·동기화  | src/services/v2.js, push.js, 기존 api.js/main.js 확장                                                                  |
| DB          | supabase/migrations/20261118134623_schoolpot_v2.sql                                                                    |
| 서버        | supabase/functions/push-dispatch/{index,handler}.ts, deno.json/deno.lock                                               |
| 운영        | src/pages/admin-notifications.js, 기존 공지/제재 관리 확장                                                             |
| 게시        | docs/releases/v2-publication.json, v2-notice.md, v2-popup.md, scripts/publish-v2.mjs                                   |

## 최종 로컬 검증 (2026-11-18)

| 검사                              | 결과                                                   |
| --------------------------------- | ------------------------------------------------------ |
| npm run lint                      | 통과                                                   |
| npm test                          | 30개 통과                                              |
| npm run test:db                   | PGlite PostgreSQL 118개 통과                           |
| npm run test:e2e                  | Chromium 74개 통과, 실제 서비스 전용 3개 미실행        |
| npm run test:pwa                  | 프로덕션 하위 경로 Chromium 3개 통과                   |
| npm run test:edge                 | Deno 20개 통과                                         |
| Deno check push-dispatch/index.ts | 통과                                                   |
| npm run build                     | 통과, PWA 테스트 후 운영용 환경으로 다시 빌드          |
| npm audit --omit=dev              | 알려진 취약점 0                                        |
| Deno audit (발송 함수 lockfile)   | 알려진 취약점 없음                                     |
| npm audit --audit-level=moderate  | **실패: picomatch 권고에 연결된 개발 의존성 high 5건** |
| git diff --check                  | 통과                                                   |

PGlite는 기존 V1 행·알림 읽음·시각 보존, 역할 목록 변경 시 migration 중단, 권한 위조/타인 알림·설정·구독/익명 정보/원본 삭제·차단/대기열 lease·재시도·묶음/세션 삭제·탈퇴/이의 제기 상한을 실제 PostgreSQL에서 확인합니다. Hosted Auth/PostgREST/Edge 동작을 대신했다고 주장하지 않습니다. 브라우저 API 데이터는 tests/ 전용 fixture이며 PWA는 실제 빌드와 SW를 실행했습니다.

## 해결한 문제

- 멘션 검색의 PL/pgSQL record/테이블 alias 충돌을 수정했습니다.
- 숨김 게시판 글쓴이/관리자의 V1 직접 열람 권한을 유지하면서 새 알림·구독에는 공개 활성 게시판 범위를 적용했습니다.
- 제재 표시 상태를 추가할 때 최신 governance의 v_role 및 appeal_admin 수정본을 유지하도록 정리했습니다.
- V2 API 전환에 맞춰 기존 이의 제기 알림 브라우저 fixture를 갱신했습니다.
- 업데이트 후 새로고침을 기다리는 브라우저 테스트의 navigation race를 수정했습니다.
- 신고자의 결과 조회에서 관리자 내부 사유가 노출되지 않도록 일반 안내로 제한했습니다.
- 푸시 잠금 화면에 민감 내용이 포함되지 않도록 고정 메시지와 검증된 내부 클릭 경로를 사용했습니다.

## 남은 제한과 배포 차단 요인

1. **개발 의존성 감사 실패:** [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), picomatch <=4.0.7의 ReDoS. 2026-11-18 확인 시 공식 패치 버전이 없습니다. 기존 Vite/Vitest 개발 의존성 경로이며 제품 번들에는 picomatch가 없고 운영 의존성 감사는 0건입니다. 검사를 끄거나 경고를 숨기지 않았으므로 현재 CI의 전체 의존성 감사는 실패합니다. 공식 수정·검증된 대응 전 전체 검사 통과/배포 준비 완료를 주장하지 않습니다. npm audit fix --force의 Vite/Vitest 파괴적 다운그레이드는 실행하지 않았습니다.
2. 원격 기존 Auth의 [유출 비밀번호 차단 비활성](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) 경고가 있습니다. 운영 설정은 변경하지 않았습니다. 기존 private 35개 테이블의 RLS/no-policy INFO는 직접 접근 거절 + guarded definer 설계와 일치하며 공개 정책을 새로 만들지 않았습니다.
3. 운영 migration/Edge/Pages와 VAPID/발송 토큰/주기 실행은 사전 승인 전입니다. 새 키·cron·외부 서비스·유료 자원을 운영에 생성하지 않았습니다.
4. 다른 기기 내부 알림 동기화는 화면 표시 중 30초 간격/focus/재조회 방식입니다. 즉시 Realtime 스트림을 구현했다고 표시하지 않습니다.
5. iOS/Android/Windows 실제 설치·OS 푸시·백그라운드 수신·실제 서버 Auth/PostgREST/Edge와 배포 후 회귀 확인이 남습니다.
6. 실제 V2 배포 확인 전이므로 공지·팝업은 원고 준비 상태입니다. 게시 작업은 사용자 요청 범위에 포함되며 검증 후 기존 권한·revision·팝업 한도로 처리합니다.

향후에는 공식 의존성 보안 패치, 실제 기기 검증, 사용량 측정 후 동기화 주기 및 발송 묶음 조정, 필요할 때 접근 통제를 갖춘 Realtime 도입을 검토합니다.
