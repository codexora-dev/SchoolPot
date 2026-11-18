# V2 배포 가이드

2026-11-19 사용자 후속 승인으로 DB·Edge·Vault·서명 스케줄러·Pages 운영 배포와 공지·팝업 게시를 완료했습니다. 실제 적용 이력은 [운영 검증 기록](V2_RELEASE_VERIFICATION.md)을 우선 확인합니다. 이전 picomatch 감사 차단은 로컬 보안 수정판과 회귀 테스트로 대응했고 전체 감사 0건을 확인했습니다. 공식 패치 릴리스로 가장하지 않으며 vendor/picomatch/README.schoolpot.md에 범위를 기록합니다. 향후 위험한 운영 변경은 별도 승인 대상입니다.

## 1. 사전 확인

- 대상: SchoolPot, hlglstdtgcodblynicmh, GitHub Pages `/SchoolPot/`.
- 원격 역할은 kminjae803=owner, yoonjihoo_0221=moderator입니다. 달라지면 중단합니다. V2 마이그레이션 자체에도 이 목록 guard가 있으며 역할을 바꾸지 않습니다.
- 원격과 로컬 기존 migration의 timestamp가 다릅니다. 전체 db push/reset이나 과거 migration 재적용 없이 기존 내용과 적용 이력을 먼저 대조합니다.
- 백업/PITR 가능 범위, 기존 테이블 건수, 실제 로그인/소속/제한 계정의 접근을 확인합니다. V2는 기존 행을 삭제하지 않는 추가 마이그레이션입니다.
- `npm run lint`, `npm test`, `npm run test:db`, `npm run test:e2e`, `npm run test:pwa`, `npm run test:edge`, Deno check, `npm run build`를 확인합니다. PWA 테스트 산출물에는 테스트 키가 있으므로 운영용 환경으로 다시 빌드합니다.

## 2. DB와 Edge

V2 기본 migration은 `supabase/migrations/20261118134623_schoolpot_v2.sql`이며 Vault·스케줄러 보완을 포함해 총 6개를 순서대로 적용했습니다. 파일/원격 버전 대응표는 운영 검증 기록에 있습니다. 현재 프로젝트에 재적용하지 마세요. private 테이블/RLS/직접 권한 회수/공개 invoker/인증된 private dispatcher 및 service_role 전용 발송 함수가 포함되며 기존 owner/moderator와 작성 데이터는 보존합니다.

`push-dispatch`를 `supabase/functions/push-dispatch/deno.json` 및 lockfile과 함께 배포합니다. verify_jwt=false는 플랫폼 JWT 검사 대신 아래 서버 전용 스케줄러 인증을 사용하기 때문이며, 무인증 허용이 아닙니다. 기존 accounts/neis/delete-account를 교체할 필요는 없습니다.

환경변수 방식의 서버 설정 대안 (현재 운영은 다음 절의 Vault 사용):

| 이름                                     | 값/보관 위치                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY | Supabase Edge 런타임 서버 환경                                         |
| VAPID_PUBLIC_KEY                         | 생성한 VAPID 공개 키                                                   |
| VAPID_PRIVATE_KEY                        | 생성한 개인키, Edge secrets 전용                                       |
| VAPID_SUBJECT                            | 운영 사이트의 HTTPS URL, 예: https://codexora-dev.github.io/SchoolPot/ |
| PUSH_DISPATCH_TOKEN                      | 별도 생성한 32자 이상 무작위 스케줄러 비밀 토큰                        |

VAPID 키는 운영자가 로컬 보안 터미널에서 `npx --yes web-push@3.6.7 generate-vapid-keys --json` 등으로 한 번 생성해 안전하게 보관합니다. 기존 운영 키가 있으면 재생성하지 않습니다. 채팅·소스·공개 빌드·명령 로그에 비밀키를 올리지 않습니다. VAPID_SUBJECT에는 철회된 개인 이메일을 사용하지 않습니다.

## 3. 운영 Vault와 서명 주기 실행

실제 운영은 Edge 기본 서버 자격 증명과 Supabase Vault를 사용합니다. VAPID 키는 인증된 최초 발송 작업 안에서 한 번 생성하고 서버 전용 RPC로 저장합니다. 이미 존재하는 키는 초기화 요청으로 교체할 수 없습니다. 공개 VAPID 키만 .env.local 및 GitHub Pages 변수에 보관합니다.

운영 migration은 V2 기본 파일 외 push_vault_configuration, push_scheduler_bootstrap, restrict_scheduler_schema_access, signed_push_scheduler, activate_signed_scheduler 순서입니다. Cron/pg_net 설정은 실제 Supabase에서 검증하며 PGlite가 확장 자체를 재현했다고 주장하지 않습니다.

운영 cron은 매분 `select private.invoke_push_scheduler();`를 실행합니다. 이 함수는 Vault 토큰으로 요청의 epoch 시각·nonce를 HMAC SHA-256 서명합니다. Edge는 60초 범위와 서명을 검사하고 DB의 서버 전용 nonce claim으로 한 번만 실행합니다. pg_net 대기열에는 영구 토큰을 넣지 않습니다. 스케줄러 제어 함수는 브라우저/회원/service_role에 직접 공개하지 않습니다.

```sql
select jobname,schedule,active from cron.job where jobname='schoolpot-v2-push';
select private.invoke_push_scheduler(); -- trusted DB operator only
```

`PUSH_DISPATCH_TOKEN` Bearer 호출은 신뢰할 수 있는 서버의 수동 호출용 대안입니다. 이를 pg_net/cron 헤더에 저장하지 않습니다. 운영에서는 Vault와 Edge 환경 토큰을 혼용하지 않습니다. 대기열 권한을 관리형 객체 소유자 때문에 모두 회수할 수 없는 경우에도 영구 비밀은 노출되지 않으며, 짧은 서명은 nonce로 재사용을 막습니다. Cron 관리 스키마 접근 회수, Vault 및 서버 RPC의 일반 사용자 직접 접근 거절을 확인합니다.

## 4. 프론트엔드

`.env.local`과 Pages 빌드 변수에 기존 공개 연결 값과 `VITE_VAPID_PUBLIC_KEY`만 둡니다. 개인키·서비스 역할 키·발송 토큰을 VITE_에 넣으면 안 됩니다. Pages workflow가 공개 VAPID 변수를 빌드에 전달하도록 구성했습니다.

승인 후 변경을 배포하고 `scripts/check-deployment.mjs`로 실제 빌드 SHA·JS/CSS·manifest·SW·아이콘·오프라인 파일의 HTTP 응답을 확인합니다. 이전 SW가 있는 기기에서 새 버전 안내 → 직접 적용을 확인합니다. DB를 먼저 적용해 새 UI가 없는 API를 호출하지 않게 합니다.

## 5. 실제 서비스 검증

- 실제 테스트 계정의 Auth → PostgREST → Edge 인증/소속/제한/역할 검사.
- OS별 설치·푸시 구독·수신·클릭 후 접근 권한·권한 거부·구독 해제·로그아웃·탈퇴.
- 댓글/답글/멘션/공지/제재·해제·만료/신고·이의 제기 및 다른 기기 읽음 동기화.
- 전송 실패/410 기기 비활성화/방해금지/묶음/빈도제한·시도 로그, Edge/DB 자원 사용량.
- 원격 advisers 및 변경 전후 실제 데이터 건수. 현재 보안 점검에서 기존 유출 비밀번호 차단 비활성 경고를 확인했으며 인증 운영 설정은 변경하지 않았습니다.

PGlite·mock 브라우저·암호화 요청 생성은 실제 공급자 수신 검증을 대신하지 않습니다. 운영 Chrome에서 실제 FCM 접수와 push 이벤트 수신은 확인했습니다. 자동화 Chrome의 OS 팝업 표시 및 iOS/Android 실기기 설치·수신·클릭은 아직 확인하지 않았습니다.

## 6. 요청된 공지·팝업 게시

실제 배포 검증 후 `docs/releases/v2-notice.md`, `v2-popup.md`, `v2-publication.json`을 사용합니다. 공지는 회원 전용 중요 공지, 팝업은 공개 가능한 설치·업데이트·알림 사용 안내이며 기본 닫기/오늘/다시 보지 않기를 제공합니다. 비회원에게 커뮤니티·개인정보를 공개하지 않습니다.

`node scripts/publish-v2.mjs`는 네트워크 요청 없이 정확한 원고를 출력합니다. 게시가 승인되고 배포 검증을 마친 뒤 owner의 실제 로그인 세션과 공개 연결 정보를 **로컬 프로세스 환경**에 준비하고 실행합니다.

```text
RELEASE_EXPECTED_BUILD=<실제 배포 SHA>
RELEASE_ACCESS_TOKEN=<현재 owner access token, 파일·채팅·로그에 기록하지 않음>
VITE_SUPABASE_URL=<대상 프로젝트 URL>
VITE_SUPABASE_PUBLISHABLE_KEY=<공개 키>
node scripts/publish-v2.mjs --publish
```

스크립트는 실제 배포 SHA·V2 메타, 현재 계정·세션·owner, 지정 관리자 목록과 V2 API를 확인한 뒤 기존 `manage_notices`/`manage_popups`를 호출합니다. 동일 제목의 기존 안내는 보존해 중복 알림·게시를 방지합니다. 게시 중 팝업 3개 한도는 유지하며 기존 팝업을 임의 중지하지 않습니다. 공지 후 팝업이 실패하면 공지를 삭제하지 않고 재실행 시 기존 공지를 재사용합니다. 이미 존재하는 중지 팝업은 재게시하지 않으므로 관리자가 확인합니다.

일반 운영자는 이 스크립트와 실제 owner 세션을 사용합니다. 이번 관리형 연결 적용은 실제 owner 계정·현재 DB 세션·DB 역할을 확인하고 같은 관리 RPC를 호출하며 관리 경로를 감사 기록으로 구분합니다. 실제 게시 결과는 운영 검증 기록을 참고하세요.

## 7. 중단과 복구

발송 오류 시 cron을 일시 중지하여 푸시만 멈추고 내부 알림은 보존합니다. 프론트엔드는 직전 정상 빌드로 되돌릴 수 있습니다. 새 private 테이블/열을 DROP하거나 기존 데이터/알림을 지우는 rollback은 수행하지 않습니다. DB 함수 변경을 되돌려야 한다면 백업한 함수 정의와 세션·권한 테스트를 검토한 새 forward migration으로 처리합니다. 실제 키 교체·사용자 구독 폐기는 별도 승인 대상입니다.

---

아래는 기존 V1 배포 기록입니다. 현재 V2 적용 상태는 위 내용을 우선합니다.

# 연결·배포·운영

## 적용 상태

Supabase 프로젝트 hlglstdtgcodblynicmh에 다음 마이그레이션을 순서대로 적용했습니다.

1. 20261111133230_schoolpot_v1.sql
2. 20261111135652_username_accounts.sql
3. 20261111140438_account_provisioning.sql
4. 20261112113812_site_popups.sql

accounts, neis, delete-account 함수가 배포되어 있습니다. 기존 프로젝트에서 위 SQL을 다시 실행하지 마세요. 새 프로젝트에서는 순서대로 적용하고 Edge Functions를 배포합니다. Auth 사용자를 직접 만들어도 account_handles에 등록되지 않은 계정은 커뮤니티를 사용할 수 없습니다.

## 아이디 계정

가입은 공개 accounts Edge Function이 수행합니다. 아이디는 내부 Auth 식별자 username@accounts.schoolpot.invalid로 매핑되며 실제 이메일을 수집하거나 메일을 발송하지 않습니다. 서버가 8자 이상 비밀번호를 검사하고 Auth admin.createUser로 계정을 만든 후 프로필과 복구 코드 해시를 등록합니다. 브라우저에는 서버 비밀키가 없습니다.

따라서 Dashboard의 Email Confirm 설정을 끄지 않아도 이 가입 경로는 이메일 인증을 요구하지 않습니다. SDK signUp을 직접 사용한 미등록 계정은 DB에서 차단됩니다. 공개 Auth provider 자체의 요청 제한도 유지하세요. 비밀번호 변경은 현재 비밀번호로 재인증하고, 비밀번호 분실은 복구 코드를 사용합니다.

admin 계정은 사용자 지정에 따라 서버에서 관리자 역할을 부여했습니다. 추가 관리자 지정은 운영자만 SQL Editor에서 해당 account_handles.user_id를 확인해 user_roles에 등록합니다. 공개 클라이언트에 역할 수정 API는 제공하지 않습니다.

## 서버 설정

SUPABASE_URL, SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY는 Supabase 런타임 환경을 사용합니다. 실제 비밀키를 코드나 GitHub Actions 빌드 환경에 넣지 않습니다.

ALLOWED_ORIGINS를 설정하면 쉼표로 구분한 Origin 목록을 사용합니다. 미설정 시 현재 개발 주소(127.0.0.1/localhost 5173, 127.0.0.1 4173)와 https://codexora-dev.github.io만 허용합니다. 새 호스팅 주소는 여기에 등록하세요. URL 경로는 Origin에 포함하지 않습니다.

NEIS 기본 학교는 안남중학교, S10, 9022150입니다. NEIS_OFFICE_CODE/NEIS_SCHOOL_CODE로 변경할 수 있습니다. NEIS_API_KEY가 있으면 인증 API를 사용하고, 없으면 공식 공개 API의 일별 제한 조회를 사용합니다. 실제 2026-11-11 급식 응답을 확인했습니다. 많은 일정을 조회할 운영 환경에서는 발급 키를 설정하세요.

세 함수는 verify_jwt=false입니다. accounts는 의도적인 공개 가입/복구 경로로 서버 입력 검증과 DB 요청 제한을 사용합니다. neis/delete-account는 공통 protect에서 getUser로 사용자 토큰을 검증하고 DB가 현재 계정·세션·제한을 다시 검사합니다.

## GitHub Pages

저장소: https://github.com/codexora-dev/SchoolPot

1. Settings → Pages의 배포 소스를 GitHub Actions로 선택합니다.
2. Actions Variables에 VITE_SUPABASE_URL과 VITE_SUPABASE_PUBLISHABLE_KEY를 등록합니다. 공개 키만 사용합니다. .env.local은 업로드하지 않습니다.
3. Actions의 Deploy GitHub Pages 워크플로를 main에서 수동 실행합니다.
4. 워크플로는 검사·빌드 후 /SchoolPot/ 경로로 dist를 배포합니다. 로컬에서 해당 하위 경로와 프로덕션 CSP를 브라우저로 검증했습니다.

사용자 승인에 따라 https://codexora-dev.github.io/SchoolPot/ 에 공개 배포했습니다. main에 프론트엔드·빌드 관련 변경이 올라오면 자동 배포하며 수동 실행도 지원합니다. 저장소 이름으로 경로를 생성하므로 이름을 바꾼 뒤에는 반드시 재빌드하세요. 배포 후 최신 빌드 식별자와 JS/CSS의 HTTP 상태·Content-Type을 검사합니다. hash router를 사용해 별도 SPA rewrite가 필요 없습니다.

GitHub Pages는 저장소의 Cloudflare _headers 및 Vercel 설정을 적용하지 않습니다. 이를 보완해 프로덕션 빌드에 CSP meta를 삽입했습니다. meta CSP로 frame-ancestors 같은 응답 헤더 전용 정책을 적용할 수는 없으므로, 전체 헤더 제어가 필요하면 제공된 Cloudflare/Vercel 설정을 사용하세요.

## Cloudflare Pages/Vercel

설치 npm ci, 빌드 npm run build, 산출물 dist를 사용합니다. URL·공개 키·학교 이름을 빌드 변수로 등록합니다. Cloudflare는 public/_headers, Vercel은 vercel.json을 사용합니다. 서버의 ALLOWED_ORIGINS도 배포 주소와 일치시킵니다.

## 운영

가입은 기존 결정대로 이메일·학생증·학번·실명·연령 확인·자동 동의 기록 없이 유지합니다. 실제 운영 정책 검토는 배포 검증과 구분합니다. 복구 코드를 잃어버린 사용자의 본인 확인 정책도 운영자가 정해야 합니다. 관리자도 본인 확인 없이 임의로 계정을 복구하면 안 됩니다.

신고·공지·이용 제한 및 관리자 기록을 검토하고 Auth/DB/Edge 사용량을 관찰하세요. NEIS 무료 조회 제한, 공유 IP의 가입 제한, 대량 공지 알림 부하를 고려하세요. 로그인 요청은 Auth 측 제한, 가입/복구는 별도 DB 버킷 제한을 사용합니다. 보존기간은 임의로 결정하지 않았으며 백업·로그·신고 보존 정책 확정 후 정리 작업을 구성합니다.

## 팝업 RPC

사이트 진입 안내의 공개 조회는 public.site_popups(), 관리 기능은 public.manage_popups(text,jsonb)를 사용합니다. 새 프로젝트에는 네 번째 마이그레이션까지 적용해야 합니다. 비회원의 관리 호출과 private.site_popups 직접 조회는 거절되어야 합니다. 팝업만을 위한 Edge Function 추가 배포는 필요하지 않습니다.
