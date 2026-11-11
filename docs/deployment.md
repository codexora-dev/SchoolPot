# 연결·배포·운영 가이드

## 현재 연결 상태

대상: `https://hlglstdtgcodblynicmh.supabase.co`. 로컬 `.env.local`에 사용자 제공 publishable key가 설정되어 있다. API 호스트에 도달했지만 public.community는 아직 없어 PGRST202를 반환했다. 연결 도구의 프로젝트 권한이 없어 원격 테이블 조사·마이그레이션·advisor·Edge 배포는 실행하지 않았다. secret/service_role 키를 채팅으로 전달할 필요는 없다.

## DB 적용

Dashboard에서 대상 프로젝트를 열고 기존 테이블/함수와 백업을 먼저 확인한다. `private` 스키마나 `public.community`가 이미 있다면 충돌을 조사하고 병합 마이그레이션을 작성한다. 빈 전용 프로젝트이면 SQL Editor에서 아래 파일 **전체**를 한 번 실행한다.

```text
supabase/migrations/20261111133230_schoolpot_v1.sql
```

이 파일은 테이블 생성, 외래 키/제약조건/인덱스, 7개 게시판, 모든 테이블 RLS, 권한 회수, API 함수를 함께 생성한다. 테스트용 계정과 게시글은 넣지 않는다. SQL Editor 실행 후 원격 migration history를 CLI로 관리할 계획이면 CLI 버전의 `migration repair --help`를 먼저 확인해 이 버전을 반영한다. 같은 파일을 db push로 중복 적용하지 않는다.

API exposed schemas는 public만 사용하고 private는 추가하지 않는다. 다음 확인 쿼리를 SQL Editor에서 실행한다.

```sql
select n.nspname,c.relname,c.relrowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='private' and c.relkind='r';
select has_table_privilege('authenticated','private.posts','SELECT') as must_be_false;
select has_function_privilege('anon','public.community(text,jsonb)','EXECUTE') as must_be_false;
```

Security Advisor의 RLS·함수 search_path·불필요 권한을 검토한다. 공개 security invoker 함수가 private definer를 호출하는 설계를 이해한 뒤 변경하며, 권한 오류를 해결하려고 테이블 전체 SELECT를 부여하지 않는다.

## Auth

1. Email provider 활성화, Confirm Email 활성화, anonymous signup 비활성화, 최소 비밀번호 길이 12자로 설정한다.
2. 로컬 개발에서 Site URL을 `http://127.0.0.1:5173`로, redirect allow list에 `http://127.0.0.1:5173/`를 등록한다. localhost와 127.0.0.1은 다르므로 사용하는 주소와 일치시킨다. 실제 배포 후 Site URL을 HTTPS 운영 주소로 바꾸고 운영 주소의 `/`를 allow list에 추가한다. 광범위한 wildcard는 사용하지 않는다.
3. 가입/재설정 이메일의 기본 템플릿에 인증 RedirectTo가 유지되는지 확인한다. PKCE 코드는 같은 브라우저에서 소비한다. 앱은 PASSWORD_RECOVERY 이벤트에서 비밀번호 변경 화면으로 이동한다.
4. SMTP 제공자를 설정하고 발송량 제한·회신 주소를 점검한다. 실제 가입 인증/재설정 메일을 테스트한다. CAPTCHA를 도입할 때 프론트 token 전달도 함께 구현하며 Dashboard만 켜고 완료했다고 하지 않는다.
5. 사용자 이메일 확인 후 로그인하고 프로필을 저장한다. 이후 Auth Users에서 UUID를 확인하고, 아래 SQL을 **운영자 본인 계정 UUID로 치환하여** 실행한다.

```sql
insert into private.user_roles(user_id,role)
values ('운영자-본인-계정의-UUID'::uuid,'admin')
on conflict(user_id) do update set role='admin';
```

일반 클라이언트에서는 역할을 만들거나 바꿀 수 없다. 관리자도 일반 로그인 후 DB 권한을 통해 관리자 화면을 이용한다. 운영자 계정은 Auth MFA 활성화를 검토한다(MFA UI는 이 버전 범위 밖).

## Edge Functions

두 함수: `neis`, `delete-account`. 로컬 config.toml에는 verify_jwt=false를 명시한다. 게이트웨이 검증을 대신해 **공통 protect가 getUser로 실제 토큰을 서버 검증**하며 익명·미인증 요청을 거절한다. 공개 publishable key는 사용자 토큰을 대신하지 않는다.

Dashboard Edge Function Secrets에 다음을 설정한다. 서버 secrets는 VITE_로 시작하면 안 된다.

| 환경변수                                        | 값                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| ALLOWED_ORIGINS                                 | 허용 웹앱 Origin을 쉼표로 구분, 예: `http://127.0.0.1:5173,https://학교서비스주소` |
| NEIS_API_KEY                                    | NEIS 발급 키                                                                       |
| NEIS_OFFICE_CODE                                | 교육청 코드                                                                        |
| NEIS_SCHOOL_CODE                                | 학교 코드                                                                          |
| SUPABASE_URL                                    | Supabase 자동 제공 URL                                                             |
| SUPABASE_ANON_KEY 또는 SUPABASE_PUBLISHABLE_KEY | 서버 사용자 토큰 검증용 공개 키                                                    |
| SUPABASE_SERVICE_ROLE_KEY                       | Supabase 자동 제공, 탈퇴 함수에서만 사용                                           |

CLI 명령은 설치 버전의 `--help`를 먼저 읽는다. 현재 로컬 CLI는 v3 형식이므로 이전 블로그의 옵션을 그대로 사용하지 않는다. 프로젝트 접근을 승인한 계정으로 로그인·link 후 `supabase functions deploy --help`를 확인하고 해당 두 함수를 배포한다. 이 작업에서는 원격 배포하지 않았다.

학교 코드가 없으면 NEIS는 503/설정 안내를 제공한다. 실제 급식이나 일정인 것처럼 샘플을 반환하지 않는다. 주말/공휴일/미등록일의 빈 결과를 확인한다. 실제 NEIS 응답에서 알레르기 번호와 메뉴가 올바르게 렌더링되는지 확인한다.

## 프론트엔드 배포

Cloudflare Pages 또는 Vercel에서 설치 `npm ci`, 빌드 `npm run build`, 출력 `dist`를 사용한다. Vercel은 저장소의 vercel.json, Cloudflare는 public/_headers가 빌드 산출물로 복사된다. Supabase URL과 공개 키, 학교 이름을 빌드 환경변수로 설정한다. `.env.local`, 서버 키, 테스트 결과물을 업로드하지 않는다.

hash router를 사용하므로 별도 SPA rewrite가 필요 없다. HTTPS 운영 주소를 Auth allow list 및 ALLOWED_ORIGINS와 맞춘다. CSP의 connect-src는 실제 Supabase 프로젝트 호스트로 좁혀 운영하는 것을 권장한다. dev 서버에서는 프로덕션 CSP가 적용되지 않으므로 배포 후 응답 헤더를 재확인한다.

공개 배포는 사용자 확인 후 실행한다. 개인정보 처리방침·이용약관·운영자 연락처·연령/동의 절차를 확정하기 전 실제 학생을 모집하지 않는다. 법률 문서를 임의로 확정하지 않았다.

## 배포 후 검증

- 실제 인증 메일 → 로그인 → 닉네임 → 글/댓글/투표 → 알림 흐름을 두 계정으로 검증한다.
- 미인증/일반/관리자 토큰을 바꿔 같은 RPC와 직접 REST 조회를 시도한다. 익명 글/댓글 JSON에 작성자 ID가 없는지 확인한다.
- 타인 수정/삭제, 관리자 역할 위조, 중복 투표/공감, 제한 계정 접근을 확인한다.
- 개발용 계정으로 재인증 탈퇴 후 기존 JWT로 RPC가 거절되는지, 작성자 정보가 NULL로 바뀌었는지 확인한다.
- NEIS 실응답, 보안 헤더, 390px 모바일·키보드 내비게이션을 확인한다.
- Auth 오류/함수 오류 로그와 DB advisory를 확인하되 토큰·비밀번호·개인정보를 로그에 추가하지 않는다.

## 운영

정기적으로 공지/신고/이용 제한 및 관리자 기록을 검토한다. 알림·조회수·신고·감사 로그의 보존기간을 확정하고, 승인된 정책에 따라 운영자 전용 정리 작업을 구성한다. 이 버전에는 개인정보 보존기간을 임의로 정한 자동 삭제 cron을 넣지 않았다. DB 용량·Auth 발송량·Edge 사용량을 관찰하고 무료 플랜 한계에 도달하기 전 대량 알림/검색/조회수 구조를 개선한다.

롤백은 프론트엔드 이전 버전 재배포와 DB 백업 복원을 별도로 계획한다. 실제 운영 데이터를 삭제하거나 스키마를 DROP하는 롤백 SQL은 제공·실행하지 않았다.
