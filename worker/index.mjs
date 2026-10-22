import { DeyeClient } from '../lib/deye.mjs';
import { publicStatus } from '../lib/public-status.mjs';

const DEFAULT_CACHE_SECONDS = 30;

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
  settings.stationName = env.DEYE_STATION_NAME || 'Чавдар 13';
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
export function createHandler({ clientFactory = (settings, options) => new DeyeClient(settings, undefined, options), now = Date.now } = {}) {
  const entries = new Map();

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
    } catch {
      // Keep serving the last good answer: the page itself marks old measurements as stale.
      if (entry.cache) return send(env, 200, entry.cache.data, { 'X-Cache': 'STALE', 'X-Cache-Age': String(Math.round((now() - entry.cache.at) / 1000)) });
      return send(env, 502, { error: 'Не вдалося отримати дані Deye.' });
    }
  };
}

const handle = createHandler();
export default { fetch: (request, env) => handle(request, env) };
