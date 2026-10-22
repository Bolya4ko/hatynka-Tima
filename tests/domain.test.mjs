import test from 'node:test';
import assert from 'node:assert/strict';
import { gridState, transitions, parseTime, summarize, previousDay } from '../lib/domain.mjs';
const off = { GridVoltageL1: 0, GridVoltageL2: 0, GridVoltageL3: 0, GridFrequency: 0 };
test('three phases, missing values, power alone and single phase', () => {
  assert.equal(gridState(off), 'off');
  assert.equal(gridState({ ...off, GridVoltageL1: 230 }), 'unstable');
  assert.equal(gridState({ ...off, GridVoltageL1: 230, GridVoltageL2: 231, GridVoltageL3: 232, GridFrequency: 50 }), 'on');
  assert.equal(gridState({ TotalGridPower: 0 }), 'unknown');
  assert.equal(gridState({ ...off, GridVoltageL3: null }), 'unknown');
  assert.equal(gridState({ GridVoltageL1L2: 27.8, GridFrequency: 0 }), 'off');
  assert.equal(gridState({ GridVoltageL1L2: 230, GridFrequency: 50 }), 'on');
});
test('Kyiv local dates, fractional epoch, midnight, ambiguous DST', () => {
  assert.equal(parseTime('1792581385.000000000'), 1792581385000);
  assert.equal(parseTime('12:14:02', '2026-10-21'), Date.parse('2026-10-21T12:14:02+03:00'));
  assert.equal(parseTime('2026-10-21 12:14:02'), Date.parse('2026-10-21T12:14:02+03:00'));
  assert.equal(parseTime('2026-10-25 03:30:00'), null);
  assert.equal(parseTime('bad'), null);
  assert.equal(previousDay('2026-01-01'), '2025-12-31');
});
test('both transitions, unordered input, no fabricated start, unknown gaps', () => {
  assert.deepEqual(transitions([{ time: 100, state: 'off' }]), { appeared: null, disappeared: null });
  const result = transitions([{ time: 400, state: 'on' }, { time: 100, state: 'on' },
    { time: 200, state: 'off' }, { time: 300, state: 'unknown' }]);
  assert.deepEqual(result.disappeared, { from: 100, to: 200, at: 150 });
  assert.deepEqual(result.appeared, { from: 200, to: 400, at: 300 });
});
test('fresh inverter overrides older station battery, stale hides all live states', () => {
  const now = Date.parse('2026-10-21T15:34:30+03:00');
  const device = { collectionTime: now / 1000, dataList: Object.entries({
    ...off, LoadVoltageL1: 231, LoadVoltageL2: 233, LoadVoltageL3: 232,
    SOC: 60, BatteryPower: 15000, UPSLoadPower: 16833, DCPowerPV1: 2100, DCPowerPV2: 1850, PVDailyPowerGenerationActive: 14.6
  }).map(([key, value]) => ({ key, value })) };
  const data = summarize({ id: '1', name: 'Test' }, { batterySOC: 61 }, [device], now);
  assert.equal(data.grid, 'off'); assert.equal(data.output, 'on');
  assert.equal(data.soc, 60); assert.equal(data.loadWatts, 16833);
  assert.equal(data.solarWatts, 3950); assert.equal(data.solarTodayKwh, 14.6);
  assert.equal(data.batteryMode, 'discharging');
  assert.equal(summarize({}, {}, [device], now + 59 * 60000).stale, false);
  assert.equal(summarize({}, {}, [device], now + 60 * 60000).stale, false);
  const stale = summarize({}, {}, [device], now + 61 * 60000);
  assert.equal(stale.grid, 'unknown'); assert.equal(stale.soc, null); assert.equal(stale.loadWatts, null);
  assert.equal(summarize({}, {}, [device, { dataList: [] }], now).grid, 'unknown');
});
