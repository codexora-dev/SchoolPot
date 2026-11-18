-- Server-only Vault fallback. No browser role can read or initialize these values.
create function private.push_worker_configuration(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare pub text;priv text;token text;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_action not in ('get','initialize') or p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>2000 then raise exception 'INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(7031323);
 select decrypted_secret into pub from vault.decrypted_secrets where name='schoolpot_vapid_public_key';
 select decrypted_secret into priv from vault.decrypted_secrets where name='schoolpot_vapid_private_key';
 if p_action='initialize' then
  if (pub is null)<>(priv is null) then raise exception 'CONFIG';end if;
  if pub is null then
   if p_payload->>'public_key' is null or p_payload->>'public_key' !~ '^[A-Za-z0-9_-]{87}$' or p_payload->>'private_key' is null or p_payload->>'private_key' !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'INVALID_INPUT';end if;
   perform vault.create_secret(p_payload->>'public_key','schoolpot_vapid_public_key');
   perform vault.create_secret(p_payload->>'private_key','schoolpot_vapid_private_key');
   pub:=p_payload->>'public_key';priv:=p_payload->>'private_key';
  end if;
 end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='schoolpot_push_dispatch_token';
 return jsonb_build_object('public_key',pub,'private_key',priv,'token',token,'subject','https://codexora-dev.github.io/SchoolPot/');
end $$;
create function public.push_worker_configuration(p_action text,p_payload jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select private.push_worker_configuration(p_action,p_payload)$$;
revoke all on function public.push_worker_configuration(text,jsonb),private.push_worker_configuration(text,jsonb) from public,anon,authenticated;
grant execute on function public.push_worker_configuration(text,jsonb),private.push_worker_configuration(text,jsonb) to service_role;
