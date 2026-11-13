import { test as base, expect } from '@playwright/test';
import { boards } from './boards.js';
import { schoolSetup } from './school.js';
// Unrelated tests must not display or depend on live operator announcements.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/rest/v1/rpc/site_popups', (route) => route.fulfill({ json: [] }));
    if (process.env.SCHOOLPOT_LIVE_TEST !== '1') {
      await page.route('**/rest/v1/rpc/service_configuration', (route) =>
        route.fulfill({
          status: 400,
          json: { code: 'PGRST202', message: 'Test fixture: bundled rules fallback' },
        }),
      );
      await page.route('**/rest/v1/rpc/school_setup', (route) =>
        route.fulfill({ json: schoolSetup }),
      );
      await page.route('**/rest/v1/rpc/school_membership', (route) =>
        route.fulfill({
          json: route.request().postDataJSON().p_action === 'admin_settings' ? schoolSetup : [],
        }),
      );
      await page.route('**/rest/v1/rpc/board_catalog', (route) => route.fulfill({ json: boards }));
      await page.route('**/rest/v1/rpc/manage_boards', (route) => route.fulfill({ json: boards }));
      await page.route('**/rest/v1/rpc/manage_notices', (route) =>
        route.request().postDataJSON().p_action === 'list'
          ? route.fulfill({ json: [] })
          : route.fulfill({ status: 400, json: { code: 'P0001', message: 'NOT_FOUND' } }),
      );
    }
    await use(page);
  },
});
export { expect };
