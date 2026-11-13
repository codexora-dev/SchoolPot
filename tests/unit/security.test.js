import { it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
async function sources(dir) {
  const out = [];
  for (const file of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, file.name);
    if (file.isDirectory()) out.push(await sources(path));
    else if (path.endsWith('.js')) out.push(await readFile(path, 'utf8'));
  }
  return out.join('\n');
}
it('프론트엔드에서 HTML 실행 API와 실제 secret 키를 사용하지 않는다', async () => {
  const code = await sources(fileURLToPath(new URL('../../src', import.meta.url)));
  expect(code).not.toMatch(/\.innerHTML\s*=|\beval\s*\(|new Function\s*\(/);
  expect(code).not.toMatch(/sb_secret_[A-Za-z0-9_-]{20,}|SUPABASE_SERVICE_ROLE_KEY/);
});
