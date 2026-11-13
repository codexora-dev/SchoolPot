-- Remove withdrawn operator contact from active and archived policy documents.
alter table private.privacy_policy alter column contact_email drop not null, alter column contact_email drop default;
update private.privacy_policy set contact_email=null,version=version+1,updated_at=now(),sections='[["필수 서비스 정보 처리","아이디·비밀번호·닉네임과 학년도·학년·반은 계정 생성·인증·복구와 본인 반 일정 제공 등 회원 서비스의 체결·이행에 필요한 범위에서 처리합니다. 학년·반 선택에 개인정보 동의 체크를 요구하지 않으며 동의하지 않은 사항을 동의 기록으로 저장하지 않습니다."],["최소 수집 항목","계정과 소속 정보, 로그인 세션과 서비스 운영 기록 및 본인이 작성한 내용입니다. 학생 실명·학번·학생증·생년월일·실제 이메일은 요구하지 않습니다. 별도의 광고·홍보 동의나 추적 기능은 추가하지 않습니다."],["보유 및 삭제","계정·소속과 계정 연결 작성 내용은 회원탈퇴 시 운영 DB에서 삭제합니다. 본인 게시글에 달린 답글도 삭제될 수 있습니다."]]'::jsonb;
update private.privacy_policy_versions set document=document-'contact_email';
insert into private.privacy_policy_versions(version,document) select version,to_jsonb(p)-'id'-'contact_email' from private.privacy_policy p;
create or replace function private.school_setup() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('school_year',c.school_year,'counts',c.counts,'revision',c.revision,
 'policy',jsonb_build_object('version',p.version,'controller',p.controller,'contact_url',p.contact_url,'sections',p.sections,'overseas_notice',p.overseas_notice,'is_ready',p.is_ready,'updated_at',p.updated_at))
 from private.class_settings c cross join private.privacy_policy p
$$;

create or replace function private.account_gateway(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $gateway$
declare v_id uuid; v_email text; v_nickname text; handle text:=p_payload->>'username';kind text:=p_payload->>'kind';begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'FORBIDDEN';end if;
 if pg_column_size(p_payload)>5000 then raise exception 'INVALID_INPUT';end if;
 if p_action='validate_signup' then
  return private.validate_enrollment(p_payload);
 elsif p_action='set_membership' then
  perform private.validate_enrollment(p_payload);
  v_id:=(p_payload->>'user_id')::uuid;
  if not exists(select 1 from private.account_handles h join auth.users a on a.id=h.user_id where h.user_id=v_id and h.username=p_payload->>'username' and a.deleted_at is null) then raise exception 'NOT_FOUND';end if;
  insert into private.memberships(user_id,school_year,grade,class_number,policy_version,collection_basis,notice_recorded_at,consented_at,age_14_confirmed_at,overseas_consented_at)
  select v_id,c.school_year,(p_payload->>'grade')::int,(p_payload->>'class_number')::int,p.version,'service_contract',now(),null,null,null from private.class_settings c cross join private.privacy_policy p;
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
