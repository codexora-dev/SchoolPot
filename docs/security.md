# 보안 설계 및 검증

## 신뢰 경계

클라이언트의 UI 숨김은 보안 경계가 아니다. 모든 데이터 요청은 DB 함수가 auth.uid, auth.users 존재, JWT session_id와 auth.sessions의 사용자 연결, 이메일 인증, 익명 Auth 여부, 최신 이용 제한, 소유권, 관리자 DB 역할을 다시 확인한다. 관리자 권한에 user_metadata를 사용하지 않는다. 미가입, 이메일 미인증, Auth anonymous 계정은 커뮤니티를 조회할 수 없다. 재학생 인증은 사용자 요청에 따라 사용하지 않는다.

public.community는 security invoker이며 데이터 테이블은 private 스키마에 있다. private.community만 의도적인 security definer다. 빈 search_path, 스키마 완전 수식, 정적 SQL, 분기별 권한 검사, 내부 함수 EXECUTE 회수로 범위를 제한한다. 모든 private 테이블은 RLS가 활성화되고 anon/authenticated 직접 권한 및 허용 정책은 없다. private 스키마를 Data API exposed schemas에 추가하지 않는다.

## 익명성

게시글/댓글 응답은 화이트리스트로 구성하며 실제 작성자 UUID/이메일/메타데이터를 포함하지 않는다. 일반 글도 작성자 닉네임만 반환한다. 내 글 판단은 is_mine boolean으로만 반환한다. 익명 댓글 번호는 게시글마다 따로 부여하며 다른 글의 번호와 연결되지 않는다. 작성자 본문에 스스로 남긴 개인정보까지 자동 제거하는 기능은 없다.

관리자는 신고 처리에 필요한 대상 계정 ID를 관리자 전용 신고 조회에서만 확인할 수 있다. 이 조회는 감사 기록에 남긴다. 일반 사용자에게는 신고 목록·계정 ID·관리자 기록 접근을 허용하지 않는다.

## 입력·요청·브라우저

- DB CHECK·FK·복합 PK 및 프론트/서버 입력 검증을 함께 사용한다. 서버가 최종 판단한다.
- 사용자 콘텐츠는 텍스트 노드로 렌더링하고 HTML/Markdown 실행을 지원하지 않는다. inline event handler, eval, innerHTML을 사용하지 않는다.
- SQL은 바인딩된 RPC 파라미터와 정적 쿼리만 사용한다. 검색어를 SQL 문자열에 조합하지 않는다.
- 성공 요청 기준 총 180회/분, 글 10회/10분, 댓글 30회/10분, 공감 60회/분, 신고 10회/시간, 수행평가 15회/시간을 DB 버킷으로 제한한다. 트랜잭션이 실패하면 해당 트랜잭션의 카운트도 롤백되므로 실패 요청 전부를 세는 WAF 대체가 아니다.
- Edge NEIS gate는 30회/분, 계정 탈퇴 재인증 시도는 별도 RPC 트랜잭션에서 5회/시간으로 제한한다. Auth 로그인·가입·비밀번호 재설정 요청 제한과 CAPTCHA는 Dashboard에서 별도 설정한다.
- RPC JSON 최대 약 60KB, 글 20개/페이지, 댓글 50개/페이지, 알림 100개, 공지 50개, 일정 200개로 응답을 제한한다. 호스팅/게이트웨이의 본문·요청 제한도 유지한다.
- Edge는 getUser로 토큰을 서버 확인한다. 허용 Origin의 POST만 처리하며 본문을 스트림으로 읽는 동안 4096바이트를 초과하면 취소한다. NEIS는 고정 HTTPS 호스트와 허용된 쿼리 필드만 사용해 SSRF를 방지한다.
- Cloudflare/Vercel용 CSP, frame-ancestors DENY, nosniff, referrer/permissions 제한을 제공한다. Vite 개발 서버에는 프로덕션 헤더가 적용되지 않는다.
- 폰트/일러스트는 외부 분석·이미지 서비스 없이 시스템 폰트와 CSS를 사용한다. 프론트에는 Supabase 공개 키만 포함한다. 비밀키는 Edge 런타임 환경변수에서만 읽는다.
- Vite 설정 단계에서 공개 키 형식을 검사하며 `VITE_`에 secret/service_role/private_key 변수를 넣으면 빌드와 개발 서버 시작을 중단한다. 런타임 검사만으로 키가 번들에 들어가는 문제를 막을 수 없으므로 빌드 전에 거절한다.

## 계정·개인정보

필수 수집은 Auth 이메일, 비밀번호(Auth가 관리), 닉네임이며 학년은 선택이다. 실명·학번·학생증을 수집하지 않는다. 브라우저 세션과 임시 글은 사용자 기기에 저장되므로 공용 기기에서 로그아웃하도록 안내한다. 로그아웃/탈퇴 시 해당 사용자의 임시 글을 제거한다.

탈퇴는 비밀번호 재인증 → 검증용 세션 로그아웃 → 원래 세션 전역 로그아웃 → 사용자 삭제 순서다. 프로필·역할·익명 매핑·공감·투표·알림은 삭제되고, 게시글/댓글/공지/신고/관리자 기록의 계정 연결은 NULL 처리한다. 글·댓글은 탈퇴 전에 직접 삭제할 수 있다. 이미 발급된 JWT가 있더라도 DB의 사용자 존재 검사로 접근을 차단한다. 이용 제한 회원도 자신의 프로필을 보고 탈퇴할 수 있도록 허용한다.

게시글·댓글 본문 자체에 남은 개인정보, Supabase Auth 로그·백업, 신고 사유 보존기간의 운영 정책은 별도로 확정해야 한다. 정식 개인정보 처리방침·연락처·연령별 동의·서비스 약관은 임의로 결정하거나 법률 검증이 끝난 것으로 표시하지 않았다.

## 검증 결과와 한계

- PostgreSQL(PGlite) 보안 시나리오: 권한/소유권/익명성/중복/탈퇴/제한 검사 실제 실행 통과.
- Vitest 입력 검증 및 Playwright 브라우저 XSS·접근 차단·반응형·회원 기능 fixture 검증 통과.
- Deno Edge 공통 HTTP 보호 테스트 및 두 함수 타입 검사 통과.
- npm audit에서 알려진 취약점 0건(검사 시점). 지속적인 의존성 갱신이 필요하다.
- 원격 RPC 조회는 PGRST202(함수 미설치) 확인. Supabase 연결 도구는 프로젝트 접근 권한 오류. 원격 DDL을 실행하지 않았다.
- **미검증:** 실제 PostgREST/GraphQL/RLS 경계, 원격 advisor, Auth 이메일/PKCE/재설정, 실제 계정 탈퇴 API, 실제 NEIS, 프로덕션 보안 헤더, 부하 및 다중 인스턴스 동시성. 이를 통과한 것으로 간주하지 않는다.

배포 전 원격 마이그레이션을 적용한 후 최소 두 일반 회원·미인증 계정·관리자로 동일 시나리오를 REST에서도 반복하고 Security Advisor 결과를 검토한다. 일반 공개 키로 데이터 테이블이 조회되지 않는지 확인한다. 테이블 RLS만 확인하고 definer API의 권한 검증을 생략하면 안 된다.

참고한 공식 자료: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [비밀번호 인증](https://supabase.com/docs/guides/auth/passwords), [Edge 인증](https://supabase.com/docs/guides/functions/auth), [사용자 삭제 API](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser), [변경 기록](https://supabase.com/changelog).
