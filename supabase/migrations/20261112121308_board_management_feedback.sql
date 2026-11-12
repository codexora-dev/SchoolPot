alter table private.boards
 add column description text not null default '' check(char_length(description)<=160),
 add column position integer not null default 100 check(position between 0 and 999),
 add column kind text not null default 'general' check(kind in ('general','anonymous','poll')),
 add column is_active boolean not null default true,
 add column can_post boolean not null default true,
 add column revision integer not null default 1 check(revision>0),
 add constraint board_name_length check(char_length(btrim(name)) between 2 and 40);
update private.boards set kind=case when anonymous then 'anonymous' when id='polls' then 'poll' else 'general' end;
alter table private.boards add constraint board_anonymity check(anonymous=(kind='anonymous')),
 add constraint board_visibility check(is_active or not can_post);
update private.boards b set description=s.description,position=s.position from (values
 ('free','소소한 일상부터 학교 이야기까지',10),('anonymous','이름 없이, 조금 더 솔직하게',20),
 ('questions','궁금한 건 함께 풀어요',30),('study','우리의 공부가 쌓이는 곳',40),
 ('lost','잃어버린 물건, 함께 찾아요',50),('clubs','좋아하는 것을 함께하는 친구들',60),
 ('polls','우리의 생각을 모아봐요',70)) s(id,description,position) where b.id=s.id;

-- Public metadata only. Hidden boards and community content never enter this projection.
create function private.board_catalog() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(b) order by position,id),'[]'::jsonb) from private.boards b where is_active
$$;
create function public.board_catalog() returns jsonb language sql security invoker set search_path='' as $$select private.board_catalog()$$;
revoke all on function private.board_catalog(),public.board_catalog() from public;
grant execute on function private.board_catalog(),public.board_catalog() to anon,authenticated;

create function private.manage_boards(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); me jsonb; b private.boards; v_id text; v_kind text;
begin
 me:=private.community('me','{}');
 if (me->>'is_admin')::boolean is distinct from true then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>4000 then raise exception 'INVALID_INPUT';end if;
 if p_action='list' then
  return coalesce((select jsonb_agg(to_jsonb(item)||jsonb_build_object('posts',(select count(*) from private.posts where board_id=item.id)) order by position,id) from private.boards item),'[]'::jsonb);
 end if;
 if p_action not in ('create','save','delete') then raise exception 'INVALID_INPUT';end if;
 perform private.consume_rate(u,'board_writes',30,600);
 perform pg_advisory_xact_lock(8407,1002);
 v_id:=p_payload->>'id';
 if p_action<>'create' then
  select * into b from private.boards where id=v_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if b.revision is distinct from (p_payload->>'revision')::int then raise exception 'STALE_BOARD';end if;
 end if;
 if p_action='delete' then
  if exists(select 1 from private.posts where board_id=v_id) then raise exception 'BOARD_HAS_POSTS';end if;
  delete from private.boards where id=v_id;
 elsif p_action='create' then
  if v_id is null or v_id !~ '^[a-z][a-z0-9-]{2,31}$' or (select count(*) from private.boards)>=50 then raise exception 'INVALID_INPUT';end if;
  v_kind:=p_payload->>'kind';
  insert into private.boards(id,name,description,position,kind,anonymous,is_active,can_post)
  values(v_id,btrim(p_payload->>'name'),btrim(p_payload->>'description'),(p_payload->>'position')::int,v_kind,v_kind='anonymous',
   (p_payload->>'is_active')::boolean,(p_payload->>'can_post')::boolean);
 else
  -- IDs and board kinds are immutable: renaming cannot reveal anonymous authors.
  update private.boards set name=btrim(p_payload->>'name'),description=btrim(p_payload->>'description'),
   position=(p_payload->>'position')::int,is_active=(p_payload->>'is_active')::boolean,can_post=(p_payload->>'can_post')::boolean,
   revision=revision+1 where id=v_id;
 end if;
 insert into private.admin_audit_logs(actor_id,action) values(u,'board_'||p_action||':'||v_id);
 return jsonb_build_object('ok',true,'id',v_id);
end $$;
create function public.manage_boards(p_action text,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.manage_boards(p_action,p_payload)$$;
revoke all on function private.manage_boards(text,jsonb),public.manage_boards(text,jsonb) from public,anon;
grant execute on function private.manage_boards(text,jsonb),public.manage_boards(text,jsonb) to authenticated;

create table private.feedback (
 id uuid primary key default gen_random_uuid(),
 author_id uuid references auth.users(id) on delete set null,
 kind text not null check(kind in ('suggestion','bug','other')),
 title text not null check(char_length(btrim(title)) between 2 and 120),
 body text not null check(char_length(btrim(body)) between 1 and 8000),
 status text not null default 'new' check(status in ('new','reviewing','resolved','closed')),
 admin_reply text not null default '' check(char_length(admin_reply)<=4000),
 revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index feedback_author_created on private.feedback(author_id,created_at desc,id);
create index feedback_status_created on private.feedback(status,created_at desc,id);
alter table private.feedback enable row level security;
revoke all on private.feedback from public,anon,authenticated;
alter table private.notifications add column feedback_id uuid references private.feedback(id) on delete set null;
create index notifications_feedback on private.notifications(feedback_id);

create function private.feedback(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); me jsonb; f private.feedback; v_id uuid; v_reply text; v_status text; result jsonb;
begin
 me:=private.community('me','{}');
 if exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 if me->'profile'='null'::jsonb then raise exception 'PROFILE_REQUIRED';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>40000 then raise exception 'INVALID_INPUT';end if;
 if p_action like 'admin_%' and (me->>'is_admin')::boolean is distinct from true then raise exception 'FORBIDDEN';end if;
 if p_action='create' then
  perform private.consume_rate(u,'feedback_create',5,3600);
  insert into private.feedback(author_id,kind,title,body) values(u,p_payload->>'kind',btrim(p_payload->>'title'),btrim(p_payload->>'body')) returning id into v_id;
  return jsonb_build_object('id',v_id);
 elsif p_action in ('mine','admin_list') then
  if p_action='admin_list' then insert into private.admin_audit_logs(actor_id,action) values(u,'feedback_read');end if;
  select coalesce(jsonb_agg((to_jsonb(t)-'author_id')||case when p_action='admin_list' then jsonb_build_object('nickname',(select nickname from private.profiles where id=t.author_id)) else '{}'::jsonb end order by created_at desc,id),'[]'::jsonb) into result
  from(select * from private.feedback where (p_action='admin_list' or author_id=u)
   and (coalesce(p_payload->>'status','')='' or status=p_payload->>'status')
   and (coalesce(p_payload->>'kind','')='' or kind=p_payload->>'kind')
   order by created_at desc,id limit 20 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000)) t;
  return result;
 elsif p_action='admin_update' then
  perform private.consume_rate(u,'feedback_update',60,600);
  v_id:=(p_payload->>'id')::uuid;
  select * into f from private.feedback where id=v_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if f.revision is distinct from (p_payload->>'revision')::int then raise exception 'STALE_FEEDBACK';end if;
  v_reply:=btrim(coalesce(p_payload->>'admin_reply',''));v_status:=p_payload->>'status';
  if v_status is null then raise exception 'INVALID_INPUT';end if;
  update private.feedback set admin_reply=v_reply,status=v_status,revision=revision+1,updated_at=now() where id=v_id;
  if row(f.admin_reply,f.status) is distinct from row(v_reply,v_status) then
   insert into private.notifications(user_id,message,feedback_id)
    select id,'내 건의·오류 제보에 답변 또는 처리 상태 변경이 있어요.',v_id from private.profiles where id=f.author_id and notifications_enabled;
  end if;
  insert into private.admin_audit_logs(actor_id,action,target_id) values(u,'feedback_update',v_id);
  return jsonb_build_object('ok',true);
 else raise exception 'INVALID_INPUT';end if;
end $$;
create function public.feedback(p_action text,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.feedback(p_action,p_payload)$$;
revoke all on function private.feedback(text,jsonb),public.feedback(text,jsonb) from public,anon;
grant execute on function private.feedback(text,jsonb),public.feedback(text,jsonb) to authenticated;

-- A shared row lock serializes writes against administrator state changes.
create function private.check_board_write(p_board text,p_admin boolean) returns text language plpgsql security definer set search_path='' as $$
declare b private.boards;begin
 select * into b from private.boards where id=p_board for share;
 if not found then raise exception 'NOT_FOUND';end if;
 if not p_admin and (not b.is_active or not b.can_post) then raise exception 'BOARD_CLOSED';end if;
 return b.kind;end $$;
revoke all on function private.check_board_write(text,boolean) from public,anon,authenticated;

create or replace function private.community(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); is_admin boolean; v_id uuid; v_parent uuid; v_post private.posts; v_comment private.comments;
 result jsonb; v_profile private.profiles; v_board text; v_kind text; v_label integer; v_target uuid; v_title text; v_body text;
begin
 if u is null or not exists(select 1 from auth.users where id=u and deleted_at is null and not coalesce(is_anonymous,false)) then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from auth.sessions where id=nullif(auth.jwt()->>'session_id','')::uuid and user_id=u) then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from private.account_handles where user_id=u) then raise exception 'ACCOUNT_REQUIRED';end if;
 if p_action not in ('me','delete_account_access') and exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 is_admin:=exists(select 1 from private.user_roles where user_id=u and role in ('admin','moderator'));
 if p_payload is null or pg_column_size(p_payload)>60000 or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_INPUT';end if;
 perform private.consume_rate(u,'requests',180,60);
 if p_action='neis_access' then perform private.consume_rate(u,'neis',30,60);return '{"ok":true}'::jsonb;end if;
 if p_action='delete_account_access' then perform private.consume_rate(u,'delete_account',5,3600);return '{"ok":true}'::jsonb;end if;
 select * into v_profile from private.profiles where id=u;
 if p_action='me' then
  return jsonb_build_object('profile',case when v_profile.id is null then null else jsonb_build_object('nickname',v_profile.nickname,'grade',v_profile.grade,'notifications_enabled',v_profile.notifications_enabled) end,'is_admin',is_admin);
 elsif p_action='save_profile' then
  insert into private.profiles(id,nickname,grade,notifications_enabled)
  values(u,btrim(p_payload->>'nickname'),nullif(p_payload->>'grade','')::smallint,coalesce((p_payload->>'notifications_enabled')::boolean,true))
  on conflict(id) do update set nickname=excluded.nickname,grade=excluded.grade,notifications_enabled=excluded.notifications_enabled;
  return jsonb_build_object('ok',true);
 end if;
 if v_profile.id is null then raise exception 'INVALID_INPUT: profile required';end if;
 if p_action like 'admin_%' and not is_admin then raise exception 'FORBIDDEN';end if;
 if p_action='list_posts' then
  return coalesce((select jsonb_agg(item) from (
   select private.post_json(p,u) item from private.posts p
   where exists(select 1 from private.boards b where b.id=p.board_id and (b.is_active or is_admin)) and (coalesce(p_payload->>'board','')='' or p.board_id=p_payload->>'board')
   and (coalesce(p_payload->>'query','')='' or position(lower(left(p_payload->>'query',120)) in lower(p.title||' '||p.body))>0)
   and (coalesce(p_payload->>'period','') not in ('day','week') or p.created_at>now()-case when p_payload->>'period'='day' then interval '1 day' else interval '7 days' end)
   order by case when p_payload->>'sort'='popular' then (select count(*) from private.post_likes where post_id=p.id) else 0 end desc,p.created_at desc,p.id
   limit 20 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000)
  ) s),'[]'::jsonb);
 elsif p_action='get_post' then
  select * into v_post from private.posts where id=(p_payload->>'id')::uuid;
  if not found then raise exception 'NOT_FOUND';end if;
  if not is_admin and v_post.author_id is distinct from u and not exists(select 1 from private.boards where id=v_post.board_id and is_active) then raise exception 'NOT_FOUND';end if;
  insert into private.post_views(post_id,user_id) values(v_post.id,u) on conflict do nothing;
  result:=private.post_json(v_post,u)||jsonb_build_object('can_interact',is_admin or exists(select 1 from private.boards where id=v_post.board_id and is_active and can_post),'board_name',(select name from private.boards where id=v_post.board_id));
  result:=result||jsonb_build_object('replies',coalesce((select jsonb_agg(jsonb_build_object(
   'id',c.id,'parent_id',c.parent_id,'body',c.body,'is_mine',c.author_id=u,'anonymous',c.anonymous,
   'author',case when c.anonymous then case when c.author_id=v_post.author_id then '익명 · 글쓴이' else '익명 '||coalesce((select label::text from private.anonymous_labels where post_id=v_post.id and user_id=c.author_id),'알 수 없음') end else coalesce((select nickname from private.profiles where id=c.author_id),'탈퇴한 사용자') end,
   'created_at',c.created_at,'updated_at',c.updated_at,'likes',(select count(*) from private.comment_likes where comment_id=c.id),
   'liked',exists(select 1 from private.comment_likes where comment_id=c.id and user_id=u)) order by c.created_at,c.id) from (select * from private.comments where post_id=v_post.id order by created_at,id limit 50 offset least(greatest(coalesce((p_payload->>'comments_offset')::int,0),0),10000)) c),'[]'::jsonb));
  if exists(select 1 from private.polls where post_id=v_post.id) then
   result:=result||jsonb_build_object('poll',jsonb_build_object('closes_at',(select closes_at from private.polls where post_id=v_post.id),'voted',exists(select 1 from private.poll_votes where post_id=v_post.id and user_id=u),'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'votes',(select count(*) from private.poll_votes where option_id=o.id)) order by o.position) from private.poll_options o where o.post_id=v_post.id),'[]'::jsonb)));
  end if;
  return result;
 elsif p_action in ('save_post','delete_post') then
  perform private.consume_rate(u,'posts',10,600);
  v_id:=nullif(p_payload->>'id','')::uuid;
  if v_id is not null then
   select * into v_post from private.posts where id=v_id for update;
   if not found then raise exception 'NOT_FOUND';end if;
   if v_post.author_id is distinct from u then raise exception 'FORBIDDEN';end if;
  end if;
  if p_action='delete_post' then
   if v_id is null then raise exception 'INVALID_INPUT';end if;
   delete from private.posts where id=v_id;return jsonb_build_object('ok',true);
  end if;
  v_board:=coalesce(v_post.board_id,p_payload->>'board');
  v_kind:=private.check_board_write(v_board,is_admin);v_title:=btrim(p_payload->>'title');v_body:=btrim(p_payload->>'body');
  if v_id is null then
   insert into private.posts(board_id,author_id,title,body,anonymous) values(v_board,u,v_title,v_body,v_kind='anonymous' or coalesce((p_payload->>'anonymous')::boolean,false)) returning id into v_id;
   if v_kind='poll' then
    if jsonb_typeof(p_payload->'options') is distinct from 'array' or coalesce(jsonb_array_length(p_payload->'options'),0) not between 2 and 6 then raise exception 'INVALID_INPUT';end if;
    insert into private.polls(post_id) values(v_id);
    insert into private.poll_options(post_id,label,position) select v_id,btrim(value),ordinality from jsonb_array_elements_text(p_payload->'options') with ordinality;
   end if;
  else
   update private.posts set title=v_title,body=v_body,updated_at=now() where id=v_id;
  end if;
  return jsonb_build_object('id',v_id);
 elsif p_action='save_comment' then
  perform private.consume_rate(u,'comments',30,600);
  v_id:=nullif(p_payload->>'id','')::uuid;
  if v_id is not null then
   select * into v_comment from private.comments where id=v_id for update;
   if not found then raise exception 'NOT_FOUND';end if;
   if v_comment.author_id is distinct from u then raise exception 'FORBIDDEN';end if;
   perform private.check_board_write((select board_id from private.posts where id=v_comment.post_id),is_admin);
   update private.comments set body=btrim(p_payload->>'body'),updated_at=now() where id=v_id;
  else
   select * into v_post from private.posts where id=(p_payload->>'post_id')::uuid for update;
   if not found then raise exception 'NOT_FOUND';end if;
   perform private.check_board_write(v_post.board_id,is_admin);
   v_parent:=nullif(p_payload->>'parent_id','')::uuid;
   if v_parent is not null and not exists(select 1 from private.comments where id=v_parent and post_id=v_post.id and parent_id is null) then raise exception 'INVALID_INPUT';end if;
   insert into private.anonymous_labels values(v_post.id,u,coalesce((select max(label)+1 from private.anonymous_labels where post_id=v_post.id),1)) on conflict(post_id,user_id) do nothing;
   insert into private.comments(post_id,parent_id,author_id,body,anonymous) values(v_post.id,v_parent,u,btrim(p_payload->>'body'),v_post.anonymous or coalesce((p_payload->>'anonymous')::boolean,false)) returning id into v_id;
   insert into private.notifications(user_id,post_id,message)
    select id,v_post.id,case when id=v_post.author_id then '내 게시글에 새 댓글이 달렸어요.' else '내 댓글에 새 답글이 달렸어요.' end
    from private.profiles where id in (v_post.author_id,(select author_id from private.comments where id=v_parent)) and id<>u and notifications_enabled;
  end if;
  return jsonb_build_object('id',v_id);
 elsif p_action='delete_comment' then
  v_id:=(p_payload->>'id')::uuid;
  if not exists(select 1 from private.comments where id=v_id and author_id=u) then raise exception 'FORBIDDEN';end if;
  delete from private.comments where id=v_id;return jsonb_build_object('ok',true);
 elsif p_action='like' then
  perform private.consume_rate(u,'likes',60,60);v_id:=(p_payload->>'id')::uuid;
  perform private.check_board_write((select board_id from private.posts where id=case when p_payload->>'kind'='post' then v_id else (select post_id from private.comments where id=v_id) end),is_admin);
  if p_payload->>'kind'='post' then
   if (p_payload->>'liked')::boolean then insert into private.post_likes values(v_id,u) on conflict do nothing;else delete from private.post_likes where post_id=v_id and user_id=u;end if;
  elsif p_payload->>'kind'='comment' then
   if (p_payload->>'liked')::boolean then insert into private.comment_likes values(v_id,u) on conflict do nothing;else delete from private.comment_likes where comment_id=v_id and user_id=u;end if;
  else raise exception 'INVALID_INPUT';end if;
  return jsonb_build_object('ok',true);
 elsif p_action='vote' then
  v_id:=(p_payload->>'post_id')::uuid;
  perform private.check_board_write((select board_id from private.posts where id=v_id),is_admin);
  if not exists(select 1 from private.polls where post_id=v_id and (closes_at is null or closes_at>now())) then raise exception 'FORBIDDEN';end if;
  if exists(select 1 from private.poll_votes where post_id=v_id and user_id=u) then raise exception 'ALREADY_VOTED';end if;
  insert into private.poll_votes values(v_id,u,(p_payload->>'option_id')::uuid);return jsonb_build_object('ok',true);
 elsif p_action='report' then
  perform private.consume_rate(u,'reports',10,3600);
  if p_payload->>'kind'='comment' then insert into private.reports(reporter_id,comment_id,reason) values(u,(p_payload->>'id')::uuid,btrim(p_payload->>'reason'));
  elsif p_payload->>'kind'='post' then insert into private.reports(reporter_id,post_id,reason) values(u,(p_payload->>'id')::uuid,btrim(p_payload->>'reason'));
  else raise exception 'INVALID_INPUT';end if;
  return jsonb_build_object('ok',true);
 elsif p_action='notifications' then
  return coalesce((select jsonb_agg(to_jsonb(n)-'user_id' order by n.created_at desc) from(select * from private.notifications where user_id=u order by created_at desc limit 100)n),'[]'::jsonb);
 elsif p_action='read_notifications' then
  update private.notifications set read_at=now() where user_id=u and (p_payload->>'id' is null or id=(p_payload->>'id')::uuid);return jsonb_build_object('ok',true);
 elsif p_action='notices' then
  return coalesce((select jsonb_agg(to_jsonb(n)-'author_id' order by n.created_at desc) from (select * from private.notices order by created_at desc limit 50)n),'[]'::jsonb);
 elsif p_action='assessments' then
  return coalesce((select jsonb_agg((to_jsonb(a)-'author_id')||jsonb_build_object('is_mine',author_id=u) order by due_date) from (select * from private.performance_assessments where (coalesce(p_payload->>'grade','')='' or grade=(p_payload->>'grade')::smallint) and due_date between coalesce(nullif(p_payload->>'from','')::date,current_date-30) and coalesce(nullif(p_payload->>'to','')::date,current_date+90) order by due_date limit 200)a),'[]'::jsonb);
 elsif p_action='save_assessment' then
  perform private.consume_rate(u,'assessments',15,3600);v_id:=nullif(p_payload->>'id','')::uuid;
  if v_id is not null then
   if not exists(select 1 from private.performance_assessments where id=v_id and author_id=u) then raise exception 'FORBIDDEN';end if;
   update private.performance_assessments set title=btrim(p_payload->>'title'),subject=btrim(p_payload->>'subject'),grade=(p_payload->>'grade')::smallint,due_date=(p_payload->>'due_date')::date,body=coalesce(p_payload->>'body','') where id=v_id;
  else
   insert into private.performance_assessments(author_id,title,subject,grade,due_date,body) values(u,btrim(p_payload->>'title'),btrim(p_payload->>'subject'),(p_payload->>'grade')::smallint,(p_payload->>'due_date')::date,coalesce(p_payload->>'body','')) returning id into v_id;
  end if;return jsonb_build_object('id',v_id);
 elsif p_action='delete_assessment' then
  v_id:=(p_payload->>'id')::uuid;
  if not exists(select 1 from private.performance_assessments where id=v_id and author_id=u) then raise exception 'FORBIDDEN';end if;
  delete from private.performance_assessments where id=v_id;return jsonb_build_object('ok',true);
 elsif p_action='report_assessment' then
  perform private.consume_rate(u,'reports',10,3600);
  insert into private.assessment_reports(assessment_id,reporter_id,reason) values((p_payload->>'id')::uuid,u,btrim(p_payload->>'reason'));return jsonb_build_object('ok',true);
 elsif p_action='admin_stats' then
  return jsonb_build_object('members',(select count(*) from private.profiles),'posts',(select count(*) from private.posts),'comments',(select count(*) from private.comments),'reports',(select count(*) from private.reports where status='pending'),'feedback',(select count(*) from private.feedback where status in ('new','reviewing')));
 elsif p_action='admin_members' then
  return coalesce((select jsonb_agg(to_jsonb(p)) from(select id,nickname,grade,suspended_until,created_at from private.profiles where position(lower(coalesce(p_payload->>'query','')) in lower(nickname))>0 order by created_at desc limit 50)p),'[]'::jsonb);
 elsif p_action='admin_reports' then
  insert into private.admin_audit_logs(actor_id,action) values(u,'admin_reports_read');
  return jsonb_build_object('content',coalesce((select jsonb_agg((to_jsonb(r)-'reporter_id')||jsonb_build_object('subject_user_id',coalesce((select author_id from private.comments where id=r.comment_id),(select author_id from private.posts where id=r.post_id)),'context_post_id',coalesce(r.post_id,(select post_id from private.comments where id=r.comment_id)))) from(select * from private.reports order by created_at desc limit 100)r),'[]'::jsonb),'assessments',coalesce((select jsonb_agg(to_jsonb(r)-'reporter_id') from(select * from private.assessment_reports order by created_at desc limit 100)r),'[]'::jsonb));
 elsif p_action='admin_audit' then
  return coalesce((select jsonb_agg(to_jsonb(a)) from(select * from private.admin_audit_logs order by created_at desc limit 100)a),'[]'::jsonb);
 elsif p_action='admin_resolve' then
  v_id:=(p_payload->>'id')::uuid;
  if p_payload->>'status' not in ('resolved','dismissed') then raise exception 'INVALID_INPUT';end if;
  if p_payload->>'kind'='assessment' then update private.assessment_reports set status=p_payload->>'status' where id=v_id;else update private.reports set status=p_payload->>'status' where id=v_id;end if;
 elsif p_action='admin_suspend' then
  v_id:=(p_payload->>'id')::uuid;
  if exists(select 1 from private.user_roles where user_id=v_id) then raise exception 'FORBIDDEN';end if;
  update private.profiles set suspended_until=case when (p_payload->>'suspend')::boolean then now()+interval '7 days' else null end where id=v_id;
 elsif p_action='admin_delete' then
  v_id:=(p_payload->>'id')::uuid;
  if p_payload->>'kind'='post' then delete from private.posts where id=v_id;
  elsif p_payload->>'kind'='comment' then delete from private.comments where id=v_id;
  elsif p_payload->>'kind'='assessment' then delete from private.performance_assessments where id=v_id;
  elsif p_payload->>'kind'='notice' then delete from private.notices where id=v_id;
  else raise exception 'INVALID_INPUT';end if;
 elsif p_action='admin_notice' then
  insert into private.notices(author_id,title,body) values(u,btrim(p_payload->>'title'),btrim(p_payload->>'body')) returning id into v_id;
  insert into private.notifications(user_id,message) select id,'새 공지: '||left(p_payload->>'title',120) from private.profiles where notifications_enabled;
 else raise exception 'INVALID_INPUT: unknown action';
 end if;
 insert into private.admin_audit_logs(actor_id,action,target_id) values(u,p_action,v_id);
 return jsonb_build_object('ok',true,'id',v_id);
end $$;

