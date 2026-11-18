-- Approved operational setup: existing project, no external paid service or key rotation.
-- VAPID keys are generated once inside the authenticated Edge worker and stored in Vault.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
do $$begin
 if not exists(select 1 from vault.secrets where name='schoolpot_project_url') then
  perform vault.create_secret('https://hlglstdtgcodblynicmh.supabase.co','schoolpot_project_url');
 elsif (select decrypted_secret from vault.decrypted_secrets where name='schoolpot_project_url') is distinct from 'https://hlglstdtgcodblynicmh.supabase.co' then raise exception 'CONFIG_PROJECT';end if;
 if not exists(select 1 from vault.secrets where name='schoolpot_push_dispatch_token') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'schoolpot_push_dispatch_token');
 end if;
 if exists(select 1 from cron.job where jobname='schoolpot-v2-push') then raise exception 'UNREVIEWED_SCHEDULER';end if;
end $$;
select cron.schedule('schoolpot-v2-push','* * * * *',$cron$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='schoolpot_project_url') || '/functions/v1/push-dispatch',
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='schoolpot_push_dispatch_token')),
  body := '{}'::jsonb,timeout_milliseconds := 50000
 );
$cron$);
