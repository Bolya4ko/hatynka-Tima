import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from '../lib/settings.mjs';
import { createApplication } from '../server.mjs';
test('encrypted settings and localhost API boundaries', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'c13-test-'));
  const store = new SettingsStore(dir);
  const settings = { appId: 'id', login: 'test', appSecret: 'secret-value', password: 'password-value', stationId: '1', stationName: 'Test' };
  let server;
  try {
    assert.equal(await store.load(), null);
    await store.save(settings);
    assert.deepEqual(await store.load(), settings);
    assert.ok(!(await readFile(path.join(dir, 'settings.json'), 'utf8')).includes('secret-value'));
    let calls = 0;
    server = await createApplication({ store, clientFactory: () => ({
      stations: async () => [{ id: '1', name: 'Test' }],
      dashboard: async () => { calls++; return { grid: 'off' }; }
    }) });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const config = await (await fetch(base + '/api/config')).json();
    assert.equal(config.configured, true);
    assert.equal(config.password, undefined); assert.equal(config.appSecret, undefined);
    assert.equal((await fetch(base + '/.local/settings.json')).status, 404);
    assert.equal((await fetch(base + '/api/status', { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(base + '/api/station', { method: 'POST' })).status, 403);
    await Promise.all([fetch(base + '/api/status'), fetch(base + '/api/status')]);
    assert.equal(calls, 1);
    const response = await fetch(base + '/api/station', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': config.csrf }, body: JSON.stringify({ stationId: '2' }) });
    assert.equal(response.status, 400);
    assert.equal((await fetch(base)).status, 200);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(dir);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('c13-test-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
