-- Production application requires the reviewed role mapping and deployment approval.
-- Existing records are preserved. Unknown administrator identities abort the migration.
do $$begin
 if (select count(*) from private.user_roles)>0 and (select count(*) from private.user_roles)<>2 then raise exception 'UNREVIEWED_ADMIN';end if;
 if exists(select 1 from private.user_roles r left join private.account_handles h on h.user_id=r.user_id where r.role<>'admin' or h.username is null or h.username not in ('kminjae803','yoonjihoo_0221')) then raise exception 'UNREVIEWED_ADMIN';end if;
end $$;
alter table private.user_roles drop constraint user_roles_role_check;
update private.user_roles r set role=case h.username when 'kminjae803' then 'owner' else 'moderator' end from private.account_handles h where h.user_id=r.user_id;
alter table private.user_roles add constraint user_roles_role_check check(role in ('owner','moderator'));
alter table private.user_roles add column assigned_at timestamptz not null default now(), add column assigned_by uuid references auth.users(id) on delete set null;
alter table private.profiles add column role_revision integer not null default 1, add column sanction_revision integer not null default 1;
alter table private.notices add column owner_only boolean not null default false;
update private.notices set owner_only=true,revision=revision+1;
alter table private.feedback add column sensitive boolean not null default true;
alter table private.reports add column resolution_reason text not null default '',add column revision integer not null default 1;
alter table private.notifications add column governance_kind text;

create function private.actor_role() returns text language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();begin
 if u is null or not exists(select 1 from auth.users where id=u and deleted_at is null and not coalesce(is_anonymous,false)) or not exists(select 1 from auth.sessions where id=nullif(auth.jwt()->>'session_id','')::uuid and user_id=u) then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from private.account_handles where user_id=u) then raise exception 'ACCOUNT_REQUIRED';end if;
 -- Serialize permission changes with in-flight protected requests.
 perform 1 from private.profiles where id=u for share;
 return coalesce((select role from private.user_roles where user_id=u),'member');
end $$;
revoke all on function private.actor_role() from public,anon,authenticated;

create function private.protect_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(7031321);
 if tg_table_schema='auth' then
  if (tg_op='DELETE' or new.deleted_at is not null) and exists(select 1 from private.user_roles where user_id=old.id and role='owner') then raise exception 'OWNER_TRANSFER_REQUIRED';end if;
 elsif old.role='owner' and (tg_op='DELETE' or new.role<>'owner') and (select count(*) from private.user_roles where role='owner')<=1 then raise exception 'LAST_OWNER';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
revoke all on function private.protect_owner() from public,anon,authenticated;
create trigger protect_last_owner before delete or update on private.user_roles for each row execute function private.protect_owner();
create trigger protect_owner_account before delete or update of deleted_at on auth.users for each row execute function private.protect_owner();

create table private.sanctions(
 id uuid primary key default gen_random_uuid(), target_id uuid not null references auth.users(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null, kind text not null check(kind in ('advice','warning','suspend','review','permanent')),
 reason text not null check(char_length(btrim(reason)) between 2 and 2000), rule text not null check(char_length(btrim(rule)) between 2 and 300),
 starts_at timestamptz not null default now(), ends_at timestamptz, revoked_at timestamptz, revoke_reason text,
 operation_id uuid not null unique, request_id uuid unique,
 check((kind in ('suspend','review') and ends_at>starts_at) or (kind not in ('suspend','review') and ends_at is null))
);
create index sanctions_target on private.sanctions(target_id,starts_at desc);
create table private.sanction_requests(
 id uuid primary key default gen_random_uuid(), target_id uuid not null references auth.users(id) on delete cascade,
 requester_id uuid not null references auth.users(id) on delete cascade, category text not null check(char_length(category) between 2 and 100),
 reason text not null check(char_length(btrim(reason)) between 2 and 2000), rule text not null check(char_length(btrim(rule)) between 2 and 300),
 proposed text not null check(proposed in ('advice','warning','1','3','7','range','30','review','permanent')), days integer check(days is null or days between 1 and 30),
 post_id uuid references private.posts(id) on delete set null, comment_id uuid references private.comments(id) on delete set null, report_id uuid references private.reports(id) on delete set null,
 status text not null default 'pending' check(status in ('pending','reviewing','needs_info','approved','rejected','cancelled')),
 revision integer not null default 1, handler_id uuid references auth.users(id) on delete set null, decision_reason text not null default '',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table private.sanctions add foreign key(request_id) references private.sanction_requests(id) on delete set null;
create index sanction_requests_requester on private.sanction_requests(requester_id,created_at desc);
create index sanction_requests_status on private.sanction_requests(status,created_at desc);
create table private.sanction_appeals(
 id uuid primary key default gen_random_uuid(), target_id uuid not null references auth.users(id) on delete cascade,
 sanction_id uuid not null references private.sanctions(id) on delete cascade,body text not null check(char_length(btrim(body)) between 2 and 4000),
 status text not null default 'new' check(status in ('new','reviewing','closed')), reply text not null default '' check(char_length(reply)<=4000),
 revision integer not null default 1,handler_id uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index appeals_one_open on private.sanction_appeals(target_id,sanction_id) where status<>'closed';
create index appeals_created on private.sanction_appeals(created_at desc);
create table private.role_history(
 id uuid primary key default gen_random_uuid(),target_id uuid references auth.users(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,previous_role text not null,next_role text not null,
 reason text not null,created_at timestamptz not null default now()
);
insert into private.role_history(target_id,previous_role,next_role,reason) select user_id,'admin',role,'사용자가 지정한 관리자 역할 이관' from private.user_roles;
insert into private.admin_audit_logs(action,target_id,details) select 'role_migration',user_id,jsonb_build_object('previous_role','admin','next_role',role,'reason','사용자가 지정한 관리자 역할 이관') from private.user_roles;
create index role_history_target on private.role_history(target_id,created_at desc);
alter table private.sanctions enable row level security;
alter table private.sanction_requests enable row level security;
alter table private.sanction_appeals enable row level security;
alter table private.role_history enable row level security;
revoke all on private.sanctions,private.sanction_requests,private.sanction_appeals,private.role_history from public,anon,authenticated;
-- Preserve the existing restriction, without inventing a violation or an actor.
insert into private.sanctions(target_id,kind,reason,rule,ends_at,operation_id)
 select id,case when suspended_until='infinity' then 'permanent' else 'suspend' end,'기존 이용 제한 · 상세 사유는 관리자에게 확인해 주세요.','기존 운영 기록',case when suspended_until='infinity' then null else suspended_until end,gen_random_uuid() from private.profiles where suspended_until>now();

create function private.apply_sanction(p jsonb,request uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); target uuid:=(p->>'target_id')::uuid; level text:=p->>'level'; k text; days integer; until_at timestamptz; sid uuid; previous timestamptz;begin
 if private.actor_role()<>'owner' then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 perform 1 from private.profiles where id=target for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if exists(select 1 from private.user_roles where user_id=target and role='owner') then raise exception 'OWNER_TRANSFER_REQUIRED';end if;
 select id into sid from private.sanctions where operation_id=(p->>'operation_id')::uuid or (request is not null and request_id=request);
 if found then return jsonb_build_object('id',sid,'already_applied',true);end if;
 if coalesce(char_length(btrim(p->>'reason')),0) not between 2 and 2000 or coalesce(char_length(btrim(p->>'rule')),0) not between 2 and 300 then raise exception 'INVALID_INPUT';end if;
 if level in ('advice','warning') then k:=level;
 elsif level='permanent' then
  if p->>'confirmation' is distinct from '영구 제한' then raise exception 'CONFIRM_REQUIRED';end if;k:='permanent';until_at:='infinity';
 else
  k:=case when level='review' then 'review' else 'suspend' end;
  if level='range' then days:=(p->>'days')::int;if days is null or days not between 7 and 30 then raise exception 'INVALID_INPUT';end if;
  elsif level in ('1','3','7','30') then days:=level::int;
  elsif level='review' then days:=30;else raise exception 'INVALID_INPUT';end if;
  until_at:=now()+make_interval(days=>days);
 end if;
 insert into private.sanctions(target_id,actor_id,kind,reason,rule,ends_at,operation_id,request_id)
 values(target,u,k,btrim(p->>'reason'),btrim(p->>'rule'),case when k='permanent' then null else until_at end,(p->>'operation_id')::uuid,request) returning id into sid;
 select suspended_until into previous from private.profiles where id=target;
 update private.profiles set suspended_until=case when until_at is null then suspended_until else greatest(suspended_until,until_at) end,sanction_revision=sanction_revision+1 where id=target;
 insert into private.admin_audit_logs(actor_id,action,target_id,details) values(u,'sanction_apply',target,jsonb_build_object('sanction_id',sid,'kind',k,'previous_until',previous,'ends_at',until_at,'reason',p->>'reason','rule',p->>'rule'));
 insert into private.notifications(user_id,message,governance_kind) values(target,'계정 운영 안내가 있어요. 계정 상태에서 내용과 이의 제기 방법을 확인해 주세요.','sanction');
 return jsonb_build_object('id',sid);
end $$;
revoke all on function private.apply_sanction(jsonb,uuid) from public,anon,authenticated;

create function private.governance(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); role text:=private.actor_role(); v_id uuid; target uuid; result jsonb; req private.sanction_requests; appeal private.sanction_appeals; previous text; desired text; v_status text; rev integer;begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>30000 then raise exception 'INVALID_INPUT';end if;
 perform private.consume_rate(u,'governance',100,60);
 if p_action not in ('mine','appeal','rights','rights_mine') then
  if exists(select 1 from private.profiles where private.profiles.id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
  if role not in ('owner','moderator') then raise exception 'FORBIDDEN';end if;
 end if;
 if p_action='mine' then
  return jsonb_build_object('sanctions',coalesce((select jsonb_agg(to_jsonb(s)-'target_id'-'actor_id'-'operation_id'-'request_id' order by starts_at desc) from(select * from private.sanctions where target_id=u order by starts_at desc limit 100 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000))s),'[]'::jsonb),
   'appeals',coalesce((select jsonb_agg(to_jsonb(a)-'target_id'-'handler_id' order by created_at desc) from(select * from private.sanction_appeals where target_id=u order by created_at desc limit 100)a),'[]'::jsonb));
 elsif p_action='appeal' then
  perform private.consume_rate(u,'appeals',5,3600);
  v_id:=(p_payload->>'sanction_id')::uuid;
  if not exists(select 1 from private.sanctions where private.sanctions.id=v_id and target_id=u) then raise exception 'NOT_FOUND';end if;
  insert into private.sanction_appeals(target_id,sanction_id,body) values(u,v_id,btrim(p_payload->>'body')) returning private.sanction_appeals.id into v_id;
  insert into private.notifications(user_id,message,governance_kind) select user_id,'새 제재 이의 제기가 접수됐어요.','appeal' from private.user_roles;
  return jsonb_build_object('id',v_id);
 elsif p_action='rights' then
  perform private.consume_rate(u,'feedback_create',5,3600);
  insert into private.feedback(author_id,kind,title,body,sensitive) values(u,'other','계정·개인정보 문의',btrim(p_payload->>'body'),true) returning private.feedback.id into v_id;
  insert into private.notifications(user_id,message,governance_kind) select user_id,'계정·개인정보 문의가 접수됐어요.','rights' from private.user_roles where private.user_roles.role='owner';
  return jsonb_build_object('id',v_id);
 elsif p_action='rights_mine' then
  return coalesce((select jsonb_agg(to_jsonb(f)-'author_id' order by created_at desc) from(select * from private.feedback where author_id=u and sensitive order by created_at desc limit 20)f),'[]'::jsonb);
 elsif p_action in ('targets','members') then
  if p_action='members' and role<>'owner' then raise exception 'FORBIDDEN';end if;
  if role='moderator' and char_length(btrim(coalesce(p_payload->>'query','')))<3 then raise exception 'INVALID_INPUT';end if;
  perform private.consume_rate(u,'member_lookup',30,60);
  insert into private.admin_audit_logs(actor_id,action) values(u,'member_lookup');
  return coalesce((select jsonb_agg(to_jsonb(t)) from(select p.id,p.nickname,h.username,coalesce(r.role,'member') role,p.role_revision,p.sanction_revision,case when p.suspended_until='infinity' then null else p.suspended_until end suspended_until,p.suspended_until='infinity' permanent,p.suspended_until>now() restricted from private.profiles p join private.account_handles h on h.user_id=p.id left join private.user_roles r on r.user_id=p.id where position(lower(left(coalesce(p_payload->>'query',''),120)) in lower(p.nickname||' '||h.username||' '||p.id::text))>0 order by h.username limit case when role='owner' then 50 else 10 end offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000))t),'[]'::jsonb);
 elsif p_action='request' then
  perform private.consume_rate(u,'sanction_request',10,3600);
  target:=(p_payload->>'target_id')::uuid;
  if not exists(select 1 from private.profiles where private.profiles.id=target) then raise exception 'NOT_FOUND';end if;
  if exists(select 1 from private.user_roles where user_id=target and private.user_roles.role='owner') then raise exception 'OWNER_TRANSFER_REQUIRED';end if;
  if nullif(p_payload->>'post_id','') is not null and not exists(select 1 from private.posts where private.posts.id=(p_payload->>'post_id')::uuid and (author_id=target or exists(select 1 from private.comments c where c.id=nullif(p_payload->>'comment_id','')::uuid and c.author_id=target and c.post_id=private.posts.id))) then raise exception 'INVALID_EVIDENCE';end if;
  if nullif(p_payload->>'comment_id','') is not null and not exists(select 1 from private.comments where private.comments.id=(p_payload->>'comment_id')::uuid and author_id=target and (nullif(p_payload->>'post_id','') is null or post_id=(p_payload->>'post_id')::uuid)) then raise exception 'INVALID_EVIDENCE';end if;
  if nullif(p_payload->>'report_id','') is not null and not exists(select 1 from private.reports r left join private.posts p on p.id=r.post_id left join private.comments c on c.id=r.comment_id where r.id=(p_payload->>'report_id')::uuid and coalesce(c.author_id,p.author_id)=target and (nullif(p_payload->>'post_id','') is null or coalesce(r.post_id,c.post_id)=(p_payload->>'post_id')::uuid) and (nullif(p_payload->>'comment_id','') is null or r.comment_id=(p_payload->>'comment_id')::uuid)) then raise exception 'INVALID_EVIDENCE';end if;
  if p_payload->>'level'='range' and (coalesce((p_payload->>'days')::int,0) not between 7 and 30) then raise exception 'INVALID_INPUT';end if;
  v_id:=nullif(p_payload->>'id','')::uuid;
  if v_id is not null then
   select * into req from private.sanction_requests where private.sanction_requests.id=v_id for update;
   if not found or req.requester_id<>u or req.status<>'needs_info' then raise exception 'FORBIDDEN';end if;
   if req.revision is distinct from (p_payload->>'revision')::int then raise exception 'STALE_CHANGE';end if;
   update private.sanction_requests set target_id=target,category=btrim(p_payload->>'category'),reason=btrim(p_payload->>'reason'),rule=btrim(p_payload->>'rule'),proposed=p_payload->>'level',days=(p_payload->>'days')::int,post_id=nullif(p_payload->>'post_id','')::uuid,comment_id=nullif(p_payload->>'comment_id','')::uuid,report_id=nullif(p_payload->>'report_id','')::uuid,status='pending',revision=revision+1,updated_at=now() where private.sanction_requests.id=v_id;
  else
   insert into private.sanction_requests(target_id,requester_id,category,reason,rule,proposed,days,post_id,comment_id,report_id) values(target,u,btrim(p_payload->>'category'),btrim(p_payload->>'reason'),btrim(p_payload->>'rule'),p_payload->>'level',(p_payload->>'days')::int,nullif(p_payload->>'post_id','')::uuid,nullif(p_payload->>'comment_id','')::uuid,nullif(p_payload->>'report_id','')::uuid) returning private.sanction_requests.id into v_id;
  end if;
  insert into private.notifications(user_id,message,governance_kind) select user_id,'새 제재 요청이 접수됐어요.','request' from private.user_roles where private.user_roles.role='owner';
 elsif p_action='requests' then
  insert into private.admin_audit_logs(actor_id,action) values(u,'sanction_requests_read');
  return coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('nickname',(select nickname from private.profiles where private.profiles.id=r.target_id)) order by created_at desc) from(select * from private.sanction_requests where (role='owner' or requester_id=u) and (coalesce(p_payload->>'status','')='' or status=p_payload->>'status') order by created_at desc limit 100 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000))r),'[]'::jsonb);
 elsif p_action in ('decide','cancel') then
  v_id:=(p_payload->>'id')::uuid;
  select * into req from private.sanction_requests where private.sanction_requests.id=v_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if p_action='decide' and role<>'owner' then raise exception 'FORBIDDEN';end if;
  if p_action='cancel' and req.requester_id<>u then raise exception 'FORBIDDEN';end if;
  if req.status='approved' and p_action='decide' and p_payload->>'status'='approved' then return jsonb_build_object('ok',true,'already_applied',true);end if;
  if req.revision is distinct from (p_payload->>'revision')::int then raise exception 'STALE_CHANGE';end if;
  if req.status in ('approved','rejected','cancelled') then raise exception 'STALE_CHANGE';end if;
  v_status:=case when p_action='cancel' then 'cancelled' else p_payload->>'status' end;
  if v_status is null or v_status not in ('reviewing','needs_info','approved','rejected','cancelled') or (p_action='decide' and v_status='cancelled') then raise exception 'INVALID_INPUT';end if;
  if coalesce(char_length(btrim(p_payload->>'decision_reason')),0) not between 2 and 2000 then raise exception 'INVALID_INPUT';end if;
  if v_status='approved' then result:=private.apply_sanction(p_payload||jsonb_build_object('target_id',req.target_id,'operation_id',req.id),req.id);end if;
  update private.sanction_requests set status=v_status,decision_reason=btrim(p_payload->>'decision_reason'),handler_id=u,revision=revision+1,updated_at=now() where private.sanction_requests.id=v_id;
  insert into private.notifications(user_id,message,governance_kind) values(req.requester_id,'제재 요청 처리 상태가 변경됐어요.','request');
 elsif p_action='appeals' then
  insert into private.admin_audit_logs(actor_id,action) values(u,'appeals_read');
  return coalesce((select jsonb_agg((to_jsonb(a))||jsonb_build_object('nickname',(select nickname from private.profiles where private.profiles.id=a.target_id),'sanction',(select to_jsonb(s)-'actor_id'-'operation_id'-'target_id' from private.sanctions s where s.id=a.sanction_id)) order by created_at desc) from(select * from private.sanction_appeals order by created_at desc limit 100 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000))a),'[]'::jsonb);
 elsif p_action='reply_appeal' then
  v_id:=(p_payload->>'id')::uuid;
  select * into appeal from private.sanction_appeals where private.sanction_appeals.id=v_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if appeal.revision is distinct from (p_payload->>'revision')::int then raise exception 'STALE_CHANGE';end if;
  if coalesce(char_length(btrim(p_payload->>'reply')),0) not between 2 and 4000 then raise exception 'INVALID_INPUT';end if;
  update private.sanction_appeals set status=p_payload->>'status',reply=btrim(p_payload->>'reply'),handler_id=u,revision=revision+1,updated_at=now() where private.sanction_appeals.id=v_id;
  insert into private.notifications(user_id,message,governance_kind) values(appeal.target_id,'이의 제기에 답변이 등록됐어요.','appeal');
 elsif p_action in ('apply','release','roles','role_history','role_set','sanctions','security') then
  if role<>'owner' then raise exception 'FORBIDDEN';end if;
  if p_action='apply' then perform private.consume_rate(u,'sanction_writes',30,600);return private.apply_sanction(p_payload);end if;
  if p_action='sanctions' then
   insert into private.admin_audit_logs(actor_id,action) values(u,'sanctions_read');
   return coalesce((select jsonb_agg(to_jsonb(s)-'operation_id' order by starts_at desc) from(select * from private.sanctions where nullif(p_payload->>'target_id','') is null or target_id=(p_payload->>'target_id')::uuid order by starts_at desc limit 100 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000))s),'[]'::jsonb);
  elsif p_action='release' then
   target:=(p_payload->>'target_id')::uuid;
   select sanction_revision into rev from private.profiles where private.profiles.id=target for update;
   if not found then raise exception 'NOT_FOUND';end if;
   if rev is distinct from (p_payload->>'revision')::int then raise exception 'STALE_CHANGE';end if;
   if coalesce(char_length(btrim(p_payload->>'reason')),0) not between 2 and 2000 then raise exception 'INVALID_INPUT';end if;
   update private.sanctions set revoked_at=now(),revoke_reason=btrim(p_payload->>'reason') where target_id=target and revoked_at is null and (kind='permanent' or ends_at>now());
   update private.profiles set suspended_until=null,sanction_revision=sanction_revision+1 where private.profiles.id=target;
   insert into private.notifications(user_id,message,governance_kind) values(target,'이용 제한이 해제됐어요.','sanction');v_id:=target;
  elsif p_action='roles' then
   insert into private.admin_audit_logs(actor_id,action) values(u,'roles_read');
   return coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('username',h.username,'nickname',p.nickname,'role_revision',p.role_revision,'restricted',p.suspended_until>now())) from private.user_roles r join private.profiles p on p.id=r.user_id join private.account_handles h on h.user_id=r.user_id),'[]'::jsonb);
  elsif p_action='role_history' then return coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc) from(select * from private.role_history order by created_at desc limit 100 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000))r),'[]'::jsonb);
  elsif p_action='role_set' then
   target:=(p_payload->>'target_id')::uuid;desired:=p_payload->>'role';
   select role_revision into rev from private.profiles where private.profiles.id=target for update;
   if not found then raise exception 'NOT_FOUND';end if;
   if rev is distinct from (p_payload->>'revision')::int then raise exception 'STALE_CHANGE';end if;
   previous:=coalesce((select private.user_roles.role from private.user_roles where user_id=target),'member');
   if previous='owner' or desired is null or desired not in ('moderator','member') then raise exception 'OWNER_TRANSFER_REQUIRED';end if;
   if coalesce(char_length(btrim(p_payload->>'reason')),0) not between 2 and 2000 then raise exception 'INVALID_INPUT';end if;
   if desired='moderator' and exists(select 1 from private.profiles where private.profiles.id=target and suspended_until>now()) then raise exception 'SUSPENDED';end if;
   if desired='member' then delete from private.user_roles where user_id=target;
   else insert into private.user_roles(user_id,role,assigned_by) values(target,desired,u) on conflict(user_id) do update set role=excluded.role,assigned_at=now(),assigned_by=u;end if;
   update private.profiles set role_revision=role_revision+1 where private.profiles.id=target;
   insert into private.role_history(target_id,actor_id,previous_role,next_role,reason) values(target,u,previous,desired,btrim(p_payload->>'reason'));
   insert into private.notifications(user_id,message,governance_kind) values(target,'관리자 역할이 변경됐어요.','role');v_id:=target;
  elsif p_action='security' then
   return jsonb_build_object('private_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r'),'rls_enabled',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and c.relrowsecurity),'owners',(select count(*) from private.user_roles where private.user_roles.role='owner'),'active_restrictions',(select count(*) from private.profiles where suspended_until>now()),'server_time',now());
  end if;
 else raise exception 'INVALID_INPUT';end if;
 insert into private.admin_audit_logs(actor_id,action,target_id,details) values(u,'governance_'||p_action,v_id,jsonb_build_object('reason',coalesce(p_payload->>'decision_reason',p_payload->>'reason'),'status',v_status,'previous_role',previous,'next_role',desired));
 return coalesce(result,jsonb_build_object('ok',true,'id',v_id));
end $$;
create function public.governance(p_action text,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.governance(p_action,p_payload)$$;
revoke all on function private.governance(text,jsonb),public.governance(text,jsonb) from public,anon;
grant execute on function private.governance(text,jsonb),public.governance(text,jsonb) to authenticated;

create or replace function private.community(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); role text:=private.actor_role(); result jsonb; v_id uuid; begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>60000 then raise exception 'INVALID_INPUT';end if;
 if p_action not in ('me','delete_account_access') and exists(select 1 from private.profiles where private.profiles.id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 if p_action='me' then
  result:=private.community_legacy(p_action,p_payload);
  return result||jsonb_build_object('role',role,'is_admin',role in ('owner','moderator'),'restricted',exists(select 1 from private.profiles where private.profiles.id=u and suspended_until>now()),'account_status',private.governance('mine'));
 end if;
 if p_action='delete_account_access' and role='owner' then raise exception 'OWNER_TRANSFER_REQUIRED';end if;
 if p_action='admin_suspend' then raise exception 'FORBIDDEN: use reviewed governance API';end if;
 if p_action='admin_notice' then return private.manage_notices('save',p_payload);end if;
 if p_action='admin_delete' and p_payload->>'kind'='notice' then raise exception 'FORBIDDEN: use revision checked notice API';end if;
 if p_action like 'admin_%' then
  if role not in ('owner','moderator') then raise exception 'FORBIDDEN';end if;
  if role='moderator' then
   if p_action not in ('admin_stats','admin_reports','admin_resolve','admin_delete') then raise exception 'FORBIDDEN';end if;
   if p_action='admin_resolve' and p_payload->>'kind' is distinct from 'content' then raise exception 'FORBIDDEN';end if;
   if p_action='admin_delete' and not ((p_payload->>'kind'='post' and exists(select 1 from private.reports where post_id=(p_payload->>'id')::uuid)) or (p_payload->>'kind'='comment' and exists(select 1 from private.reports where comment_id=(p_payload->>'id')::uuid))) then raise exception 'FORBIDDEN';end if;
  end if;
  if p_action='admin_resolve' and (p_payload->>'kind' is null or p_payload->>'kind' not in ('content','assessment')) then raise exception 'INVALID_INPUT';end if;
  if p_action='admin_delete' and p_payload->>'kind'='post' and not exists(select 1 from private.posts where id=(p_payload->>'id')::uuid) then raise exception 'NOT_FOUND';end if;
  if p_action='admin_delete' and p_payload->>'kind'='comment' and not exists(select 1 from private.comments where id=(p_payload->>'id')::uuid) then raise exception 'NOT_FOUND';end if;
  if p_action in ('admin_delete','admin_resolve') then
   if coalesce(char_length(btrim(p_payload->>'reason')),0) not between 2 and 2000 then raise exception 'INVALID_INPUT';end if;
   insert into private.admin_audit_logs(actor_id,action,target_id,details) values(u,p_action||'_reason',(p_payload->>'id')::uuid,jsonb_build_object('reason',p_payload->>'reason'));
   if p_action='admin_resolve' and p_payload->>'kind'='content' then
    select r.id into v_id from private.reports r where r.id=(p_payload->>'id')::uuid and r.revision=(p_payload->>'revision')::int for update;
    if not found then raise exception 'STALE_CHANGE';end if;
    update private.reports set resolution_reason=btrim(p_payload->>'reason'),revision=revision+1 where private.reports.id=v_id;
   end if;
  end if;
 end if;
 result:=private.community_legacy(p_action,p_payload);
 if p_action='admin_reports' and role='moderator' then return jsonb_set(result,'{assessments}','[]');end if;
 if p_action='admin_stats' then
  result:=result||jsonb_build_object('reports_total',(select count(*) from private.reports),'posts_today',(select count(*) from private.posts where created_at>now()-interval '1 day'),'comments_today',(select count(*) from private.comments where created_at>now()-interval '1 day'));
 end if;
 if p_action='admin_stats' and role='moderator' then
  return result||jsonb_build_object('feedback',(select count(*) from private.feedback where not sensitive and status in ('new','reviewing')),'reports_total',(select count(*) from private.reports));
 end if;
 if p_action='get_notice' and role in ('owner','moderator') then
  return result||coalesce((select jsonb_build_object('can_edit',role='owner' or not n.owner_only,'can_delete',role='owner' or (not n.owner_only and n.author_id=u)) from private.notices n where n.id=(p_payload->>'id')::uuid),'{}');
 end if;
 return result;
end $$;

-- Immutable compatibility implementation; only the guarded dispatcher may call it.
create or replace function private.community_legacy(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); is_admin boolean; v_id uuid; v_parent uuid; v_post private.posts; v_comment private.comments;
 result jsonb; v_profile private.profiles; m private.memberships; v_assessment private.performance_assessments; v_board text; v_kind text; v_label integer; v_target uuid; v_title text; v_body text;
begin
 if u is null or not exists(select 1 from auth.users where id=u and deleted_at is null and not coalesce(is_anonymous,false)) then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from auth.sessions where id=nullif(auth.jwt()->>'session_id','')::uuid and user_id=u) then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from private.account_handles where user_id=u) then raise exception 'ACCOUNT_REQUIRED';end if;
 if p_action not in ('me','delete_account_access') and exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 is_admin:=exists(select 1 from private.user_roles where user_id=u and (role='owner' or (role='moderator' and p_action like 'admin_%')));
 if p_payload is null or pg_column_size(p_payload)>60000 or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_INPUT';end if;
 perform private.consume_rate(u,'requests',180,60);
 if p_action='neis_access' then perform private.consume_rate(u,'neis',30,60);return '{"ok":true}'::jsonb;end if;
 if p_action='delete_account_access' then perform private.consume_rate(u,'delete_account',5,3600);return '{"ok":true}'::jsonb;end if;
 select * into v_profile from private.profiles where id=u;
 if p_action='me' then
  return jsonb_build_object('profile',case when v_profile.id is null then null else jsonb_build_object('nickname',v_profile.nickname,'grade',v_profile.grade,'notifications_enabled',v_profile.notifications_enabled) end,'is_admin',is_admin,'membership',(select jsonb_build_object('school_year',school_year,'grade',grade,'class_number',class_number,'policy_version',policy_version,'revision',revision,'collection_basis',collection_basis) from private.memberships where user_id=u),
   'enrollment_current',exists(select 1 from private.memberships mm cross join private.class_settings cc cross join private.privacy_policy pp where mm.user_id=u and mm.school_year=cc.school_year and mm.class_number<=cc.counts[mm.grade] ));
 elsif p_action='save_profile' then
  insert into private.profiles(id,nickname,notifications_enabled)
  values(u,btrim(p_payload->>'nickname'),coalesce((p_payload->>'notifications_enabled')::boolean,true))
  on conflict(id) do update set nickname=excluded.nickname,notifications_enabled=excluded.notifications_enabled;
  return jsonb_build_object('ok',true);
 end if;
 if v_profile.id is null then raise exception 'INVALID_INPUT: profile required';end if;
 if p_action like 'admin_%' and not is_admin then raise exception 'FORBIDDEN';end if;
 if p_action not like 'admin_%' and p_action not in ('notifications','read_notifications','delete_post','delete_comment','delete_assessment') then m:=private.require_membership(u);end if;
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
 elsif p_action='notice_list' then
  return coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc) from (
   select id,title,created_at from private.notices
   where position(lower(left(coalesce(p_payload->>'query',''),120)) in lower(title))>0
   order by created_at desc,id desc limit 20 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000)
  )n),'[]'::jsonb);
 elsif p_action='get_notice' then
  v_id:=(p_payload->>'id')::uuid;
  select to_jsonb(n)-'author_id' into result from private.notices n where id=v_id;
  if not found then raise exception 'NOT_FOUND';end if;
  return result;
 elsif p_action='notices' then
  return coalesce((select jsonb_agg(to_jsonb(n)-'author_id' order by n.created_at desc) from (select * from private.notices order by created_at desc limit 50)n),'[]'::jsonb);

 elsif p_action in ('assessments','assessments_unassigned') then
  return coalesce((select jsonb_agg((to_jsonb(a)-'author_id')||jsonb_build_object('is_mine',author_id=u) order by due_date,id) from (
   select * from private.performance_assessments where
   ((p_action='assessments' and school_year=m.school_year and grade=m.grade and class_number=m.class_number and due_date between coalesce(nullif(p_payload->>'from','')::date,current_date-30) and coalesce(nullif(p_payload->>'to','')::date,current_date+90))
    or (p_action='assessments_unassigned' and author_id=u and class_number is null)) order by due_date,id limit 200)a),'[]'::jsonb);
 elsif p_action='save_assessment' then
  perform private.consume_rate(u,'assessments',15,3600);v_id:=nullif(p_payload->>'id','')::uuid;
  if v_id is not null then
   select * into v_assessment from private.performance_assessments where id=v_id for update;
   if not found or v_assessment.author_id is distinct from u then raise exception 'NOT_FOUND';end if;
   if v_assessment.class_number is not null and row(v_assessment.school_year,v_assessment.grade,v_assessment.class_number) is distinct from row(m.school_year,m.grade,m.class_number) then raise exception 'NOT_FOUND';end if;
   update private.performance_assessments set title=btrim(p_payload->>'title'),subject=btrim(p_payload->>'subject'),grade=m.grade,school_year=m.school_year,class_number=m.class_number,due_date=(p_payload->>'due_date')::date,body=coalesce(p_payload->>'body','') where id=v_id;
  else
   insert into private.performance_assessments(author_id,title,subject,grade,school_year,class_number,due_date,body) values(u,btrim(p_payload->>'title'),btrim(p_payload->>'subject'),m.grade,m.school_year,m.class_number,(p_payload->>'due_date')::date,coalesce(p_payload->>'body','')) returning id into v_id;
  end if;return jsonb_build_object('id',v_id);
 elsif p_action='delete_assessment' then
  v_id:=(p_payload->>'id')::uuid;
  if not exists(select 1 from private.performance_assessments where id=v_id and author_id=u) then raise exception 'FORBIDDEN';end if;
  delete from private.performance_assessments where id=v_id;return jsonb_build_object('ok',true);
 elsif p_action='report_assessment' then
  perform private.consume_rate(u,'reports',10,3600);
  if not exists(select 1 from private.performance_assessments where id=(p_payload->>'id')::uuid and school_year=m.school_year and grade=m.grade and class_number=m.class_number) then raise exception 'NOT_FOUND';end if;
  insert into private.assessment_reports(assessment_id,reporter_id,reason) values((p_payload->>'id')::uuid,u,btrim(p_payload->>'reason'));return jsonb_build_object('ok',true);
 elsif p_action='admin_stats' then
  return jsonb_build_object('members',(select count(*) from private.profiles),'posts',(select count(*) from private.posts),'comments',(select count(*) from private.comments),'reports',(select count(*) from private.reports where status='pending'),'feedback',(select count(*) from private.feedback where status in ('new','reviewing')));
 elsif p_action='admin_members' then
  return coalesce((select jsonb_agg(to_jsonb(p)) from(select id,nickname,grade,suspended_until,created_at from private.profiles where position(lower(coalesce(p_payload->>'query','')) in lower(nickname))>0 order by created_at desc limit 50)p),'[]'::jsonb);
 elsif p_action='admin_reports' then
  insert into private.admin_audit_logs(actor_id,action) values(u,'admin_reports_read');
  return jsonb_build_object('content',coalesce((select jsonb_agg((to_jsonb(r)-'reporter_id')||jsonb_build_object('subject_user_id',coalesce((select author_id from private.comments where id=r.comment_id),(select author_id from private.posts where id=r.post_id)),'context_post_id',coalesce(r.post_id,(select post_id from private.comments where id=r.comment_id)))) from(select * from private.reports order by created_at desc limit 100)r),'[]'::jsonb),'assessments',coalesce((select jsonb_agg(to_jsonb(r)-'reporter_id') from(select r.* from private.assessment_reports r join private.performance_assessments a on a.id=r.assessment_id join private.memberships mm on mm.user_id=u and row(mm.school_year,mm.grade,mm.class_number)=row(a.school_year,a.grade,a.class_number) where mm.school_year=(select school_year from private.class_settings where id) order by r.created_at desc limit 100)r),'[]'::jsonb));
 elsif p_action='admin_audit' then
  return coalesce((select jsonb_agg(to_jsonb(a)) from(select * from private.admin_audit_logs order by created_at desc limit 100)a),'[]'::jsonb);
 elsif p_action='admin_resolve' then
  v_id:=(p_payload->>'id')::uuid;
  if p_payload->>'status' not in ('resolved','dismissed') then raise exception 'INVALID_INPUT';end if;
  if p_payload->>'kind'='assessment' then
   m:=private.require_membership(u);
   if not exists(select 1 from private.assessment_reports r join private.performance_assessments a on a.id=r.assessment_id where r.id=v_id and row(a.school_year,a.grade,a.class_number)=row(m.school_year,m.grade,m.class_number)) then raise exception 'NOT_FOUND';end if;
   update private.assessment_reports set status=p_payload->>'status' where id=v_id;else update private.reports set status=p_payload->>'status' where id=v_id;end if;
 elsif p_action='admin_suspend' then
  v_id:=(p_payload->>'id')::uuid;
  if exists(select 1 from private.user_roles where user_id=v_id) then raise exception 'FORBIDDEN';end if;
  update private.profiles set suspended_until=case when (p_payload->>'suspend')::boolean then now()+interval '7 days' else null end where id=v_id;
 elsif p_action='admin_delete' then
  v_id:=(p_payload->>'id')::uuid;
  if p_payload->>'kind'='post' then delete from private.posts where id=v_id;
  elsif p_payload->>'kind'='comment' then delete from private.comments where id=v_id;
  elsif p_payload->>'kind'='assessment' then
   m:=private.require_membership(u);
   if not exists(select 1 from private.performance_assessments a where a.id=v_id and row(a.school_year,a.grade,a.class_number)=row(m.school_year,m.grade,m.class_number)) then raise exception 'NOT_FOUND';end if;
   delete from private.performance_assessments where id=v_id;
  elsif p_payload->>'kind'='notice' then delete from private.notices where id=v_id;
  else raise exception 'INVALID_INPUT';end if;
 elsif p_action='admin_notice' then
  if coalesce(p_payload->>'content_format','text') not in ('text','markdown','html') then raise exception 'INVALID_INPUT';end if;
  insert into private.notices(author_id,title,body,content_format) values(u,btrim(p_payload->>'title'),btrim(p_payload->>'body'),coalesce(p_payload->>'content_format','text')) returning id into v_id;
  insert into private.notifications(user_id,message) select id,'새 공지: '||left(p_payload->>'title',120) from private.profiles where notifications_enabled;
 else raise exception 'INVALID_INPUT: unknown action';
 end if;
 insert into private.admin_audit_logs(actor_id,action,target_id) values(u,p_action,v_id);
 return jsonb_build_object('ok',true,'id',v_id);
end $$;

revoke all on function private.community_legacy(text,jsonb) from public,anon,authenticated;

create or replace function private.manage_boards(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); me jsonb; b private.boards; v_id text; v_kind text;
begin
 me:=private.community('me','{}');
 if private.actor_role()<>'owner' then raise exception 'FORBIDDEN';end if;
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

create or replace function private.manage_popups(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); me jsonb; current_popup private.site_popups;
 v_id uuid; v_title text; v_body text; v_options text[]; v_active boolean; v_format text;
begin
 -- Reuse the full live-user/session/account/role guard; never trust request metadata.
 me:=private.community('me','{}');
 if private.actor_role()<>'owner' then raise exception 'FORBIDDEN';end if;
 if (me->>'is_admin')::boolean is distinct from true then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>40000 then raise exception 'INVALID_INPUT';end if;
 if p_action='list' then
  return coalesce((select jsonb_agg(to_jsonb(p)-'created_by' order by created_at desc,id) from(select * from private.site_popups order by created_at desc,id limit 100)p),'[]'::jsonb);
 end if;
 if p_action not in ('save','delete') then raise exception 'INVALID_INPUT';end if;
 perform private.consume_rate(u,'popup_writes',30,600);
 -- Serialize activation and creation so the three-active-popup bound also holds under concurrency.
 perform pg_advisory_xact_lock(8407,1001);
 v_id:=nullif(p_payload->>'id','')::uuid;
 if v_id is not null then
  select * into current_popup from private.site_popups where id=v_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if current_popup.revision is distinct from (p_payload->>'revision')::integer then raise exception 'STALE_POPUP';end if;
 end if;
 if p_action='delete' then
  if v_id is null then raise exception 'INVALID_INPUT';end if;
  delete from private.site_popups where id=v_id;
 else
  v_title:=btrim(p_payload->>'title');v_body:=btrim(p_payload->>'body');
  v_format:=coalesce(p_payload->>'content_format','text');
  if v_format not in ('text','markdown','html') then raise exception 'INVALID_INPUT';end if;
  if jsonb_typeof(p_payload->'close_options') is distinct from 'array' then raise exception 'INVALID_INPUT';end if;
  select array_agg(value order by value) into v_options from(select distinct value from jsonb_array_elements_text(p_payload->'close_options')) options;
  if v_options is null or not ('once'=any(v_options)) or not (v_options <@ array['once','today','forever']::text[]) then raise exception 'INVALID_INPUT';end if;
  v_active:=coalesce((p_payload->>'is_active')::boolean,true);
  if v_active and (v_id is null or not current_popup.is_active) and (select count(*) from private.site_popups where is_active)>=3 then raise exception 'POPUP_LIMIT';end if;
  if v_id is null then
   if (select count(*) from private.site_popups)>=100 then raise exception 'POPUP_STORAGE_LIMIT';end if;
   insert into private.site_popups(title,body,close_options,is_active,created_by,content_format) values(v_title,v_body,v_options,v_active,u,v_format) returning id into v_id;
  else
   update private.site_popups set title=v_title,body=v_body,content_format=v_format,close_options=v_options,is_active=v_active,updated_at=now(),
    revision=revision+case when row(title,body,close_options,content_format) is distinct from row(v_title,v_body,v_options,v_format) then 1 else 0 end
    where id=v_id;
  end if;
 end if;
 insert into private.admin_audit_logs(actor_id,action,target_id) values(u,'popup_'||p_action,v_id);
 return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function private.school_membership(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); me jsonb; c private.class_settings; m private.memberships; v jsonb; target uuid; next_counts int[]; yr int;
begin
 me:=private.community('me','{}');
 if p_action like 'admin_%' and private.actor_role()<>'owner' then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>40000 then raise exception 'INVALID_INPUT';end if;
 if p_action like 'admin_%' and (me->>'is_admin')::boolean is distinct from true then raise exception 'FORBIDDEN';end if;
 if p_action='enroll' then
  perform private.consume_rate(u,'enrollment',10,3600);
  perform pg_advisory_xact_lock(hashtextextended('schoolpot:membership:'||u::text,0));
  v:=private.validate_enrollment(p_payload);
  select * into m from private.memberships where user_id=u for update;
  if m.school_year=(v->>'school_year')::int and (m.grade<>(v->>'grade')::int or m.class_number<>(v->>'class_number')::int) then raise exception 'MEMBERSHIP_LOCKED';end if;
  insert into private.memberships(user_id,school_year,grade,class_number,policy_version,collection_basis,notice_recorded_at,consented_at,age_14_confirmed_at,overseas_consented_at)
  values(u,(v->>'school_year')::int,(v->>'grade')::int,(v->>'class_number')::int,(v->>'policy_version')::int,'service_contract',now(),null,null,null)
  on conflict(user_id) do update set school_year=excluded.school_year,grade=excluded.grade,class_number=excluded.class_number,policy_version=excluded.policy_version,
   collection_basis='service_contract',notice_recorded_at=now(),revision=private.memberships.revision+1;
  update private.profiles set grade=(v->>'grade')::int where id=u;
 elsif p_action='admin_settings' then return private.school_setup();
 elsif p_action='admin_save_classes' then
  perform private.consume_rate(u,'class_settings',20,600);
  select * into c from private.class_settings where id for update;
  if c.revision is distinct from (p_payload->>'revision')::int then raise exception 'STALE_CLASS_SETTINGS';end if;
  if jsonb_typeof(p_payload->'counts') is distinct from 'array' or jsonb_array_length(p_payload->'counts')<>3 then raise exception 'INVALID_INPUT';end if;
  select array_agg(value::int order by ordinality) into next_counts from jsonb_array_elements_text(p_payload->'counts') with ordinality;
  yr:=(p_payload->>'school_year')::int;
  if yr<c.school_year then raise exception 'INVALID_INPUT';end if;
  if yr=c.school_year and exists(select 1 from private.memberships where school_year=yr and class_number>next_counts[grade]) then raise exception 'CLASS_IN_USE';end if;
  update private.class_settings set school_year=yr,counts=next_counts,revision=revision+1 where id;
 elsif p_action='admin_save_policy' then
  perform private.consume_rate(u,'privacy_settings',10,600);
  perform 1 from private.privacy_policy where id for update;
  if (select version from private.privacy_policy where id) is distinct from (p_payload->>'version')::int then raise exception 'STALE_POLICY';end if;
  if coalesce((p_payload->>'is_ready')::boolean,false) and (char_length(btrim(coalesce(p_payload->>'overseas_notice','')))<30 or p_payload->'review_confirmed' is distinct from 'true'::jsonb) then raise exception 'POLICY_NOT_READY';end if;
  update private.privacy_policy set controller=btrim(p_payload->>'controller'),contact_url=btrim(p_payload->>'contact_url'),contact_email=coalesce(nullif(btrim(p_payload->>'contact_email'),''),contact_email),overseas_notice=btrim(p_payload->>'overseas_notice'),
   is_ready=coalesce((p_payload->>'is_ready')::boolean,false),version=version+1,updated_at=now() where id;
  insert into private.privacy_policy_versions(version,document) select version,to_jsonb(p)-'id' from private.privacy_policy p;
 elsif p_action='admin_members' then
  insert into private.admin_audit_logs(actor_id,action) values(u,'class_members_read');
  return coalesce((select jsonb_agg(to_jsonb(t)) from(select p.id,p.nickname,h.username,mm.school_year,mm.grade,mm.class_number,mm.revision from private.profiles p join private.account_handles h on h.user_id=p.id left join private.memberships mm on mm.user_id=p.id
   where position(lower(left(coalesce(p_payload->>'query',''),40)) in lower(h.username||' '||p.nickname))>0 order by h.username limit 30 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000)) t),'[]'::jsonb);
 elsif p_action='admin_correct_member' then
  perform private.consume_rate(u,'class_corrections',30,600);
  target:=(p_payload->>'id')::uuid;
  select * into c from private.class_settings where id for share;
  select * into m from private.memberships where user_id=target for update;
  if not found then raise exception 'MEMBERSHIP_REQUIRED';end if;
  if m.revision is distinct from (p_payload->>'revision')::int then raise exception 'STALE_MEMBERSHIP';end if;
  if (p_payload->>'grade')::int not between 1 and 3 or (p_payload->>'class_number')::int not between 1 and c.counts[(p_payload->>'grade')::int] then raise exception 'CLASS_INVALID';end if;
  if char_length(btrim(coalesce(p_payload->>'reason',''))) not between 2 and 200 then raise exception 'INVALID_INPUT';end if;
  update private.memberships set grade=(p_payload->>'grade')::int,class_number=(p_payload->>'class_number')::int,school_year=c.school_year,revision=revision+1 where user_id=target;
  update private.profiles set grade=(p_payload->>'grade')::int where id=target;
  insert into private.notifications(user_id,message) values(target,'관리자가 학년·반을 정정했어요. 내 소속을 확인해 주세요.');
  insert into private.admin_audit_logs(actor_id,action,target_id,details) values(u,p_action,target,jsonb_build_object('reason',btrim(p_payload->>'reason'),'previous',jsonb_build_object('school_year',m.school_year,'grade',m.grade,'class_number',m.class_number),'next',jsonb_build_object('school_year',c.school_year,'grade',(p_payload->>'grade')::int,'class_number',(p_payload->>'class_number')::int)));
  return jsonb_build_object('ok',true);
 else raise exception 'INVALID_INPUT';end if;
 if p_action like 'admin_%' then insert into private.admin_audit_logs(actor_id,action,target_id) values(u,p_action,target);end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function private.feedback(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_role text:=private.actor_role(); u uuid:=auth.uid(); me jsonb; f private.feedback; v_id uuid; v_reply text; v_status text; result jsonb;
begin
 me:=private.community('me','{}');
 if exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 if me->'profile'='null'::jsonb then raise exception 'PROFILE_REQUIRED';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>40000 then raise exception 'INVALID_INPUT';end if;
 if p_action like 'admin_%' and (me->>'is_admin')::boolean is distinct from true then raise exception 'FORBIDDEN';end if;
 if p_action='create' then
  perform private.consume_rate(u,'feedback_create',5,3600);
  insert into private.feedback(author_id,kind,title,body,sensitive) values(u,p_payload->>'kind',btrim(p_payload->>'title'),btrim(p_payload->>'body'),p_payload->>'kind'='other' or coalesce((p_payload->>'sensitive')::boolean,false)) returning id into v_id;
  return jsonb_build_object('id',v_id);
 elsif p_action in ('mine','admin_list') then
  if p_action='admin_list' then insert into private.admin_audit_logs(actor_id,action) values(u,'feedback_read');end if;
  select coalesce(jsonb_agg((to_jsonb(t)-'author_id')||case when p_action='admin_list' then jsonb_build_object('nickname',(select nickname from private.profiles where id=t.author_id)) else '{}'::jsonb end order by created_at desc,id),'[]'::jsonb) into result
  from(select * from private.feedback where (p_action='admin_list' or author_id=u) and (p_action<>'admin_list' or v_role='owner' or not sensitive)
   and (coalesce(p_payload->>'status','')='' or status=p_payload->>'status')
   and (coalesce(p_payload->>'kind','')='' or kind=p_payload->>'kind')
   order by created_at desc,id limit 20 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000)) t;
  return result;
 elsif p_action='admin_escalate' then
  select * into f from private.feedback where id=(p_payload->>'id')::uuid for update;
  if not found or (f.sensitive and v_role<>'owner') then raise exception 'NOT_FOUND';end if;
  if f.revision is distinct from (p_payload->>'revision')::int then raise exception 'STALE_FEEDBACK';end if;
  update private.feedback set sensitive=true,revision=revision+1,updated_at=now() where id=f.id;
  insert into private.admin_audit_logs(actor_id,action,target_id) values(u,'feedback_escalate',f.id);
  insert into private.notifications(user_id,message,governance_kind) select user_id,'민감한 문의가 최고 관리자에게 이관됐어요.','rights' from private.user_roles where role='owner';
  return '{"ok":true}'::jsonb;
 elsif p_action='admin_update' then
  perform private.consume_rate(u,'feedback_update',60,600);
  v_id:=(p_payload->>'id')::uuid;
  select * into f from private.feedback where id=v_id for update;
  if not found or (f.sensitive and v_role<>'owner') then raise exception 'NOT_FOUND';end if;
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

create or replace function private.manage_notices(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_role text:=private.actor_role(); u uuid:=auth.uid(); me jsonb; current_notice private.notices; v_id uuid; v_title text; v_body text; v_format text; result jsonb;
begin
 me:=private.community('me','{}');
 if (me->>'is_admin')::boolean is distinct from true then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>60000 then raise exception 'INVALID_INPUT';end if;
 if p_action='list' then
  return coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc) from (
   select id,title,content_format,created_at,updated_at,revision,owner_only,(v_role='owner' or not owner_only) can_edit,(v_role='owner' or (not owner_only and author_id=u)) can_delete from private.notices
   where position(lower(left(coalesce(p_payload->>'query',''),120)) in lower(title))>0
   order by created_at desc,id desc limit 20 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000)
  )n),'[]'::jsonb);
 end if;
 if p_action not in ('get','save','delete') then raise exception 'INVALID_INPUT';end if;
 v_id:=nullif(p_payload->>'id','')::uuid;
 if p_action='get' then
  select (to_jsonb(n)-'author_id')||jsonb_build_object('can_edit',v_role='owner' or not n.owner_only,'can_delete',v_role='owner' or (not n.owner_only and n.author_id=u)) into result from private.notices n where id=v_id;
  if not found then raise exception 'NOT_FOUND';end if;return result;
 end if;
 perform private.consume_rate(u,'notice_writes',30,600);
 if v_id is not null then
  select * into current_notice from private.notices where id=v_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if v_role<>'owner' and (current_notice.owner_only or (p_action='delete' and current_notice.author_id is distinct from u)) then raise exception 'FORBIDDEN';end if;
  if current_notice.revision is distinct from (p_payload->>'revision')::integer then raise exception 'STALE_NOTICE';end if;
 end if;
 if p_action='delete' then
  if v_id is null then raise exception 'INVALID_INPUT';end if;
  delete from private.notices where id=v_id;
 else
  v_title:=btrim(p_payload->>'title');v_body:=btrim(p_payload->>'body');v_format:=coalesce(p_payload->>'content_format','text');
  if v_title is null or char_length(v_title) not between 2 and 120 or v_body is null or char_length(v_body) not between 1 and 20000 or v_format not in ('text','markdown','html') then raise exception 'INVALID_INPUT';end if;
  if v_role<>'owner' and coalesce((p_payload->>'owner_only')::boolean,false) then raise exception 'FORBIDDEN';end if;
  if v_id is null then
   -- The existing creation path alone sends the new-notice notification.
   result:=private.community_legacy('admin_notice',p_payload);
   update private.notices set owner_only=coalesce((p_payload->>'owner_only')::boolean,false) where id=(result->>'id')::uuid;return result;
  end if;
  update private.notices set title=v_title,body=v_body,content_format=v_format,owner_only=coalesce((p_payload->>'owner_only')::boolean,current_notice.owner_only),updated_at=now(),revision=revision+1 where id=v_id;
 end if;
 insert into private.admin_audit_logs(actor_id,action,target_id) values(u,'notice_'||p_action,v_id);
 return jsonb_build_object('ok',true,'id',v_id);
end $$;

-- Public projection contains display metadata and the current published rules only.
create table private.service_configuration(
 id boolean primary key default true check(id),title text not null check(char_length(title) between 2 and 40),
 school_name text not null check(char_length(school_name) between 2 and 80),description text not null check(char_length(description)<=300),
 revision integer not null default 1,updated_at timestamptz not null default now()
);
insert into private.service_configuration(title,school_name,description) values('스쿨팟','안남중학교','우리 학교의 작은 광장');
create table private.rules_versions(
 version integer primary key,summary text not null check(char_length(summary) between 1 and 20000),full_text text not null check(char_length(full_text) between 1 and 20000),
 reason text not null,actor_id uuid references auth.users(id) on delete set null,created_at timestamptz not null default now()
);
alter table private.service_configuration enable row level security;
alter table private.rules_versions enable row level security;
revoke all on private.service_configuration,private.rules_versions from public,anon,authenticated;
insert into private.rules_versions(version,summary,full_text,reason) values(1,$original_summary$# 스쿨팟(SchoolPot) 이용 규정 — 핵심 안내

**시행일: 2026년 11월 13일**
**적용 대상: 스쿨팟을 이용하는 모든 회원**

안녕하세요. 스쿨팟 운영자입니다.

스쿨팟은 안남중학교 학생들이 자유롭게 이야기하고, 학교생활에 필요한 정보를 함께 공유하는 커뮤니티입니다.

모든 학생이 안전하고 편안하게 이용할 수 있도록 이용 규정을 마련했습니다.

**이 규정은 게시글, 댓글, 답글, 익명게시판, 투표 등 스쿨팟의 모든 커뮤니티 활동에 적용됩니다.**

규정을 몰랐다는 이유만으로 위반 행위에 대한 조치가 면제되지는 않으므로, 이용 전에 내용을 확인해 주세요.

---

## 1. 스쿨팟에서는 무엇을 할 수 있나요?

스쿨팟에서는 다음과 같은 활동을 할 수 있습니다.

- **자유게시판:** 일상이나 학교생활에 관한 자유로운 이야기
- **익명게시판:** 닉네임을 공개하지 않고 의견 나누기
- **질문게시판:** 학교생활, 공부 등에 관한 질문과 답변
- **공부게시판:** 공부 방법과 학습 정보 공유
- **분실물게시판:** 잃어버리거나 발견한 물건에 관한 정보 공유
- **동아리게시판:** 동아리 활동 및 관련 정보 공유
- **투표게시판:** 다양한 주제에 관한 투표 및 의견 수렴
- **학교생활:** 급식, 학사일정, 본인 반의 수행평가 일정 확인

게시글을 작성하거나 댓글·답글을 남기고, 다른 사람의 글에 공감을 표시할 수도 있습니다.

단, **자유롭게 의견을 표현할 권리가 다른 사람을 공격하거나 피해를 줄 권리까지 의미하지는 않습니다.**

## 2. 반드시 지켜야 할 이용 규칙

### ① 욕설·비방·괴롭힘 금지

다른 학생을 욕하거나 조롱하고, 고의로 상처를 주는 행위를 금지합니다.

**금지되는 행동의 예시**

- 특정 학생을 지목하여 욕설이나 조롱을 하는 행위
- 외모, 성격, 성적 등을 이유로 비하하는 행위
- 여러 사람이 한 학생을 집중적으로 공격하는 행위
- 지속적으로 시비를 걸거나 괴롭히는 행위
- 특정 학생을 위협하거나 협박하는 행위

**기본 제재**

- 단순한 비방·모욕: 3일 이용 제한
- 반복적인 비방·괴롭힘: 7\~30일 이용 제한
- 심각한 협박 또는 지속적인 집단 괴롭힘: 30일\~영구 이용 제한

해당 게시글이나 댓글은 삭제될 수 있습니다.

### ② 개인정보 무단 공개 금지

다른 사람의 개인정보를 허락 없이 공개해서는 안 됩니다.

**금지되는 행동의 예시**

- 친구의 전화번호나 주소를 공개하는 행위
- 허락 없이 친구의 사진을 올리는 행위
- 개인적인 대화 내용을 무단으로 공개하는 행위
- 특정 학생을 알아볼 수 있는 사적인 정보를 퍼뜨리는 행위
- 다른 사람의 비밀번호나 복구 코드를 공개하는 행위

이름을 직접 적지 않더라도, 게시글의 내용을 통해 특정 학생을 알아볼 수 있다면 문제가 될 수 있습니다.

**기본 제재**

- 개인정보 무단 공개: 7일 이용 제한
- 피해가 크거나 반복된 공개: 30일 이용 제한
- 악의적인 개인정보 유포: 영구 이용 제한 검토

문제가 되는 콘텐츠는 확인 후 신속하게 삭제하거나 접근을 제한합니다.

### ③ 허위 정보 및 소문 유포 금지

사실이 아닌 내용을 고의로 퍼뜨리거나, 확인되지 않은 소문을 사실처럼 작성해서는 안 됩니다.

**금지되는 행동의 예시**

- 확인되지 않은 소문으로 특정 학생을 비난하는 행위
- 학교에서 발표하지 않은 내용을 공식 공지처럼 작성하는 행위
- 수행평가 날짜나 시험 범위를 고의로 잘못 등록하는 행위
- 다른 사람에게 피해를 주기 위해 거짓 정보를 퍼뜨리는 행위

**기본 제재**

- 잘못된 정보의 단순 등록: 정정 요청 또는 게시물 수정·삭제
- 허위 정보의 고의적 등록: 3\~7일 이용 제한
- 반복적이거나 심각한 피해를 유발한 허위 정보: 7\~30일 이용 제한

**실수로 잘못된 정보를 작성한 것과 고의로 거짓 정보를 퍼뜨린 것은 구분합니다.**

잘못된 사실을 발견했다면 가능한 한 빠르게 수정해 주세요.

### ④ 도배·광고·게시판 이용 방해 금지

다른 사람이 게시판을 정상적으로 이용하지 못하도록 방해하는 행위를 금지합니다.

**금지되는 행동의 예시**

- 동일하거나 비슷한 게시글을 반복해서 올리는 행위
- 의미 없는 댓글을 과도하게 반복하는 행위
- 게시판의 목적과 관계없는 광고를 반복하는 행위
- 다른 사람을 불편하게 만들 목적으로 게시글을 대량 작성하는 행위

**기본 제재**

- 가벼운 위반: 안내 또는 경고
- 반복적인 도배·광고: 1\~3일 이용 제한
- 운영을 심각하게 방해하는 반복 행위: 7\~30일 이용 제한

문제가 되는 글이나 댓글은 삭제될 수 있습니다.

### ⑤ 익명게시판 악용 금지

익명게시판은 부담 없이 의견을 나누기 위한 공간입니다.

다른 사람을 괴롭히기 위한 공간이 아닙니다.

**금지되는 행동의 예시**

- 익명으로 특정 학생을 조롱하거나 비난하는 행위
- 익명성을 이용하여 거짓 소문을 퍼뜨리는 행위
- 자신이 누구인지 드러나지 않는다는 이유로 협박하는 행위
- 다른 이용자의 익명 작성자 신원을 알아내거나 공개하려는 행위

**기본 제재**

익명게시판에서도 일반 게시판과 동일한 제재 기준이 적용됩니다.

예를 들어 익명으로 특정 학생을 반복적으로 괴롭히면 7\~30일 이용 제한이 적용될 수 있습니다.

**익명은 다른 일반 이용자에게 닉네임을 공개하지 않는 기능이며, 완전한 신원 추적 불가능을 보장하는 기능은 아닙니다.**

### ⑥ 부적절한 투표 금지

다른 학생을 평가하거나 조롱하는 투표를 작성해서는 안 됩니다.

**금지되는 투표의 예시**

- 특정 학생 중 누가 가장 못생겼는지 묻는 투표
- 특정 학생을 싫어하는지 묻는 투표
- 특정 학생을 조롱하거나 망신 주기 위한 투표
- 개인의 사생활을 침해하는 투표
- 투표 결과를 부정한 방법으로 조작하는 행위

**기본 제재**

- 부적절한 투표: 삭제 및 3\~7일 이용 제한
- 특정 학생을 괴롭히기 위한 투표: 삭제 및 7\~30일 이용 제한
- 심각하거나 반복적인 괴롭힘: 영구 이용 제한 검토

### ⑦ 저작권 및 초상권 침해 금지

다른 사람이 만든 글, 사진, 그림, 학습 자료 등을 허락 없이 무단으로 게시하지 마세요.

**금지되는 행동의 예시**

- 유료 교재를 무단으로 촬영하여 배포하는 행위
- 유료 강의 영상이나 자료를 무단 공유하는 행위
- 다른 사람의 사진을 동의 없이 게시하는 행위
- 타인의 창작물을 자신의 것처럼 게시하는 행위

**기본 제재**

- 위반 콘텐츠 삭제 및 경고
- 고의적이거나 반복적인 침해: 3\~7일 이용 제한
- 중대한 반복 위반: 30일 이용 제한 검토

### ⑧ 계정 도용·사칭 금지

계정은 본인만 사용해야 합니다.

**금지되는 행동의 예시**

- 다른 사람의 계정에 무단 로그인하는 행위
- 타인의 아이디나 비밀번호를 알아내려는 행위
- 다른 학생이나 교사, 운영자를 사칭하는 행위
- 자신이 관리자라고 속이는 행위
- 제재를 피하기 위해 다른 계정을 악용하는 행위

**기본 제재**

- 일반적인 사칭: 7\~30일 이용 제한
- 계정 도용 또는 무단 접근: 30일\~영구 이용 제한
- 운영자 사칭을 이용한 피해 유발: 영구 이용 제한 검토

### ⑨ 서비스 공격 및 운영 방해 금지

스쿨팟을 고의로 공격하거나, 시스템을 악용하여 다른 이용자에게 피해를 주는 행위를 금지합니다.

**금지되는 행동의 예시**

- 다른 회원의 비공개 정보를 무단으로 조회하려는 행위
- 관리자 권한을 부정하게 취득하려는 행위
- 자동화된 대량 요청으로 서버에 장애를 발생시키는 행위
- 발견한 보안 취약점을 악용하는 행위

**기본 제재**

- 경미한 고의적 운영 방해: 7\~30일 이용 제한
- 무단 정보 접근 또는 심각한 서비스 공격: 영구 이용 제한 검토

보안 문제를 발견했다면 직접 악용하거나 다른 사람에게 공개하지 말고 운영자에게 제보해 주세요.

### ⑩ 불법·유해 콘텐츠 금지

불법적인 거래, 타인에게 위험을 주는 행동, 음란물 등 학생 커뮤니티에 부적절한 콘텐츠는 게시할 수 없습니다.

**기본 제재**

- 부적절한 콘텐츠: 삭제 및 7\~30일 이용 제한
- 중대한 불법 행위 또는 심각한 피해 발생: 영구 이용 제한 검토

긴급한 위험이나 실제 범죄가 의심되는 경우에는 사안에 따라 적절한 보호 조치나 관계기관의 도움이 필요할 수 있습니다.

---

## 3. 제재는 어떻게 적용되나요?

스쿨팟은 위반 내용과 피해 정도에 따라 다음과 같이 조치합니다.

| 제재     | 적용 내용                          |
| ------ | ------------------------------ |
| 안내     | 규정을 설명하고 자발적인 수정을 요청합니다.       |
| 경고     | 규정 위반 사실을 알리고 재발 방지를 요청합니다.    |
| 게시물 삭제 | 문제가 있는 게시글·댓글·투표 등을 삭제합니다.     |
| 1일 제한  | 24시간 동안 정해진 서비스 기능의 이용을 제한합니다. |
| 3일 제한  | 72시간 동안 정해진 서비스 기능의 이용을 제한합니다. |
| 7일 제한  | 7일 동안 정해진 서비스 기능의 이용을 제한합니다.   |
| 30일 제한 | 30일 동안 정해진 서비스 기능의 이용을 제한합니다.  |
| 영구 제한  | 해제 결정 전까지 해당 계정의 이용을 제한합니다.    |

### 제재 적용 시 알아둘 점

1. **반드시 경고부터 시작하지 않습니다.** 피해가 큰 위반은 처음 발생했더라도 강한 제재를 적용할 수 있습니다.
2. **게시물 삭제와 이용 제한은 함께 적용될 수 있습니다.**
3. **반복 위반 시 제재가 강화될 수 있습니다.**
4. 실수인지 고의인지, 피해가 어느 정도인지, 위반이 반복되었는지 등을 함께 고려합니다.
5. 같은 잘못이라도 구체적인 상황에 따라 제재가 달라질 수 있습니다.
6. 하나의 행위가 여러 규칙을 위반한 경우 가장 심각한 위반을 중심으로 판단합니다. 여러 제재 기간을 무조건 합산하지 않습니다.
7. 이용 제한이 끝났더라도 새로운 위반이 발생하면 과거 위반 이력을 고려할 수 있습니다.
8. 영구 이용 제한은 자동으로 해제되지 않으며, 재검토를 통해 변경될 수 있습니다.

**이용 제한의 범위:** 실제 제한되는 기능은 계정 제재 방식에 따라 달라질 수 있습니다. 제재 통지에는 이용할 수 없는 기능과 제한 기간을 구체적으로 안내해야 합니다.

### 반복 위반은 어떻게 판단하나요?

같은 유형의 규칙을 여러 차례 위반하거나, 경고·제재 이후에도 비슷한 위반을 계속하는 경우 반복 위반으로 판단할 수 있습니다.

이전에 제재받았다는 이유만으로 모든 새로운 위반에 무조건 더 강한 조치를 적용하는 것은 아닙니다.

위반 사이의 기간, 행위의 유사성, 피해 정도를 함께 검토합니다.

---

## 4. 신고는 어떻게 하나요?

규칙을 위반한 게시글이나 댓글을 발견하면 **신고 기능**을 이용해 주세요.

### 신고할 수 있는 상황

- 욕설이나 괴롭힘을 발견했을 때
- 개인정보가 무단으로 공개되었을 때
- 허위 정보가 게시되었을 때
- 불법적이거나 부적절한 콘텐츠를 발견했을 때
- 기타 이용 규정을 위반한 내용을 발견했을 때

### 신고 시 유의사항

1. 가능한 한 정확한 이유를 작성해 주세요.
2. 마음에 들지 않는다는 이유만으로 무분별하게 신고하지 마세요.
3. 허위 신고를 반복하거나 특정 이용자를 괴롭히기 위해 신고 기능을 악용해서는 안 됩니다.
4. 신고가 접수되었다고 해서 해당 회원이 자동으로 제재되는 것은 아닙니다.
5. 운영자는 신고 내용을 확인한 뒤 필요한 조치를 결정합니다.

단순한 의견 차이만으로는 일반적으로 규정 위반이라고 판단하지 않습니다.

**신고 기능을 고의로 악용하는 행위**는 경고 대상이 될 수 있으며, 반복하거나 다른 이용자에게 피해를 주는 경우 1\~7일 이용 제한이 적용될 수 있습니다.

---

## 5. 억울하게 제재받았다면?

운영자의 판단에 오류가 있다고 생각한다면 재검토를 요청할 수 있습니다.

### 재검토 요청 방법

1. **서비스 안내 → 건의·오류 제보** 메뉴로 이동합니다.
2. 문의 유형을 선택합니다.
3. 제재받은 내용과 재검토를 원하는 이유를 작성합니다.
4. 운영자의 답변을 확인합니다.

재검토 과정에서는 다음 내용을 확인할 수 있습니다.

- 실제로 규정을 위반했는지
- 제재 기준이 적절하게 적용되었는지
- 다른 사람의 신고 내용에 오류가 있는지
- 추가로 확인해야 할 사실이 있는지

확인 결과에 따라 제재가 유지, 축소, 해제될 수 있습니다.

단, 다른 이용자의 개인정보 또는 비공개 신고 내용은 제공되지 않을 수 있습니다.

제재 중 문의 기능을 사용할 수 없는 경우에도 재검토를 요청할 수 있도록 운영자가 별도 접수 방법을 안내해야 합니다.

---

## 6. 학년·반 및 학교생활 정보 이용

스쿨팟의 수행평가 정보는 학년과 반별로 구분됩니다.

### 학년·반 등록 규칙

- 반드시 본인의 실제 학년과 반을 선택해야 합니다.
- 잘못 등록했다면 관리자에게 정정을 요청해 주세요.
- 다른 반의 정보를 조회하기 위해 소속을 허위로 등록해서는 안 됩니다.
- 다른 사람의 학년·반 정보를 이용하여 계정을 만들어서는 안 됩니다.

고의적인 허위 소속 등록은 정정 요청 및 경고 대상이며, 다른 사람의 정보에 무단 접근하는 등의 피해를 일으킨 경우 더 강한 제재를 적용할 수 있습니다.

**기존 회원의 학년·반 등록**

기존 회원 중 학년과 반을 등록하지 않은 학생은 아래 주소에 접속해 주세요.

[학년·반 등록하기](https://숏.한국/스쿨팟소속/)

학년과 반을 등록해야 본인 반의 수행평가 일정을 확인하고 공유할 수 있습니다.

### 수행평가 정보 이용 시 주의사항

- 다른 학생이 작성한 일정에 오류가 있을 수 있습니다.
- 실제 일정은 담당 선생님의 공식 안내를 우선합니다.
- 잘못된 일정을 발견하면 수정 요청을 이용해 주세요.
- 고의로 잘못된 일정을 등록하여 학생들에게 혼란을 주는 행위는 제재 대상입니다.

---

## 7. 개인정보와 계정은 어떻게 보호하나요?

계정과 개인정보를 안전하게 관리하기 위해 다음 사항을 지켜 주세요.

1. 비밀번호와 복구 코드는 다른 사람에게 알려주지 마세요.
2. 다른 사람의 계정에 로그인하지 마세요.
3. 게시글에 불필요한 개인정보를 작성하지 마세요.
4. 타인의 개인정보를 발견했다면 무단으로 공유하거나 확산하지 마세요.
5. 공용 기기에서는 사용을 마친 뒤 로그아웃해 주세요.
6. 계정에 이상이 생겼다면 운영자에게 알려주세요.

게시글 삭제 또는 회원탈퇴만으로 모든 외부 백업이나 기록이 즉시 사라진다고 보장되는 것은 아닙니다. 개인정보의 처리와 보관에 관한 자세한 내용은 별도의 개인정보 처리방침을 확인해 주세요.

---

## 8. 운영자는 어떤 기준으로 관리하나요?

운영자는 다음 원칙을 지키도록 노력합니다.

1. 이용 규정에 따라 일관되고 공정하게 판단합니다.
2. 특정 학생을 개인적인 이유로 차별하지 않습니다.
3. 제재가 필요한 경우 위반 내용과 피해 정도를 확인합니다.
4. 필요 이상으로 강한 제재를 적용하지 않습니다.
5. 회원이 제재 사유를 이해할 수 있도록 안내합니다.
6. 정당한 재검토 요청을 확인합니다.
7. 회원의 개인정보와 비공개 신고 내용을 보호합니다.
8. 운영자 권한을 개인적인 목적으로 악용하지 않습니다.

긴급하게 피해 확산을 막아야 하는 경우에는 사실관계가 모두 확인되기 전이라도 콘텐츠를 임시로 숨기는 등 필요한 보호 조치를 할 수 있습니다. 이후 확인 결과에 따라 조치를 유지하거나 해제해야 합니다.

---

## 9. 서비스 이용 시 꼭 알아두세요

- 스쿨팟은 학교의 공식 공지 채널이 아닙니다.
- 학교 일정과 수행평가 정보는 실제 학교 안내를 우선합니다.
- 서비스는 업데이트와 점검으로 일시적으로 이용할 수 없을 수 있습니다.
- 운영 중 발견된 문제는 건의·오류 제보를 통해 알려주세요.
- 이용 규정은 운영 상황에 따라 개정될 수 있습니다.
- 규정이 변경되는 경우 시행일과 주요 변경 내용을 공지합니다.
- 변경된 규정은 별도로 명시하지 않는 한 시행일 이후의 활동에 적용합니다.

---

## 10. 자주 묻는 질문

**Q. 친구와 의견이 다르다고 신고당하면 제재받나요?**

아니요. 단순한 의견 차이나 정중한 비판은 일반적으로 규정 위반이 아닙니다. 다만 상대방을 모욕하거나 괴롭히는 표현이 포함된다면 문제가 될 수 있습니다.

**Q. 익명게시판이면 아무 말이나 해도 되나요?**

아니요. 익명게시판에도 모든 이용 규정이 동일하게 적용됩니다.

**Q. 친구가 허락한 사진은 게시해도 되나요?**

게시 목적과 공개 범위를 충분히 설명하고 허락받아야 합니다. 사진에 다른 사람이 함께 나온 경우에도 주의해야 합니다.

**Q. 실수로 수행평가 날짜를 잘못 올렸습니다. 제재받나요?**

단순한 실수라면 일반적으로 정정을 먼저 요청합니다. 고의로 거짓 정보를 작성하거나 피해를 유발한 경우 제재할 수 있습니다.

**Q. 경고를 한 번 받으면 다음에는 무조건 이용 제한을 받나요?**

아니요. 새로운 위반의 내용과 심각성, 기존 위반과의 관련성을 확인한 후 결정합니다.

**Q. 게시글이 삭제되면 이용 제한도 함께 적용되나요?**

반드시 그렇지는 않습니다. 잘못 올린 글을 삭제하는 것으로 끝날 수도 있으며, 심각한 위반이라면 이용 제한이 함께 적용될 수 있습니다.

**Q. 규칙을 어긴 사람을 직접 공개하거나 비난해도 되나요?**

안 됩니다. 문제가 있는 게시글은 신고해 주세요. 다른 이용자를 공개적으로 비난하거나 개인정보를 퍼뜨리는 행위도 규정 위반이 될 수 있습니다.

**Q. 운영자의 제재가 부당하다고 생각하면 어떻게 하나요?**

건의·오류 제보를 통해 재검토를 요청할 수 있습니다.

**Q. 제재받은 사람이 다른 계정을 만들면 되나요?**

제재를 피하기 위해 다른 계정을 악용하는 것은 금지됩니다. 기존 제재와 관련된 사안을 확인하여 추가 조치를 검토할 수 있습니다.

---

## 마지막으로

스쿨팟은 학생들이 서로 도움을 주고받으며 함께 만들어 가는 공간입니다.

**내가 작성한 글을 다른 사람이 읽었을 때 어떤 기분일지 한 번만 생각해 주세요.**

서로의 생각을 존중하고, 필요한 정보를 나누고, 잘못된 점은 함께 개선해 나간다면 스쿨팟은 모두에게 유용한 서비스가 될 수 있습니다.

안전하고 즐거운 커뮤니티를 만들기 위한 여러분의 협조를 부탁드립니다.

**스쿨팟 운영자 드림**
$original_summary$,$original_full$# 스쿨팟(SchoolPot) 커뮤니티 이용 및 운영 규정

**문서 버전:** 1.0  
**시행일:** 2026년 11월 13일  
**적용 대상:** 스쿨팟의 모든 이용자 및 운영자  
**운영 대상:** 안남중학교 학생  
**서비스:** [스쿨팟 바로가기](https://codexora-dev.github.io/SchoolPot/)

---

# 제1장. 총칙

## 제1조 (목적)

① 본 규정은 스쿨팟(SchoolPot, 이하 '서비스')의 운영 원칙과 이용 기준을 정하고, 이용자의 권리 및 의무, 금지 행위, 위반 시 제재 기준, 신고 및 이의신청 절차 등을 명확히 하는 것을 목적으로 한다.

② 본 규정은 다음 사항을 달성하기 위해 마련한다.

1. 이용자의 자유롭고 건전한 의사소통 보장
2. 학생 간 상호 존중 및 안전한 커뮤니티 환경 조성
3. 개인정보와 이용자의 권익 보호
4. 잘못된 정보 및 유해 콘텐츠의 확산 방지
5. 공정하고 일관된 서비스 운영
6. 운영자의 자의적인 제재 및 권한 남용 방지
7. 이용자와 운영자 간 분쟁 예방 및 해결

③ 본 규정은 서비스를 이용하는 모든 회원과 운영자에게 적용한다.

## 제2조 (용어의 정의)

본 규정에서 사용하는 용어의 뜻은 다음과 같다.

1. **서비스:** 스쿨팟에서 제공하는 커뮤니티, 학교생활 정보, 계정 관리 등 모든 기능
2. **이용자:** 서비스에 방문하거나 서비스를 이용하는 사람
3. **회원:** 회원가입을 완료하여 계정을 보유한 이용자
4. **운영자:** 서비스 관리 권한을 부여받아 운영 업무를 수행하는 사람
5. **게시물:** 게시글, 댓글, 답글, 투표 및 그 밖에 이용자가 서비스에 등록한 콘텐츠
6. **익명 게시물:** 일반 이용자에게 작성자의 닉네임을 표시하지 않는 게시물
7. **신고:** 다른 이용자의 규정 위반 의심 행위를 운영자에게 알리는 행위
8. **제재:** 규정 위반에 대해 운영자가 취하는 경고, 게시물 삭제, 계정 이용 제한 등의 조치
9. **이용 제한:** 일정 기간 또는 해제 결정 전까지 서비스의 일부 또는 전체 기능을 이용하지 못하도록 하는 조치
10. **이의신청:** 운영자의 제재에 대해 재검토를 요청하는 절차
11. **반복 위반:** 이전 위반에 대한 안내 또는 조치 이후 동일하거나 유사한 규정을 다시 위반하는 행위
12. **중대한 위반:** 개인정보 침해, 심각한 괴롭힘, 계정 도용 등 이용자에게 큰 피해를 주거나 서비스의 안전을 위협하는 행위

## 제3조 (서비스의 성격)

① 스쿨팟은 안남중학교 학생들의 소통과 학교생활 편의를 위한 커뮤니티 서비스이다.

② 스쿨팟은 학교의 공식 홈페이지나 공식 공지 채널이 아니다.

③ 이용자가 작성한 게시물은 해당 이용자의 의견이며, 학교 또는 운영자의 공식 입장을 의미하지 않는다.

④ 시험, 수행평가, 학사일정 등의 정보는 실제 학교 또는 담당 교사의 공식 안내를 우선한다.

⑤ 운영자는 서비스의 안정성과 정확성을 높이기 위해 노력하나, 이용자가 작성하는 모든 정보의 정확성을 보장하지는 않는다.

## 제4조 (규정의 적용 및 변경)

① 본 규정은 시행일부터 적용한다.

② 운영자는 운영 환경, 이용자의 의견, 관계 법령의 변경 등을 고려하여 규정을 개정할 수 있다.

③ 규정을 개정하는 경우 변경 내용과 시행일을 서비스 공지사항에 안내한다.

④ 이용자에게 불리한 중요한 변경은 원칙적으로 시행 최소 7일 전에 안내한다. 다만 긴급한 보안 문제나 이용자 보호를 위한 조치는 예외로 할 수 있다.

⑤ 새로운 규정은 특별한 사유가 없는 한 시행일 이후의 행위에 적용한다.

⑥ 규정에 명시되지 않은 사안은 유사 조항, 위반의 심각성, 이용자 보호 필요성 및 관계 법령을 고려하여 합리적으로 판단한다.

⑦ 규정에 없는 행위에 대해 새로운 제재 기준을 적용해야 하는 경우에는 자의적인 판단을 피하고, 가능한 한 사전에 규정을 보완한다.

---

# 제2장. 회원가입 및 계정 관리

## 제5조 (이용 대상)

① 스쿨팟은 안남중학교 학생의 이용을 목적으로 운영한다.

② 회원가입 시 별도의 재학생 인증을 시행하지 않으므로, 회원가입 사실만으로 해당 이용자가 실제 재학생임이 확인된 것은 아니다.

③ 이용자는 본인의 소속 정보를 사실대로 입력해야 한다.

④ 운영자는 명백한 허위 등록이나 다른 이용자의 권리 침해가 확인된 경우 필요한 조치를 할 수 있다.

## 제6조 (회원가입)

① 회원가입을 원하는 이용자는 서비스에서 정한 방식에 따라 아이디와 비밀번호를 설정해야 한다.

② 회원가입 및 이용 과정에서 타인을 사칭하거나 다른 사람의 정보를 무단으로 사용해서는 안 된다.

③ 회원은 아이디와 비밀번호를 안전하게 관리해야 한다.

④ 회원가입 과정에서 발급되는 계정 복구 코드는 회원 본인이 안전하게 보관해야 한다.

⑤ 운영자는 회원에게 비밀번호 또는 복구 코드 자체를 전달하도록 요구하지 않는다.

## 제7조 (학년 및 반 등록)

① 회원은 본인의 실제 학년과 반을 등록해야 한다.

② 학년과 반은 수행평가 등 학급별 정보의 접근 범위를 결정하는 데 사용된다.

③ 다음 행위를 금지한다.

1. 다른 반의 정보를 조회하기 위한 허위 소속 등록
2. 타인의 소속 정보를 이용한 계정 생성
3. 허위 소속을 이용한 정보 수집
4. 관리자에게 고의로 거짓 정정 사유를 전달하는 행위

④ 실수로 학년 또는 반을 잘못 선택한 경우에는 운영자에게 정정을 요청할 수 있다.

⑤ 단순한 입력 실수는 원칙적으로 제재하지 않으며, 정정 절차를 안내한다.

⑥ 고의적인 허위 소속 등록은 경고 또는 3일 이용 제한의 대상이 될 수 있다.

⑦ 허위 소속을 이용해 다른 회원의 비공개 정보에 접근하거나 피해를 유발한 경우에는 7~30일 이용 제한 또는 더 강한 조치를 검토할 수 있다.

**기존 회원 등록 안내**

기존 회원 중 학년과 반을 등록하지 않은 회원은 아래 주소에서 등록할 수 있다.

[학년·반 등록하기](https://숏.한국/스쿨팟소속/)

## 제8조 (계정 보안)

① 회원은 계정 정보를 다른 사람에게 알려주지 않도록 주의해야 한다.

② 다른 회원의 계정에 무단으로 접근해서는 안 된다.

③ 타인의 비밀번호나 복구 코드를 수집하거나 요구해서는 안 된다.

④ 계정 도용이 의심될 경우 운영자에게 신고할 수 있다.

⑤ 운영자는 계정 도용이 의심되는 경우 피해 확산을 막기 위한 보호 조치를 검토할 수 있다.

## 제9조 (회원탈퇴)

① 회원은 서비스에서 제공하는 계정 관리 기능을 통해 회원탈퇴를 요청할 수 있다.

② 회원탈퇴 시 계정과 연결된 게시물 등 관련 정보가 삭제될 수 있다.

③ 다른 사람이 작성한 답글도 게시물 구조에 따라 함께 삭제될 수 있다.

④ 회원탈퇴 후 삭제된 자료는 복구되지 않을 수 있다.

⑤ 개인정보의 삭제 및 보관에 관한 자세한 내용은 별도의 개인정보 처리방침에 따른다.

⑥ 회원탈퇴를 이유로 이전 행위의 법적 책임이 자동으로 없어지는 것은 아니다.

---

# 제3장. 게시물 작성 및 이용

## 제10조 (게시물 작성의 기본 원칙)

① 회원은 게시판의 목적에 맞는 게시물을 작성해야 한다.

② 게시물의 제목과 본문은 다른 이용자가 내용을 이해할 수 있도록 작성하는 것을 원칙으로 한다.

③ 회원은 자신의 게시물로 인해 다른 사람의 권리나 이익이 침해되지 않도록 주의해야 한다.

④ 사실관계가 중요한 정보는 가능한 한 확인한 후 작성해야 한다.

⑤ 다른 사람의 의견과 다르다는 이유만으로 공격하거나 조롱해서는 안 된다.

⑥ 법령과 본 규정을 준수하는 정중한 비판 및 의견 표현은 허용된다.

## 제11조 (게시판별 이용 기준)

① 자유게시판에서는 학교생활, 일상, 취미 등 다양한 주제로 소통할 수 있다.

② 익명게시판에서는 닉네임을 공개하지 않고 의견을 표현할 수 있으나, 일반 게시판과 동일한 규정을 준수해야 한다.

③ 질문게시판에서는 학교생활과 학습 등에 관한 질문과 답변을 작성할 수 있다.

④ 공부게시판에서는 학습 방법, 정보, 자료 등을 공유할 수 있다. 단, 저작권을 침해하거나 평가의 공정성을 해치는 자료는 공유할 수 없다.

⑤ 분실물게시판에서는 분실하거나 습득한 물건에 대한 정보를 공유할 수 있다. 물품 반환 과정에서 불필요한 개인정보를 요구해서는 안 된다.

⑥ 동아리게시판에서는 동아리 활동, 모집 등 관련 정보를 공유할 수 있다. 허위 모집과 사칭은 금지한다.

⑦ 투표게시판에서는 건전한 주제로 투표를 실시할 수 있다. 특정인을 조롱하거나 사생활을 침해하는 투표는 금지한다.

⑧ 게시판의 운영 목적에 맞지 않는 콘텐츠는 운영자가 다른 게시판으로 이동하도록 안내하거나 삭제할 수 있다. 단, 단순한 게시판 선택 실수만으로 중한 제재를 적용하지 않는다.

## 제12조 (댓글 및 답글)

① 댓글과 답글에는 게시글과 동일한 규정이 적용된다.

② 다음 행위를 금지한다.

1. 특정 이용자에 대한 반복적인 시비
2. 욕설, 모욕 및 조롱
3. 논의와 무관한 개인정보 공개
4. 의미 없는 댓글의 반복 작성
5. 집단적인 댓글 공격
6. 상대방의 발언을 고의로 왜곡하여 비난하는 행위

③ 정중한 반론, 비판, 토론은 허용한다.

④ 댓글을 이용한 위반도 해당 위반 항목과 동일한 기준으로 제재할 수 있다.

---

# 제4장. 금지 행위 및 세부 제재 기준

## 제13조 (욕설 및 모욕)

① 특정 이용자에게 욕설하거나 모욕적인 표현을 사용하는 행위를 금지한다.

② 제재 기준은 다음과 같다.

| 위반 유형 | 기본 제재 |
|---|---|
| 경미한 부적절 표현 | 안내 또는 경고 |
| 특정인을 향한 명백한 욕설·모욕 | 3일 이용 제한 |
| 반복적인 욕설·모욕 | 7일 이용 제한 |
| 지속적인 인신공격 | 7~30일 이용 제한 |
| 심각한 피해를 동반한 반복적 모욕 | 30일~영구 이용 제한 검토 |

③ 운영자는 표현이 사용된 상황과 전후 문맥을 고려한다.

④ 특정인을 공격하지 않은 일반적인 감탄 표현 등을 무조건 모욕으로 판단하지 않는다.

⑤ 정중한 비판과 의견 차이는 본 조의 위반으로 보지 않는다.

## 제14조 (괴롭힘 및 집단 공격)

① 특정 이용자를 지속적으로 괴롭히거나 여러 이용자가 집단적으로 공격하는 행위를 금지한다.

② 다음 행위는 괴롭힘에 해당할 수 있다.

1. 특정 학생을 반복적으로 조롱하는 행위
2. 다른 이용자에게 특정 학생을 공격하도록 유도하는 행위
3. 특정 학생에 관한 비방 게시글을 지속적으로 작성하는 행위
4. 원하지 않는 공격적 언급을 반복하는 행위
5. 따돌림이나 집단적 배척을 조장하는 행위

③ 제재 기준은 다음과 같다.

| 위반 유형 | 기본 제재 |
|---|---|
| 경미한 괴롭힘 | 3~7일 제한 |
| 반복적인 괴롭힘 | 7~30일 제한 |
| 집단적 괴롭힘 주도 | 30일 제한 |
| 중대한 피해를 유발한 지속적인 괴롭힘 | 영구 제한 검토 |

④ 심각한 피해가 의심되는 경우 운영자는 추가 피해를 막기 위한 조치를 우선 검토한다.

⑤ 운영자는 피해를 주장한 회원에게 공개적인 해명을 강요하지 않는다.

## 제15조 (협박 및 위협)

① 다른 이용자에게 위해를 가하겠다고 위협하거나 공포심을 조성하는 행위를 금지한다.

② 실제 위해를 가할 의사가 확인되지 않았더라도 표현의 내용과 상황에 따라 위반이 될 수 있다.

③ 제재 기준은 다음과 같다.

| 위반 유형 | 기본 제재 |
|---|---|
| 위협적인 표현 | 7일 제한 |
| 명백한 협박 | 30일 제한 |
| 반복적이거나 중대한 협박 | 영구 제한 검토 |

④ 긴급한 보호가 필요한 상황에서는 이용 제한과 별개로 신뢰할 수 있는 보호자, 학교 담당자 또는 관계기관의 도움이 필요할 수 있다.

## 제16조 (차별 및 혐오 표현)

① 성별, 장애, 출신, 외모 등 개인의 특성을 이유로 다른 사람을 비하하거나 차별을 조장하는 행위를 금지한다.

② 다음 행위가 이에 해당한다.

1. 개인의 특성을 이유로 한 모욕
2. 특정 집단에 대한 적대감 조장
3. 차별적인 표현을 이용한 지속적 조롱
4. 특정인을 배제하거나 괴롭히도록 선동하는 행위

③ 제재 기준은 다음과 같다.

| 위반 유형 | 기본 제재 |
|---|---|
| 경미한 차별적 표현 | 경고 또는 3일 제한 |
| 명백한 혐오·차별 표현 | 7일 제한 |
| 반복적 차별 및 공격 | 30일 제한 |
| 중대한 피해를 동반한 지속적인 행위 | 영구 제한 검토 |

④ 차별 문제에 관한 학술적 설명이나 정중한 토론 자체를 금지하지는 않는다.

## 제17조 (개인정보 침해)

① 타인의 개인정보를 동의 없이 공개하거나 수집·유포하는 행위를 금지한다.

② 보호 대상에는 다음 정보가 포함될 수 있다.

1. 전화번호, 주소 및 개인 연락처
2. 계정 정보 및 복구 코드
3. 개인적인 대화 내용
4. 동의 없이 공개되는 사진 또는 영상
5. 개인을 식별할 수 있는 사적인 정보
6. 다른 이용자의 비공개 계정 정보

③ 여러 정보를 결합하여 특정인을 식별할 수 있는 경우에도 개인정보 침해가 될 수 있다.

④ 제재 기준은 다음과 같다.

| 위반 유형 | 기본 제재 |
|---|---|
| 경미한 개인정보 무단 공개 | 삭제 및 7일 제한 |
| 명백한 사생활 침해 | 삭제 및 30일 제한 |
| 악의적인 개인정보 유포 | 영구 제한 검토 |
| 개인정보 탈취 또는 도용 | 영구 제한 검토 |

⑤ 개인정보가 포함된 게시물은 추가 확산을 막기 위해 우선 삭제하거나 접근을 제한할 수 있다.

⑥ 개인정보가 공개되었다는 사실을 알게 된 회원은 해당 정보를 재게시하지 말고 신고해야 한다.

## 제18조 (허위 정보 및 소문 유포)

① 고의로 허위 정보를 작성하거나 확인되지 않은 소문을 사실처럼 유포하는 행위를 금지한다.

② 다음 행위를 금지한다.

1. 특정 학생에 관한 허위 사실 유포
2. 허위 학교 공지 작성
3. 시험 및 수행평가 정보의 고의적인 조작
4. 다른 사람의 평판을 해치기 위한 거짓 정보 게시
5. 사실과 다른 내용을 반복적으로 확산하는 행위

③ 제재 기준은 다음과 같다.

| 위반 유형 | 기본 제재 |
|---|---|
| 단순한 정보 오류 | 정정 요청 |
| 확인되지 않은 정보의 부주의한 확산 | 안내 또는 경고 |
| 고의적인 허위 정보 게시 | 3~7일 제한 |
| 반복적인 허위 정보 유포 | 7~30일 제한 |
| 중대한 피해를 유발한 악의적 유포 | 30일~영구 제한 검토 |

④ 운영자는 고의성과 피해 정도를 구분하여 판단한다.

⑤ 의견이나 예측을 사실과 명확하게 구분하여 작성한 경우 이를 무조건 허위 정보로 판단하지 않는다.

## 제19조 (도배 및 스팸)

① 게시판의 정상적인 이용을 방해하는 반복 게시 행위를 금지한다.

② 다음 행위를 도배 또는 스팸으로 판단할 수 있다.

1. 동일한 게시글의 반복 작성
2. 의미 없는 댓글의 반복 등록
3. 자동화된 대량 게시
4. 광고성 게시물의 반복 등록
5. 다른 게시글의 이용을 방해할 정도의 연속 작성

③ 제재 기준은 다음과 같다.

| 위반 유형 | 기본 제재 |
|---|---|
| 실수로 중복 작성 | 안내 또는 중복 글 정리 |
| 경미한 도배 | 경고 |
| 반복적인 도배 | 1~3일 제한 |
| 고의적인 대량 스팸 | 7일 제한 |
| 서비스 장애를 유발한 반복 도배 | 30일 제한 검토 |

④ 짧은 시간에 여러 글을 작성했다는 이유만으로 도배로 확정하지 않는다. 게시물의 목적과 내용도 함께 고려한다.

## 제20조 (광고 및 상업적 이용)

① 사전 허용 없이 게시판을 반복적인 광고나 상업적 홍보 목적으로 이용하는 행위를 제한할 수 있다.

② 다음 행위를 금지한다.

1. 무분별한 광고 게시
2. 사기성 판매 또는 허위 홍보
3. 이용자를 속이는 외부 사이트 유도
4. 불법적인 상품이나 서비스 홍보

③ 제재 기준은 다음과 같다.

| 위반 유형 | 기본 제재 |
|---|---|
| 게시판 목적에 맞지 않는 홍보 | 삭제 또는 경고 |
| 반복적인 상업 광고 | 3일 제한 |
| 기만적인 홍보 또는 사기성 게시물 | 30일 제한 |
| 중대한 사기 또는 불법 행위 | 영구 제한 검토 |

④ 학생들의 정상적인 동아리 활동 및 학교 관련 행사 안내는 일반적인 상업 광고와 구분한다.

## 제21조 (부적절한 투표)

① 특정 학생의 인격이나 권리를 침해하는 투표를 금지한다.

② 다음 유형의 투표를 금지한다.

1. 특정 학생의 외모를 평가하는 투표
2. 특정 학생을 싫어하는지 묻는 투표
3. 특정 학생을 망신 주기 위한 투표
4. 다른 사람의 사생활을 평가하는 투표
5. 타인을 괴롭히기 위한 집단적 투표
6. 투표 결과를 고의로 조작하는 행위

③ 제재 기준은 다음과 같다.

| 위반 유형 | 기본 제재 |
|---|---|
| 부적절한 투표 | 삭제 및 3일 제한 |
| 특정인을 모욕하는 투표 | 삭제 및 7일 제한 |
| 집단적 괴롭힘 목적의 투표 | 삭제 및 30일 제한 |
| 심각한 피해를 동반한 반복 위반 | 영구 제한 검토 |

④ 건전한 의견 조사와 학교생활 관련 투표는 허용한다.

## 제22조 (저작권 및 초상권 침해)

① 타인의 저작물이나 사진을 이용할 때는 관련 권리를 존중해야 한다.

② 다음 행위를 금지한다.

1. 유료 학습 자료의 무단 배포
2. 타인의 창작물을 자신의 것으로 표시하는 행위
3. 타인의 사진을 허락 없이 게시하여 권리를 침해하는 행위
4. 저작권 침해가 명백한 콘텐츠의 반복 공유

③ 제재 기준은 다음과 같다.

| 위반 유형 | 기본 제재 |
|---|---|
| 경미한 권리 침해 | 삭제 및 경고 |
| 고의적인 무단 배포 | 3~7일 제한 |
| 반복적인 권리 침해 | 30일 제한 |
| 중대한 침해의 반복 | 영구 제한 검토 |

④ 저작권 침해 여부가 명확하지 않은 경우 운영자는 구체적인 상황과 자료를 확인한 후 판단한다.

## 제23조 (사칭 및 계정 도용)

① 다른 학생, 교직원, 운영자 등을 사칭하는 행위를 금지한다.

② 타인의 계정에 무단으로 접근하거나 계정 정보를 탈취하는 행위를 금지한다.

③ 제재 기준은 다음과 같다.

| 위반 유형 | 기본 제재 |
|---|---|
| 타인을 속이는 일반적인 사칭 | 7일 제한 |
| 반복적인 사칭 | 30일 제한 |
| 계정 무단 접근 또는 도용 | 30일~영구 제한 |
| 운영자 사칭을 이용한 피해 유발 | 영구 제한 검토 |

④ 단순히 비슷한 닉네임을 사용했다는 이유만으로 사칭으로 판단하지 않는다. 다른 사람을 속이려는 의도와 실제 혼동 가능성 등을 확인한다.

## 제24조 (서비스 공격 및 보안 침해)

① 서비스의 안정성이나 다른 이용자의 정보를 위협하는 행위를 금지한다.

② 다음 행위는 중대한 위반에 해당할 수 있다.

1. 관리자 권한의 부정한 취득
2. 타인 계정이나 비공개 데이터에 대한 무단 접근
3. 서버에 과도한 요청을 보내 장애를 유발하는 행위
4. 시스템 취약점을 악용한 정보 탈취
5. 서비스의 데이터를 무단으로 변조하거나 삭제하는 행위

③ 제재 기준은 다음과 같다.

| 위반 유형 | 기본 제재 |
|---|---|
| 경미한 고의적 운영 방해 | 7일 제한 |
| 반복적인 운영 방해 | 30일 제한 |
| 무단 접근 및 정보 침해 | 영구 제한 검토 |
| 중대한 시스템 공격 및 정보 탈취 | 영구 제한 검토 |

④ 단순히 오류를 발견하거나 정상적인 방법으로 제보하는 행위는 제재 대상이 아니다.

⑤ 운영자는 보안 사고 발생 시 피해 확산 방지와 필요한 신고·통지 등 법적 의무를 별도로 검토한다.

## 제25조 (불법 및 유해 콘텐츠)

① 관계 법령에 위반되거나 학생 커뮤니티의 안전을 심각하게 해치는 콘텐츠를 게시해서는 안 된다.

② 금지 대상에는 불법 거래, 성적 착취나 괴롭힘, 심각한 위협, 위험한 행위의 조장 등이 포함된다.

③ 제재 기준은 다음과 같다.

| 위반 유형 | 기본 제재 |
|---|---|
| 부적절한 유해 콘텐츠 | 삭제 및 7일 제한 |
| 반복적이거나 중대한 유해 콘텐츠 | 30일 제한 |
| 명백한 중대한 불법 행위 | 영구 제한 검토 |

④ 운영자는 위반이 의심된다는 사실만으로 범죄가 확정된 것처럼 공개적으로 발표하지 않는다.

⑤ 실제 위험에 처한 학생이 도움을 요청하는 게시물은 위험 행위를 조장하는 콘텐츠와 구별하며, 필요한 보호와 도움을 우선한다.

## 제26조 (신고 기능 악용)

① 신고 기능은 실제 위반이 의심되는 사안을 알리기 위한 목적으로 이용해야 한다.

② 다음 행위를 금지한다.

1. 특정 이용자를 괴롭히기 위한 반복적인 허위 신고
2. 사실을 조작한 신고
3. 신고를 이용한 협박
4. 여러 계정을 이용한 조직적인 허위 신고

③ 제재 기준은 다음과 같다.

| 위반 유형 | 기본 제재 |
|---|---|
| 단순한 오해에 따른 신고 | 제재 없음 |
| 명백한 악의적 허위 신고 | 경고 |
| 반복적인 허위 신고 | 1~7일 제한 |
| 심각한 피해를 유발한 조직적 신고 악용 | 30일 제한 검토 |

④ 신고 내용이 사실로 확인되지 않았다는 이유만으로 허위 신고로 판단하지 않는다.

---

# 제5장. 제재의 종류 및 적용 원칙

## 제27조 (제재의 종류)

① 운영자가 적용할 수 있는 제재는 다음과 같다.

| 구분 | 제재 | 내용 |
|---|---|---|
| A | 안내 | 이용 규정 설명 및 수정 요청 |
| B | 경고 | 위반 사실과 재발 방지 요청 |
| C | 콘텐츠 조치 | 게시물 삭제 또는 접근 제한 |
| D | 1일 제한 | 24시간 이용 제한 |
| E | 3일 제한 | 72시간 이용 제한 |
| F | 7일 제한 | 7일 이용 제한 |
| G | 30일 제한 | 30일 이용 제한 |
| H | 영구 제한 | 별도 해제 결정 전까지 이용 제한 |

② 게시물 삭제와 이용 제한은 필요에 따라 함께 적용할 수 있다.

③ 이용 제한의 정확한 범위는 실제 서비스가 지원하는 기능을 기준으로 정한다.

④ 제한 기간은 제재가 시스템에 실제로 적용된 시각부터 계산한다.

⑤ 기간이 종료되면 해당 제재는 해제되어야 한다. 다만 다른 유효한 제한이 있는 경우는 예외로 한다.

## 제28조 (제재 판단 원칙)

① 운영자는 다음 요소를 종합적으로 고려한다.

1. 위반 행위의 내용
2. 고의 또는 실수 여부
3. 피해의 심각성
4. 반복 여부
5. 실제 피해 발생 여부
6. 피해 확산 가능성
7. 위반 후 정정 및 피해 회복 노력
8. 이전에 적용된 유사한 제재

② 운영자는 위반에 비례하는 제재를 적용해야 한다.

③ 사안이 경미한 경우 안내나 경고를 우선할 수 있다.

④ 개인정보 유포, 중대한 협박, 계정 도용 등 심각한 위반은 첫 위반이더라도 강한 제재를 적용할 수 있다.

⑤ 규정을 위반했다는 의심만으로 영구 제한을 확정해서는 안 된다.

## 제29조 (반복 위반 및 가중 제재)

① 이전 위반 이후 동일하거나 유사한 위반이 반복되는 경우 제재를 강화할 수 있다.

② 반복 여부는 원칙적으로 최근 90일 이내의 동일하거나 유사한 위반 이력을 중심으로 검토한다.

③ 최근 90일을 초과한 위반이라도 중대한 사안과 관련된 경우 그 관련성을 합리적으로 검토할 수 있다. 단, 오래된 기록만을 이유로 자동 가중하지 않는다.

④ 반복 위반 시 권장 기준은 다음과 같다.

| 상황 | 권장 기준 |
|---|---|
| 최초 경미한 위반 | 안내 또는 경고 |
| 유사한 위반의 재발 | 해당 기본 제재 적용 |
| 제재 이후 재차 반복 | 기본 제재보다 한 단계 강화 검토 |
| 지속적·악의적인 반복 | 30일 또는 영구 제한 검토 |

⑤ 다른 종류의 규정을 위반했다는 이유만으로 기계적으로 제재 단계를 올리지 않는다.

## 제30조 (여러 규정의 동시 위반)

① 하나의 행위가 여러 규정에 해당하는 경우 가장 중대한 위반을 중심으로 제재를 결정한다.

② 원칙적으로 제재 기간을 단순 합산하지 않는다.

③ 서로 구분되는 독립적인 위반 행위가 여러 차례 발생한 경우에는 전체 행위의 반복성과 심각성을 고려하여 판단한다.

④ 동일한 행위에 대해 이미 확정된 제재를 정당한 사유 없이 반복 부과하지 않는다.

## 제31조 (긴급 보호 조치)

① 다음 상황에서는 피해 확산을 막기 위해 긴급 조치를 취할 수 있다.

1. 개인정보가 공개되어 추가 피해가 우려되는 경우
2. 심각한 협박이나 괴롭힘이 진행 중인 경우
3. 계정 도용 등 보안 사고가 의심되는 경우
4. 서비스 전체의 안전이 위협받는 경우

② 긴급 조치는 가능한 한 필요한 범위에서 최소한으로 적용한다.

③ 운영자는 긴급 조치 이후 사실관계를 확인하여 조치를 유지, 수정 또는 해제해야 한다.

④ 긴급 조치는 최종 제재 확정을 의미하지 않는다.

---

# 제6장. 신고 접수 및 처리

## 제32조 (신고의 접수)

① 회원은 위반이 의심되는 게시물에 대해 서비스의 신고 기능을 사용할 수 있다.

② 그 밖의 문제는 건의·오류 제보 기능을 통해 알릴 수 있다.

③ 신고 시에는 가능한 한 해당 게시물과 위반 사유를 구체적으로 기재해야 한다.

④ 신고자는 다른 사람의 개인정보를 불필요하게 첨부해서는 안 된다.

## 제33조 (신고 처리 절차)

신고 처리 절차는 다음과 같다.

1. **접수:** 신고 내용 확인
2. **분류:** 위반 유형과 긴급성 판단
3. **검토:** 관련 게시물 및 확인 가능한 사실 조사
4. **판단:** 위반 여부와 제재 필요성 결정
5. **조치:** 콘텐츠 삭제, 경고, 이용 제한 등 적용
6. **기록:** 처리 결과와 사유 기록
7. **재검토:** 이의신청이 있는 경우 추가 확인

운영자는 신고가 접수되었다는 이유만으로 피신고자를 자동 제재해서는 안 된다.

## 제34조 (증거 및 사실관계 확인)

① 운영자는 가능한 한 객관적인 정보를 바탕으로 판단한다.

② 게시물의 내용과 작성 시각, 신고 사유, 관련 문맥 등을 확인할 수 있다.

③ 증거가 불충분한 경우 제재를 보류하거나 경미한 조치를 선택할 수 있다.

④ 운영자는 신고자 또는 피신고자의 일방적인 주장만으로 중대한 제재를 확정하지 않도록 주의해야 한다.

⑤ 다른 사람의 비공개 개인정보를 수집하는 방법으로 증거를 확보해서는 안 된다.

⑥ 운영에 필요한 기록은 정해진 목적과 기간에 한해 보관해야 한다.

## 제35조 (신고자 및 피신고자 보호)

① 운영자는 신고자의 개인정보를 부당하게 공개해서는 안 된다.

② 신고 대상자도 제재가 확정되기 전까지 부당하게 비난받지 않도록 보호해야 한다.

③ 신고자에게 불이익을 주기 위한 보복성 게시글을 금지한다.

④ 신고를 이유로 특정 회원을 괴롭히는 행위에는 별도의 제재를 적용할 수 있다.

---

# 제7장. 제재 통지 및 이의신청

## 제36조 (제재 통지)

① 이용 제한 등 중요한 제재를 적용하는 경우 운영자는 해당 회원에게 가능한 범위에서 사유를 안내한다.

② 통지 내용에는 다음 사항을 포함한다.

1. 위반한 규정
2. 문제가 된 행위의 개요
3. 적용된 제재
4. 제재 시작일 및 종료 예정일
5. 이의신청 방법
6. 재검토 가능 여부

③ 다른 이용자의 개인정보나 비공개 신고 내용은 공개하지 않을 수 있다.

④ 게시물 삭제만 이루어진 경우에도 가능한 한 삭제 사유를 확인할 수 있도록 안내하는 것을 원칙으로 한다.

## 제37조 (이의신청 권리)

① 회원은 운영자의 제재가 부당하다고 판단되는 경우 이의신청을 할 수 있다.

② 이의신청은 원칙적으로 제재 통지를 받은 날부터 30일 이내에 접수할 수 있다.

③ 기간을 넘겼더라도 중대한 사실 오류나 새로운 증거가 확인되는 경우 재검토를 요청할 수 있다.

④ 이의신청을 했다는 이유로 추가 제재를 부과해서는 안 된다.

## 제38조 (이의신청 방법)

① 회원은 **서비스 안내 → 건의·오류 제보**를 통해 이의신청을 할 수 있다.

② 이의신청 시 다음 사항을 작성하도록 안내한다.

1. 제재받은 계정
2. 제재 내용
3. 재검토를 요청하는 이유
4. 사실관계를 확인하는 데 필요한 설명

③ 계정 제한으로 인해 문의 기능을 이용할 수 없는 경우 운영자는 별도의 접수 경로를 제공해야 한다.

④ 비밀번호, 복구 코드 등 민감한 인증 정보는 제출하도록 요구하지 않는다.

## 제39조 (이의신청 처리)

① 운영자는 이의신청을 접수한 후 원칙적으로 7일 이내에 검토 결과를 안내하는 것을 목표로 한다.

② 추가 확인이 필요한 경우 처리 기간이 연장될 수 있으며, 가능한 경우 그 사유를 안내한다.

③ 이의신청 결과는 다음 중 하나로 결정한다.

1. 기존 제재 유지
2. 제재 기간 단축
3. 제재 종류 변경
4. 제재 해제
5. 추가 확인을 위한 판단 보류

④ 기존 판단에 명백한 오류가 발견된 경우 운영자는 이를 정정해야 한다.

⑤ 재검토 요청에는 가능한 한 최초 조치자와 다른 운영자가 참여하도록 한다. 별도 운영자가 없는 경우에도 기존 판단의 근거를 다시 확인해야 한다.

---

# 제8장. 학교생활 정보 관리

## 제40조 (급식 및 학사일정)

① 급식 및 학사일정은 이용자의 편의를 위해 제공한다.

② 외부 정보 제공 기관이나 학교의 일정 변경으로 실제 내용과 차이가 발생할 수 있다.

③ 운영자는 정보 오류가 확인되는 경우 가능한 범위에서 수정하거나 안내한다.

④ 이용자는 중요한 정보를 학교의 공식 자료로 재확인해야 한다.

## 제41조 (수행평가 일정)

① 수행평가 일정은 회원이 등록한 학년과 반을 기준으로 구분한다.

② 다른 반의 수행평가 정보를 무단으로 열람하거나 조작하려는 행위를 금지한다.

③ 수행평가 정보 등록자는 정확한 내용을 작성하기 위해 노력해야 한다.

④ 단순한 입력 오류는 정정을 우선한다.

⑤ 고의로 잘못된 일정을 등록하는 행위에는 제18조의 허위 정보 관련 제재 기준을 적용할 수 있다.

⑥ 중요한 수행평가 일정은 반드시 담당 교사의 공식 안내를 우선하여 확인한다.

---

# 제9장. 운영자의 권한 및 의무

## 제42조 (운영자의 권한)

① 운영자는 서비스의 안전과 정상적인 운영을 위해 필요한 관리 업무를 수행할 수 있다.

② 운영 업무에는 다음 사항이 포함된다.

1. 위반 콘텐츠의 검토 및 삭제
2. 신고 접수 및 처리
3. 계정 이용 제한
4. 공지사항 관리
5. 게시판 관리
6. 서비스 오류 대응
7. 회원 문의 및 이의신청 처리

③ 운영 권한은 본 규정 및 관련 법령에 따라 행사해야 한다.

## 제43조 (운영자의 의무)

운영자는 다음 사항을 준수해야 한다.

1. 회원을 공정하게 대우할 것
2. 규정을 일관되게 적용할 것
3. 제재의 사유와 범위를 합리적으로 판단할 것
4. 개인정보를 목적 외로 사용하지 않을 것
5. 신고자 및 피신고자의 권리를 보호할 것
6. 운영 권한을 사적인 목적으로 악용하지 않을 것
7. 필요한 경우 제재를 정정하거나 해제할 것
8. 운영상의 오류를 발견하면 개선하도록 노력할 것

## 제44조 (운영 권한 남용 금지)

① 운영자는 개인적인 감정이나 이해관계를 이유로 이용자를 제재해서는 안 된다.

② 운영자는 타인의 개인정보를 호기심이나 사적인 목적으로 조회해서는 안 된다.

③ 운영자는 신고 및 제재 기록을 허위로 작성하거나 조작해서는 안 된다.

④ 운영자는 본인과 직접적인 이해관계가 있는 분쟁에 대해 가능한 한 다른 운영자의 검토를 받도록 한다.

⑤ 운영 권한의 남용이 확인된 경우 해당 권한의 회수, 관련 조치의 재검토 등 필요한 시정 조치를 취해야 한다.

## 제45조 (비밀 유지)

① 운영자는 운영 과정에서 알게 된 회원의 개인정보와 비공개 내용을 정당한 권한이나 법적 근거 없이 공개해서는 안 된다.

② 신고 및 문의의 세부 내용은 필요한 처리 범위를 벗어나 공유하지 않는다.

③ 운영 권한이 종료된 이후에도 개인정보와 관련된 비밀 유지 의무를 준수해야 한다.

---

# 제10장. 개인정보 및 정보 보호

## 제46조 (개인정보 보호 원칙)

① 서비스는 운영에 필요한 범위에서 개인정보를 처리해야 한다.

② 개인정보의 구체적인 처리 목적, 항목, 보관 기간, 권리 행사 방법 등은 별도의 개인정보 처리방침에서 정한다.

③ 본 이용 규정은 개인정보 처리방침을 대신하지 않는다.

④ 운영자는 서비스 운영에 필요한 경우에도 개인정보를 무제한 수집하거나 보관해서는 안 된다.

## 제47조 (개인정보 보호를 위한 이용자의 의무)

① 회원은 타인의 개인정보를 무단으로 공개해서는 안 된다.

② 회원은 타인의 계정 정보를 수집하거나 도용해서는 안 된다.

③ 회원은 본인 또는 다른 사람의 민감한 정보를 게시글에 불필요하게 작성하지 않도록 주의해야 한다.

④ 개인정보 유출이 의심되는 경우 운영자에게 알릴 수 있다.

## 제48조 (게시물 및 운영 기록의 보관)

① 게시물과 운영 기록의 보관 및 삭제는 서비스의 실제 데이터 처리 정책과 관계 법령을 따른다.

② 운영자는 제재 기록을 무기한 보관하는 것을 기본 원칙으로 삼지 않는다.

③ 운영 기록에는 필요한 최소한의 내용만 포함하도록 한다.

④ 보관 기간이 종료되거나 처리 목적이 달성된 기록은 관계 법령에 따른 예외가 없는 한 적절하게 삭제하거나 비식별 처리한다.

⑤ 기록의 정확한 보관 기간은 별도의 데이터 보관 정책에서 명시한다.

---

# 제11장. 서비스 운영 및 장애 대응

## 제49조 (서비스 제공)

① 운영자는 안정적인 서비스를 제공하기 위해 노력한다.

② 서비스는 점검, 업데이트, 장애 등의 이유로 일시적으로 중단될 수 있다.

③ 사전에 예측할 수 있는 점검은 가능한 범위에서 공지한다.

④ 예상하지 못한 장애는 사전 안내 없이 발생할 수 있다.

## 제50조 (오류 및 보안 문제 신고)

① 이용자는 오류나 보안 문제를 발견한 경우 건의·오류 제보 기능을 이용할 수 있다.

② 오류 제보 시 가능한 한 발생 화면과 상황을 설명해야 한다.

③ 비밀번호나 복구 코드 등 민감한 정보는 오류 제보 내용에 포함하지 않는다.

④ 운영자는 접수된 오류를 확인하고 중요도에 따라 개선을 검토한다.

⑤ 오류를 발견했다는 사실만으로 제재하지 않으며, 의도적인 악용 행위와 구분한다.

---

# 제12장. 기타 및 부칙

## 제51조 (규정에 없는 사항)

① 본 규정에 명시되지 않은 사항은 관계 법령과 서비스의 운영 목적을 고려하여 판단한다.

② 이용자에게 불이익을 주는 해석은 필요한 범위에서 명확하고 합리적인 근거를 갖추어야 한다.

③ 규정의 의미가 불분명한 경우 운영자는 이용자에게 충분히 설명하고, 향후 혼란을 방지하기 위해 규정을 보완하도록 노력한다.

## 제52조 (규정과 법령의 관계)

① 본 규정은 관계 법령보다 우선하지 않는다.

② 본 규정의 일부 내용이 관계 법령에 위반되거나 효력이 인정되지 않는 경우 해당 부분은 적용하지 않을 수 있으며, 나머지 조항은 가능한 범위에서 유지한다.

③ 법적 신고, 개인정보 보호, 아동·청소년 보호 등 별도의 법적 의무는 본 규정과 관계없이 준수해야 한다.

## 제53조 (최종 원칙)

① 스쿨팟의 운영과 제재는 이용자의 안전, 공정성, 표현의 자유 및 개인정보 보호 사이의 균형을 고려해야 한다.

② 이용자는 다른 사람의 권리를 존중하면서 서비스를 이용해야 한다.

③ 운영자는 회원의 권리를 보호하고 신뢰할 수 있는 환경을 조성하기 위해 노력해야 한다.

---

# 부칙

## 제1조 (시행일)

본 규정은 **2026년 11월 13일**부터 시행한다.

## 제2조 (기존 회원에 대한 적용)

① 본 규정은 시행일 이후 기존 회원에게도 적용한다.

② 기존 회원은 시행일 이후의 서비스 이용에서 본 규정을 준수해야 한다.

③ 본 규정 시행 전에 발생한 행위에 대해 새로운 제재 기준을 소급 적용하지 않는 것을 원칙으로 한다.

## 제3조 (규정 개정)

① 규정 개정 시 버전, 변경 내용, 시행일을 기록한다.

② 중요한 변경 사항은 공지사항을 통해 안내한다.

---

**스쿨팟(SchoolPot) 운영자**

*모두가 안전하고 즐겁게 소통할 수 있는 공간을 함께 만들어 갑니다.*$original_full$,'사용자가 제공한 원문');
create function private.service_configuration(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); v integer;begin
 if p_action='public' then return (select jsonb_build_object('title',title,'school_name',school_name,'description',description,'revision',revision) from private.service_configuration where id);end if;
 if p_action='rules' then return (select jsonb_build_object('version',version,'summary',summary,'full_text',full_text,'created_at',created_at) from private.rules_versions order by version desc limit 1);end if;
 if private.actor_role()<>'owner' then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>130000 then raise exception 'INVALID_INPUT';end if;
 if p_action='history' then return coalesce((select jsonb_agg(to_jsonb(r)) from(select version,reason,created_at from private.rules_versions order by version desc limit 100)r),'[]'::jsonb);end if;
 if coalesce(char_length(btrim(p_payload->>'reason')),0) not between 2 and 2000 then raise exception 'INVALID_INPUT';end if;
 perform private.consume_rate(u,'configuration_writes',20,600);
 if p_action='save' then
  select revision into v from private.service_configuration where id for update;
  if v is distinct from (p_payload->>'revision')::int then raise exception 'STALE_CHANGE';end if;
  update private.service_configuration set title=btrim(p_payload->>'title'),school_name=btrim(p_payload->>'school_name'),description=btrim(p_payload->>'description'),revision=revision+1,updated_at=now() where id;
 elsif p_action='publish_rules' then
  perform pg_advisory_xact_lock(7031322);
  select max(version) into v from private.rules_versions;
  if v is distinct from (p_payload->>'version')::int then raise exception 'STALE_CHANGE';end if;
  if p_payload->>'confirmation' is distinct from '규정 게시' then raise exception 'CONFIRM_REQUIRED';end if;
  insert into private.rules_versions(version,summary,full_text,reason,actor_id) values(v+1,p_payload->>'summary',p_payload->>'full_text',btrim(p_payload->>'reason'),u);
 else raise exception 'INVALID_INPUT';end if;
 insert into private.admin_audit_logs(actor_id,action,details) values(u,'configuration_'||p_action,jsonb_build_object('previous_version',v,'reason',p_payload->>'reason'));
 return '{"ok":true}'::jsonb;
end $$;
create function public.service_configuration(p_action text,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.service_configuration(p_action,p_payload)$$;
revoke all on function private.service_configuration(text,jsonb),public.service_configuration(text,jsonb) from public;
grant execute on function private.service_configuration(text,jsonb),public.service_configuration(text,jsonb) to anon,authenticated;

-- Foreign-key lookup indexes keep deletion and moderation bounded as records grow.
create index user_roles_assigned_by on private.user_roles(assigned_by);
create index sanctions_actor on private.sanctions(actor_id);
create index sanction_requests_target on private.sanction_requests(target_id);
create index sanction_requests_handler on private.sanction_requests(handler_id);
create index sanction_requests_post on private.sanction_requests(post_id);
create index sanction_requests_comment on private.sanction_requests(comment_id);
create index sanction_requests_report on private.sanction_requests(report_id);
create index appeals_sanction on private.sanction_appeals(sanction_id);
create index appeals_handler on private.sanction_appeals(handler_id);
create index role_history_actor on private.role_history(actor_id);
create index rules_versions_actor on private.rules_versions(actor_id);
