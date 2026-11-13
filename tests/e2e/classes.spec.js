import { test, expect } from './test.js';
import { schoolSetup, enrolled } from './school.js';
const id = '66666666-6666-4666-8666-666666666666';
async function session(page, admin = false, complete = true) {
  const state = {
    ...enrolled,
    enrollment_current: complete,
    membership: complete ? { ...enrolled.membership } : null,
  };
  await page.addInitScript(
    ({ id }) => {
      localStorage.setItem('schoolpot-remember-login', 'true');
      localStorage.setItem(
        'sb-hlglstdtgcodblynicmh-auth-token',
        JSON.stringify({
          user: { id },
          access_token: 'test-session',
          refresh_token: 'test-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
        }),
      );
    },
    { id },
  );
  await page.route('**/auth/v1/user', (r) =>
    r.fulfill({ json: { id, app_metadata: {}, user_metadata: {} } }),
  );
  await page.route('**/rest/v1/rpc/community', (r) =>
    r.fulfill({
      json:
        r.request().postDataJSON().p_action === 'me'
          ? {
              profile: { nickname: '우리반친구', notifications_enabled: true },
              is_admin: admin,
              ...state,
            }
          : [],
    }),
  );
  return state;
}
test('동의·연령 체크 없이 가입 학년별 반 선택과 서버 전송', async ({ page }) => {
  let body;
  await page.route('**/functions/v1/accounts', (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
      });
    body = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: { ok: true, recovery_code: 'a'.repeat(64) },
    });
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/#/signup');
  await expect(page.locator('input[name=age_14_confirmed]')).toHaveCount(0);
  await expect(page.locator('main .processing-note')).toHaveCount(0);
  await expect(
    page.locator('input[name=privacy_consent], input[name=overseas_consent]'),
  ).toHaveCount(0);
  await page.getByLabel('학년', { exact: true }).selectOption('2');
  await expect(page.getByLabel('반', { exact: true }).locator('option')).toHaveCount(4);
  await page.getByLabel('반', { exact: true }).selectOption('3');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/screenshots/signup-class-mobile.png', fullPage: true });
  await page.getByLabel('아이디', { exact: true }).fill('classfriend');
  await page.getByLabel('비밀번호', { exact: true }).fill('testing888');
  await page.getByRole('button', { name: '회원가입', exact: true }).click();
  await expect(page.getByRole('heading', { name: '가입이 완료되었어요' })).toBeVisible();
  expect(body).toMatchObject({
    grade: 2,
    class_number: 3,
    school_year: 2026,
    policy_version: 1,
  });
  for (const name of [
    'age_14_confirmed',
    'email',
    'birth_date',
    'student_id',
    'real_name',
    'privacy_consent',
    'overseas_consent',
  ])
    expect(body).not.toHaveProperty(name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('기존 회원은 소속 등록 후 본인 반 일정 화면에 진입하고 프로필 소속은 수정할 수 없다', async ({
  page,
}) => {
  const state = await session(page, false, false);
  let payload;
  await page.route('**/rest/v1/rpc/school_membership', (r) => {
    const { p_action, p_payload } = r.request().postDataJSON();
    expect(p_action).toBe('enroll');
    payload = p_payload;
    state.membership = { ...enrolled.membership };
    state.enrollment_current = true;
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto('/#/assessments');
  await page.getByRole('link', { name: '학년·반 선택', exact: true }).click();
  await page.getByLabel('학년', { exact: true }).selectOption('1');
  await page.getByLabel('반', { exact: true }).selectOption('1');
  await expect(page.locator('main input[type=checkbox]')).toHaveCount(0);
  await page.getByRole('button', { name: '내 반으로 시작하기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '수행평가 캘린더', exact: true })).toBeVisible();
  expect(payload.class_number).toBe(1);
  await expect(
    page.getByText('2026학년도 1학년 1반의 일정만 표시합니다.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: '전체 학년', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '＋ 일정 등록', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('학년')).toHaveCount(0);
  await expect(
    dialog.getByText('2026학년도 1학년 1반에만 공유합니다.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await page.goto('/#/profile');
  await expect(page.getByText('2026학년도 1학년 1반', { exact: true })).toBeVisible();
  await expect(page.getByLabel('학년', { exact: true })).toHaveCount(0);
});
test('관리자 학년별 반 수 저장·회원 소속 정정', async ({ page }) => {
  await session(page, true);
  let setup = JSON.parse(JSON.stringify(schoolSetup));
  let member = { id, username: 'classfriend', nickname: '우리반친구', ...enrolled.membership };
  let corrected;
  await page.route('**/rest/v1/rpc/school_membership', (route) => {
    const { p_action, p_payload } = route.request().postDataJSON();
    if (p_action === 'admin_settings') return route.fulfill({ json: setup });
    if (p_action === 'admin_members') return route.fulfill({ json: [member] });
    if (p_action === 'admin_save_classes') {
      expect(p_payload.counts).toEqual([4, 3, 1]);
      setup = { ...setup, counts: p_payload.counts, revision: 2 };
    }
    if (p_action === 'admin_correct_member') {
      corrected = p_payload;
      member = {
        ...member,
        grade: p_payload.grade,
        class_number: p_payload.class_number,
        revision: 2,
      };
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/#/admin?tab=classes');
  await page.getByLabel('1학년은 몇 반까지 있나요? (0: 등록 중지)', { exact: true }).fill('4');
  await page.getByRole('button', { name: '학급 설정 저장', exact: true }).click();
  await expect(
    page.getByLabel('1학년은 몇 반까지 있나요? (0: 등록 중지)', { exact: true }),
  ).toHaveValue('4');
  await page.getByRole('button', { name: '소속 정정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '소속 정정', exact: true });
  await dialog.getByLabel('정정할 반', { exact: true }).selectOption('4');
  await dialog.getByLabel('정정 사유', { exact: true }).fill('소속 선택 오류 정정');
  await dialog.getByRole('button', { name: '소속 정정 저장', exact: true }).click();
  await expect(page.locator('.management-card')).toContainText('1학년 4반');
  expect(corrected).toMatchObject({ id, revision: 1, grade: 1, class_number: 4 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/screenshots/admin-class-settings.png', fullPage: true });
});
test('문서 검토 상태와 별개로 가입하고 삭제한 개인정보 섹션은 표시하지 않는다', async ({
  page,
}) => {
  await page.route('**/rest/v1/rpc/school_setup', (r) =>
    r.fulfill({
      json: {
        ...schoolSetup,
        policy: {
          ...schoolSetup.policy,
          is_ready: false,
          contact_url: 'https://codexora-dev.github.io/SPContact',
        },
      },
    }),
  );
  await page.goto('/#/signup');
  await expect(page.getByRole('button', { name: '회원가입', exact: true })).toBeEnabled();
  await page.goto('/#/privacy');
  await expect(page.getByRole('heading', { name: '개인정보 처리방침', exact: true })).toBeVisible();
  await expect(page.locator('main a[href^="mailto:"]')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '위탁·국외 처리 및 보안 기록', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '개인정보 문의와 권리행사', exact: true }),
  ).toHaveCount(0);
});
test('소속이 유효하지 않게 되면 재시도 후 학년·반 선택으로 안내한다', async ({ page }) => {
  const state = await session(page, false, true);
  await page.route('**/rest/v1/rpc/community', (route) => {
    if (route.request().postDataJSON().p_action !== 'assessments') return route.fallback();
    state.enrollment_current = false;
    return route.fulfill({ status: 400, json: { code: 'P0001', message: 'MEMBERSHIP_REQUIRED' } });
  });
  await page.goto('/#/assessments');
  await expect(page.getByRole('alert')).toContainText('학년·반');
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await page.getByRole('link', { name: '학년·반 선택', exact: true }).click();
  await expect(page.getByRole('heading', { name: '학년·반 선택', exact: true })).toBeVisible();
  await expect(page.getByLabel('학년', { exact: true })).toBeDisabled();
});
