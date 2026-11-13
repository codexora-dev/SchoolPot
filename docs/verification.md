# 검증 결과 · 2026-11-12

## 2026-11-13 관리자 공지 수정·관리 목록

lint/build, Vitest 25, PGlite 87, Playwright 63(기본 live 2 제외), npm audit 0 통과. 공지 관리 목록→미리보기→기존 본문/형식 편집→저장→확인 삭제, 상세 편집, 모바일 폭, stale 응답 때 입력 유지와 저장 차단을 검사했다. DB 실행에서 일반 회원/권한 위조/비회원 차단, 현재 세션/이용 제한, revision 충돌, author_id/created_at 보존, 수정 후 알림 수 불변과 감사 기록을 확인했다.

운영 PostgreSQL에서 notice-management-rollback.sql의 public RPC 등록/목록 projection/본문/수정/revision 거부/삭제를 통과했다. 임시 JWT·세션 fixture를 사용했으며 모든 쓰기와 알림을 rollback했다. 실제 관리자 로그인/PostgREST 쓰기를 검증했다고 표시하지 않는다. 공개 사이트 검증은 배포 후 추가한다.

[Pages 43402183641](https://github.com/codexora-dev/SchoolPot/actions/runs/43402183641) / [Checks 43402183647](https://github.com/codexora-dev/SchoolPot/actions/runs/43402183647)가 6e768cd1862dcc8c38e79d5ca9a54163a4852e7b에서 success. 공개 HTML 빌드 ID·JS/CSS 11개 HTTP/MIME 통과. 실제 일반 QA 계정 Auth/PostgREST로 manage_notices 권한 위조 list가 FORBIDDEN임을 확인했다. 이어서 같은 격리 테스트 브라우저의 관리자/읽기/쓰기 fixture로 배포 편집기·기존 형식 로딩·수정 payload/revision·목록 갱신·Markdown 미리보기·390px 폭·JS 오류 0개를 검사했다. 실제 서버에서 QA 계정의 관리자 역할을 바꾸거나 운영 공지/알림을 쓰지 않았다. QA 계정 삭제 후 잔여 0, 테스트 공지 잔여 0, 운영 공지 기존 1건, private RLS 누락 0개 확인.

## 2026-11-13 운영 규정·공지 목록과 상세

사용자 첨부 요약본/전문과 repo 복사본의 SHA-256 일치를 확인했다. 공개 페이지에서 선택·목차·전문 끝부분·모바일 폭을 검증하고 규정 문구나 제재 로직을 임의 변경하지 않았다. 공지 metadata 목록 20개·검색·페이지·개별 ID·본문 서식·복귀 상태·새로고침·관리자 확인 삭제 및 일반 회원/비회원 제한을 검사했다.

lint/build, Vitest 25, PGlite 83, Playwright 60(기본 live 2 제외), npm audit 취약점 0 통과. notice_list는 본문/작성자 제외, get_notice는 상세 서식·본문 제공과 작성자 제외를 PGlite에서 실제 SQL 실행으로 확인했다. 첫 페이지 밖 ID, 중복 없는 페이지 분할, 없는 ID, 세션 없음·소속 없음·비회원 차단도 검사했다.

원격 PostgreSQL public RPC의 metadata projection/개별 format 응답을 JWT·임시 세션 fixture로 롤백 검증했다. 실제 Auth/PostgREST 검증을 대신하지 않는다. 공개 규정은 별도 정적 문서이며 회원 공지의 공개 읽기 예외를 추가하지 않았다. 공개 배포/실제 계정 결과는 확인 후 추가한다.

배포 6b72742442839a345b9262e1a7974c63a8fe0c0d의 [Pages 43398397744](https://github.com/codexora-dev/SchoolPot/actions/runs/43398397744) / [Checks 43398397989](https://github.com/codexora-dev/SchoolPot/actions/runs/43398397989) success, 공개 빌드 ID·JS/CSS 11개 HTTP/MIME 통과. 실제 배포 규정 assets로 전문 마지막 문장과 요약 전환·모바일 폭을 검사했다. 실제 QA 가입/Auth 로그인 후 hosted PostgREST에서 공지 목록 metadata에 본문/작성자가 없고 없는 ID는 NOT_FOUND임을 검증했다. 실제 로그인 브라우저의 공지 읽기 응답은 로컬 fixture로 대체하여 목록/상세/새로고침/복귀/HTTPS 이미지 naturalWidth와 JS 오류 0개를 확인했다. 관련 없는 운영 팝업도 테스트 브라우저에서만 분리했으며 운영 DB에 공지·알림을 생성하지 않았다. QA 계정 잔여 0, 롤백 공지 잔여 0, private RLS 누락 0개를 확인했다.

## 2026-11-13 공지·팝업 서식과 이미지

lint/build, Vitest 25, PGlite 80, Playwright 54(기본 live 2 제외), npm audit 0 통과. UI에서 3형식 선택·본문/팝업 미리보기·저장·회원 화면·재편집을 검사했다. 실제 Chromium에 XSS HTML을 입력해 script/iframe/style/foreign namespace/이벤트/위험 URL을 제거하고 실행/외부 스타일 요청이 없음을 확인했다. HTTPS 이미지 응답 fixture의 naturalWidth=1과 모바일 폭, Markdown 제목·강조·목록·표·코드·외부 링크 보호를 확인했다. 기존 text의 HTML 원문은 그대로 표시한다.

운영 DB 마이그레이션 후 formatted-rollback.sql이 실제 PostgreSQL public RPC에서 세 형식·잘못된 형식 거부·팝업 format 변경 revision을 통과했다. 임시 세션/JWT fixture를 사용한 SQL 검증이며 실제 로그인/Auth/PostgREST 호출을 대신했다고 표시하지 않는다. 알림과 콘텐츠를 포함해 전부 rollback했다.

parse5 AST→허용 태그/속성 DOM 재구성 방식이다. 일반 사용자 게시글/댓글의 HTML 실행을 허용하지 않는다. HTTPS 외부 이미지는 원본 제공처의 공개 접근이 가능해야 하며 이 기능에 파일 업로드/임의 CSS/스크립트 실행은 포함되지 않는다. 신규 parser chunk는 서식 콘텐츠가 있을 때만 로드한다. 공개 빌드의 이미지 CSP 검증은 배포 후 추가한다.

[Pages 43391681688](https://github.com/codexora-dev/SchoolPot/actions/runs/43391681688) / [Checks 43391681759](https://github.com/codexora-dev/SchoolPot/actions/runs/43391681759)가 76190086bc3f3d21bcc7e2523bb0f9361e354d0c에서 모두 success. 공개 HTML 빌드 ID·JS/CSS 9개 HTTP/MIME 검증 통과. tests/integration/rich-content-production.mjs를 공개 URL에 실행해 HTML/Markdown 각각의 실제 CSP·lazy parser 로드·HTTPS 이미지 naturalWidth=1·서식·스크립트/이벤트 제거·390px 폭·JS 오류 0개를 확인했다. 팝업 조회만 브라우저 로컬 fixture로 대체했으며 실제 운영 콘텐츠를 게시하지 않았다. 운영 DB의 롤백 테스트용 공지/팝업 잔여 0건과 RLS 미설정 private 테이블 0건도 확인했다.

## 2026-11-13 안정성·화면·최적화

테마/토큰 갱신 후 입력·포커스 유지, 오프라인/복구 후 입력 유지, 15초 조회 중단 안내, 홈 공지 부분 실패 후 글 영역 유지/재시도, 진행 중 공감 1회 요청을 실제 Chromium+fixture 응답으로 검증했다. 실제 Supabase 장애나 다수 동시 이용자 부하 테스트를 대체하지 않는다.

Vitest 23, PGlite 77, build 및 npm audit(0) 통과. 최신 프론트엔드는 조회 중단·중복 버튼 실행과 지연 로딩을 추가하며 DB/Edge는 변경하지 않는다. 반별 권한/익명 응답/철회한 개인정보 요구는 유지했다.

초기 HTML의 JS 참조 합계는 비교 당시 공개 버전 297,662 bytes, 신규 빌드 254,224 bytes로 14.6% 감소했다. lazy route 파일은 필요한 화면 진입 시 별도로 전송한다. 비압축 빌드 전송 대상 크기 비교이며 실사용 속도·부하 수치를 보장하지 않는다. PC/모바일/다크 화면 캡처를 검토했고 공개 배포·실제 계정 결과는 확인 후 추가한다.

최종 lint 통과, 브라우저 전체 50개 통과(기본 실제 서비스 opt-in 2개 제외). [Pages 43387497983](https://github.com/codexora-dev/SchoolPot/actions/runs/43387497983)와 [Checks 43387498738](https://github.com/codexora-dev/SchoolPot/actions/runs/43387498738)가 프론트엔드 6152cf9b196a6ed20dbfc1b7b54c1053ccb09a86에서 모두 success다. 공개 HTML 빌드 ID와 JS/CSS 7개 HTTP/MIME 검사 통과. 공개 Chromium 1440/390px에서 홈/게시판/가입/로그인/처리방침의 동적 모듈, 체크박스 제거·학년별 실제 7반 선택, 테마 전환 시 입력 유지, 가로 넘침 없음, JS 오류/asset 오류 0개를 확인했다. 공개 URL account-live 1개도 실제 Auth/Edge와 함께 통과했고 QA를 삭제했다. 실제 커뮤니티 데이터 쓰기나 동시 이용 부하 검사를 수행한 것으로 표시하지 않는다.

## 2026-11-13 연락처·정책 섹션·가입 체크 제거

이 섹션이 아래 과거 이메일/연령 체크 검증보다 우선한다. 현재 소스에서 운영자 개인 이메일을 삭제하고 현재 DB contact_email=null 및 보관 문서 contact_email 제거를 적용했다. Git 과거 커밋·캐시·외부 백업까지 삭제한 것은 아니다.

로컬 lint, Vitest 23, PGlite 77, Playwright 45(기본 live 2 제외), Deno check 및 Edge 11, build 통과. 가입 UI의 연령·동의 체크와 처리 안내 문구가 없고 정책의 지정 섹션·mailto가 표시되지 않음을 브라우저에서 검사했다. DB는 새 가입에 연령/동의 시각을 만들지 않고 공개 연락처 필드를 반환하지 않는다. 반별 권한 검사를 유지했다.

실제 프로젝트 migration 적용/accounts Edge v5 배포 후 연령·동의·문서 버전 없는 가입과 Auth 로그인, 소속 조회·임의 변경 거부·관리자 위조 거부를 검사했다. QA 두 계정은 삭제했고 공개 콘텐츠를 생성하지 않았다. 공개 Pages 확인은 배포 후 기록한다.

공개 배포 01fadd8fd77c114d1701bd139601939afebead0c의 [Pages](https://github.com/codexora-dev/SchoolPot/actions/runs/43385554869) success를 확인했다. 빌드 ID와 JS/CSS 2개 HTTP/MIME 검증 통과. 공개 Chromium 1440/390px에서 가입 체크박스·안내 문구 없음, 실제 학년별 7반 선택, 처리방침 3개 섹션, mailto/지정 섹션/외부 문의 부제 없음, 가로 넘침 없음, JS 오류 0개를 확인했다. 공개 URL account-live 1개도 통과(연령값 없는 실제 가입 API, 로그인·자동로그인·탈퇴)했으며 QA는 삭제했다. 부제·메뉴 정리 이후 관련 화면 10개도 재통과했다. DB는 contact_email null, 보관 정책에 연락처 필드 0개, 공개 연락처 필드 없음, 반 수 [7,7,7], 기존 일정 1건, QA 잔여 0개를 확인했다.

## 최신 변경: 동의 없는 소속 선택과 화면 개편

이 섹션이 아래 이전 동의 기반 검증 기록보다 우선한다. 사용자 최신 지시로 개인정보 동의 체크/정책 버전 게이트를 제거했으며 가입 시 만 14세 이상 확인과 반별 DB 권한은 유지한다.

- lint 통과, Vitest 23, PGlite DB 77, Deno check 및 HTTP/accounts Edge 11 통과. npm audit 취약점 0, Vite 빌드 성공.
- 로컬 Playwright 전체는 최신 화면/권한/팝업/관리자/계정/입력·중복 제출·저장소 차단과 320~1440px를 검사한다. 실제 서비스가 아닌 테스트 fixture 응답을 사용하는 검사다.
- 실제 서버: tests/integration/consent-free-live.mjs로 동의·정책 버전 없는 가입, 실제 로그인·소속 읽기, 다른 반 이동 거부·관리자 위조 거부·private 테이블 직접 조회 거부·공개 이메일을 확인했다. 두 임시 계정은 삭제했고 공개 글은 생성하지 않았다. 이 빈 목록 조회만으로 실데이터 반별 격리 검증을 대체하지 않으며, 여러 반의 데이터 격리는 별도 PGlite 회귀로 실행했다.
- 실제 Auth+로컬 UI: account-live.spec.js 1개 통과. 자동로그인 유지·세션 한정, 잘못된 비밀번호 탈퇴 거부, 올바른 비밀번호 탈퇴, 삭제 후 로그인 실패까지 확인했다. 임시 계정 삭제 확인.
- DB 적용 후 반 수 [7,7,7], 기존 수행평가 1건, QA 계정 잔여 0건, RLS 미설정 private 테이블 0개. accounts Edge v4 ACTIVE, verify_jwt=false는 기존의 공개 가입 경로이며 내부 서비스 게이트를 유지한다.
- Security Advisor 기존 INFO/WARN은 security.md의 설명과 같다. 문의 이메일 추가와 동의 없는 가입 구조가 모든 법적 운영 검토 완료를 의미하지 않는다.

최종 로컬 Playwright: 45개 통과, 실제 서비스 opt-in 2개는 기본 실행에서 제외했다. 실제 account-live는 별도로 로컬 UI/공개 UI에서 각각 1개 통과했다.

프론트엔드 커밋 c57891ef9cfdb1d7ea02dc4378ee5575cffc8afd의 [Pages 배포](https://github.com/codexora-dev/SchoolPot/actions/runs/43237125663)와 [Checks](https://github.com/codexora-dev/SchoolPot/actions/runs/43237125562)가 모두 success다. 공개 HTML의 빌드 ID와 JS/CSS 2개 HTTP/MIME을 check-deployment.mjs로 검증했다.

[공개 사이트](https://codexora-dev.github.io/SchoolPot/)의 실제 Chromium 1440/390px에서 홈·게시판·가입 화면, 가로 넘침 없음, 개인정보/국외 처리 동의 입력 없음, 연령 확인 입력 1개, 회원가입 버튼 활성화, 실제 3학년 7반 선택, 문의 mailto, 비회원 수행평가 접근 제한을 확인했다. JavaScript pageerror 0개다. 공개 URL을 대상으로 자동로그인 선택·해제·새 세션 복원·잘못된 비밀번호 탈퇴 거절·정상 탈퇴·삭제 후 로그인 실패도 통과했다. 공개 글 없이 임시 계정만 사용하고 삭제했다.

| 최신 검사                                             | 통과 |
| ----------------------------------------------------- | ---: |
| Vitest 입력·정적 보안·인증 저장소                     |   23 |
| PGlite 최종 스키마 기준 권한·반 격리·동의·삭제        |   77 |
| Playwright fixture·가입·학급 설정·기존 회원·반별 화면 |   44 |
| Deno HTTP 보호 및 가입 처리 순서·실패 정리            |   11 |
| 실제 Auth/PostgREST/Edge 준비 상태·권한 검증          |    5 |
| 실제 DB 현재 세션·authenticated 역할 롤백 assertion   |    8 |

168개 검사/assertion을 통과했다. lint/build 및 accounts Edge Deno check도 통과했다. 로컬 DB 검사는 전체 최신 마이그레이션을 먼저 적용해 기존 회귀 사례까지 실행한다. 기본 E2E의 실제 계정 테스트 2개는 건너뛰며, 별도 활성화 시에도 실제 반 수·정책 준비 전 새 가입 전체 흐름을 실행하지 않는다. 열린 화면에서 정책 변경 시 재시도로 최신 소속·동의를 불러오고 등록 경로로 안내하는 검사도 포함했다.

실제 API는 공개 설정의 소속 비노출, 미등록 소속의 일정 거절, 관리자 설정/정정 권한 차단, 정책 미준비에서 소속/동의 거절, 가입 서버의 Auth 생성 전 거절을 확인했다. 긍정적인 반별 쓰기·읽기·타 반 격리는 실제 임시 계정의 세션 식별자와 DB authenticated 역할을 사용한 롤백 트랜잭션으로 별도 확인했다. 실제 방문자에게 테스트 정책이나 반/일정을 공개하지 않았다.

실제 DB 확인: 테스트 계정 0, 소속 0, 기존 일정 1건 유지, 반 수 [0,0,0], 정책 준비 상태, private 29개 테이블 RLS 활성화. 실제 신규 가입→소속 저장→UI 전체 긍정 흐름은 운영 설정 미준비로 검증하지 않았으며 로컬 fixture·롤백 검사를 대체 증거로 표시하지 않는다. 운영자 설정 후 account-live.spec.js로 실행할 수 있다.

화면 캡처: screenshots/signup-class-mobile.png, admin-class-settings.png. 제공된 외부 개인정보 문의 주소는 HTTP 404였다. [아동 동의](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1020398523)와 [국외 이전 고지](https://law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1033215841)를 확인했으며 법적 운영 보증으로 표시하지 않는다. 운영 준비와 제한은 classes-privacy.md를 참고한다.

최신 Security Advisor는 의도적인 [기본 거부 RLS INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) 29건과 기존 [유출 비밀번호 보호 비활성 WARN](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) 1건이다. 공개 배포 결과는 progress.md에 기록한다.

최종 코드 9e979af의 CI/Pages 성공과 실제 배포 SHA·JS/CSS 200/MIME을 확인했다. 배포 후 브라우저에서 준비 중 가입 차단, 동의 3개, 공개 처리방침과 지정 외부 문의 링크, JavaScript 오류 0건을 재확인했다. 실제 문의 사이트와 운영 정책은 준비 미완료 상태이며 신규 가입 전체 긍정 흐름의 실제 검증을 완료한 것으로 표시하지 않는다.

## 이전 자동로그인·회원탈퇴 검증

| 최신 검사                                 | 통과 |
| ----------------------------------------- | ---: |
| Vitest 입력·정적 보안·선호도·인증 저장소  |   23 |
| PGlite DB 계정·세션·권한·게시판·문의      |   61 |
| Playwright fixture·반응형·자동로그인·탈퇴 |   39 |
| 실제 Supabase 연동 계정 브라우저 시나리오 |    1 |

최신 124개 검사를 통과했습니다. lint/build도 통과했습니다. 기본 브라우저 실행에서 실제 계정을 만드는 테스트 2개는 건너뛰며 account-live.spec.js를 별도 명시 활성화해 실제 서버로 1개 실행했습니다. 아래 이전 게시판 API 7개는 이번 최신 합계에 다시 더하지 않습니다.

인증 저장소 단위 검사는 기본 탭 저장, 이전 영구 토큰 정리, 선택 후 SDK 부가 키 이동 및 재생성 복원, 선택 해제, 로그아웃/탈퇴 정리, 저장 차단·용량 부족·메모리 대체를 검사합니다. UI fixture 검사는 새 브라우저 컨텍스트의 복원 차이와 새로고침 유지, 비밀번호 미보관, 로그아웃 정리, 확인 문구·비밀번호 오류·중복 제출·탈퇴 후 토큰/임시 글 정리, 모바일 눈 아이콘·키보드 토글을 포함합니다.

실제 서버 시나리오는 임시 계정을 생성해 자동로그인 선택 시 브라우저 컨텍스트 재생성 후 프로필 진입을 확인하고, 해제 시 같은 탭 새로고침은 유지되지만 새 컨텍스트에서는 로그인 안내를 확인했습니다. 실제 잘못된 비밀번호로 탈퇴가 거절되고 올바른 비밀번호로 삭제된 뒤 로그인에 실패함을 확인했습니다. 실제 QA 계정 잔여 0건을 원격 SQL로 확인했습니다. 실제 사용자 계정은 변경하지 않았습니다. 새 DB 마이그레이션/Edge 변경은 없습니다.

브라우저 캡처: screenshots/login-options-mobile.png, account-delete-mobile.png. 코드 5a177ac의 CI/Pages 배포 성공, 실제 배포 SHA·JS/CSS 200/MIME을 확인했습니다. 같은 실제 계정 시나리오를 공개 사이트에서도 별도 재실행해 통과했고 QA 계정 삭제를 확인했습니다. 로컬/배포 환경의 동일 시나리오를 중복 합산하지 않았습니다. workflow 링크와 배포 결과는 progress.md에 기록했습니다.

## 이전 게시판·문의 관리 검증

| 최신 검사                                     | 통과 |
| --------------------------------------------- | ---: |
| Vitest 입력·아이디·정적 보안·팝업 닫기 선호도 |   15 |
| PGlite DB 권한·익명·계정·팝업·게시판·문의     |   61 |
| Playwright 일반·회원 fixture·반응형·관리 화면 |   35 |
| 실제 Supabase 게시판·문의 API                 |    7 |

이번 최신 실행에서 118개 검사를 통과했습니다. 기본 E2E의 실제 계정 생성 테스트 1개는 명시적 활성화 전까지 건너뜁니다. Lint와 production build도 통과했습니다. Edge 함수는 변경하지 않았습니다.

## DB 및 실제 서버

PGlite는 전체 마이그레이션을 새 PostgreSQL DB에 적용하고 권한·소유권·현재 세션·익명 식별자 보호를 실제 실행합니다. 추가 검사는 관리자 게시판 생성/수정/순서/버전/삭제, 사용자 정의 익명·투표 게시판, 읽기 전용의 글·댓글·공감·투표 우회 차단, 숨김 게시판의 공개 목록/검색/타인 직접 조회 차단, 글이 있는 게시판 삭제 거절을 포함합니다. 문의 소유자/상태/답변 위조 무시, 타인 문의 격리, 관리자 필터/답변/알림, 버전 충돌, 입력 길이와 시간당 접수 제한도 검증했습니다.

실제 Supabase에 board_management_feedback 마이그레이션을 적용했습니다. 별도 임시 QA 계정 2개로 Auth 로그인, 비회원 메타데이터/관리 거절, 일반 회원 관리자 거절, 문의 작성 및 계정 간 격리, 관리자 답변/알림/오래된 수정 거절, 숨김 게시판/글 생성 및 접근 차단, 게시판 수정/버전/삭제를 검증했습니다. QA 계정 하나에만 임시 역할을 부여했으며 운영자 admin 계정은 변경하지 않았습니다.

검증 종료 후 QA 계정·문의·게시판 잔여가 각각 0건이고 private 테이블 전체의 RLS가 활성화됐음을 원격 SQL로 확인했습니다. 테스트 게시판을 공개하지 않았으며 기존 사용자 글은 변경하지 않았습니다. 테스트 코드: tests/integration/management-live.mjs. 로컬 DB/브라우저 fixture 검사는 실제 Supabase 검증과 별도로 집계합니다.

## 화면

게시판 추가 후 메뉴 반영, 설정 수정·읽기 전용·숨김·빈 게시판 삭제, 사용자 문의 접수/목록/XSS 원문 표시, 관리자 필터/답변/상태 변경을 검증했습니다. 읽기 전용에서는 수정/댓글 폼이 사라지고 공감·투표 버튼이 비활성화됩니다. 게시판 API 실패 시 가짜 목록 없이 오류와 재시도를 표시합니다.

320~1440px 기존 화면 검사를 유지하고 320px의 긴 문의·관리자 답변 창을 확인했습니다. 창이 뷰포트 안에 위치하고 가로 넘침이 없으며, 문의 답변 캡처는 screenshots/feedback-admin-mobile.png입니다. 기존 팝업/계정/학교생활 UI 검사도 통과했습니다.

## 보안 진단과 배포

최신 Security Advisor는 기본 거부 RLS의 [no policy INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) 25건과 기존 [유출 비밀번호 보호 비활성 WARN](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) 1건입니다. 필요 없는 허용 정책이나 유료 플랜 변경을 추가하지 않았습니다.

코드 ef72e1e의 GitHub CI와 Pages build/deploy가 성공했습니다. 실제 배포 SHA·JS/CSS 3개 자산의 HTTP 200/MIME을 확인했습니다. 공개 사이트 브라우저에서 실제 게시판 7개·문의 링크·비로그인 접근 안내·390px 가로폭을 확인했고 JavaScript 오류는 0건입니다. 최종 배포 URL과 workflow 링크는 progress.md에 기록했습니다.

## 이전 팝업 업데이트 검증 이력

| 최신 검사                                     | 통과 |
| --------------------------------------------- | ---: |
| Vitest 입력·아이디·정적 보안·팝업 닫기 선호도 |   15 |
| PGlite DB 권한·익명·계정·팝업 관리            |   48 |
| Playwright 일반·회원 fixture·반응형·팝업      |   30 |
| 실제 Supabase 팝업 API                        |    7 |

이번 최신 실행에서 자동 검사 100개를 통과했습니다. 기본 E2E의 실제 계정 생성 테스트 1개는 명시적 활성화 전까지 건너뜁니다. 이전 계정 작업에서 실제 Auth/API 15개·실제 가입/탈퇴 UI 1개·Edge HTTP 보호 8개를 검증한 이력은 progress.md에 남겼으며 이번 팝업 검사와 혼동하지 않습니다.

실제 팝업 API 검증은 임시 계정을 생성해 일반 회원 관리 차단을 확인한 뒤 해당 QA 계정에만 임시 역할을 부여해 비공개 생성·공개 응답 제외·수정/버전·오래된 수정 차단·기본 닫기 제거 차단·삭제를 수행했습니다. 테스트 계정과 팝업 잔여 0건을 확인했습니다. 운영자 admin 계정 및 실제 데이터는 변경하지 않았습니다.

별도로 실제 DB에서 활성 팝업 생성·공개 JSON projection·삭제를 현재 역할/세션 검사와 함께 검증하고 트랜잭션 전체를 롤백했습니다. 실제 방문자에게 QA 팝업을 게시하지 않았습니다. 비회원 공개 RPC는 HTTP 200, 관리 RPC는 401/권한 거절을 확인했습니다.

브라우저 검사는 첫 진입 표시, HTML 원문 텍스트 처리, 기본 닫기 후 메뉴 이동/새로고침, 오늘 하루와 다시 보지 않기 유지, 수정 버전 재표시, 허용된 옵션만 표시, Escape/× 닫기, 순차 팝업, 320px 긴 본문, 관리자 등록/미리보기/중지/수정/삭제를 포함합니다. 캡처는 screenshots/popup-mobile.png 및 popup-preview-desktop.png입니다.

Lint·build를 통과했고 npm audit에서 알려진 취약점 0건을 확인했습니다. popup_preferences의 오늘 날짜는 Asia/Seoul 기준이며 브라우저 저장 차단 시 이번 방문에만 닫았다고 안내합니다.

최신 Security Advisor: RLS 기본 거부의 no policy INFO 24건, Auth 유출 비밀번호 보호 비활성 WARN 1건. [유출 비밀번호 보호 설정](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) 비활성 WARN 1건도 확인했습니다. 팝업과 별개인 Auth 설정이며, 공식 문서상 Pro 이상 기능이므로 임의의 유료 플랜 변경은 하지 않았습니다.

## 2026-11-13 관리자 계층·제재·이의 제기 (운영 미적용)

| 검증                                   | 결과                           |
| -------------------------------------- | ------------------------------ |
| ESLint                                 | 통과                           |
| Vitest                                 | 25 통과                        |
| PGlite PostgreSQL, 전체 최종 migration | 101 통과                       |
| Playwright fixture E2E                 | 69 통과, 실제 계정 2 기본 제외 |
| Deno HTTP·가입·탈퇴 테스트             | 15 통과                        |
| delete-account Deno check              | 통과                           |
| Vite build                             | 통과                           |
| 마지막 관리자 메뉴 보완 후 관련 E2E    | 9 통과                         |

DB에는 역할 위조·일반 회원 관리자 RPC 차단·부관리자의 직접 제재/해제/역할/환경설정 차단, 현재 세션 해임, 마지막 owner 보호, 중요 공지 및 민감 문의 격리, 실제 작성자 증거 확인, 요청 보완/충돌/중복 승인, 제한 중 이의 제기/문의/탈퇴 예외, 다른 회원의 제재 접근 차단, 영구 제한 확인, 장기 제한 보존, 기간 만료, 규정/설정 버전 비교를 포함했다. 실제 운영과 같은 두 아이디의 이관 fixture를 롤백 트랜잭션에서 검사했다.

브라우저에서는 부관리자 메뉴/직접 URL 차단/요청만 전송, 최고 관리자 제재 입력·사유·operation UUID, 닫기/Escape/라우트 이동으로 제한 팝업 우회 불가, 이의 제기 접수, 로그인 도중 해임·제한 화면 교체, 경고 확인 중 글 입력 보존, PC/390px 관리자 화면과 설정 저장을 검사했다. Edge 탈퇴 테스트는 최고 관리자 거절이 재인증/전역 로그아웃/삭제 전에 발생하고 일반 계정은 비밀번호 확인 후 삭제하는 순서를 검사했다.

`docs/screenshots/admin-governance-desktop.png`, `admin-governance-mobile.png`, `account-restriction-mobile.png`를 직접 열어 확인했다. 기존 관련 화면 캡처의 자동 덮어쓰기는 정리했다.

이번 migration·Edge·Pages는 아직 운영에 적용하지 않았다. 운영 Auth/PostgREST/Edge를 통한 실제 역할/제재/이의 제기 흐름, 여러 실제 DB 연결의 동시 승인, 공개 배포 빌드 검증은 승인 후 진행할 항목이다. 기존 데이터 보존과 권한 이관 계획은 `admin-governance.md`를 따른다.

## 2026-11-13 최종 운영 적용·Pages 검증

- 승인된 두 운영 migration과 delete-account Edge v3 적용 완료. kminjae803=owner, yoonjihoo_0221=moderator.
- 최종 기능 빌드: `91aad199e6e66ca6bf32c06ac44a7e02adcdf6fb`. [CI 성공](https://github.com/codexora-dev/SchoolPot/actions/runs/43445365536), [Pages 성공](https://github.com/codexora-dev/SchoolPot/actions/runs/43445365738).
- 공개 HTML 빌드 식별자·JS/CSS 12개 자산 200 및 MIME 검증 통과.
- 로컬 단위 25·DB 101·기본 브라우저 70(실제 서비스 3 기본 제외)·lint·build 통과. 기존 Edge 15 및 Deno check 통과, CI npm audit 통과.
- 실제 Supabase Auth 회원의 역할 위조/관리 API 거절, 배포 사이트의 제한 팝업·Escape/URL 우회 거절·이의 제기·권리 문의·제한 중 탈퇴·삭제 후 JWT 거절: 별도 live E2E 통과.
- 최종 공개 빌드의 실제 자동로그인 선택/해제 복원, 비밀번호 재확인 탈퇴 및 삭제 후 로그인 거절: 기존 account-live E2E 통과.
- 운영 PostgreSQL의 실제 세션/역할로 owner/moderator/member 권한 검사 및 실제 QA 접수 이의의 양쪽 관리자 열람, 부관리자 답변/민감 문의 차단/제한 해제 차단, 최고 관리자 해제/정상 회원 검색을 검사하고 모두 롤백.
- 실제 운영 관리자 외부 JWT 로그인 및 다중 DB 연결 동시 승인 부하를 자동화해 검사했다고 표시하지 않는다.
- QA 계정과 연결 작성 내용 삭제 확인. 초기 데이터 건수 보존 후 실제 owner의 운영 해제 변경은 감사 시각을 확인해 보존.

Security Advisor의 private 기본 거부 RLS INFO 35는 직접 테이블 권한 회수/디스패처 설계와 일치한다. 기존 [유출 비밀번호 보호 비활성 WARN](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)은 남아 있으며 이번 배포에서 Auth 유료 설정을 임의 변경하지 않았다. Performance Advisor의 기존 [anonymous_labels FK 인덱스 INFO](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) 1건과 미사용 인덱스 INFO 18건도 기능 실패로 표시하지 않는다.
