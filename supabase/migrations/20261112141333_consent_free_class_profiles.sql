-- Required service profile data is recorded without manufacturing consent events.
alter table private.memberships alter column consented_at drop not null,alter column consented_at drop default,
 alter column age_14_confirmed_at drop not null,alter column age_14_confirmed_at drop default,
 alter column overseas_consented_at drop not null,alter column overseas_consented_at drop default,
 add column collection_basis text not null default 'legacy_consent' check(collection_basis in ('legacy_consent','service_contract')),
 add column notice_recorded_at timestamptz,
 add column consented_policy_version integer;
update private.memberships set consented_policy_version=policy_version where consented_at is not null;
alter table private.privacy_policy add column contact_email text not null default 'kminjae803@naver.com'
 check(char_length(contact_email)<=254 and contact_email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,63}$');
update private.privacy_policy set version=version+1,updated_at=now(),sections=jsonb_build_array(
 jsonb_build_array('필수 서비스 정보 처리','아이디·비밀번호·닉네임과 학년도·학년·반은 계정 생성·인증·복구와 본인 반 일정 제공 등 회원 서비스의 체결·이행에 필요한 범위에서 처리합니다. 학년·반 선택에 개인정보 동의 체크를 요구하지 않으며 동의하지 않은 사항을 동의 기록으로 저장하지 않습니다.'),
 jsonb_build_array('최소 수집 항목','계정과 소속 정보, 가입 시 만 14세 이상 본인 확인, 로그인 세션과 서비스 운영 기록 및 본인이 작성한 내용입니다. 학생 실명·학번·학생증·생년월일·실제 이메일은 요구하지 않습니다. 별도의 광고·홍보 동의나 추적 기능은 추가하지 않습니다.'),
 jsonb_build_array('보유 및 삭제','계정·소속과 계정 연결 작성 내용은 회원탈퇴 시 운영 DB에서 삭제합니다. 본인 게시글에 달린 답글도 삭제될 수 있습니다. 외부 처리업체 로그·백업과 별도 보안 기록은 해당 처리방침과 운영 조건을 따르므로 즉시 완전 삭제를 보장하지 않습니다.'),
 jsonb_build_array('열람·정정·삭제·처리정지','로그인한 회원은 계정 관리와 건의·오류 제보를 이용할 수 있고, 로그인할 수 없거나 탈퇴한 뒤에도 공개된 이메일로 개인정보 권리행사를 요청할 수 있습니다. 비밀번호·복구 코드·주민등록번호·학생증 사본은 이메일에 보내지 마세요. 필요한 범위에서 본인 확인 후 처리 결과와 제한 사유 및 이의제기 방법을 안내합니다.'),
 jsonb_build_array('소속과 연령 안내','가입 시 만 14세 이상임을 확인합니다. 소속과 연령은 자기 신고이며 실제 재학생·연령 인증이 아닙니다. 같은 학년도에서 소속을 임의 변경할 수 없고 정정은 관리자에게 요청합니다.'));
insert into private.privacy_policy_versions(version,document) select version,to_jsonb(p)-'id' from private.privacy_policy p;

create or replace function private.school_setup() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('school_year',c.school_year,'counts',c.counts,'revision',c.revision,
 'policy',jsonb_build_object('version',p.version,'controller',p.controller,'contact_url',p.contact_url,'contact_email',p.contact_email,'sections',p.sections,'overseas_notice',p.overseas_notice,'is_ready',p.is_ready,'updated_at',p.updated_at))
 from private.class_settings c cross join private.privacy_policy p
$$;
create or replace function private.validate_enrollment(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.class_settings; policy private.privacy_policy; g int; n int;
begin
 select * into c from private.class_settings where id for share;
 select * into policy from private.privacy_policy where id for share;
 if p ? 'school_year' and c.school_year is distinct from (p->>'school_year')::smallint then raise exception 'STALE_CLASS_SETTINGS';end if;
 g:=(p->>'grade')::int;n:=(p->>'class_number')::int;
 if g is null or n is null or g not between 1 and 3 or n<1 or n>c.counts[g] then raise exception 'CLASS_INVALID';end if;
 return jsonb_build_object('school_year',c.school_year,'grade',g,'class_number',n,'policy_version',policy.version);
end $$;
create or replace function private.require_membership(u uuid) returns private.memberships language plpgsql stable security definer set search_path='' as $$
declare m private.memberships; c private.class_settings;
begin
 select * into m from private.memberships where user_id=u;
 select * into c from private.class_settings where id;
 if m.user_id is null or m.school_year<>c.school_year or m.class_number>c.counts[m.grade] then raise exception 'MEMBERSHIP_REQUIRED';end if;
 return m;
end $$;

create or replace function private.school_membership(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); me jsonb; c private.class_settings; m private.memberships; v jsonb; target uuid; next_counts int[]; yr int;
begin
 me:=private.community('me','{}');
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

create or replace function private.community(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); is_admin boolean; v_id uuid; v_parent uuid; v_post private.posts; v_comment private.comments;
 result jsonb; v_profile private.profiles; m private.memberships; v_assessment private.performance_assessments; v_board text; v_kind text; v_label integer; v_target uuid; v_title text; v_body text;
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
  insert into private.notices(author_id,title,body) values(u,btrim(p_payload->>'title'),btrim(p_payload->>'body')) returning id into v_id;
  insert into private.notifications(user_id,message) select id,'새 공지: '||left(p_payload->>'title',120) from private.profiles where notifications_enabled;
 else raise exception 'INVALID_INPUT: unknown action';
 end if;
 insert into private.admin_audit_logs(actor_id,action,target_id) values(u,p_action,v_id);
 return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function private.account_gateway(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $gateway$
declare v_id uuid; v_email text; v_nickname text; handle text:=p_payload->>'username';kind text:=p_payload->>'kind';begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'FORBIDDEN';end if;
 if pg_column_size(p_payload)>5000 then raise exception 'INVALID_INPUT';end if;
 if p_action='validate_signup' then
  if p_payload->'age_14_confirmed' is distinct from 'true'::jsonb then raise exception 'AGE_REQUIRED';end if;
  return private.validate_enrollment(p_payload);
 elsif p_action='set_membership' then
  if p_payload->'age_14_confirmed' is distinct from 'true'::jsonb then raise exception 'AGE_REQUIRED';end if;
  perform private.validate_enrollment(p_payload);
  v_id:=(p_payload->>'user_id')::uuid;
  if not exists(select 1 from private.account_handles h join auth.users a on a.id=h.user_id where h.user_id=v_id and h.username=p_payload->>'username' and a.deleted_at is null) then raise exception 'NOT_FOUND';end if;
  insert into private.memberships(user_id,school_year,grade,class_number,policy_version,collection_basis,notice_recorded_at,consented_at,age_14_confirmed_at,overseas_consented_at)
  select v_id,c.school_year,(p_payload->>'grade')::int,(p_payload->>'class_number')::int,p.version,'service_contract',now(),null,now(),null from private.class_settings c cross join private.privacy_policy p;
  update private.profiles set grade=(p_payload->>'grade')::int where id=v_id;
 elsif p_action='limit' then
  if handle !~ '^[a-z][a-z0-9_]{2,19}$' or p_payload->>'ip_hash' !~ '^[a-f0-9]{64}$' or kind not in ('signup','recover') then raise exception 'INVALID_INPUT';end if;
  perform private.consume_account_rate(kind||':global',300,case when kind='signup' then 3600 else 900 end);
  perform private.consume_account_rate(kind||':ip:'||(p_payload->>'ip_hash'),case when kind='signup' then 10 else 20 end,case when kind='signup' then 3600 else 900 end);
  perform private.consume_account_rate(kind||':username:'||handle,6,900);
  delete from private.account_attempts where window_start<now()-interval '7 days';
 elsif p_action='set_recovery' then
  v_id:=(p_payload->>'user_id')::uuid;
  select email into v_email from auth.users where id=v_id and raw_app_meta_data->>'account_type'='username' and deleted_at is null;
  if v_email is null or v_email !~ '^[a-z][a-z0-9_]{2,19}@accounts[.]schoolpot[.]invalid$' then raise exception 'NOT_FOUND';end if;
  handle:=split_part(v_email,'@',1);
  insert into private.account_handles(user_id,username,recovery_hash) values(v_id,handle,p_payload->>'recovery_hash')
  on conflict(user_id) do update set recovery_hash=excluded.recovery_hash where private.account_handles.recovery_hash is null;
  if not found then raise exception 'FORBIDDEN';end if;
  begin
   insert into private.profiles(id,nickname) values(v_id,handle) on conflict(id) do nothing;
  exception when unique_violation then
   v_nickname:=left(handle,10)||'_'||left(replace(gen_random_uuid()::text,'-',''),8);
   insert into private.profiles(id,nickname) values(v_id,v_nickname) on conflict(id) do nothing;
  end;
 elsif p_action='claim_recovery' then
  if p_payload->>'old_hash' !~ '^[a-f0-9]{64}$' or p_payload->>'new_hash' !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT';end if;
  update private.account_handles set recovery_hash=p_payload->>'new_hash' where username=handle and recovery_hash=p_payload->>'old_hash' returning user_id into v_id;
  return jsonb_build_object('user_id',v_id);
 elsif p_action='restore_recovery' then
  update private.account_handles set recovery_hash=p_payload->>'old_hash' where username=handle and recovery_hash=p_payload->>'new_hash';
 elsif p_action='revoke_sessions' then
  v_id:=(p_payload->>'user_id')::uuid;
  if not exists(select 1 from private.account_handles where user_id=v_id) then raise exception 'NOT_FOUND';end if;
  delete from auth.sessions where user_id=v_id;
 else raise exception 'INVALID_INPUT';end if;
 return jsonb_build_object('ok',true);
end $gateway$;
