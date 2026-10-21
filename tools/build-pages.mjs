import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DeyeClient } from '../lib/deye.mjs';
import { SettingsStore } from '../lib/settings.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function publicStatus(data) {
  // Explicit allowlist: never publish full API responses, credentials or error text.
  const event = value => value && [value.from, value.to, value.at].every(Number.isFinite)
    ? { from: value.from, to: value.to, at: value.at } : null;
  const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    station: { name: String(data.station?.name || 'Чавдар 13') },
    collectedAt: numeric(data.collectedAt), fetchedAt: numeric(data.fetchedAt),
    stale: data.stale !== false,
    grid: ['on', 'off', 'unstable'].includes(data.grid) ? data.grid : 'unknown',
    output: ['on', 'off', 'unstable'].includes(data.output) ? data.output : 'unknown',
    allPhasesZero: data.allPhasesZero === true,
    soc: numeric(data.soc), loadWatts: numeric(data.loadWatts),
    batteryMode: ['charging', 'discharging', 'idle'].includes(data.batteryMode) ? data.batteryMode : 'unknown',
    events: { appeared: event(data.events?.appeared), disappeared: event(data.events?.disappeared) },
    historyAvailable: data.historyAvailable === true,
    historyError: data.historyError ? 'Історія тимчасово недоступна.' : undefined
  };
}
export async function buildPages(data, directory = path.join(root, 'dist')) {
  await mkdir(path.join(directory, 'data'), { recursive: true });
  let html = await readFile(path.join(root, 'public/index.html'), 'utf8');
  html = html.replace('name="dashboard-mode" content="local"', 'name="dashboard-mode" content="static"');
  await writeFile(path.join(directory, 'index.html'), html);
  for (const name of ['app.js', 'styles.css', 'favicon.svg'])
    await copyFile(path.join(root, 'public', name), path.join(directory, name));
  await writeFile(path.join(directory, '.nojekyll'), '');
  await writeFile(path.join(directory, 'data/status.json'), JSON.stringify(publicStatus(data)));
}
export function environmentSettings(env) {
  const fields = { appId: 'DEYE_APP_ID', appSecret: 'DEYE_APP_SECRET', login: 'DEYE_LOGIN',
    password: 'DEYE_PASSWORD', stationId: 'DEYE_STATION_ID' };
  const result = {};
  for (const [key, name] of Object.entries(fields)) {
    if (!env[name]?.trim()) throw new Error('Missing configuration: ' + name);
    result[key] = env[name];
  }
  result.stationName = env.DEYE_STATION_NAME || 'Чавдар 13';
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const settings = process.argv.includes('--local')
      ? await new SettingsStore(path.join(root, '.local')).load()
      : environmentSettings(process.env);
    if (!settings?.stationId) throw new Error('No saved station. Configure the local dashboard first.');
    const data = await new DeyeClient(settings).dashboard();
    await buildPages(data);
    console.log('Pages build ready in dist. Only public measurements were exported.');
  } catch {
    // API errors may contain account details. Do not put upstream text in Actions logs.
    console.error('Pages build failed. Check Deye connectivity, the four DEYE secrets and DEYE_STATION_ID. Previous deployment is unchanged.');
    process.exitCode = 1;
  }
}
