import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { publicStatus } from '../tools/build-pages.mjs';
import { DeyeClient } from '../lib/deye.mjs';

test('diagnostic journal detects regression across reload, survives errors and remains bounded', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  let stored = null;
  const storage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  function browser() {
    const nodes = new Map();
    const element = id => {
      if (!nodes.has(id)) nodes.set(id, { textContent: '', value: 'live' });
      return nodes.get(id);
    };
    const context = vm.createContext({ Date, Intl, sessionStorage: storage,
      document: { querySelector: () => ({content:'static'}), getElementById: element } });
    vm.runInContext(source.slice(0, source.indexOf('async function api(')), context);
    return { context, element };
  }
  const first = browser();
  vm.runInContext('recordDiagnostic({collectedAt: 200000, diagnostics:{fileCreatedAt: 300000}})', first.context);
  const second = browser();
  vm.runInContext('recordDiagnostic({collectedAt: 100000, diagnostics:{fileCreatedAt: 400000}})', second.context);
  assert.match(second.element('diagnostics-report').textContent, /Час пішов назад/);
  assert.match(second.element('diagnostics-report').textContent, /це не чиста тривалість публікації/);
  vm.runInContext('recordDiagnostic(null, "Timeout")', second.context);
  assert.match(second.element('diagnostics-report').textContent, /Timeout/);
  vm.runInContext('for(let i=0;i<20;i++) recordDiagnostic({collectedAt: 500000})', second.context);
  assert.equal(JSON.parse(stored).length, 12);
  assert.ok(!stored.includes('Timeout'));
});

test('diagnostics export permits only numeric timings and public run identifiers', () => {
  const result = publicStatus({diagnostics:{requestStartedAt:100, latestReceivedAt:200,
    completedAt:300, stationUpdatedAt:50, fileCreatedAt:400, runId:123, runAttempt:2,
    password:'private', response:'private', token:'private'}});
  assert.equal(result.diagnostics.completedAt, 300);
  assert.equal(result.diagnostics.runId, 123);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(publicStatus({diagnostics:{runId:'secret'}}).diagnostics.runId, null);
});

test('Deye diagnostics surround latest and history requests without exposing readings', async () => {
  const client = new DeyeClient({stationId:'1'});
  const time = Date.now();
  client.list = async () => [{deviceType:'INVERTER',deviceSn:'private-sn'}];
  client.request = async endpoint => endpoint === 'station/latest'
    ? {lastUpdateTime:time}
    : {deviceDataList:[{deviceSn:'private-sn',collectionTime:time,dataList:[]}]};
  client.history = async () => ({appeared:null,disappeared:null});
  const data = await client.dashboard();
  assert.ok(data.diagnostics.requestStartedAt <= data.diagnostics.latestReceivedAt);
  assert.ok(data.diagnostics.latestReceivedAt <= data.diagnostics.completedAt);
  assert.equal(data.diagnostics.stationUpdatedAt, time);
  assert.ok(!JSON.stringify(publicStatus(data)).includes('private-sn'));
});