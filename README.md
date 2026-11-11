# 스쿨팟 · 안남중학교

창원 안남중학교 학생들이 학교생활과 이야기를 나누는 모바일 커뮤니티입니다. Vite + HTML/CSS/JavaScript ES Modules + Supabase를 사용합니다.

현재 아이디 계정용 DB 마이그레이션과 accounts/neis/delete-account Edge Function이 실제 Supabase 프로젝트에 적용되어 있습니다. 실제 가입·로그인·글·댓글·투표·알림·수행평가·급식·복구·탈퇴까지 검증했습니다. GitHub Pages 워크플로는 수동 실행 방식으로 준비했습니다.

## 가입과 로그인

- 이메일을 입력하거나 인증할 필요가 없습니다.
- 아이디는 영문자로 시작하는 영문·숫자·밑줄 3~20자이며 대소문자를 구분하지 않습니다.
- 비밀번호는 8~128자입니다. Supabase Auth에서 해시로 관리하며 앱 DB에 비밀번호를 저장하지 않습니다.
- 가입 직후 프로필이 자동 생성됩니다. 닉네임과 학년은 프로필 화면에서 변경할 수 있습니다.
- 가입 때 한 번 표시되는 256비트 복구 코드를 보관하세요. 이메일 없이 비밀번호를 재설정할 때 필요합니다. 복구 후에는 새 코드가 발급되고 이전 코드와 세션은 무효화됩니다.
- 재학생 여부는 확인하지 않습니다. 학생증·학번·실명을 수집하지 않습니다.

## 로컬 실행

Node.js 22.12 이상이 필요합니다. 프로젝트 폴더에서 아래 명령을 실행하세요.

    npm ci
    npm run dev

기본 주소는 http://127.0.0.1:5173/ 입니다. 이미 설정된 .env.local은 덮어쓰지 마세요. 새 체크아웃에서는 .env.example을 .env.local로 복사하고 공개 키를 입력합니다.

    VITE_SUPABASE_URL=https://hlglstdtgcodblynicmh.supabase.co
    VITE_SUPABASE_PUBLISHABLE_KEY=프로젝트의_publishable_키
    VITE_SCHOOL_NAME=안남중학교

VITE_ 변수는 브라우저에 공개됩니다. 비밀키를 넣으면 안 됩니다. Vite가 secret/service_role 형식 키를 발견하면 빌드를 거절합니다.

## 기능

- 자유·익명·질문·공부·분실물·동아리·투표 게시판
- 게시글/댓글 CRUD, 대댓글, 글별 익명 번호, 공감, 신고, 조회수
- 검색, 최신/인기 정렬, 일간/주간 인기글, 기기 내 임시 저장
- 투표 생성/참여 및 중복 투표 방지
- 댓글/답글/공지 알림, 읽음 처리 및 알림 설정
- 안남중학교 실제 NEIS 급식·학사일정, 학년별 수행평가 일정과 수정 요청
- 관리자 통계·회원 검색/제한·신고 처리·게시물 삭제·공지·감사 기록
- 아이디 가입/로그인, 복구 코드 재설정, 비밀번호 변경, 프로필, 재인증 탈퇴
- 반응형, 라이트/다크 모드, 오류/로딩/빈 상태, 키보드 탐색

admin 계정은 사용자 요청에 따라 서버에서 관리자 지정했습니다. 기본 관리자 비밀번호나 자동 승격 규칙은 없습니다.

## 검증

    npm run lint
    npm test
    npm run test:db
    npm run test:e2e
    npm run build
    npm audit

실제 서버에 임시 QA 계정을 만들고 정리하는 검사는 명시적으로 활성화합니다. CI에서는 실행하지 않습니다.

    $env:SCHOOLPOT_LIVE_TEST='1'
    node tests/integration/live.mjs
    npx playwright test tests/e2e/live.spec.js --workers=1
    Remove-Item Env:\SCHOOLPOT_LIVE_TEST

## 구조

    src/components  공통 레이아웃
    src/config      학교·게시판 설정
    src/lib         안전한 DOM·아이디·입력 검증
    src/pages       인증·홈·커뮤니티·학교생활·관리자
    src/services    Auth/RPC/Edge 어댑터
    src/styles      디자인 시스템·반응형
    supabase/migrations  스키마·권한·버전별 SQL
    supabase/functions   accounts·neis·delete-account
    tests/unit·database·e2e·integration
    docs            설계·보안·배포·진행·검증

연결/Pages 배포는 docs/deployment.md, 검증 결과는 docs/verification.md, 보안 경계는 docs/security.md를 참고하세요. 파일 첨부·푸시 알림·사용자 차단 UI·V2/V3는 구현 범위 밖입니다. 정식 운영 정책과 이용약관/개인정보 처리방침은 운영자가 확정해야 합니다.
