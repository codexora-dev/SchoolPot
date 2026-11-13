import assert from 'node:assert/strict';
export async function roleMigrationTests(db, migration, ok) {
  await ok('운영 역할 이관은 지정된 두 아이디를 매핑하고 기존 제한·공지·감사 보존', async () => {
    await db.exec('begin');
    try {
      await db.exec(`insert into auth.users(id,email,raw_app_meta_data) values
        ('90000000-0000-4000-8000-000000000001','kminjae803@accounts.schoolpot.invalid','{"account_type":"username"}'),
        ('90000000-0000-4000-8000-000000000002','yoonjihoo_0221@accounts.schoolpot.invalid','{"account_type":"username"}');
        insert into private.user_roles values('90000000-0000-4000-8000-000000000001','admin'),('90000000-0000-4000-8000-000000000002','admin');
        update private.profiles set suspended_until=now()+interval '2 days' where id='90000000-0000-4000-8000-000000000002';
        insert into private.notices(title,body) values('이관 전 공지','보존할 내용');`);
      await db.exec(migration);
      assert.deepEqual(
        (await db.query('select role from private.user_roles order by user_id')).rows.map(
          (r) => r.role,
        ),
        ['owner', 'moderator'],
      );
      assert.equal((await db.query('select count(*) n from private.sanctions')).rows[0].n, 1);
      assert.equal(
        (await db.query('select owner_only,body from private.notices')).rows[0].body,
        '보존할 내용',
      );
      assert.equal(
        (await db.query('select owner_only from private.notices')).rows[0].owner_only,
        true,
      );
      assert.equal(
        (
          await db.query(
            "select count(*) n from private.admin_audit_logs where action='role_migration'",
          )
        ).rows[0].n,
        2,
      );
    } finally {
      await db.exec('rollback');
    }
  });
  await ok('확인되지 않은 관리자 계정이 생기면 이관을 중단하고 데이터 보존', async () => {
    await db.exec('begin');
    try {
      await db.exec(`insert into auth.users(id,email,raw_app_meta_data) values('90000000-0000-4000-8000-000000000003','unreviewed@accounts.schoolpot.invalid','{"account_type":"username"}');
        insert into private.user_roles values('90000000-0000-4000-8000-000000000003','admin');`);
      await assert.rejects(() => db.exec(migration), /UNREVIEWED_ADMIN/);
    } finally {
      await db.exec('rollback');
    }
  });
}
