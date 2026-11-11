import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
export function json(body: unknown, status = 200, origin = '') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export async function protect(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (
    Deno.env.get('ALLOWED_ORIGINS') ||
    'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,https://codexora-dev.github.io'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) throw new Error('ORIGIN');
  if (req.method === 'OPTIONS') return { preflight: json({}, 200, origin), origin };
  if (req.method !== 'POST') throw new Error('METHOD');
  if (Number(req.headers.get('Content-Length') || 0) > 4096) throw new Error('SIZE');
  const token = req.headers.get('Authorization');
  if (!token?.startsWith('Bearer ')) throw new Error('AUTH');
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!;
  const client = createClient(url, key, {
    global: { headers: { Authorization: token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token.slice(7));
  if (error || !data.user || data.user.is_anonymous) throw new Error('AUTH');
  return { origin, client, user: data.user, token: token.slice(7), url, key };
}
export async function readBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('BODY');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) {
        await reader.cancel();
        throw new Error('SIZE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('BODY');
  return parsed;
}
