-- pg_net defaults grant queue access to PUBLIC; scheduler headers contain a secret.
-- Vault reads are already denied; do not change managed Vault crypto-function ownership.
revoke all on schema net,cron from public,anon,authenticated;
revoke all on net.http_request_queue,net._http_response,cron.job,cron.job_run_details from public,anon,authenticated;
alter default privileges in schema net revoke all on tables from public,anon,authenticated;
alter default privileges in schema cron revoke all on tables from public,anon,authenticated;
