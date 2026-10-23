import { writeFile } from 'node:fs/promises';
const response = await fetch('https://mapasvitla.com.ua/kyivska-oblast', { headers: { 'User-Agent': 'Mozilla/5.0' } });
if (!response.ok) throw new Error('Schedule source unavailable: ' + response.status);
const page = await response.text();
const section = page.match(/aria-label="Черга 5\.2: без світла ([^"]*)"/);
const intervals = section && [...section[1].matchAll(/(\d{2}):(\d{2})[–-](\d{2}):(\d{2})/g)].map(match => match.slice(1).map(Number));
if (!intervals?.length) throw new Error('Schedule for queue 5.2 is unavailable');
const today = Array(24).fill(0);
for (const [fromHour, fromMinute, toHour, toMinute] of intervals) {
  const from = fromHour * 60 + fromMinute, to = toHour * 60 + toMinute || 1440;
  for (let hour = 0; hour < 24; hour++) {
    const overlap = Math.max(0, Math.min((hour + 1) * 60, to) - Math.max(hour * 60, from));
    if (overlap === 60) today[hour] = 1;
    else if (overlap > 0 && today[hour] !== 1) today[hour] = 2;
  }
}
await writeFile(new URL('../public/outage-schedule.json', import.meta.url), JSON.stringify({ queue: '5.2', updated: new Date().toISOString(), today, todayStatus: 'ScheduleApplies' }) + '\n');