# 아키텍처

브라우저의 Vite 정적 앱은 Supabase Auth, community RPC, accounts/neis/delete-account Edge Function을 사용합니다. 화면·UI·비즈니스 검증·데이터 접근을 분리했습니다.

## 아이디 가입/복구

아이디는 정규화한 소문자 3~20자입니다. 브라우저는 가입 시 아이디와 8자 이상 비밀번호만 accounts 함수로 보냅니다. 서버가 입력과 Origin을 검증하고 가입 요청 횟수를 DB에서 제한합니다. Auth admin.createUser로 내부 주소 계정을 만들고 보호된 app_metadata.account_type을 부여합니다. 이후 service_role 전용 account_gateway가 계정 매핑·프로필·복구 코드 해시를 등록합니다.

Supabase Auth가 INSERT 후 메타데이터를 저장할 수 있어 INSERT 트리거에만 의존하지 않습니다. 후속 프로비저닝이 실패하면 방금 만든 계정만 정리하고 실패를 반환합니다. 기본 프로필 닉네임이 이미 사용 중이면 무작위 접미사를 사용합니다.

복구 코드는 암호학적 난수 32바이트이며 SHA-256 해시만 private.account_handles에 저장합니다. 재설정은 기존 해시를 원자적으로 새 해시로 교체하고 Auth 비밀번호를 갱신한 다음 기존 auth.sessions를 제거합니다. 실패 시 새 해시가 그대로인 경우에만 이전 해시로 되돌립니다. 계정 삭제는 Auth admin API를 사용합니다.

## 데이터 경계

private 테이블은 모두 RLS와 직접 권한 회수로 기본 거부합니다. public.community는 invoker 래퍼이고 private.community만 의도적으로 definer 권한을 사용합니다. 현재 auth.uid·Auth 사용자 존재·현재 session_id·등록된 아이디 계정·이용 제한·소유권·관리자 DB 역할을 매 작업 검사합니다.

공개 글/댓글은 화이트리스트 JSON으로 반환해 작성자 UUID와 계정 매핑을 감춥니다. 익명 번호는 글별로 생성합니다. 관리자 신고 조회만 대상 사용자 ID를 반환하며 감사 기록을 남깁니다. 클라이언트 user_metadata나 요청의 role/is_admin으로 권한을 부여하지 않습니다.

## 학교생활

기본 학교 설정은 src/config/school.js입니다. NEIS는 고정 호스트를 서버에서 호출하고 학교 코드·날짜·종류만 전달합니다. API 키는 선택적인 서버 비밀값입니다. 최대 100개 키, 1시간의 인스턴스 내 캐시를 사용합니다. 실제 일별 조회이며 데이터가 없으면 빈 상태를 반환합니다.

## 배포와 확장

정적 빌드는 루트·저장소 하위 경로 모두 지원하고 빌드 시 CSP meta를 넣습니다. 서버는 Supabase에 독립 배포합니다. Realtime·파일 업로드·대량 알림 배치·외부 분석은 포함하지 않습니다. 검색 규모가 커지면 pg_trgm, 대량 공지에는 큐/배치, NEIS에는 공유 캐시를 추가할 수 있습니다.

## 사이트 진입 팝업

게시된 안내만 site_popups 공개 RPC로 읽으며 작성자 정보와 비공개 팝업은 제외합니다. manage_popups는 기존 community의 실제 계정/세션/역할 검사를 재사용합니다. 팝업은 private.site_popups에 저장하고 보지 않기는 버전과 한국 날짜를 기준으로 브라우저에 저장합니다. 관리 화면에는 자동 표시하지 않으며 미리보기는 저장/게시하지 않습니다.
