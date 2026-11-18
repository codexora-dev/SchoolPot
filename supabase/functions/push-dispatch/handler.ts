export type Job = {
  id: string;
  lease_token: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  tag: string;
  path?: string;
};
export type Dependencies = {
  token: string;
  claim: (nonce?: string) => Promise<Job[]>;
  finish: (job: Job, code: number) => Promise<void>;
  send: (job: Job) => Promise<number>;
};
export function allowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com|[a-z0-9-]+\.push\.mozilla\.com)$/.test(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}
async function equalSecret(a: string, b: string) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all(
    [a, b].map((s) => crypto.subtle.digest('SHA-256', encoder.encode(s))),
  );
  const x = new Uint8Array(left),
    y = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}
export async function dispatch(req: Request, deps: Dependencies): Promise<Response> {
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  if (req.method !== 'POST') return respond({ error: 'METHOD' }, 405);
  if (!deps.token || deps.token.length < 32) return respond({ error: 'CONFIG' }, 503);
  const authorization = req.headers.get('Authorization') || '';
  if (authorization.length > 512 || req.headers.has('Origin'))
    return respond({ error: 'FORBIDDEN' }, 403);
  let nonce: string | undefined;
  if (!(await equalSecret(authorization, `Bearer ${deps.token}`))) {
    const timestamp = req.headers.get('X-SchoolPot-Time') || '';
    const candidate = req.headers.get('X-SchoolPot-Nonce') || '';
    const signature = req.headers.get('X-SchoolPot-Signature') || '';
    if (
      !/^\d{10}$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 ||
      !/^[0-9a-f-]{36}$/.test(candidate) ||
      !/^[0-9a-f]{64}$/.test(signature)
    )
      return respond({ error: 'FORBIDDEN' }, 403);
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(deps.token),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(timestamp + ':' + candidate));
    const expected = [...new Uint8Array(mac)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (!(await equalSecret(signature, expected))) return respond({ error: 'FORBIDDEN' }, 403);
    nonce = candidate;
  }
  // No recipient, endpoint, message or user-supplied event is accepted here.
  if (req.body) {
    const reader = req.body.getReader();
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 1024) {
          await reader.cancel();
          return respond({ error: 'SIZE' }, 413);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  try {
    const jobs = await deps.claim(nonce);
    let cursor = 0,
      sent = 0,
      failed = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, jobs.length) }, async () => {
        while (cursor < jobs.length) {
          const job = jobs[cursor++];
          let code = 400;
          if (allowedPushEndpoint(job.endpoint)) {
            try {
              code = await deps.send(job);
            } catch {
              code = 0;
            }
          }
          await deps.finish(job, code);
          if (code >= 200 && code < 300) sent++;
          else failed++;
        }
      }),
    );
    return respond({ claimed: jobs.length, sent, failed });
  } catch {
    return respond({ error: 'DELIVERY_FAILED' }, 503);
  }
}
