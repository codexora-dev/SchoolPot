import { spawn } from 'node:child_process';
const env = {
  ...process.env,
  VITE_BASE_PATH: '/SchoolPot/',
  VITE_SUPABASE_URL: 'https://hlglstdtgcodblynicmh.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_fixture_only',
};
const vite = 'node_modules/vite/bin/vite.js';
const build = spawn(process.execPath, [vite, 'build'], { env, stdio: 'inherit' });
const code = await new Promise((resolve) => build.on('exit', resolve));
if (code !== 0) process.exit(code || 1);
const preview = spawn(process.execPath, [vite, 'preview', '--port', '4174', '--strictPort'], {
  env,
  stdio: 'inherit',
});
process.on('SIGTERM', () => {
  preview.kill();
});
process.on('SIGINT', () => {
  preview.kill();
});
preview.on('exit', (result) => process.exit(result || 0));
