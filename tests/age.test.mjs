import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
test('render passes measurement time to visible counter and timer advances without a fetch', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false, dataset: {} });
    return elements.get(id);
  };
  let now = 1792600000000;
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ Date: Clock, Intl, URL, document: {
    getElementById: element, querySelector: () => ({ content: 'local' })
  } });
  vm.runInContext(source.slice(0, source.indexOf('async function api(')), context);
  context.data = { collectedAt: now - 130000, output: 'on', grid: 'on', soc: 100,
    batteryMode: 'idle', loadWatts: 0, station: { name: 'Test' } };
  vm.runInContext('render(data)', context);
  assert.equal(element('data-elapsed').hidden, false);
  assert.equal(element('data-elapsed').textContent, 'Пройшло 2 хв. 10 с.');
  now += 1000;
  vm.runInContext('updateMeasurementAge()', context);
  assert.equal(element('data-elapsed').textContent, 'Пройшло 2 хв. 11 с.');
  vm.runInContext('render(data)', context);
  assert.equal(element('data-elapsed').textContent, 'Пройшло 2 хв. 11 с.');
  vm.runInContext('render({stale: true})', context);
  assert.equal(element('data-elapsed').hidden, true);
});

test('measurement label uses Kyiv today, yesterday and older dates', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const label = vm.runInNewContext(source.slice(source.indexOf('function measurementDateLabel('), source.indexOf('function render(')) + '; measurementDateLabel;', {
    Intl, Date, clock: new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' })
  });
  const now = Date.parse('2026-10-22T00:05:00+03:00');
  assert.equal(label(Date.parse('2026-10-22T00:01:00+03:00'), now), 'Дані станом на сьогодні 00:01');
  assert.equal(label(Date.parse('2026-10-21T22:51:00+03:00'), now), 'Дані станом на вчора 22:51');
  assert.match(label(Date.parse('2026-10-19T22:51:00+03:00'), now), /19 жовтня 22:51/);
});

test('grid duration follows the matching event and hides when missing, stale or unavailable', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false, dataset: {} });
    return elements.get(id);
  };
  let now = 1792600000000;
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ Date: Clock, Intl, URL, document: {
    getElementById: element, querySelector: () => ({ content: 'local' })
  } });
  vm.runInContext(source.slice(0, source.indexOf('async function api(')), context);
  context.data = { collectedAt: now - 60000, output: 'on', grid: 'on', soc: 100,
    batteryMode: 'idle', loadWatts: 0, events: { appeared: { at: now - 140000 } } };
  vm.runInContext('render(data)', context);
  assert.equal(element('grid-duration').textContent, 'Є вже ≈ 2 хв. 20 с.');
  assert.equal(element('grid-duration').hidden, false);
  now += 1000;
  vm.runInContext('updateGridDuration()', context);
  assert.equal(element('grid-duration').textContent, 'Є вже ≈ 2 хв. 21 с.');
  vm.runInContext('render(data)', context);
  assert.equal(element('grid-duration').textContent, 'Є вже ≈ 2 хв. 21 с.');
  context.data.grid = 'off';
  context.data.events.disappeared = { at: now - 90000 };
  vm.runInContext('render(data)', context);
  assert.equal(element('grid-duration').textContent, 'Немає вже ≈ 1 хв. 30 с.');
  now += 900000;
  vm.runInContext('updateGridDuration()', context);
  assert.equal(element('grid-duration').hidden, true);
  assert.equal(element('grid-event').hidden, true);
  context.data.collectedAt = now;
  context.data.events = {};
  vm.runInContext('render(data)', context);
  assert.equal(element('grid-duration').hidden, true);
  vm.runInContext('render({stale: true})', context);
  assert.equal(element('grid-duration').hidden, true);
});
