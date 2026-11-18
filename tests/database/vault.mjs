import assert from 'node:assert/strict';
export async function vaultTests({ db, as, ok, denied }) {
  // Vault's encryption is not emulated: this fixture tests only RPC authorization and atomic initialization.
  await db.exec(`reset role;create schema vault;
    create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,secret text);
    create view vault.decrypted_secrets as select id,name,secret decrypted_secret from vault.secrets;
    create function vault.create_secret(secret text,name text) returns uuid language sql as $$insert into vault.secrets(name,secret) values(name,secret) returning id$$;
    insert into vault.secrets(name,secret) values('schoolpot_push_dispatch_token','test-fixture-token-only');`);
  const config = async (action, payload = {}) =>
    (
      await db.query('select public.push_worker_configuration($1,$2::jsonb) result', [
        action,
        JSON.stringify(payload),
      ])
    ).rows[0].result;
  await ok('서버 Vault 설정은 비회원·회원·위조 role에게 조회/초기화 금지', async () => {
    for (const [who, role] of [
      ['', 'anon'],
      ['a', 'authenticated'],
    ]) {
      await as(who, role);
      for (const action of ['get', 'initialize'])
        await denied(
          () =>
            config(action, {
              role: 'service_role',
              public_key: 'B'.repeat(87),
              private_key: 'a'.repeat(43),
            }),
          /permission denied/,
        );
    }
  });
  await ok('서버 키 초기화는 최초 한 번만 수행하며 재호출·잘못된 키로 교체 불가', async () => {
    await as('', 'service_role');
    await denied(
      () => config('initialize', { public_key: 'bad', private_key: 'bad' }),
      /INVALID_INPUT/,
    );
    const first = await config('initialize', {
      public_key: 'B'.repeat(87),
      private_key: 'a'.repeat(43),
    });
    const second = await config('initialize', {
      public_key: 'C'.repeat(87),
      private_key: 'b'.repeat(43),
    });
    assert.equal(first.public_key, second.public_key);
    assert.equal(first.private_key, second.private_key);
    assert.equal((await config('get')).token, 'test-fixture-token-only');
  });
  await db.exec('reset role;drop schema vault cascade;');
}
