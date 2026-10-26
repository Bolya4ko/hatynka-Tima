// Explicit allowlist: never publish full API responses, credentials or error text.
export function publicStatus(data) {
  const event = value => value && [value.from, value.to, value.at].every(Number.isFinite)
    ? { from: value.from, to: value.to, at: value.at } : null;
  const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    station: { name: String(data.station?.name || 'Хатинка Тіма') },
    collectedAt: numeric(data.collectedAt), fetchedAt: numeric(data.fetchedAt),
    diagnostics: Object.fromEntries(['requestStartedAt', 'latestReceivedAt', 'completedAt', 'stationUpdatedAt', 'fileCreatedAt', 'runId', 'runAttempt'].map(key => [key, numeric(data.diagnostics?.[key])])),
    stale: data.stale !== false,
    grid: ['on', 'off', 'unstable'].includes(data.grid) ? data.grid : 'unknown',
    output: ['on', 'off', 'unstable'].includes(data.output) ? data.output : 'unknown',
    allPhasesZero: data.allPhasesZero === true,
    soc: numeric(data.soc), loadWatts: numeric(data.loadWatts),
    solarWatts: numeric(data.solarWatts), solarTodayKwh: numeric(data.solarTodayKwh), batteryWatts: numeric(data.batteryWatts), batteryVoltage: numeric(data.batteryVoltage), batteryCurrent: numeric(data.batteryCurrent), gridWatts: numeric(data.gridWatts), solarTotalKwh: numeric(data.solarTotalKwh), dailyChargingKwh: numeric(data.dailyChargingKwh), dailyDischargingKwh: numeric(data.dailyDischargingKwh), dailyGridImportKwh: numeric(data.dailyGridImportKwh), dailyGridExportKwh: numeric(data.dailyGridExportKwh), pvInputs: Array.isArray(data.pvInputs) ? data.pvInputs.map(numeric) : [],
    batteryMode: ['charging', 'discharging', 'idle'].includes(data.batteryMode) ? data.batteryMode : 'unknown',
    events: { appeared: event(data.events?.appeared), disappeared: event(data.events?.disappeared) },
    historyAvailable: data.historyAvailable === true,
    historyError: data.historyError ? 'Історія тимчасово недоступна.' : undefined
  };
}
