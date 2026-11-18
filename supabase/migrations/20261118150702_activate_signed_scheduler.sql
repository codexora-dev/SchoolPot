-- Invalidate the bootstrap dispatch token after removing it from queue headers.
-- VAPID keys are preserved. The new token stays entirely within Vault and Edge.
select vault.update_secret((select id from vault.secrets where name='schoolpot_push_dispatch_token'),encode(extensions.gen_random_bytes(32),'hex'));
select cron.alter_job(job_id:=(select jobid from cron.job where jobname='schoolpot-v2-push'),command:='select private.invoke_push_scheduler();',active:=true);
