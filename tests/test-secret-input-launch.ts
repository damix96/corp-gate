import assert from 'node:assert/strict';
import { SecretInputBrowser, BrowserCommand } from '../src/secret-input/browser-launcher.js';

const commands: BrowserCommand[] = [];
const launcher = new SecretInputBrowser('win32', async command => { commands.push(command); return true; });
const address = new URL('http://127.0.0.1:12345/vault/set?secrets=ONE,TWO&request=12345678-1234-4234-8234-123456789abc');
assert.equal(await launcher.open(address), 'attempted');
assert.equal(commands.length, 1);
assert.equal(commands[0].env.CORPGATE_INPUT_URL, address.href);
assert.deepEqual(commands[0].args, ['/d', '/s', '/c', 'start "" "' + address.href + '"']);
assert.equal(commands[0].file.toLowerCase().includes('powershell'), false);
const cleanAddress = new URL('http://127.0.0.1:12345/vault/set/12345678-1234-4234-8234-123456789abc');
assert.equal(await launcher.open(cleanAddress), 'attempted');
assert.equal(await launcher.open(new URL('http://127.0.0.1:12345/vault/set/e4b2')), 'attempted');
assert.equal(await launcher.open(new URL('http://127.0.0.1:12345/vault/set?secrets=%41%42')), 'attempted');
assert.equal(commands[3].args.at(-1)?.includes('%'), false, 'The Windows shell must not expand percent-encoded URL data as environment variables');
assert.equal(await launcher.open(new URL('http://127.0.0.1:12345/?token=' + 'a'.repeat(64) + '#vault')), 'attempted');
for (const invalid of ['https://evil.example/vault/set', 'file:///vault/set', 'http://127.0.0.1:12345/api/export', 'http://user:password@localhost/vault/set', 'http://localhost/vault/set?secrets=A%26calc', 'http://localhost/vault/set#credential', 'http://localhost/vault/set?url=https://evil.example', 'http://localhost/vault/new', 'http://localhost/vault/update', 'http://localhost/vault/set?request=e4b2&request=abcd', 'http://127.0.0.1:12345/?token=bad', 'http://127.0.0.1:12345/?token=' + 'a'.repeat(64) + '&extra=1']) assert.equal(await launcher.open(new URL(invalid)), 'unavailable');
assert.equal(commands.length, 5);
assert.equal(await new SecretInputBrowser('win32', async () => { throw new Error('private process detail'); }).open(address), 'unavailable');
assert.equal(await new SecretInputBrowser('darwin', async command => command.file === '/usr/bin/open' && command.args[0] === address.href).open(address), 'attempted');
const savedDisplay = process.env.DISPLAY;
const savedWayland = process.env.WAYLAND_DISPLAY;
try {
  delete process.env.DISPLAY;
  delete process.env.WAYLAND_DISPLAY;
  assert.equal(await new SecretInputBrowser('linux', async () => true).open(address), 'unavailable');
  process.env.DISPLAY = ':1';
  assert.equal(await new SecretInputBrowser('linux', async command => command.file === '/usr/bin/xdg-open').open(address), 'attempted');
} finally {
  if (savedDisplay === undefined) delete process.env.DISPLAY; else process.env.DISPLAY = savedDisplay;
  if (savedWayland === undefined) delete process.env.WAYLAND_DISPLAY; else process.env.WAYLAND_DISPLAY = savedWayland;
}
console.log('PASS controlled browser launch: set-only URLs, no PowerShell, encoded URL data, per-platform commands and unavailable desktop');
