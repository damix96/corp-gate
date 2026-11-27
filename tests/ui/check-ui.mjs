import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UiTestHost } from './ui-test-host.mjs';

const files = async directory => (await Promise.all((await readdir(directory)).map(async name => {
  const entry = directory + '/' + name;
  return (await stat(entry)).isDirectory() ? files(entry) : [entry];
}))).flat();

const frontendRoot = fileURLToPath(new URL('../../web', import.meta.url));
const sourceFiles = await files(frontendRoot);

for (const src of sourceFiles) {
  assert.ok(!src.endsWith('.css'), `Forbidden custom CSS file in frontend: ${src}`);
  if (/\.(?:tsx|ts|jsx|js)$/.test(src)) {
    const code = await readFile(src, 'utf8');
    assert.doesNotMatch(code, /\b(?:className|style)\s*=/, `Forbidden className/style attribute in ${src}`);
    assert.doesNotMatch(code, /\binnerHTML\b/, `Forbidden innerHTML usage in ${src}`);
    assert.doesNotMatch(code, /<(?:div|span|section|header|main|table|tr|td|th|button|input|select|textarea|dialog|details)\b/, `Forbidden raw HTML tag in ${src}; use @mantine/core components`);
  }
}

const host = new UiTestHost();
await host.init();
const { app, publicRoot } = host;
try {
  const html = await app.inject('/dashboard');
  assert.equal(html.statusCode, 200);
  assert.match(html.body, /<div id="root"><\/div>/);
  assert.doesNotMatch(html.body, /https?:\/\/(?:cdn|unpkg|fonts\.)/);
  const assets = await files(publicRoot);
  for (const path of assets) {
    const url = '/' + path.slice(publicRoot.length).replaceAll('\\', '/').replace(/^\//, '');
    const response = await app.inject(url);
    assert.equal(response.statusCode, 200, url);
    if (/\.(?:js|css)$/.test(path)) {
      assert.doesNotMatch(await readFile(path, 'utf8'), /(?:cdn\.tailwindcss\.com|unpkg\.com\/lucide|fonts\.googleapis\.com)/);
    }
  }
  console.log(`PASS: production dashboard and ${assets.length} local assets served; Mantine & Zero-CSS invariants verified`);
} finally {
  await host.close();
}
