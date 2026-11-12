import { test, expect } from './test.js';
import { randomBytes } from 'node:crypto';
test.skip(
  process.env.SCHOOLPOT_LIVE_TEST !== '1',
  'Actual accounts are created only by an explicitly enabled live test.',
);
test('실제 화면에서 가입·로그인·글쓰기·급식·탈퇴', async ({ page }) => {
  test.setTimeout(90000);
  const username = 'uiqa' + randomBytes(5).toString('hex'),
    password = randomBytes(6).toString('base64url');
  let signedIn = false,
    postId;
  try {
    await page.goto('/#/signup');
    await page.getByLabel('아이디', { exact: true }).fill(username);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByRole('button', { name: '회원가입', exact: true }).click();
    await expect(page.getByRole('heading', { name: '가입이 완료되었어요' })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator('.recovery-code')).toBeVisible();
    await page.getByRole('link', { name: '코드를 보관했어요 · 로그인하기' }).click();
    await page.getByLabel('아이디', { exact: true }).fill(username);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: `${username}님, 오늘도 반가워요.` }),
    ).toBeVisible({ timeout: 15000 });
    signedIn = true;
    await page.goto('/#/write?board=anonymous');
    await page.getByLabel('제목', { exact: true }).fill('실제 브라우저 연동 검증');
    await page
      .getByLabel('내용', { exact: true })
      .fill('검증 후 자동 삭제하는 테스트 게시글입니다.');
    await page.getByRole('button', { name: '게시하기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '실제 브라우저 연동 검증' })).toBeVisible({
      timeout: 15000,
    });
    postId = new URL(page.url()).hash.split('/post/')[1];
    await page.goto('/#/meals?day=2026-11-11');
    await expect(page.getByText(/강황쌀밥/)).toBeVisible({ timeout: 15000 });
  } finally {
    if (signedIn) {
      if (postId) {
        await page.goto('/#/post/' + postId);
        await page.getByRole('button', { name: '삭제', exact: true }).first().click();
        await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click();
        await page.waitForURL(/board/);
      }
      await page.goto('/#/profile');
      await page.getByRole('button', { name: '회원 탈퇴', exact: true }).click();
      await page.getByLabel('탈퇴 확인', { exact: true }).fill('탈퇴');
      await page.getByLabel('현재 비밀번호', { exact: true }).fill(password);
      await page.getByRole('button', { name: '계정 삭제', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: '우리 학교의 이야기가 모이는 곳' }),
      ).toBeVisible({ timeout: 20000 });
    }
  }
});
