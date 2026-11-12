import { test as base, expect } from '@playwright/test';
// Unrelated tests must not display or depend on live operator announcements.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/rest/v1/rpc/site_popups', (route) => route.fulfill({ json: [] }));
    await use(page);
  },
});
export { expect };
