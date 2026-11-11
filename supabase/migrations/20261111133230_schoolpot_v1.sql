-- Source reference only. The generated migration is the deployment artifact.
-- Private relations are intentionally unavailable to the Data API, including authorship.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
create table private.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 nickname text not null check(char_length(nickname) between 2 and 20 and nickname ~ '^[[:alnum:]가-힣_ ]+$'),
 grade smallint check(grade between 1 and 3), suspended_until timestamptz,
 notifications_enabled boolean not null default true, created_at timestamptz not null default now()
);
create unique index profiles_nickname_unique on private.profiles(lower(nickname));
create table private.user_roles(user_id uuid primary key references auth.users(id) on delete cascade, role text not null check(role in ('admin','moderator')));
create table private.boards(id text primary key, name text not null, anonymous boolean not null default false);
insert into private.boards values ('free','자유게시판',false),('anonymous','익명게시판',true),('questions','질문게시판',false),('study','공부게시판',false),('lost','분실물게시판',false),('clubs','동아리게시판',false),('polls','투표게시판',false);
create table private.posts (
 id uuid primary key default gen_random_uuid(), board_id text not null references private.boards(id),
 author_id uuid references auth.users(id) on delete set null,
 title text not null check(char_length(btrim(title)) between 2 and 120),
 body text not null check(char_length(btrim(body)) between 1 and 20000),
 anonymous boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index posts_board_created on private.posts(board_id,created_at desc);
create index posts_author on private.posts(author_id);
create table private.comments (
 id uuid primary key default gen_random_uuid(), post_id uuid not null references private.posts(id) on delete cascade,
 parent_id uuid references private.comments(id) on delete cascade, author_id uuid references auth.users(id) on delete set null,
 body text not null check(char_length(btrim(body)) between 1 and 2000), anonymous boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index comments_post on private.comments(post_id,created_at);
create index comments_author on private.comments(author_id);
create index comments_parent on private.comments(parent_id);
create table private.anonymous_labels(post_id uuid references private.posts(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade, label integer not null, primary key(post_id,user_id),unique(post_id,label));
create table private.post_likes(post_id uuid references private.posts(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,primary key(post_id,user_id));
create index post_likes_user on private.post_likes(user_id);
create table private.comment_likes(comment_id uuid references private.comments(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,primary key(comment_id,user_id));
create index comment_likes_user on private.comment_likes(user_id);
create table private.post_views(post_id uuid references private.posts(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,viewed_on date default ((now() at time zone 'Asia/Seoul')::date), primary key(post_id,user_id,viewed_on));
create index post_views_user on private.post_views(user_id);
create table private.polls(post_id uuid primary key references private.posts(id) on delete cascade,closes_at timestamptz);
create table private.poll_options(id uuid primary key default gen_random_uuid(),post_id uuid not null references private.polls(post_id) on delete cascade,label text not null check(char_length(btrim(label)) between 1 and 100),position smallint not null,unique(post_id,id));
create index poll_options_post on private.poll_options(post_id);
create table private.poll_votes(post_id uuid references private.polls(post_id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,option_id uuid not null,primary key(post_id,user_id),foreign key(post_id,option_id) references private.poll_options(post_id,id) on delete cascade);
create index poll_votes_option on private.poll_votes(post_id,option_id);
create index poll_votes_user on private.poll_votes(user_id);
create table private.notifications(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,post_id uuid references private.posts(id) on delete cascade,message text not null,read_at timestamptz,created_at timestamptz not null default now());
create index notifications_user_created on private.notifications(user_id,created_at desc);
create index notifications_post on private.notifications(post_id);
create table private.reports(id uuid primary key default gen_random_uuid(),reporter_id uuid references auth.users(id) on delete set null,post_id uuid references private.posts(id) on delete set null,comment_id uuid references private.comments(id) on delete set null,reason text not null check(char_length(reason) between 2 and 1000),status text not null default 'pending' check(status in ('pending','resolved','dismissed')),created_at timestamptz not null default now());
create index reports_status_created on private.reports(status,created_at);
create index reports_reporter on private.reports(reporter_id);
create index reports_post on private.reports(post_id);
create index reports_comment on private.reports(comment_id);
create table private.performance_assessments(id uuid primary key default gen_random_uuid(),author_id uuid references auth.users(id) on delete set null,title text not null check(char_length(title) between 2 and 120),subject text not null check(char_length(subject) between 1 and 40),grade smallint not null check(grade between 1 and 3),due_date date not null,body text not null default '' check(char_length(body)<=2000),created_at timestamptz not null default now());
create index assessments_grade_date on private.performance_assessments(grade,due_date);
create index assessments_author on private.performance_assessments(author_id);
create table private.assessment_reports(id uuid primary key default gen_random_uuid(),assessment_id uuid not null references private.performance_assessments(id) on delete cascade,reporter_id uuid references auth.users(id) on delete set null,reason text not null check(char_length(reason) between 2 and 1000),status text not null default 'pending' check(status in ('pending','resolved','dismissed')),created_at timestamptz not null default now());
create index assessment_reports_assessment on private.assessment_reports(assessment_id);
create index assessment_reports_reporter on private.assessment_reports(reporter_id);
create table private.notices(id uuid primary key default gen_random_uuid(),author_id uuid references auth.users(id) on delete set null,title text not null check(char_length(title) between 2 and 120),body text not null check(char_length(body) between 1 and 20000),created_at timestamptz not null default now());
create index notices_created on private.notices(created_at desc);
create index notices_author on private.notices(author_id);
create table private.user_blocks(user_id uuid references auth.users(id) on delete cascade,blocked_id uuid references auth.users(id) on delete cascade,primary key(user_id,blocked_id),check(user_id<>blocked_id));
create index blocks_blocked on private.user_blocks(blocked_id);
create table private.admin_audit_logs(id bigint generated always as identity primary key,actor_id uuid references auth.users(id) on delete set null,action text not null,target_id uuid,created_at timestamptz not null default now());
create index audit_actor on private.admin_audit_logs(actor_id);
create table private.rate_limits(user_id uuid references auth.users(id) on delete cascade,bucket text not null,window_start timestamptz not null,hits integer not null,primary key(user_id,bucket));
create table private.neis_cache(kind text not null,day text not null,payload jsonb not null,expires_at timestamptz not null,primary key(kind,day));

-- All relations deny direct client access. No permissive policies are installed.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='private' loop
  execute format('alter table private.%I enable row level security',t.tablename);
  execute format('revoke all on private.%I from public,anon,authenticated',t.tablename);
 end loop;
end $$;

create function private.consume_rate(u uuid,b text,max_hits integer,seconds integer) returns void
language plpgsql set search_path='' as $$
declare n integer; begin
 insert into private.rate_limits values(u,b,clock_timestamp(),1)
 on conflict(user_id,bucket) do update set
 hits=case when private.rate_limits.window_start < clock_timestamp()-make_interval(secs=>seconds) then 1 else private.rate_limits.hits+1 end,
 window_start=case when private.rate_limits.window_start < clock_timestamp()-make_interval(secs=>seconds) then clock_timestamp() else private.rate_limits.window_start end
 returning hits into n;
 if n>max_hits then raise exception 'RATE_LIMIT';end if;
end $$;

-- Projection deliberately never returns author_id, email, auth metadata, or stable anonymous IDs.
create function private.post_json(p private.posts,u uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'board_id',p.board_id,'title',p.title,'body',p.body,'anonymous',p.anonymous,
 'author',case when p.anonymous then '익명' else coalesce((select nickname from private.profiles where id=p.author_id),'탈퇴한 사용자') end,
 'is_mine',p.author_id=u,'created_at',p.created_at,'updated_at',p.updated_at,
 'likes',(select count(*) from private.post_likes where post_id=p.id),
 'liked',exists(select 1 from private.post_likes where post_id=p.id and user_id=u),
 'comments',(select count(*) from private.comments where post_id=p.id),
 'views',(select count(*) from private.post_views where post_id=p.id))
$$;

create function private.community(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); is_admin boolean; v_id uuid; v_parent uuid; v_post private.posts; v_comment private.comments;
 result jsonb; v_profile private.profiles; v_board text; v_label integer; v_target uuid; v_title text; v_body text;
begin
 if u is null or not exists(select 1 from auth.users where id=u and deleted_at is null and not coalesce(is_anonymous,false)) then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from auth.sessions where id=nullif(auth.jwt()->>'session_id','')::uuid and user_id=u) then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from auth.users where id=u and email_confirmed_at is not null) then raise exception 'EMAIL_REQUIRED';end if;
 if p_action not in ('me','delete_account_access') and exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 is_admin:=exists(select 1 from private.user_roles where user_id=u and role in ('admin','moderator'));
 if pg_column_size(p_payload)>60000 or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_INPUT';end if;
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
   where (coalesce(p_payload->>'board','')='' or p.board_id=p_payload->>'board')
   and (coalesce(p_payload->>'query','')='' or position(lower(left(p_payload->>'query',120)) in lower(p.title||' '||p.body))>0)
   and (coalesce(p_payload->>'period','') not in ('day','week') or p.created_at>now()-case when p_payload->>'period'='day' then interval '1 day' else interval '7 days' end)
   order by case when p_payload->>'sort'='popular' then (select count(*) from private.post_likes where post_id=p.id) else 0 end desc,p.created_at desc,p.id
   limit 20 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000)
  ) s),'[]'::jsonb);
 elsif p_action='get_post' then
  select * into v_post from private.posts where id=(p_payload->>'id')::uuid;
  if not found then raise exception 'NOT_FOUND';end if;
  insert into private.post_views(post_id,user_id) values(v_post.id,u) on conflict do nothing;
  result:=private.post_json(v_post,u);
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
  v_board:=p_payload->>'board';v_title:=btrim(p_payload->>'title');v_body:=btrim(p_payload->>'body');
  if v_id is null then
   insert into private.posts(board_id,author_id,title,body,anonymous) values(v_board,u,v_title,v_body,v_board='anonymous' or coalesce((p_payload->>'anonymous')::boolean,false)) returning id into v_id;
   if v_board='polls' then
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
   update private.comments set body=btrim(p_payload->>'body'),updated_at=now() where id=v_id;
  else
   select * into v_post from private.posts where id=(p_payload->>'post_id')::uuid for update;
   if not found then raise exception 'NOT_FOUND';end if;
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
  if p_payload->>'kind'='post' then
   if (p_payload->>'liked')::boolean then insert into private.post_likes values(v_id,u) on conflict do nothing;else delete from private.post_likes where post_id=v_id and user_id=u;end if;
  elsif p_payload->>'kind'='comment' then
   if (p_payload->>'liked')::boolean then insert into private.comment_likes values(v_id,u) on conflict do nothing;else delete from private.comment_likes where comment_id=v_id and user_id=u;end if;
  else raise exception 'INVALID_INPUT';end if;
  return jsonb_build_object('ok',true);
 elsif p_action='vote' then
  v_id:=(p_payload->>'post_id')::uuid;
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
  return jsonb_build_object('members',(select count(*) from private.profiles),'posts',(select count(*) from private.posts),'comments',(select count(*) from private.comments),'reports',(select count(*) from private.reports where status='pending'));
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

-- The exposed wrapper has invoker security; only the private, audited dispatcher elevates.
create function public.community(p_action text,p_payload jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select private.community(p_action,p_payload)$$;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.community(text,jsonb) to authenticated;
revoke all on function public.community(text,jsonb) from public,anon;
grant execute on function public.community(text,jsonb) to authenticated;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema private revoke all on tables from public,anon,authenticated;
