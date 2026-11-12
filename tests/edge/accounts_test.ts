import { handleAccount } from '../../supabase/functions/accounts/handler.ts';
function assert(value: unknown, message = 'assertion failed'): asserts value {
  if (!value) throw Error(message);
}
const user = {
  id: '77777777-7777-4777-8777-777777777777',
  email: 'fixture@accounts.schoolpot.invalid',
  app_metadata: { account_type: 'username' },
};
const body = {
  action: 'signup',
  username: 'fixture',
  password: 'password888',
  school_year: 2026,
  grade: 1,
  class_number: 2,
  policy_version: 3,
  age_14_confirmed: true,
  privacy_consent: true,
  overseas_consent: true,
};
async function run(errorAt?: string, errorCode = 'AGE_REQUIRED') {
  Deno.env.set('SUPABASE_URL', 'https://project.example');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_test_fixture_only');
  Deno.env.set('ALLOWED_ORIGINS', 'https://school.example');
  const original = globalThis.fetch;
  const calls: {
    path: string;
    action?: string;
    payload?: Record<string, unknown>;
    method: string;
  }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const data = init?.body ? JSON.parse(String(init.body)) : {};
    const action = data.p_action;
    calls.push({
      path: url.pathname,
      action,
      payload: data.p_payload,
      method: init?.method || 'GET',
    });
    if (errorAt && action === errorAt) {
      return new Response(JSON.stringify({ message: errorCode, code: 'P0001' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify(url.pathname === '/auth/v1/admin/users' ? user : { ok: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  try {
    return {
      response: await handleAccount(
        new Request('https://edge.example', {
          method: 'POST',
          headers: {
            Origin: 'https://school.example',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
      ),
      calls,
    };
  } finally {
    globalThis.fetch = original;
  }
}
Deno.test('동의·연령·정책 검증 실패 시 Auth 사용자를 만들지 않는다', async () => {
  for (const code of [
    'AGE_REQUIRED',
    'CONSENT_REQUIRED',
    'STALE_POLICY',
    'CLASS_INVALID',
    'POLICY_NOT_READY',
  ]) {
    const { response, calls } = await run('validate_signup', code);
    assert(response.status === 400);
    assert((await response.json()).error === code);
    assert(!calls.some((c) => c.path.startsWith('/auth/')));
  }
});
Deno.test('회원가입은 검증 뒤 Auth·복구 해시·소속 동의 순서로 기록한다', async () => {
  const { response, calls } = await run();
  assert(response.status === 201);
  const result = await response.json();
  assert(result.ok === true && /^[a-f0-9]{64}$/.test(result.recovery_code));
  const actions = calls.map((c) => c.action || c.path);
  assert(
    actions.join('|') === 'limit|validate_signup|/auth/v1/admin/users|set_recovery|set_membership',
  );
  const payload = calls.find((c) => c.action === 'set_membership')!.payload!;
  assert(
    payload.user_id === user.id && payload.age_14_confirmed === true && payload.class_number === 2,
  );
  assert(!('password' in payload));
  assert(!('recovery_code' in payload));
});
Deno.test('Auth 생성 후 소속 기록 실패 시 부분 생성 계정을 삭제한다', async () => {
  const { response, calls } = await run('set_membership', 'STALE_POLICY');
  assert(response.status === 400);
  assert(calls.some((c) => c.method === 'DELETE' && c.path === '/auth/v1/admin/users/' + user.id));
});
