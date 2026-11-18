import {
  allowedPushEndpoint,
  dispatch,
  type Job,
} from '../../supabase/functions/push-dispatch/handler.ts';
function assert(value: unknown) {
  if (!value) throw new Error('Assertion failed');
}
const token = 'test-only-dispatch-token-32-characters-minimum';
async function signedHeaders(timestamp: string, nonce: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(token),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(timestamp + ':' + nonce));
  return {
    'X-SchoolPot-Time': timestamp,
    'X-SchoolPot-Nonce': nonce,
    'X-SchoolPot-Signature': [...new Uint8Array(signature)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(''),
  };
}
Deno.test('스케줄러 서명은 시각·nonce를 묶어 검증하고 영구 토큰 없이 인증한다', async () => {
  const nonce = crypto.randomUUID(),
    stamp = String(Math.floor(Date.now() / 1000));
  let claimed = '';
  const deps = {
    token,
    claim: async (value?: string) => {
      claimed = value || '';
      return [];
    },
    send: async () => 201,
    finish: async () => {},
  };
  const response = await dispatch(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: await signedHeaders(stamp, nonce),
    }),
    deps,
  );
  assert(response.status === 200);
  assert(claimed === nonce);
  for (const headers of [
    await signedHeaders(String(Number(stamp) - 120), nonce),
    { ...(await signedHeaders(stamp, nonce)), 'X-SchoolPot-Nonce': crypto.randomUUID() },
  ]) {
    claimed = '';
    const denied = await dispatch(
      new Request('https://example.invalid', { method: 'POST', headers }),
      deps,
    );
    assert(denied.status === 403);
    assert(claimed === '');
  }
});
const job: Job = {
  id: 'fixture',
  lease_token: 'lease',
  endpoint: 'https://fcm.googleapis.com/fcm/send/test',
  p256dh: 'fixture',
  auth: 'fixture',
  tag: 'schoolpot-news',
};
Deno.test('푸시 주소는 정해진 HTTPS 공급자만 허용하고 SSRF·유사 도메인 거절', () => {
  assert(allowedPushEndpoint(job.endpoint));
  for (const endpoint of [
    'http://fcm.googleapis.com/x',
    'https://fcm.googleapis.com.attacker.invalid/x',
    'https://127.0.0.1/x',
    'https://fcm.googleapis.com:444/x',
    'https://user@fcm.googleapis.com/x',
    'https://metadata.google.internal/x',
  ])
    assert(!allowedPushEndpoint(endpoint));
});
Deno.test('디스패처는 스케줄러 비밀 인증 전에 대기열을 읽지 않는다', async () => {
  let claims = 0;
  const deps = {
    token,
    claim: async () => {
      claims++;
      return [];
    },
    send: async () => 201,
    finish: async () => {},
  };
  for (const headers of [
    {},
    { Authorization: 'Bearer forged' },
    { Authorization: `Bearer ${token}`, Origin: 'https://attacker.invalid' },
  ]) {
    const response = await dispatch(
      new Request('https://example.invalid', {
        method: 'POST',
        headers: headers as Record<string, string>,
      }),
      deps,
    );
    assert(response.status === 403);
  }
  assert(claims === 0);
});
Deno.test('발송 실패·만료 결과를 기록하고 앱 내부 알림 삭제 API는 호출하지 않는다', async () => {
  const codes: number[] = [];
  const response = await dispatch(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),
    {
      token,
      claim: async () => [job, { ...job, id: 'two' }, { ...job, id: 'three' }],
      send: async (item) => {
        if (item.id === 'fixture') throw new Error('network');
        return item.id === 'two' ? 410 : 201;
      },
      finish: async (_item, code) => {
        codes.push(code);
      },
    },
  );
  assert(response.status === 200);
  assert(codes.includes(0));
  assert(codes.includes(410));
  assert(codes.includes(201));
  const result = await response.json();
  assert(result.sent === 1 && result.failed === 2);
});
Deno.test(
  '유효한 스케줄러도 임의 endpoint를 발송하지 못하고 결과에 키를 노출하지 않는다',
  async () => {
    let sends = 0;
    const response = await dispatch(
      new Request('https://example.invalid', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
      {
        token,
        claim: async () => [{ ...job, endpoint: 'https://127.0.0.1/private' }],
        send: async () => {
          sends++;
          return 201;
        },
        finish: async (_item, code) => {
          assert(code === 400);
        },
      },
    );
    assert(sends === 0);
    assert(!JSON.stringify(await response.json()).includes('endpoint'));
  },
);
