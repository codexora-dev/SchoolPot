# 게시글은 어디에 저장되나요?

프로젝트 hlglstdtgcodblynicmh의 PostgreSQL에 영구 저장됩니다. 기본 public 스키마에는 커뮤니티 테이블을 만들지 않았습니다. 데이터 테이블 24개는 private 스키마에 있습니다.

| 데이터                         | 저장 위치                   |
| ------------------------------ | --------------------------- |
| 게시글                         | private.posts               |
| 댓글·답글                      | private.comments            |
| 닉네임·학년·알림 설정          | private.profiles            |
| 아이디 매핑·복구 코드 해시     | private.account_handles     |
| 투표·공감·알림·신고            | private 안의 해당 테이블    |
| 로그인 계정·비밀번호 해시·세션 | Supabase Auth의 auth 스키마 |
| 게시 전 임시 저장              | 사용자 기기의 localStorage  |

Supabase Table Editor에서 스키마를 public 대신 private로 선택하세요. SQL Editor에서 다음 쿼리로 저장 상태를 확인할 수도 있습니다.

```sql
select count(*) from private.posts;
select id, board_id, title, created_at
from private.posts order by created_at desc limit 20;
```

브라우저의 글쓰기 → public.community RPC → 로그인·세션·등록 계정·소유권 검사 → private.posts 저장 순서입니다. 새로고침하거나 다른 기기로 로그인해도 게시된 글은 DB에서 다시 읽습니다. 익명 글의 실제 작성자 ID는 일반 사용자에게 반환하지 않습니다.

private를 Data API의 Exposed schemas에 추가하거나 일반 클라이언트에 테이블 조회 권한을 부여할 필요는 없습니다. 관리자 Dashboard의 조회와 일반 사용자의 접근 권한은 별개입니다.

방문 안내 팝업은 private.site_popups에 저장합니다. 게시 중인 팝업만 별도 공개 RPC로 반환하며 실제 작성자 정보는 포함하지 않습니다.
