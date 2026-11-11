import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { json, readBody } from '../_shared/http.ts';
import { username, accountEmail } from '../../../src/lib/identity.js';
import { password } from '../../../src/lib/validation.js';
const defaultOrigins =
  'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,https://codexora-dev.github.io';
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const randomCode = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async (text: string) =>
  hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
Deno.serve(async (req: Request) => {
  let origin = '';
  try {
    const candidate = req.headers.get('Origin') || '';
    const allowed = (Deno.env.get('ALLOWED_ORIGINS') || defaultOrigins)
      .split(',')
      .map((s) => s.trim());
    if (!allowed.includes(candidate) || !candidate) return json({ error: 'ORIGIN' }, 403);
    origin = candidate;
    if (req.method === 'OPTIONS') return json({}, 200, origin);
    if (req.method !== 'POST') return json({ error: 'METHOD' }, 405, origin);
    let body, handle, secret;
    try {
      body = await readBody(req);
      handle = username(body.username);
      secret = password(body.password);
    } catch {
      return json({ error: 'INVALID_INPUT' }, 400, origin);
    }
    if (!['signup', 'recover'].includes(body.action))
      return json({ error: 'INVALID_INPUT' }, 400, origin);
    const url = Deno.env.get('SUPABASE_URL'),
      key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return json({ error: 'CONFIG' }, 503, origin);
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const gateway = async (action: string, payload: Record<string, unknown>) => {
      const { data, error } = await admin.rpc('account_gateway', {
        p_action: action,
        p_payload: payload,
      });
      if (error) {
        console.error('account_gateway failure', error.code, error.message);
        throw new Error(error.message.includes('RATE_LIMIT') ? 'RATE_LIMIT' : 'CONFIG');
      }
      return data;
    };
    // Never retain a raw IP. A service-secret keyed digest is stored only for bounded abuse counters.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ipHash = await digest(key + '|schoolpot-ip|' + ip);
    await gateway('limit', { kind: body.action, username: handle, ip_hash: ipHash });
    const nextCode = randomCode(),
      nextHash = await digest(nextCode);
    if (body.action === 'signup') {
      const { data, error } = await admin.auth.admin.createUser({
        email: accountEmail(handle),
        password: secret,
        email_confirm: true,
        app_metadata: { account_type: 'username' },
        user_metadata: { nickname: handle },
      });
      if (error)
        return json(
          {
            error: ['email_exists', 'user_already_exists'].includes(error.code || '')
              ? 'ACCOUNT_EXISTS'
              : 'SIGNUP_FAILED',
          },
          400,
          origin,
        );
      try {
        await gateway('set_recovery', { user_id: data.user.id, recovery_hash: nextHash });
      } catch (error) {
        await admin.auth.admin.deleteUser(data.user.id);
        throw error;
      }
      return json({ ok: true, username: handle, recovery_code: nextCode }, 201, origin);
    }
    const code = String(body.recovery_code || '')
      .replace(/[\s-]/g, '')
      .toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(code)) return json({ error: 'RECOVERY_FAILED' }, 400, origin);
    const oldHash = await digest(code);
    const claimed = await gateway('claim_recovery', {
      username: handle,
      old_hash: oldHash,
      new_hash: nextHash,
    });
    if (!claimed?.user_id) return json({ error: 'RECOVERY_FAILED' }, 400, origin);
    const { error: changed } = await admin.auth.admin.updateUserById(claimed.user_id, {
      password: secret,
    });
    if (changed) {
      await gateway('restore_recovery', {
        username: handle,
        old_hash: oldHash,
        new_hash: nextHash,
      });
      return json({ error: 'RECOVERY_FAILED' }, 400, origin);
    }
    // Revocation happens in SQL after the credential update, including tokens minted before recovery.
    await gateway('revoke_sessions', { user_id: claimed.user_id });
    return json({ ok: true, username: handle, recovery_code: nextCode }, 200, origin);
  } catch (error) {
    console.error(
      'accounts failure',
      error instanceof Error ? error.message.slice(0, 160) : 'unknown',
    );
    return json(
      {
        error:
          error instanceof Error && error.message === 'RATE_LIMIT'
            ? 'RATE_LIMIT'
            : error instanceof Error && error.message === 'CONFIG'
              ? 'CONFIG'
              : 'REQUEST_FAILED',
      },
      error instanceof Error && error.message === 'RATE_LIMIT' ? 429 : 500,
      origin,
    );
  }
});
