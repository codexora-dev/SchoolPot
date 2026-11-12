// An HTML 200 alone does not prove the app works: renamed repositories can leave assets at 404.
const url = new URL(process.env.DEPLOYMENT_URL || 'https://codexora-dev.github.io/SchoolPot/');
const expected = process.env.EXPECTED_BUILD;
const attempts = expected ? 12 : 1;
async function verify() {
  const target = new URL(url);
  if (expected) target.searchParams.set('build', expected);
  const response = await fetch(target, {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTML HTTP ${response.status}`);
  const html = await response.text();
  if (expected && !html.includes(`name="schoolpot-build" content="${expected}"`))
    throw new Error('CDN has not served the expected build yet.');
  const assets = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => new URL(m[1], url).href),
    ),
  ];
  if (assets.length < 2 || !html.includes('type="module"'))
    throw new Error('Expected built JS and CSS entrypoints.');
  for (const asset of assets) {
    const result = await fetch(asset, { signal: AbortSignal.timeout(15000) });
    if (!result.ok) throw new Error(`Asset HTTP ${result.status}: ${new URL(asset).pathname}`);
    const type = result.headers.get('content-type') || '';
    if (asset.endsWith('.js') && !/javascript|ecmascript/.test(type))
      throw new Error('Invalid JS content type');
    if (asset.endsWith('.css') && !type.includes('text/css'))
      throw new Error('Invalid CSS content type');
    await result.arrayBuffer();
  }
  console.log(`Verified published HTML and ${assets.length} assets at ${url.href}`);
}
for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    await verify();
    break;
  } catch (error) {
    if (attempt === attempts) throw error;
    console.log(`Waiting for CDN update (${attempt}/${attempts})`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
