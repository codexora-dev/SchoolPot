# 연결·배포·운영

## 적용 상태

Supabase 프로젝트 hlglstdtgcodblynicmh에 다음 마이그레이션을 순서대로 적용했습니다.

1. 20261111133230_schoolpot_v1.sql
2. 20261111135652_username_accounts.sql
3. 20261111140438_account_provisioning.sql

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

실제 학생 모집 전 운영자 연락처·이용약관·개인정보 처리방침·연령과 동의 절차를 확정합니다. 복구 코드를 잃어버린 사용자의 본인 확인 정책도 운영자가 정해야 합니다. 관리자도 본인 확인 없이 임의로 계정을 복구하면 안 됩니다.

신고·공지·이용 제한 및 관리자 기록을 검토하고 Auth/DB/Edge 사용량을 관찰하세요. NEIS 무료 조회 제한, 공유 IP의 가입 제한, 대량 공지 알림 부하를 고려하세요. 로그인 요청은 Auth 측 제한, 가입/복구는 별도 DB 버킷 제한을 사용합니다. 보존기간은 임의로 결정하지 않았으며 백업·로그·신고 보존 정책 확정 후 정리 작업을 구성합니다.
