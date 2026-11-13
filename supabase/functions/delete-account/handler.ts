import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { json, protect, readBody } from '../_shared/http.ts';
export async function handleDeleteAccount(req: Request) {
  let origin = '';
  try {
    const ctx = await protect(req);
    origin = ctx.origin;
    if (ctx.preflight) return ctx.preflight;
    const body = await readBody(req);
    if (typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 128)
      return json({ error: 'INVALID_INPUT' }, 400, origin);
    const { error: gateError } = await ctx.client!.rpc('community', {
      p_action: 'delete_account_access',
      p_payload: {},
    });
    if (gateError)
      return json(
        {
          error: gateError.message?.includes('OWNER_TRANSFER_REQUIRED')
            ? 'OWNER_TRANSFER_REQUIRED'
            : 'FORBIDDEN_OR_RATE_LIMIT',
        },
        403,
        origin,
      );
    // Fresh password authentication prevents an unattended browser session from deleting an account.
    const verifier = createClient(ctx.url!, ctx.key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await verifier.auth.signInWithPassword({
      email: ctx.user!.email!,
      password: body.password,
    });
    if (error || data.user?.id !== ctx.user!.id)
      return json({ error: 'REAUTHENTICATION_FAILED' }, 403, origin);
    await verifier.auth.signOut({ scope: 'local' });
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!secret) throw new Error('CONFIG');
    const admin = createClient(ctx.url!, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signout } = await admin.auth.admin.signOut(ctx.token!, 'global');
    if (signout) throw signout;
    const { error: deleted } = await admin.auth.admin.deleteUser(ctx.user!.id);
    if (deleted) throw deleted;
    // Every RPC checks auth.users existence, so a previously issued JWT cannot keep accessing data.
    return json({ ok: true }, 200, origin);
  } catch {
    return json({ error: 'DELETE_FAILED' }, 400, origin);
  }
}
