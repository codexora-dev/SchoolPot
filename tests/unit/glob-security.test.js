import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const picomatch = require('picomatch');
it('반복 wildcard extglob ReDoS 입력은 비활성 recursion 옵션에서도 리터럴로 처리한다', () => {
  const source = `const p=require('picomatch');
    for (const pattern of ['+(*)b','+(*a)b','*(?a)b','+(@(a|aa))b','+([ab]*)b']) {
      for (const options of [{}, {maxExtglobRecursion:false}]) {
        const match=p(pattern,options);
        if(match('a'.repeat(20000)+'!')!==false || match(pattern)!==true) process.exit(2);
      }
    }`;
  const result = spawnSync(process.execPath, ['-e', source], { timeout: 2000, encoding: 'utf8' });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
});
it('Vite/Vitest에서 사용하는 globstar·brace·확장자·단순 extglob은 유지한다', () => {
  expect(picomatch('src/**/*.{js,css}')('src/pages/main.js')).toBe(true);
  expect(picomatch('tests/**/*.test.js')('tests/unit/security.test.js')).toBe(true);
  expect(picomatch('**/node_modules/**')('a/node_modules/vite/index.js')).toBe(true);
  expect(picomatch('+(a|b).js')('ababa.js')).toBe(true);
  expect(picomatch('src/**/*.js')('src/pages/main.json')).toBe(false);
});
