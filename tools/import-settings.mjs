import { SettingsStore } from '../lib/settings.mjs';
import { DeyeClient } from '../lib/deye.mjs';
import { fileURLToPath } from 'node:url';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
try {
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''));
  const settings = { appId: String(input.AppId), login: input.Login, appSecret: input.Secret, password: input.Password };
  const rows = await new DeyeClient(settings).stations();
  const selected = rows.find(s => s.id === String(input.StationId));
  if (!selected) throw new Error('Збережена станція недоступна.');
  settings.stationId = selected.id; settings.stationName = selected.name;
  await new SettingsStore(fileURLToPath(new URL('../.local/', import.meta.url))).save(settings);
  console.log('Підключення перенесено. Станція: ' + selected.name);
} catch (error) { console.error('Не вдалося перенести підключення: ' + error.message); process.exitCode = 1; }
