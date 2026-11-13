import { handleDeleteAccount } from '../../supabase/functions/delete-account/handler.ts';
function assert(value: unknown): asserts value {
  if (!value) throw Error('assertion failed');
}
const user = {
  id: '77777777-7777-4777-8777-777777777777',
  email: 'fixture@accounts.schoolpot.invalid',
};
async function run(gate?: string, wrongPassword = false) {
  Deno.env.set('SUPABASE_URL', 'https://project.example');
  Deno.env.set('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test_fixture_only');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_test_fixture_only');
  Deno.env.set('ALLOWED_ORIGINS', 'https://school.example');
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    calls.push(url.pathname + url.search);
    let body: unknown = {};
    let status = 200;
    if (url.pathname === '/auth/v1/user') body = user;
    else if (url.pathname === '/rest/v1/rpc/community') {
      body = gate ? { code: 'P0001', message: gate } : { ok: true };
      status = gate ? 400 : 200;
    } else if (url.pathname === '/auth/v1/token') {
      body = wrongPassword
        ? { error: 'invalid_grant', error_description: 'wrong password' }
        : {
            access_token: 'fixture-access-token',
            refresh_token: 'fixture-refresh-token',
            expires_in: 3600,
            token_type: 'bearer',
            user,
          };
      status = wrongPassword ? 400 : 200;
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const response = await handleDeleteAccount(
      new Request('https://edge.example', {
        method: 'POST',
        headers: {
          Origin: 'https://school.example',
          Authorization: 'Bearer fixture-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: 'fixture-password' }),
      }),
    );
    return { response, calls };
  } finally {
    globalThis.fetch = original;
  }
}
Deno.test('최고 관리자 탈퇴는 비밀번호 재인증·전체 로그아웃·삭제 전에 중단', async () => {
  const { response, calls } = await run('OWNER_TRANSFER_REQUIRED');
  assert(response.status === 403);
  assert((await response.json()).error === 'OWNER_TRANSFER_REQUIRED');
  assert(
    !calls.some(
      (p) =>
        p.startsWith('/auth/v1/token') ||
        p.startsWith('/auth/v1/logout') ||
        p.startsWith('/auth/v1/admin'),
    ),
  );
});
Deno.test('유효하지 않은 세션·요청 제한은 계정 삭제를 실행하지 않는다', async () => {
  for (const code of ['AUTH_REQUIRED', 'RATE_LIMIT']) {
    const { response, calls } = await run(code);
    assert(response.status === 403);
    assert(!calls.some((p) => p.startsWith('/auth/v1/admin')));
  }
});
Deno.test('탈퇴 비밀번호 오류는 전역 로그아웃·계정 삭제를 실행하지 않는다', async () => {
  const { response, calls } = await run(undefined, true);
  assert(response.status === 403);
  assert((await response.json()).error === 'REAUTHENTICATION_FAILED');
  assert(!calls.some((p) => p.startsWith('/auth/v1/admin') || p.includes('scope=global')));
});
Deno.test(
  '제한 계정도 게이트 허용·비밀번호 확인 후 전역 로그아웃과 실제 삭제 순서 유지',
  async () => {
    const { response, calls } = await run();
    assert(response.status === 200);
    assert((await response.json()).ok === true);
    assert(
      calls.findIndex((p) => p.includes('scope=global')) <
        calls.findIndex((p) => p.startsWith('/auth/v1/admin/users/')),
    );
    assert(calls.some((p) => p === `/auth/v1/admin/users/${user.id}`));
  },
);
