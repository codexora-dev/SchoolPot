-- Auth admin creation can attach app_metadata after the INSERT trigger. Provision after its response.
create or replace function private.account_gateway(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $gateway$
declare v_id uuid; v_email text; v_nickname text; handle text:=p_payload->>'username';kind text:=p_payload->>'kind';begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'FORBIDDEN';end if;
 if pg_column_size(p_payload)>5000 then raise exception 'INVALID_INPUT';end if;
 if p_action='limit' then
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
