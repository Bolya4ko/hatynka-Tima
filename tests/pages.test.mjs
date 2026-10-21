import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { buildPages, publicStatus, environmentSettings } from '../tools/build-pages.mjs';

test('public export excludes credentials, identifiers and upstream errors', () => {
  const data = publicStatus({ station: { id: 'private-id', name: 'Чавдар 13' },
    password: 'secret', accessToken: 'token', historyError: 'private response',
    collectedAt: Date.now(), stale: false, output: 'on', grid: 'off',
    events: { appeared: { from: 100, to: 200, at: 150, secret: 'hidden' } } });
  const json = JSON.stringify(data);
  for (const value of ['private-id', 'secret', 'token', 'private response', 'hidden']) assert.ok(!json.includes(value));
  assert.equal(data.output, 'on');
  assert.equal(data.events.appeared.at, 150);
  assert.throws(() => environmentSettings({}), /DEYE_APP_ID/);
});

test('Pages artifact has relative assets, static mode and no server or secrets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'c13-pages-'));
  try {
    await buildPages({ collectedAt: Date.now(), station: { name: 'Test' } }, directory);
    const html = await readFile(path.join(directory, 'index.html'), 'utf8');
    assert.match(html, /name="dashboard-mode" content="static"/);
    assert.match(html, /src="\.\/app.js"/);
    assert.match(html, /href="\.\/styles.css"/);
    assert.deepEqual((await readdir(directory)).sort(), ['.nojekyll', 'app.js', 'data', 'favicon.svg', 'index.html', 'styles.css', 'iphone-step-1.png', 'iphone-step-2.png', 'iphone-step-3.png'].sort());
    assert.deepEqual(await readdir(path.join(directory, 'data')), ['status.json']);
    const original = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
    assert.match(original, /name="dashboard-mode" content="local"/);
  } finally {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('c13-pages-'));
    await rm(resolved, { recursive: true, force: true });
  }
});

test('static browser requests nested repository JSON, never local config or secrets', async () => {
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const code = script.slice(script.indexOf('async function api('), script.indexOf('async function refresh('));
  const calls = [];
  const api = vm.runInNewContext(code + '; api;', {
    staticMode: true, URL, Date, AbortSignal,
    document: { baseURI: 'https://example.github.io/C13PowerDashboard/' },
    fetch: async url => { calls.push(String(url)); return Response.json({ collectedAt: Date.now() }); }
  });
  const config = await api('/api/config');
  assert.equal(config.canConfigure, false);
  assert.equal(calls.length, 0);
  await api('/api/status');
  assert.match(calls[0], /^https:\/\/example.github.io\/C13PowerDashboard\/data\/status.json\?t=/);
  await assert.rejects(api('/api/connect', {}), /GitHub Secrets/);
});

