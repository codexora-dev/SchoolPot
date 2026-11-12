import assert from 'node:assert/strict';
import { privacySections } from '../../src/config/privacy.js';
export async function classTests({ db, as, call, ok, denied, users }) {
  const setup = async () => (await db.query('select public.school_setup() result')).rows[0].result;
  const api = async (action, payload = {}) =>
    (
      await db.query('select public.school_membership($1,$2::jsonb) result', [
        action,
        JSON.stringify(payload),
      ])
    ).rows[0].result;
  let config, consent, assessment;
  await ok(
    '공개 학급·정책 설정에는 회원 정보가 없고 초기 반 수와 동의 접수는 준비 상태',
    async () => {
      await as('', 'anon');
      config = await setup();
      assert.deepEqual(config.counts, [0, 0, 0]);
      assert.equal(config.policy.is_ready, false);
      assert.deepEqual(config.policy.sections, privacySections);
      assert.equal(JSON.stringify(config).includes(users.a), false);
      await denied(() => api('admin_settings'), /permission denied/);
    },
  );
  await ok('새 소속 테이블 RLS·직접 접근 거절 및 일반 회원 설정·소속 정정 차단', async () => {
    await as('a');
    for (const table of ['class_settings', 'privacy_policy', 'memberships']) {
      const queries = {
        class_settings: 'select * from private.class_settings',
        privacy_policy: 'select * from private.privacy_policy',
        memberships: 'select * from private.memberships',
      };
      await denied(() => db.query(queries[table]), /permission denied/);
    }
    await denied(() => api('admin_settings', { is_admin: true }), /FORBIDDEN/);
    await denied(
      () => api('admin_correct_member', { id: users.a, grade: 3, class_number: 1 }),
      /FORBIDDEN/,
    );
    await denied(
      () => db.query('select private.require_membership($1)', [users.a]),
      /permission denied/,
    );
    await db.exec('reset role');
    assert.equal(
      (
        await db.query(
          "select bool_and(relrowsecurity) enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r'",
        )
      ).rows[0].enabled,
      true,
    );
  });
  await ok('소속 등록 전 커뮤니티·수행평가 접근 차단, 탈퇴 접근은 허용', async () => {
    await as('a');
    await denied(() => call('assessments'), /MEMBERSHIP_REQUIRED/);
    await denied(() => call('list_posts'), /MEMBERSHIP_REQUIRED/);
    assert.equal((await call('delete_account_access')).ok, true);
    assert.equal((await call('me')).enrollment_current, false);
  });
  await ok('관리자 학년별 반 수 저장·버전 충돌·비정상 반 수 거절', async () => {
    await as('admin');
    await api('admin_save_classes', {
      revision: config.revision,
      school_year: config.school_year,
      counts: [2, 3, 1],
    });
    await denied(
      () =>
        api('admin_save_classes', {
          revision: 1,
          school_year: config.school_year,
          counts: [1, 1, 1],
        }),
      /STALE_CLASS_SETTINGS/,
    );
    config = await setup();
    assert.deepEqual(config.counts, [2, 3, 1]);
    await denied(
      () =>
        api('admin_save_classes', {
          revision: config.revision,
          school_year: config.school_year,
          counts: [31, 3, 1],
        }),
      /check constraint/,
    );
  });
  await ok('개인정보 접수 준비·정책 버전·검토 확인 강제', async () => {
    await as('a');
    await denied(() => api('enroll', {}), /POLICY_NOT_READY/);
    await as('admin');
    await denied(
      () =>
        api('admin_save_policy', {
          version: config.policy.version,
          controller: '테스트 운영자',
          contact_url: 'https://example.invalid/contact',
          overseas_notice: '테스트 정책',
          is_ready: true,
        }),
      /POLICY_NOT_READY/,
    );
    await api('admin_save_policy', {
      version: config.policy.version,
      controller: '테스트 운영자',
      contact_url: 'https://example.invalid/contact',
      overseas_notice: 'DB 검증 fixture입니다. 실제 운영 정책·국외 이전 고지에 사용하지 않습니다.',
      is_ready: true,
      review_confirmed: true,
    });
    config = await setup();
    consent = {
      school_year: config.school_year,
      grade: 1,
      class_number: 1,
      policy_version: config.policy.version,
      age_14_confirmed: true,
      privacy_consent: true,
      overseas_consent: true,
    };
  });
  await ok('14세 확인·별도 필수 동의·최신 정책·실제 학급 범위 서버 검증', async () => {
    await as('a');
    for (const [payload, pattern] of [
      [{ ...consent, age_14_confirmed: false }, /AGE_REQUIRED/],
      [{ ...consent, age_14_confirmed: 'true' }, /AGE_REQUIRED/],
      [{ ...consent, privacy_consent: false }, /CONSENT_REQUIRED/],
      [{ ...consent, overseas_consent: false }, /CONSENT_REQUIRED/],
      [{ ...consent, policy_version: 1 }, /STALE_POLICY/],
      [{ ...consent, school_year: config.school_year + 1 }, /STALE_CLASS_SETTINGS/],
      [{ ...consent, class_number: 3 }, /CLASS_INVALID/],
    ])
      await denied(() => api('enroll', payload), pattern);
  });
  await ok(
    '가입 서버 전용 게이트는 동의 검증 후 소속을 기록하며 일반 회원은 실행할 수 없다',
    async () => {
      const gateway = async (action, payload) =>
        (
          await db.query('select public.account_gateway($1,$2::jsonb) result', [
            action,
            JSON.stringify(payload),
          ])
        ).rows[0].result;
      await as('a');
      await denied(() => gateway('validate_signup', consent), /permission denied/);
      await as('', 'service_role');
      await denied(
        () => gateway('validate_signup', { ...consent, age_14_confirmed: false }),
        /AGE_REQUIRED/,
      );
      const v = await gateway('validate_signup', consent);
      assert.equal(v.class_number, 1);
      const created = '99999999-4444-4444-8444-999999999999';
      await db.exec('reset role');
      await db.query(
        'insert into auth.users(id,email,is_anonymous,raw_app_meta_data) values($1,\'newclass@accounts.schoolpot.invalid\',false,\'{"account_type":"username"}\')',
        [created],
      );
      await as('', 'service_role');
      await gateway('set_recovery', { user_id: created, recovery_hash: 'a'.repeat(64) });
      await denied(
        () => gateway('set_membership', { ...consent, user_id: created, username: 'wronghandle' }),
        /NOT_FOUND/,
      );
      await gateway('set_membership', { ...consent, user_id: created, username: 'newclass' });
      await denied(
        () =>
          gateway('set_membership', {
            ...consent,
            user_id: created,
            username: 'newclass',
            class_number: 2,
          }),
        /duplicate key/,
      );
      await db.exec('reset role');
      assert.equal(
        (await db.query('select class_number from private.memberships where user_id=$1', [created]))
          .rows[0].class_number,
        1,
      );
      await db.query('delete from auth.users where id=$1', [created]);
    },
  );
  await ok('소속 등록은 auth.uid 기준·본인 최초 등록만 허용·동의 시각 저장', async () => {
    await as('a');
    await api('enroll', { ...consent, user_id: users.b, is_admin: true });
    let me = await call('me');
    assert.equal(me.membership.class_number, 1);
    assert.equal(me.enrollment_current, true);
    await denied(() => api('enroll', { ...consent, class_number: 2 }), /MEMBERSHIP_LOCKED/);
    await as('b');
    assert.equal((await call('me')).membership, null);
    await api('enroll', { ...consent, class_number: 2 });
    await as('admin');
    await api('enroll', consent);
    await db.exec('reset role');
    const m = (await db.query('select * from private.memberships where user_id=$1', [users.a]))
      .rows[0];
    assert.ok(m.consented_at);
    assert.ok(m.age_14_confirmed_at);
    assert.ok(m.overseas_consented_at);
  });
  await ok('프로필 학년·반·역할 수정으로 소속 권한 우회 불가', async () => {
    await as('a');
    await call('save_profile', {
      nickname: '소속검증친구',
      grade: 3,
      class_number: 30,
      is_admin: true,
    });
    const me = await call('me');
    assert.equal(me.membership.grade, 1);
    assert.equal(me.membership.class_number, 1);
    assert.equal(me.is_admin, false);
  });
  await ok('수행평가 등록의 학년·반은 요청 대신 저장된 소속으로 강제', async () => {
    await as('a');
    assessment = (
      await call('save_assessment', {
        title: '1반 전용 일정',
        subject: '수학',
        body: '1반 정보',
        due_date: new Date().toISOString().slice(0, 10),
        grade: 3,
        class_number: 30,
        school_year: 2099,
      })
    ).id;
    const a = (await call('assessments', { grade: 3, class_number: 30 })).find(
      (a) => a.id === assessment,
    );
    assert.equal(a.grade, 1);
    assert.equal(a.class_number, 1);
    assert.equal(a.school_year, config.school_year);
    assert.equal(a.author_id, undefined);
  });
  await ok('다른 반의 조회·수정·신고를 ID·필터 변조로 우회할 수 없다', async () => {
    await as('b');
    assert.equal(
      (await call('assessments', { grade: 1, class_number: 1 })).some((a) => a.id === assessment),
      false,
    );
    await denied(
      () =>
        call('save_assessment', {
          id: assessment,
          title: '변조',
          subject: '국어',
          body: '우회',
          due_date: new Date().toISOString().slice(0, 10),
        }),
      /NOT_FOUND/,
    );
    await denied(
      () => call('report_assessment', { id: assessment, reason: '다른 반 추측 ID' }),
      /NOT_FOUND/,
    );
  });
  await ok('동일 반에만 수행평가와 수정 요청을 공유하고 관리자도 다른 반 본문 비공개', async () => {
    await as('admin');
    assert.ok((await call('assessments')).some((a) => a.id === assessment));
    await call('report_assessment', { id: assessment, reason: '같은 반 수정 요청' });
    const bAssessment = await (async () => {
      await as('b');
      return call('save_assessment', {
        title: '2반 비공개 일정',
        subject: '과학',
        body: '2반 본문',
        due_date: new Date().toISOString().slice(0, 10),
      });
    })();
    await call('report_assessment', { id: bAssessment.id, reason: '2반 수정 요청 본문' });
    await as('admin');
    assert.equal(
      (await call('assessments')).some((a) => a.id === bAssessment.id),
      false,
    );
    assert.equal(
      (await call('admin_reports')).assessments.some((r) => r.assessment_id === bAssessment.id),
      false,
    );
    await denied(
      () => call('admin_delete', { id: bAssessment.id, kind: 'assessment' }),
      /NOT_FOUND/,
    );
  });
  await ok('소속 회원이 있는 반 삭제 거절 및 관리자 정정·이전 반 일정 차단', async () => {
    await as('admin');
    await denied(
      () =>
        api('admin_save_classes', {
          revision: config.revision,
          school_year: config.school_year,
          counts: [1, 3, 1],
        }),
      /CLASS_IN_USE/,
    );
    const rows = await api('admin_members', { query: 'student_a' });
    const a = rows.find((m) => m.id === users.a);
    assert.ok(a);
    await api('admin_correct_member', {
      id: a.id,
      revision: a.revision,
      grade: 1,
      class_number: 2,
      reason: '본인 요청 정정',
    });
    await denied(
      () =>
        api('admin_correct_member', {
          id: a.id,
          revision: a.revision,
          grade: 1,
          class_number: 1,
          reason: '오래된 변경',
        }),
      /STALE_MEMBERSHIP/,
    );
    await as('a');
    assert.equal(
      (await call('assessments')).some((a) => a.id === assessment),
      false,
    );
    await denied(
      () =>
        call('save_assessment', {
          id: assessment,
          title: '이전 반 수정',
          subject: '수학',
          due_date: new Date().toISOString().slice(0, 10),
          body: '본문',
        }),
      /NOT_FOUND/,
    );
  });
  await ok('반 정보 없는 기존 일정은 작성자만 조회·본인 반 이관 가능', async () => {
    await db.exec('reset role');
    const id = (
      await db.query(
        "insert into private.performance_assessments(author_id,title,subject,grade,due_date,body) values($1,'기존 일정','국어',3,current_date,'이전 본문') returning id",
        [users.a],
      )
    ).rows[0].id;
    await as('b');
    assert.equal(
      (await call('assessments_unassigned')).some((a) => a.id === id),
      false,
    );
    await as('a');
    assert.ok((await call('assessments_unassigned')).some((a) => a.id === id));
    await call('save_assessment', {
      id,
      title: '이관 일정',
      subject: '국어',
      due_date: new Date().toISOString().slice(0, 10),
      body: '옮긴 본문',
      grade: 3,
      class_number: 1,
    });
    assert.ok(
      (await call('assessments')).some((a) => a.id === id && a.grade === 1 && a.class_number === 2),
    );
  });
  await ok('정책 변경 시 재동의를 요구하되 소속 변경은 허용하지 않는다', async () => {
    await as('admin');
    config = await setup();
    await api('admin_save_policy', {
      ...config.policy,
      version: config.policy.version,
      review_confirmed: true,
      is_ready: true,
    });
    config = await setup();
    await as('a');
    assert.equal((await call('me')).enrollment_current, false);
    await denied(() => call('assessments'), /CONSENT_REQUIRED/);
    await denied(
      () => api('enroll', { ...consent, policy_version: config.policy.version, class_number: 1 }),
      /MEMBERSHIP_LOCKED/,
    );
    await api('enroll', { ...consent, policy_version: config.policy.version, class_number: 2 });
    assert.equal((await call('me')).enrollment_current, true);
  });
  await ok('학년도 변경 후 기존 소속으로 새 학년도 정보 조회 불가', async () => {
    await as('admin');
    await api('admin_save_classes', {
      revision: config.revision,
      school_year: config.school_year + 1,
      counts: [2, 3, 1],
    });
    await as('a');
    await denied(() => call('assessments'), /MEMBERSHIP_REQUIRED/);
    await api('enroll', {
      ...consent,
      policy_version: config.policy.version,
      school_year: config.school_year + 1,
      grade: 2,
      class_number: 1,
    });
    assert.deepEqual(await call('assessments'), []);
  });
}
