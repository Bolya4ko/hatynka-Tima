import { DeyeClient } from '../lib/deye.mjs';
import { publicStatus } from '../lib/public-status.mjs';

const DEFAULT_CACHE_SECONDS = 30;

function safeDiagnostic(error, env) {
  let message = String(error?.message || 'unknown error');
  for (const key of ['DEYE_APP_SECRET', 'DEYE_LOGIN', 'DEYE_PASSWORD']) {
    const secret = String(env[key] || '');
    if (secret) message = message.split(secret).join('[приховано]');
  }
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [приховано]').slice(0, 500);
}

function seconds(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
export function settingsFromEnv(env) {
  const fields = { appId: 'DEYE_APP_ID', appSecret: 'DEYE_APP_SECRET', login: 'DEYE_LOGIN',
    password: 'DEYE_PASSWORD', stationId: 'DEYE_STATION_ID' };
  const settings = {};
  for (const [key, name] of Object.entries(fields)) {
    if (!String(env[name] ?? '').trim()) throw new Error('Missing configuration: ' + name);
    settings[key] = String(env[name]);
  }
  settings.stationName = env.DEYE_STATION_NAME || 'Мій дім';
  return settings;
}
// ALLOWED_STATION_IDS: "61167187:Моя станція,12345" — станції, які можна відкрити через ?station=ID.
export function allowedStations(env) {
  const result = new Map();
  for (const entry of String(env.ALLOWED_STATION_IDS ?? '').split(',')) {
    const [id, ...name] = entry.split(':');
    if (/^\d{1,20}$/.test(id.trim())) result.set(id.trim(), name.join(':').trim() || 'Станція ' + id.trim());
  }
  return result;
}

// State lives while the Worker isolate is warm: token, history and the last answer are reused per station.
export function createHandler({ clientFactory = (settings, options) => new DeyeClient(settings, undefined, options), now = Date.now, fetcher = fetch } = {}) {
  const entries = new Map();
  let outageCache = null;

  function headers(env, extra = {}) {
    return {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin',
      'X-Content-Type-Options': 'nosniff',
      ...extra
    };
  }
  function send(env, status, data, extra) {
    return new Response(JSON.stringify(data), { status, headers: headers(env, extra) });
  }
  function entryFor(env, requestedStation) {
    const base = settingsFromEnv(env);
    let settings = base;
    if (requestedStation && requestedStation !== base.stationId) {
      const name = allowedStations(env).get(requestedStation);
      if (!name) return null;
      settings = { ...base, stationId: requestedStation, stationName: name };
    }
    const key = JSON.stringify(settings);
    let entry = entries.get(settings.stationId);
    if (!entry || entry.key !== key) {
      // Only plain data is kept between requests (answer, token, history). Never a promise: see lib/deye.mjs.
      entry = { key, settings, cache: null, shared: { token: null, expiresAt: 0, historyCache: new Map() } };
      entries.set(settings.stationId, entry);
      if (entries.size > 10) entries.delete(entries.keys().next().value);
    }
    return entry;
  }

  return async function handle(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(env) });
    if (request.method !== 'GET') return send(env, 405, { error: 'Дозволено лише GET.' });
    if (url.pathname === '/' || url.pathname === '/health') return send(env, 200, { ok: true });
    if (url.pathname === '/api/outage-schedule') {
      const ttl = 3 * 60 * 60 * 1000;
      if (outageCache && now() - outageCache.at < ttl) return send(env, 200, outageCache.data, { 'X-Cache': 'HIT' });
      try {
        const response = await fetcher('https://mapasvitla.com.ua/kyivska-oblast');
        if (!response.ok) throw new Error('Schedule page unavailable');
        const page = await response.text();
        const section = page.match(/aria-label=\"Черга 5\.2: без світла ([^\"]*)\"/);
        const intervals = section && [...section[1].matchAll(/(\d{2}):(\d{2})[–-](\d{2}):(\d{2})/g)].map(match => match.slice(1).map(Number));
        if (!intervals?.length) throw new Error('Schedule unavailable');
        const today = Array(24).fill(0);
        for (const [fromHour, fromMinute, toHour, toMinute] of intervals) {
          const from = fromHour * 60 + fromMinute, to = toHour * 60 + toMinute || 1440;
          for (let hour = 0; hour < 24; hour++) {
            const start = hour * 60, end = start + 60, overlap = Math.max(0, Math.min(end, to) - Math.max(start, from));
            if (overlap === 60) today[hour] = 1;
            else if (overlap > 0 && today[hour] !== 1) today[hour] = 2;
          }
        }
        const data = { queue: '5.2', updated: new Date().toISOString(), today, todayStatus: 'ScheduleApplies' };
        outageCache = { at: now(), data };
        return send(env, 200, data, { 'X-Cache': 'MISS' });
      } catch {
        if (outageCache) return send(env, 200, outageCache.data, { 'X-Cache': 'STALE' });
        return send(env, 502, { error: 'Графік тимчасово недоступний.' });
      }
    }
    if (url.pathname !== '/api/status') return send(env, 404, { error: 'Не знайдено.' });

    let entry;
    try { entry = entryFor(env, (url.searchParams.get('station') || '').trim()); }
    catch { return send(env, 500, { error: 'Worker не налаштований: перевірте змінні та секрети.' }); }
    if (!entry) return send(env, 403, { error: 'Ця станція недоступна.' });

    const ttl = seconds(env.CACHE_SECONDS, DEFAULT_CACHE_SECONDS) * 1000;
    if (entry.cache && now() - entry.cache.at < ttl)
      return send(env, 200, entry.cache.data, { 'X-Cache': 'HIT', 'X-Cache-Age': String(Math.round((now() - entry.cache.at) / 1000)) });

    try {
      // Every request makes its own call. Parallel misses are rare and the cache above limits the rate.
      const client = clientFactory(entry.settings, { shared: entry.shared });
      const data = await client.dashboard();
      entry.cache = { at: now(), data: publicStatus({ ...data, diagnostics: { ...data.diagnostics, fileCreatedAt: now() } }) };
      return send(env, 200, entry.cache.data, { 'X-Cache': 'MISS', 'X-Cache-Age': '0' });
    } catch (error) {
      // The browser receives no upstream details. The local Worker log has a redacted reason for setup diagnostics.
      console.error('Deye dashboard fetch failed:', safeDiagnostic(error, env));
      // Keep serving the last good answer: the page itself marks old measurements as stale.
      if (entry.cache) return send(env, 200, entry.cache.data, { 'X-Cache': 'STALE', 'X-Cache-Age': String(Math.round((now() - entry.cache.at) / 1000)) });
      return send(env, 502, { error: 'Не вдалося отримати дані Deye.' });
    }
  };
}

const handle = createHandler();
export default { fetch: (request, env) => handle(request, env) };
