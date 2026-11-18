import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import webpush from 'npm:web-push@3.6.7';
import { dispatch, type Job } from './handler.ts';

type Configuration = {
  public_key: string | null;
  private_key: string | null;
  token: string;
  subject: string;
};
let cached: { value: Configuration; until: number } | null = null;
Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return new Response('Server configuration required', { status: 503 });
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const configuration = async (action: string, payload = {}): Promise<Configuration> => {
    const result = await client.rpc('push_worker_configuration', {
      p_action: action,
      p_payload: payload,
    });
    if (result.error) throw new Error('CONFIG');
    return result.data;
  };
  let config: Configuration;
  try {
    const public_key = Deno.env.get('VAPID_PUBLIC_KEY');
    const private_key = Deno.env.get('VAPID_PRIVATE_KEY');
    const token = Deno.env.get('PUSH_DISPATCH_TOKEN');
    if (public_key && private_key && token)
      config = {
        public_key,
        private_key,
        token,
        subject: Deno.env.get('VAPID_SUBJECT') || 'https://codexora-dev.github.io/SchoolPot/',
      };
    else if (cached && cached.until > Date.now()) config = cached.value;
    else {
      config = await configuration('get');
      cached = { value: config, until: Date.now() + 60000 };
    }
    if (Boolean(public_key) !== Boolean(private_key)) throw new Error('CONFIG');
    // Existing operator-managed keys take precedence even when the scheduler token is in Vault.
    if (public_key && private_key)
      config = {
        ...config,
        public_key,
        private_key,
        subject: Deno.env.get('VAPID_SUBJECT') || config.subject,
      };
    if (!config.token || !/^https:\/\//.test(config.subject)) throw new Error('CONFIG');
  } catch {
    return new Response('Server configuration required', { status: 503 });
  }
  const rpc = async (action: string, payload = {}) => {
    const { data, error } = await client.rpc('push_delivery', {
      p_action: action,
      p_payload: payload,
    });
    if (error) throw new Error('DELIVERY_RPC');
    return data;
  };
  return dispatch(req, {
    token: config.token,
    claim: async (nonce) => {
      // Runs only after the scheduler's secret has been verified by dispatch().
      if (!config.public_key || !config.private_key) {
        const keys = webpush.generateVAPIDKeys();
        config = await configuration('initialize', {
          public_key: keys.publicKey,
          private_key: keys.privateKey,
        });
        cached = { value: config, until: Date.now() + 60000 };
      }
      if (nonce) {
        const result = await client.rpc('push_scheduler_claim', { p_nonce: nonce });
        if (result.error) throw new Error('SCHEDULER_CLAIM');
        return result.data;
      }
      return rpc('claim');
    },
    finish: async (job: Job, status_code: number) => {
      await rpc('finish', { id: job.id, lease_token: job.lease_token, status_code });
    },
    send: async (job: Job) => {
      const request = webpush.generateRequestDetails(
        { endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } },
        JSON.stringify({ tag: job.tag, path: job.path }),
        {
          vapidDetails: {
            subject: config.subject,
            publicKey: config.public_key!,
            privateKey: config.private_key!,
          },
          TTL: 300,
          urgency: 'normal',
          contentEncoding: 'aes128gcm',
        },
      );
      const result = await fetch(request.endpoint, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      await result.body?.cancel();
      return result.status;
    },
  });
});
