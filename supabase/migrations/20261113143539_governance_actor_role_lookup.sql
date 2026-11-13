-- Disambiguate the actor role from the target role output alias in LIMIT.
create or replace function private.governance(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); v_role text:=private.actor_role(); v_id uuid; target uuid; result jsonb; req private.sanction_requests; appeal private.sanction_appeals; previous text; desired text; v_status text; rev integer;begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>30000 then raise exception 'INVALID_INPUT';end if;
 perform private.consume_rate(u,'governance',100,60);
 if p_action not in ('mine','appeal','rights','rights_mine') then
  if exists(select 1 from private.profiles where private.profiles.id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
  if v_role not in ('owner','moderator') then raise exception 'FORBIDDEN';end if;
 end if;
 if p_action='mine' then
  return jsonb_build_object('sanctions',coalesce((select jsonb_agg(to_jsonb(s)-'target_id'-'actor_id'-'operation_id'-'request_id' order by starts_at desc) from(select * from private.sanctions where target_id=u order by starts_at desc limit 100 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000))s),'[]'::jsonb),
   'appeals',coalesce((select jsonb_agg(to_jsonb(a)-'target_id'-'handler_id' order by created_at desc) from(select * from private.sanction_appeals where target_id=u order by created_at desc limit 100)a),'[]'::jsonb));
 elsif p_action='appeal' then
  perform private.consume_rate(u,'appeals',5,3600);
  v_id:=(p_payload->>'sanction_id')::uuid;
  if not exists(select 1 from private.sanctions where private.sanctions.id=v_id and target_id=u) then raise exception 'NOT_FOUND';end if;
  insert into private.sanction_appeals(target_id,sanction_id,body) values(u,v_id,btrim(p_payload->>'body')) returning private.sanction_appeals.id into v_id;
  insert into private.notifications(user_id,message,governance_kind) select user_id,'새 제재 이의 제기가 접수됐어요.','appeal_admin' from private.user_roles;
  return jsonb_build_object('id',v_id);
 elsif p_action='rights' then
  perform private.consume_rate(u,'feedback_create',5,3600);
  insert into private.feedback(author_id,kind,title,body,sensitive) values(u,'other','계정·개인정보 문의',btrim(p_payload->>'body'),true) returning private.feedback.id into v_id;
  insert into private.notifications(user_id,message,governance_kind) select user_id,'계정·개인정보 문의가 접수됐어요.','rights' from private.user_roles where private.user_roles.role='owner';
  return jsonb_build_object('id',v_id);
 elsif p_action='rights_mine' then
  return coalesce((select jsonb_agg(to_jsonb(f)-'author_id' order by created_at desc) from(select * from private.feedback where author_id=u and sensitive order by created_at desc limit 20)f),'[]'::jsonb);
 elsif p_action in ('targets','members') then
  if p_action='members' and v_role<>'owner' then raise exception 'FORBIDDEN';end if;
  if v_role='moderator' and char_length(btrim(coalesce(p_payload->>'query','')))<3 then raise exception 'INVALID_INPUT';end if;
  perform private.consume_rate(u,'member_lookup',30,60);
  insert into private.admin_audit_logs(actor_id,action) values(u,'member_lookup');
  return coalesce((select jsonb_agg(to_jsonb(t)) from(select p.id,p.nickname,h.username,coalesce(r.role,'member') role,p.role_revision,p.sanction_revision,case when p.suspended_until='infinity' then null else p.suspended_until end suspended_until,p.suspended_until='infinity' permanent,p.suspended_until>now() restricted from private.profiles p join private.account_handles h on h.user_id=p.id left join private.user_roles r on r.user_id=p.id where position(lower(left(coalesce(p_payload->>'query',''),120)) in lower(p.nickname||' '||h.username||' '||p.id::text))>0 order by h.username limit case when v_role='owner' then 50 else 10 end offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000))t),'[]'::jsonb);
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
  return coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('nickname',(select nickname from private.profiles where private.profiles.id=r.target_id)) order by created_at desc) from(select * from private.sanction_requests where (v_role='owner' or requester_id=u) and (coalesce(p_payload->>'status','')='' or status=p_payload->>'status') order by created_at desc limit 100 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000))r),'[]'::jsonb);
 elsif p_action in ('decide','cancel') then
  v_id:=(p_payload->>'id')::uuid;
  select * into req from private.sanction_requests where private.sanction_requests.id=v_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if p_action='decide' and v_role<>'owner' then raise exception 'FORBIDDEN';end if;
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
  if v_role<>'owner' then raise exception 'FORBIDDEN';end if;
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
