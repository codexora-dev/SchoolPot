create table private.push_scheduler_nonces(nonce uuid primary key,created_at timestamptz not null default now());
create index push_scheduler_nonce_time on private.push_scheduler_nonces(created_at);
alter table private.push_scheduler_nonces enable row level security;
revoke all on private.push_scheduler_nonces from public,anon,authenticated;
create function private.push_scheduler_claim(p_nonce uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_nonce is null then raise exception 'INVALID_INPUT';end if;
 delete from private.push_scheduler_nonces where created_at<now()-interval '10 minutes';
 insert into private.push_scheduler_nonces(nonce) values(p_nonce) on conflict do nothing;
 if not found then return '[]'::jsonb;end if;
 return private.push_delivery('claim','{}');
end $$;
create function public.push_scheduler_claim(p_nonce uuid) returns jsonb language sql security invoker set search_path='' as $$select private.push_scheduler_claim(p_nonce)$$;
revoke all on function private.push_scheduler_claim(uuid),public.push_scheduler_claim(uuid) from public,anon,authenticated;
grant execute on function private.push_scheduler_claim(uuid),public.push_scheduler_claim(uuid) to service_role;

-- Only the trusted database scheduler can sign short-lived requests.
-- No persistent bearer token enters pg_net's managed request queue.
create function private.invoke_push_scheduler() returns bigint language plpgsql security definer set search_path='' as $$
declare stamp text:=floor(extract(epoch from clock_timestamp()))::bigint::text;nonce text:=gen_random_uuid()::text;token text;url text;begin
 select decrypted_secret into token from vault.decrypted_secrets where name='schoolpot_push_dispatch_token';
 select decrypted_secret into url from vault.decrypted_secrets where name='schoolpot_project_url';
 if token is null or length(token)<32 or url is distinct from 'https://hlglstdtgcodblynicmh.supabase.co' then raise exception 'CONFIG';end if;
 return net.http_post(url:=url||'/functions/v1/push-dispatch',headers:=jsonb_build_object('Content-Type','application/json','X-SchoolPot-Time',stamp,'X-SchoolPot-Nonce',nonce,'X-SchoolPot-Signature',encode(extensions.hmac(stamp||':'||nonce,token,'sha256'),'hex')),body:='{}'::jsonb,timeout_milliseconds:=50000);
end $$;
revoke all on function private.invoke_push_scheduler() from public,anon,authenticated,service_role;
