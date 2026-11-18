import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function pwaPlugin() {
  return {
    name: 'schoolpot-pwa',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((name) => /\.(js|css|html)$/.test(name));
      const workerSource = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
      const publicFiles = [
        'offline.html',
        'offline.js',
        'offline.css',
        'manifest.webmanifest',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/maskable-512.png',
        'icons/apple-touch-icon.png',
      ];
      const digest = createHash('sha256')
        .update(workerSource)
        .update(files.map((name) => name + (bundle[name].code || bundle[name].source)).join(''));
      for (const file of publicFiles)
        digest.update(readFileSync(new URL('../public/' + file, import.meta.url)));
      const version = digest.digest('hex').slice(0, 12);
      const source = workerSource
        .replace('__BUILD_VERSION__', version)
        .replace("'__PRECACHE_FILES__'", JSON.stringify([...files, ...publicFiles]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
