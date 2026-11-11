# 스쿨팟 개발 지침

- Vite + JavaScript ES Modules를 유지한다. React를 도입하지 않는다.
- `src/pages`: 화면, `src/components`: 공통 UI, `src/services`: API, `src/lib`: 검증 및 DOM, `src/config`: 설정, `src/styles`: 반응형 스타일.
- Supabase 변경은 `supabase/migrations`에 관리하고 기존 원격 DB를 먼저 조사한다. 원격 프로젝트 권한 및 학교·개인정보 관련 결정은 사용자 확인을 따른다.
- 사용자 최종 결정: **재학생 인증 신청 없이 회원가입한다.** 이메일을 수집하거나 인증하지 않는다. 아이디와 8~128자 비밀번호를 사용하며 가입 시 일회성 복구 코드를 제공한다. 학생증, 학번, 실명 수집 기능을 추가하지 않는다.
- 실제 키를 커밋하지 않는다. 공개 키도 `.env.local`에 보관한다. `service_role`, secret 키는 프론트엔드나 `VITE_` 환경변수에 절대 넣지 않는다.
- 사용자 텍스트는 `el()`/`textContent`로 렌더링한다. `innerHTML`, `eval`, 문자열 SQL 조립은 금지한다.
- 모든 테이블은 private 스키마 + RLS + 직접 접근 권한 회수를 적용한다. API는 공개 security invoker 래퍼와 private security definer 디스패처로 구성한다. definer는 인증·등록된 아이디 계정·현재 세션·계정 존재·이용 제한·소유권·관리자 권한을 직접 검사한다.
- 요청 JSON의 사용자 ID·role·is_admin 필드를 권한 판단에 쓰지 않는다. `auth.uid()`와 DB 역할을 사용한다.
- 익명 게시글·댓글 응답에 `author_id`, 이메일, 안정적인 익명 사용자 식별자를 추가하지 않는다. 게시글별 익명 번호만 사용한다. 관리자 신고 식별 정보는 관리자 권한 확인 및 감사 기록 이후에만 조회한다.
- `npm run lint`, `npm test`, `npm run test:db`, `npm run test:e2e`, `npm run build`를 변경에 맞게 실행한다. Edge 함수는 Deno check 및 변경 범위 테스트를 수행한다.
- DB 테스트는 PGlite PostgreSQL로 권한 로직을 실제 실행한다. 실제 Supabase Auth/PostgREST/Edge 검증을 대신했다고 표시하지 않는다.
- 테스트 fixture는 `tests/` 안에만 둔다. 제품에 데모 계정·가짜 성공·가짜 급식 데이터를 추가하지 않는다.
- 변경사항, 실패 및 해결, 남은 작업을 `docs/progress.md`에 기록한다. 배포·운영 완료는 실제 검증 전 주장하지 않는다.
