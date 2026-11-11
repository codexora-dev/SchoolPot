# 스쿨팟

우리 학교의 이야기가 모이는 커뮤니티. 모바일 우선 Vite + HTML/CSS/JavaScript + Supabase 프로젝트입니다. React를 사용하지 않습니다.

**현재 상태: 로컬 V1 코드 및 보안 테스트 구현, 원격 DB 마이그레이션·Edge 배포 대기. 정식 운영 완료 상태가 아닙니다.**

회원가입에는 재학생 인증 신청을 받지 않습니다. 이메일 인증 후 닉네임을 설정하면 이용하도록 구현했습니다. 실제 재학생 여부를 확인하는 서비스는 아닙니다.

## 실행

Node.js 22.12 이상과 npm이 필요합니다.

```powershell
cd C:\Users\PC\Desktop\스쿨팟
npm ci
# 이미 .env.local이 있으면 덮어쓰지 마세요.
# 새 체크아웃에서만: Copy-Item .env.example .env.local
npm run dev
```

표시되는 로컬 주소(기본 `http://127.0.0.1:5173`)로 접속합니다. `.env.local`에는 전달받은 프로젝트 URL과 공개 키를 설정했습니다. 키는 Git에서 제외됩니다.

```dotenv
VITE_SUPABASE_URL=https://hlglstdtgcodblynicmh.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=공개_publishable_키
VITE_SCHOOL_NAME=우리 학교
```

학교 이름은 빌드 시 설정합니다. `VITE_` 값은 브라우저에 공개되므로 비밀키를 넣으면 안 됩니다. 연결이 없으면 연결 안내를 표시하며 샘플 게시물이나 가짜 성공 응답은 제공하지 않습니다.

## 주요 기능

- 이메일 회원가입·인증·로그인·로그아웃·세션 유지·비밀번호 재설정·프로필·회원 탈퇴 UI/서버 함수
- 7개 게시판, 글 작성·수정·삭제·조회, 기기 내 임시 저장, 조회수·공감·제목/본문 검색·최신/인기 정렬·24시간/7일 인기글
- 댓글·대댓글·수정·삭제·공감·신고, 게시글별 익명 번호, 익명 작성자 ID 비노출
- 투표 작성 및 1인 1표, 댓글/답글/공지 알림·읽음·설정
- NEIS 급식·학사일정 프록시, 학년별 수행평가 일정 등록·수정·삭제·수정 요청, 학교 공지
- 관리자 통계·닉네임 검색·회원 제한·게시글/댓글 삭제·신고 처리·공지 등록·작업 기록
- 반응형 화면, 다크모드, 로딩/오류/빈 상태, 키보드 포커스, 접근성 레이블

실제 기능 사용에는 DB 마이그레이션이 필요합니다. NEIS 및 탈퇴에는 Edge Function 설정·배포가 추가로 필요합니다. 사용자 차단 UI, 파일 첨부, 푸시 알림, 재학생 인증, V2/V3 기능은 포함하지 않았습니다.

## Supabase 연결과 배포

1. 프로젝트 Dashboard에서 기존 스키마와 백업을 확인합니다.
2. SQL Editor에서 `supabase/migrations/20261111133230_schoolpot_v1.sql`을 실행합니다. **현재 연결 도구의 프로젝트 접근 권한이 없어 이 작업을 자동 실행하지 않았습니다.**
3. Auth에서 이메일 인증 활성화, 최소 비밀번호 12자, 익명 로그인 비활성화, Site URL/리다이렉트 URL을 설정합니다.
4. 가입·이메일 인증·로그인·닉네임 저장 후 SQL Editor에서 첫 관리자를 직접 지정합니다. 절차는 `docs/deployment.md`를 참고하세요.
5. NEIS 학교 코드·교육청 코드·API 키, 허용 Origin을 서버에 설정하고 Edge Functions를 배포합니다.
6. `npm run build` 후 `dist`를 Cloudflare Pages 또는 Vercel로 배포합니다. 이 작업에서는 외부 공개 배포하지 않았습니다.

## 검증

```powershell
npm run lint
npm test
npm run test:db
npx playwright install chromium
npm run test:e2e
npm run build
npm audit
```

DB 검증은 Docker 없이 PGlite PostgreSQL에서 역할·권한·함수·제약조건을 실제 실행합니다. Auth 서버, PostgREST, 이메일 발송, NEIS 실응답, 배포된 Edge Function 검증은 운영 전 별도로 해야 합니다. 브라우저 회원 테스트에는 테스트 전용 네트워크 fixture를 사용합니다.

## 폴더

```text
src/
  components/   공통 레이아웃
  config/       학교 이름·게시판 설정
  lib/          안전한 DOM 생성·입력 검증
  pages/        홈·인증·커뮤니티·학교생활·관리자
  services/     Supabase Auth/RPC/Edge 어댑터
  styles/       디자인 시스템·반응형·테마
supabase/
  migrations/   전체 스키마·권한·API 함수
  functions/    NEIS·계정 삭제·공통 HTTP 보호
tests/
  unit/         입력 검증
  database/     PostgreSQL 보안 시나리오
  e2e/          비회원·회원·관리자·XSS·반응형
docs/           요구사항·설계·보안·배포·진행 기록
public/         정적 아이콘·Cloudflare 보안 헤더
```

상세 진행 상태는 `docs/requirements.md`, 보안 경계와 남은 검증은 `docs/security.md`, 배포·운영 절차는 `docs/deployment.md`에 정리했습니다.
