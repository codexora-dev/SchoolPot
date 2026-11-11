# 데이터베이스

모든 사용자 테이블은 `private` 스키마다. 모든 테이블에 RLS가 활성화되어 있고 anon/authenticated의 직접 권한을 회수한다. 일반 클라이언트가 접근 가능한 테이블 정책은 만들지 않는다. 공개 API는 `public.community(p_action text,p_payload jsonb)` 하나다.

| 테이블                            | 역할                                 | 삭제 정책                                            |
| --------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| profiles                          | 닉네임·선택 학년·알림 설정·제한 일시 | Auth 탈퇴 시 CASCADE                                 |
| user_roles                        | admin/moderator 역할                 | 서버에서만 지정, 탈퇴 CASCADE                        |
| boards                            | 7개 게시판 정의                      | 참조 글 존재 시 삭제 거절                            |
| posts                             | 본문과 비공개 작성자                 | 작성자 탈퇴 SET NULL, 글 삭제 시 종속 데이터 CASCADE |
| comments                          | 댓글·1단계 답글                      | 작성자 탈퇴 SET NULL, 부모 댓글 삭제 시 답글 CASCADE |
| anonymous_labels                  | 글별 사용자 익명 번호                | 글/사용자 삭제 CASCADE                               |
| post_likes / comment_likes        | 공감                                 | 대상+사용자 복합 PK, CASCADE                         |
| post_views                        | 사용자별 날짜별 조회                 | 복합 PK, 대상/사용자 CASCADE                         |
| polls / poll_options / poll_votes | 투표와 결과                          | 사용자별 1표 PK, 선택지/투표 복합 FK                 |
| notifications                     | 사용자 알림                          | 대상 글/사용자 삭제 CASCADE                          |
| reports                           | 글·댓글 신고                         | 작성자/대상 삭제 SET NULL, 사유 보존                 |
| performance_assessments           | 학년·과목·기한·메모                  | 작성자 SET NULL                                      |
| assessment_reports                | 일정 수정 요청                       | 일정 CASCADE, 작성자 SET NULL                        |
| notices                           | 학교/서비스 공지                     | 작성자 SET NULL                                      |
| admin_audit_logs                  | 관리자 작업·신고 조회 기록           | 계정 삭제 시 actor SET NULL                          |
| rate_limits                       | 사용자별 요청 버킷                   | 사용자 CASCADE, 버킷별 단일 행 재사용                |
| user_blocks                       | 향후 차단 기능을 위한 비공개 구조    | UI/API 미구현                                        |
| neis_cache                        | 향후 공유 캐시를 위한 비공개 구조    | 현 버전은 Edge 메모리 캐시 사용                      |

`student_verifications`는 최신 사용자 결정에 따라 만들지 않는다. `school_events`는 중복 저장하지 않고 NEIS에서 조회한다.

관계: Auth user → profile/role → posts → comments/likes/views/polls. Poll vote는 `(post_id, option_id)` FK로 다른 투표의 선택지를 사용할 수 없다. 댓글의 같은 글·부모 깊이 확인은 RPC에서 수행한다. 익명 번호 충돌은 글 행 잠금과 unique(post_id,label)로 방지한다.

인덱스: 게시판+작성일, 작성자 FK, 댓글 글+시간/부모, 공감·투표 사용자 FK, 알림 사용자+시간, 신고 상태+시간, 수행평가 학년+기한, 관리자 actor. 본문 검색은 부분 문자열 전체 검사로, 대규모 운영 전 pg_trgm 적용과 EXPLAIN 검증이 필요하다.

제약조건: 닉네임 2~20자·중복 거절·HTML 불허, 제목 2~120자, 글 본문 1~20000자, 댓글 1~2000자, 투표 2~6항목(항목 1~100자), 학년 1~3, 신고 사유 2~1000자. 역할/신고 상태는 허용값을 제한한다.

마이그레이션은 CLI `supabase migration new schoolpot_v1`로 생성했다. 새 빈 대상 또는 기존 구조를 검토한 대상에 한 번만 적용한다. 이미 적용한 SQL은 다시 편집/실행하지 않고 후속 마이그레이션을 만든다.

## 아이디 계정 확장

account_handles는 사용자 UUID·고유 아이디·복구 코드 해시를 비공개로 저장하고 탈퇴 시 CASCADE 삭제한다. account_attempts는 가입/복구의 IP 해시·아이디·전역 카운터이며 7일 이상 된 버킷을 정리한다. 두 테이블도 RLS와 직접 접근 권한 회수를 적용한다.

초기 스키마, username_accounts, account_provisioning의 마이그레이션 3개를 실제 프로젝트에 적용했다. account_provisioning은 Auth 생성 후 메타데이터 저장 시점 차이를 처리한다. 서버만 보호된 계정 유형과 내부 식별자를 확인해 매핑·프로필·해시를 등록한다. 이메일 인증은 가입 조건이 아니며, 현재 세션과 등록된 아이디 계정은 매 RPC에서 확인한다.
