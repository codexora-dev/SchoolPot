import { test, expect } from './test.js';
import { enrolled } from './school.js';
const uid = '11111111-1111-4111-8111-111111111111';
const sid = '99000000-0000-4000-8000-000000000001';
async function setup(page, role = 'member', restricted = false) {
  const store = {
    role,
    restricted,
    calls: [],
    appeals: [],
    sanctions: restricted
      ? [
          {
            id: sid,
            kind: 'suspend',
            reason: '규정 위반 확인',
            rule: '서로 존중하기',
            starts_at: '2026-11-13T04:00:00Z',
            ends_at: '2026-11-16T04:00:00Z',
          },
        ]
      : [],
  };
  await page.addInitScript(
    ({ uid }) => {
      localStorage.setItem('schoolpot-remember-login', 'true');
      localStorage.setItem(
        'sb-hlglstdtgcodblynicmh-auth-token',
        JSON.stringify({
          user: { id: uid },
          access_token: 'test-session',
          refresh_token: 'test-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
        }),
      );
    },
    { uid },
  );
  await page.route('**/auth/v1/user', (r) => r.fulfill({ json: { id: uid } }));
  await page.route('**/rest/v1/rpc/service_configuration', (r) =>
    r.fulfill({
      json: { title: '스쿨팟', school_name: '안남중학교', description: '테스트', revision: 1 },
    }),
  );
  await page.route('**/rest/v1/rpc/community', (r) => {
    const { p_action } = r.request().postDataJSON();
    store.calls.push(p_action);
    return r.fulfill({
      json:
        p_action === 'me'
          ? {
              profile: { nickname: '운영친구' },
              ...enrolled,
              role: store.role,
              is_admin: store.role !== 'member',
              restricted: store.restricted,
              account_status: { sanctions: store.sanctions, appeals: store.appeals },
            }
          : p_action === 'admin_stats'
            ? { members: 3, posts: 4, comments: 5, reports: 1, feedback: 1 }
            : [],
    });
  });
  await page.route('**/rest/v1/rpc/governance', (r) => {
    const { p_action, p_payload } = r.request().postDataJSON();
    store.calls.push({ p_action, p_payload });
    if (p_action === 'mine')
      return r.fulfill({ json: { sanctions: store.sanctions, appeals: store.appeals } });
    if (p_action === 'appeal') {
      store.appeals.push({
        id: sid,
        sanction_id: p_payload.sanction_id,
        body: p_payload.body,
        status: 'new',
      });
      return r.fulfill({ json: { id: sid } });
    }
    if (['members', 'targets'].includes(p_action))
      return r.fulfill({
        json: [
          {
            id: uid,
            nickname: '대상친구',
            username: 'student_one',
            role: 'member',
            role_revision: 1,
            sanction_revision: 1,
            restricted: store.restricted,
          },
        ],
      });
    if (p_action === 'apply') {
      store.lastApply = p_payload;
      return r.fulfill({ json: { id: sid } });
    }
    return r.fulfill({ json: [] });
  });
  return store;
}
test('부관리자 메뉴는 허용 항목만 표시하고 최고 관리자 URL에서 데이터를 요청하지 않는다', async ({
  page,
}) => {
  const store = await setup(page, 'moderator');
  await page.goto('/#/admin');
  const nav = page.getByRole('navigation', { name: '관리자 메뉴' });
  await expect(nav.getByRole('link', { name: '회원 제재 요청', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: '관리자 권한', exact: true })).toHaveCount(0);
  await page.goto('/#/admin?tab=roles');
  await expect(page.getByRole('heading', { name: '접근할 수 없는 관리 화면이에요' })).toBeVisible();
  expect(
    store.calls.some(
      (c) => typeof c === 'object' && ['roles', 'members', 'role_history'].includes(c.p_action),
    ),
  ).toBe(false);
  await page.goto('/#/admin?tab=request&q=student');
  await page.getByRole('button', { name: '제재 요청', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('위반 규정', { exact: true }).fill('커뮤니티 규정');
  await dialog.getByLabel('안내·제재 사유').fill('규정 위반 내용 확인');
  await dialog.getByRole('button', { name: '요청 제출' }).click();
  await expect(dialog).toHaveCount(0);
  expect(store.calls.find((c) => c.p_action === 'request').p_payload.target_id).toBe(uid);
  expect(store.lastApply).toBeUndefined();
});
test('최고 관리자 제재는 구체적 수준·사유·확인 문구를 전송한다', async ({ page }) => {
  const store = await setup(page, 'owner');
  await page.goto('/#/admin?tab=members');
  await page.getByRole('button', { name: '안내·경고·이용 제한' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('제재 수준').selectOption('range');
  await dialog.getByLabel('제한 일수').fill('14');
  await dialog.getByLabel('위반 규정', { exact: true }).fill('이용 규정 3조');
  await dialog.getByLabel('안내·제재 사유').fill('반복된 규정 위반 확인');
  await dialog.getByRole('button', { name: '내용 확인 후 적용' }).click();
  await expect(dialog).toHaveCount(0);
  expect(store.lastApply).toMatchObject({
    level: 'range',
    days: '14',
    target_id: uid,
    reason: '반복된 규정 위반 확인',
  });
  expect(store.lastApply.operation_id).toMatch(/^[0-9a-f-]{36}$/);
});
test('제한 팝업은 Escape·URL 이동으로 해제되지 않고 이의 제기를 접수한다', async ({ page }) => {
  const store = await setup(page, 'member', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/board/free');
  let dialog = page.getByRole('dialog', { name: '계정 이용이 제한되어 있어요' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(store.calls).not.toContain('list_posts');
  await dialog.getByRole('button', { name: '이의 제기', exact: true }).click();
  await dialog.getByLabel('이의 제기 내용').fill('제재 내용의 재검토를 요청합니다');
  await dialog.getByRole('button', { name: '보내기', exact: true }).first().click();
  await expect(page.getByText('이의 제기를 접수했습니다. 답변을 기다려 주세요.')).toBeVisible();
  await page.goto('/#/admin');
  dialog = page.getByRole('dialog', { name: '계정 이용이 제한되어 있어요' });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: 'docs/screenshots/account-restriction-mobile.png',
    fullPage: true,
  });
});
test('로그인 도중 제한·해임 변경을 확인하면 기존 관리 화면을 교체한다', async ({ page }) => {
  const store = await setup(page, 'owner');
  await page.goto('/#/admin');
  await expect(page.getByRole('navigation', { name: '관리자 메뉴' })).toBeVisible();
  store.role = 'moderator';
  await page.evaluate(() => window.dispatchEvent(new window.Event('focus')));
  await expect(
    page
      .getByRole('navigation', { name: '관리자 메뉴' })
      .getByRole('link', { name: '관리자 권한' }),
  ).toHaveCount(0);
  store.restricted = true;
  store.sanctions = [
    {
      id: sid,
      kind: 'permanent',
      reason: '규정 위반 확인',
      rule: '이용 규정',
      starts_at: new Date().toISOString(),
    },
  ];
  await page.evaluate(() => window.dispatchEvent(new window.Event('focus')));
  await expect(page.getByRole('dialog', { name: '계정 이용이 제한되어 있어요' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '관리자 메뉴' })).toHaveCount(0);
});

test('비차단 경고를 새로 확인해도 작성 중인 글을 초기화하지 않는다', async ({ page }) => {
  const store = await setup(page);
  await page.goto('/#/write?board=free');
  await page.getByLabel('제목', { exact: true }).fill('작성 중인 제목');
  store.sanctions = [
    {
      id: sid,
      kind: 'warning',
      reason: '안내 사항',
      rule: '운영 규정',
      starts_at: new Date().toISOString(),
    },
  ];
  await page.evaluate(() => window.dispatchEvent(new window.Event('focus')));
  await expect(page.locator('#toast')).toContainText('계정 운영 안내가 변경됐어요');
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue('작성 중인 제목');
});

test('최고 관리자 서비스 설정을 확인하고 사유와 버전을 함께 저장한다', async ({ page }) => {
  await setup(page, 'owner');
  let saved;
  await page.route('**/rest/v1/rpc/service_configuration', (r) => {
    const { p_action, p_payload } = r.request().postDataJSON();
    if (p_action === 'save') saved = p_payload;
    return r.fulfill({
      json:
        p_action === 'save'
          ? { ok: true }
          : { title: '스쿨팟', school_name: '안남중학교', description: '우리 학교', revision: 2 },
    });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#/admin?tab=settings');
  await expect(page.getByRole('heading', { name: '서비스 기본 정보', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/admin-governance-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '기본 정보 수정' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('서비스 소개', { exact: true }).fill('함께 만드는 학교 커뮤니티');
  await dialog.getByLabel('처리 사유', { exact: true }).fill('소개 문구 검토');
  await dialog.getByRole('button', { name: '확인하고 저장' }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved).toMatchObject({
    description: '함께 만드는 학교 커뮤니티',
    revision: 2,
    reason: '소개 문구 검토',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: '서비스 기본 정보', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/admin-governance-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('관리자 이의 제기 알림은 관리자 이의 제기 목록으로 연결한다', async ({ page }) => {
  await setup(page, 'moderator');
  await page.route('**/rest/v1/rpc/community', (r) =>
    r.request().postDataJSON().p_action === 'notifications'
      ? r.fulfill({
          json: [
            {
              id: sid,
              message: '새 제재 이의 제기가 접수됐어요.',
              governance_kind: 'appeal_admin',
              created_at: new Date().toISOString(),
            },
          ],
        })
      : r.fallback(),
  );
  await page.goto('/#/notifications');
  await expect(page.getByRole('link', { name: '새 제재 이의 제기가 접수됐어요.' })).toHaveAttribute(
    'href',
    '#/admin?tab=appeals',
  );
});
