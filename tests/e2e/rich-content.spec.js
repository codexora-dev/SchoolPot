import { test, expect } from './test.js';
import { Buffer } from 'node:buffer';
import { enrolled } from './school.js';
const id = '77777777-7777-4777-8777-777777777777';
const imageUrl = 'https://images.example.test/announcement.png';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIeEAAAAASUVORK5CYII=',
  'base64',
);
async function image(page) {
  await page.route(imageUrl, (r) => r.fulfill({ contentType: 'image/png', body: png }));
}
async function admin(page, handle = () => []) {
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
  await page.route('**/rest/v1/rpc/community', (r) => {
    const p = r.request().postDataJSON();
    return r.fulfill({
      json:
        p.p_action === 'me'
          ? { profile: { nickname: '공지 관리자' }, ...enrolled, is_admin: true }
          : handle(p),
    });
  });
}
test('HTML 팝업은 서식·HTTPS 이미지만 표시하고 실행 코드와 추적 속성은 제거한다', async ({
  page,
}) => {
  await image(page);
  const unwanted = [];
  page.on('request', (r) => {
    if (r.url().includes('evil.example')) unwanted.push(r.url());
  });
  await page.route('**/rest/v1/rpc/site_popups', (r) =>
    r.fulfill({
      json: [
        {
          id,
          revision: 1,
          title: 'HTML 안전 안내',
          content_format: 'html',
          close_options: ['once'],
          body: `<h2>안내 내용</h2><p><strong>중요</strong> <em>준비물</em></p><img src="${imageUrl}" alt="공지 이미지" onerror="window.richXss=1"><script>window.richXss=1</script><iframe src="https://evil.example/frame"></iframe><style>@import url(https://evil.example/style);</style><svg onload="window.richXss=1"></svg><a href="java&#x73;cript:alert(1)" onclick="window.richXss=1">위험 링크</a><span style="position:fixed" id="app" onmouseover="window.richXss=1">안전한 글자</span><img src="data:image/svg+xml,evil" alt="차단 이미지">`,
        },
      ],
    }),
  );
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'HTML 안전 안내', exact: true });
  await expect(dialog.getByRole('heading', { name: '안내 내용', exact: true })).toBeVisible();
  await expect(dialog.locator('strong')).toHaveText('중요');
  const img = dialog.getByRole('img', { name: '공지 이미지', exact: true });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((n) => n.naturalWidth)).toBe(1);
  await expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(
    dialog
      .locator('.content-body')
      .locator('script,style,iframe,svg,[onclick],[onerror],[onmouseover],[style],#app'),
  ).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: '위험 링크', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.richXss)).toBeUndefined();
  expect(unwanted).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('Markdown 팝업의 제목·목록·표·코드·이미지와 링크를 렌더링한다', async ({ page }) => {
  await image(page);
  await page.route('**/rest/v1/rpc/site_popups', (r) =>
    r.fulfill({
      json: [
        {
          id,
          revision: 1,
          title: 'Markdown 안내',
          content_format: 'markdown',
          close_options: ['once'],
          body: `## 새 소식\n\n**중요 안내**\n\n- 준비물\n- 일정\n\n| 항목 | 시간 |\n|---|---|\n| 발표 | 9시 |\n\n[학교](https://example.test/)\n\n![안내 이미지](${imageUrl})\n\n\`<script>실행되지 않는 예시</script>\``,
        },
      ],
    }),
  );
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Markdown 안내', exact: true });
  await expect(dialog.getByRole('heading', { name: '새 소식', exact: true })).toBeVisible();
  await expect(dialog.locator('strong')).toHaveText('중요 안내');
  await expect(dialog.locator('li')).toHaveCount(2);
  await expect(dialog.locator('table')).toContainText('발표');
  await expect(dialog.locator('code')).toContainText('<script>실행되지 않는 예시</script>');
  await expect(dialog.getByRole('img', { name: '안내 이미지', exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: '학교', exact: true })).toHaveAttribute(
    'rel',
    'noopener noreferrer nofollow',
  );
  await page.screenshot({ path: 'docs/screenshots/popup-markdown.png' });
});
test('관리자 공지 Markdown 미리보기·전송·회원 화면 표시', async ({ page }) => {
  let notices = [],
    payload;
  await image(page);
  await admin(page, (p) => {
    if (p.p_action === 'admin_notice') {
      payload = p.p_payload;
      notices = [{ ...payload, id, created_at: new Date().toISOString() }];
      return { ok: true, id };
    }
    if (p.p_action === 'notices') return notices;
    return [];
  });
  await page.goto('/#/admin?tab=notice');
  await page.getByLabel('제목', { exact: true }).fill('새 공지 안내');
  await page.getByLabel('작성 형식', { exact: true }).selectOption('markdown');
  await page
    .getByLabel('내용', { exact: true })
    .fill(`## 준비물\n\n**필독**\n\n![공지 이미지](${imageUrl})`);
  await page.getByRole('button', { name: '본문 미리보기', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '본문 미리보기', exact: true });
  await expect(preview.getByRole('heading', { name: '준비물', exact: true })).toBeVisible();
  expect(payload).toBeUndefined();
  await preview.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '등록하고 알림 보내기', exact: true }).click();
  await expect.poll(() => payload?.content_format).toBe('markdown');
  await page.goto('/#/notices');
  await expect(page.locator('.notice strong')).toHaveText('필독');
  await expect(page.locator('.notice img')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/screenshots/notice-markdown-mobile.png', fullPage: true });
});
test('팝업 HTML 작성·전체 미리보기·저장·다시 편집할 때 형식을 유지한다', async ({ page }) => {
  await admin(page);
  let items = [];
  await page.route('**/rest/v1/rpc/manage_popups', (r) => {
    const { p_action, p_payload } = r.request().postDataJSON();
    if (p_action === 'list') return r.fulfill({ json: items });
    items = [{ ...p_payload, id, revision: 1, updated_at: new Date().toISOString() }];
    return r.fulfill({ json: { ok: true, id } });
  });
  await page.goto('/#/admin?tab=popups');
  await page.getByRole('button', { name: '＋ 팝업 등록', exact: true }).click();
  let editor = page.getByRole('dialog', { name: '새 팝업 등록', exact: true });
  await editor.getByLabel('팝업 제목', { exact: true }).fill('서식 팝업');
  await editor.getByLabel('작성 형식', { exact: true }).selectOption('html');
  await editor
    .getByLabel('팝업 본문', { exact: true })
    .fill('<h3>알림</h3><p><strong>확인하세요</strong></p>');
  await editor.getByRole('button', { name: '미리보기', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '서식 팝업', exact: true });
  await expect(preview.locator('strong')).toHaveText('확인하세요');
  await preview.getByRole('button', { name: '닫기', exact: true }).click();
  await editor.getByRole('button', { name: '팝업 등록', exact: true }).click();
  await expect(page.locator('.popup-admin-card')).toContainText('서식 팝업');
  expect(items[0].content_format).toBe('html');
  await page.getByRole('button', { name: '수정', exact: true }).click();
  editor = page.getByRole('dialog', { name: '팝업 수정', exact: true });
  await expect(editor.getByLabel('작성 형식', { exact: true })).toHaveValue('html');
  await editor.getByRole('button', { name: '취소', exact: true }).click();
});
