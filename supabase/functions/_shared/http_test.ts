import { protect, readBody } from './http.ts';
function assert(condition: boolean) {
  if (!condition) throw new Error('assertion failed');
}
async function rejects(action: () => Promise<unknown>, message: string) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error && error.message === message);
    return;
  }
  throw new Error('Expected rejection');
}
Deno.test('허용되지 않은 Origin 거절', async () => {
  Deno.env.set('ALLOWED_ORIGINS', 'https://school.example');
  await rejects(
    () =>
      protect(
        new Request('https://edge.example', {
          method: 'POST',
          headers: { Origin: 'https://attacker.example' },
        }),
      ),
    'ORIGIN',
  );
});
Deno.test('Origin 없는 요청 거절', async () => {
  await rejects(() => protect(new Request('https://edge.example', { method: 'POST' })), 'ORIGIN');
});
Deno.test('허용 Origin의 preflight 승인', async () => {
  Deno.env.set('ALLOWED_ORIGINS', 'https://school.example');
  const r = await protect(
    new Request('https://edge.example', {
      method: 'OPTIONS',
      headers: { Origin: 'https://school.example' },
    }),
  );
  assert(r.preflight?.status === 200);
  assert(r.preflight?.headers.get('Access-Control-Allow-Origin') === 'https://school.example');
});
Deno.test('POST 외 메서드 거절', async () => {
  await rejects(
    () =>
      protect(
        new Request('https://edge.example', { headers: { Origin: 'https://school.example' } }),
      ),
    'METHOD',
  );
});
Deno.test('토큰 없는 요청 거절', async () => {
  await rejects(
    () =>
      protect(
        new Request('https://edge.example', {
          method: 'POST',
          headers: { Origin: 'https://school.example' },
        }),
      ),
    'AUTH',
  );
});
Deno.test('스트림 읽기 중 본문 크기 제한', async () => {
  await rejects(
    () =>
      readBody(
        new Request('https://edge.example', {
          method: 'POST',
          body: JSON.stringify({ password: 'x'.repeat(5000) }),
        }),
      ),
    'SIZE',
  );
});
Deno.test('배열과 null 본문 거절', async () => {
  for (const text of ['null', '[]'])
    await rejects(
      () => readBody(new Request('https://edge.example', { method: 'POST', body: text })),
      'BODY',
    );
});
Deno.test('정상 JSON 객체 승인', async () => {
  const value = await readBody(
    new Request('https://edge.example', { method: 'POST', body: '{"day":"2026-11-11"}' }),
  );
  assert(value.day === '2026-11-11');
});
