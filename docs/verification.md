# 최종 로컬 검증 결과

2026-11-11, Windows / Node.js 22.23.4, npm 10.9.9.

| 검사                  | 결과              | 범위                                                                       |
| --------------------- | ----------------- | -------------------------------------------------------------------------- |
| `npm run lint`        | 통과              | JS 소스·테스트·설정                                                        |
| `npm test`            | 5/5 통과          | 길이/닉네임/비밀번호/공개 키 검증, 프론트 HTML 실행 API·secret 키 검사     |
| `npm run test:db`     | 35/35 통과        | PGlite PostgreSQL에서 SQL 권한·익명·소유권·중복·신고·관리자·세션·탈퇴 검증 |
| `npm run test:e2e`    | 11/11 통과        | Chromium 비회원/회원/관리자·글쓰기/수정·임시 저장·XSS·달력·반응형·테마     |
| Deno 공통 HTTP 테스트 | 8/8 통과          | Origin·메서드·토큰 부재·크기·JSON 제한                                     |
| Deno check            | 두 함수 통과      | neis / delete-account 타입 검사                                            |
| `npm run build`       | 통과              | Vite 프로덕션 정적 빌드                                                    |
| `npm audit`           | 알려진 취약점 0건 | 검사 시점 npm lockfile 의존성                                              |

총 59개 자동화 테스트 통과. `.env.local`, node_modules, dist가 Git에서 제외되는 것도 확인했다. 초기 개발 브랜치에서 사용자 요청에 따라 `main`으로 변경하고 공개 저장소 `https://github.com/codexora-dev/SchooltPot`에 Git으로 업로드했다. 저장소의 기본 브랜치는 `main`이다. 웹사이트 공개 배포는 아직 수행하지 않았다.

추가로 테스트용 secret 형식 키를 환경변수에 넣어 빌드가 시작 전에 거절되는지 확인했고, 정상 공개 키로 다시 빌드해 통과했다. 실제 비밀키는 사용하지 않았다. Vite 미리보기 HTTP 200도 확인했다. 점검용 개발 서버는 종료했으며 다시 보려면 `npm run dev`로 시작한다.

브라우저에서 desktop 1440px/mobile 390px 화면을 캡처하고 검토했다. 홈·가입 화면의 가로 넘침과 콘솔 실행 오류가 없었다. 캡처는 `screenshots/`에 있다. 회원/관리자 E2E는 테스트 전용 네트워크 fixture를 사용한다. 실제 서비스의 데이터를 가장하지 않는다.

아직 통과하지 않은 항목: 원격 DB 마이그레이션 적용, 원격 Security Advisor, 실제 Auth 이메일·PKCE·재설정, 실제 탈퇴와 로그아웃의 auth.sessions 제거 시점, PostgREST·GraphQL 직접 조회, 실계정 동시성, NEIS 실응답, 실제 배포 Edge와 호스팅 CSP/HTTPS. 로컬 테스트로 이 항목들의 통과를 주장하지 않는다.

원격 공개 API 확인은 호스트 접속 및 community 함수 미설치(PGRST202)까지만 수행했다. Supabase 도구의 프로젝트 접근 권한 오류로 원격 스키마를 변경하지 않았다.
