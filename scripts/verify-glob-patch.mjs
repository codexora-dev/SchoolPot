import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const root = new URL('../vendor/picomatch/', import.meta.url);
const provenance = JSON.parse(await readFile(new URL('PROVENANCE.json', root), 'utf8'));
for (const [name, expected] of Object.entries(provenance.patched_sha256)) {
  assert.match(name, /^(?:lib\/)?[A-Za-z0-9_.-]+$/);
  const actual = createHash('sha256')
    .update(await readFile(new URL(name, root)))
    .digest('hex');
  assert.equal(actual, expected, `Local glob patch changed: ${name}`);
}
const require = createRequire(import.meta.url);
assert.equal(
  await realpath(require.resolve('picomatch/lib/parse')),
  await realpath(new URL('lib/parse.js', root)),
);
const pkg = require('picomatch/package.json');
assert.equal(pkg.name, '@schoolpot/picomatch');
assert.equal(pkg.version, '4.0.7+schoolpot.1');
for (const name of ['vite', 'vitest', 'tinyglobby', 'fdir']) {
  const consumer = createRequire(require.resolve(name));
  assert.equal(
    await realpath(consumer.resolve('picomatch/lib/parse')),
    await realpath(new URL('lib/parse.js', root)),
    `Unpatched glob consumer: ${name}`,
  );
}
console.log('Verified local glob security patch, provenance and installed dependency resolution.');
