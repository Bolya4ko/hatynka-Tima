import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { SettingsStore } from './lib/settings.mjs';
import { DeyeClient } from './lib/deye.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
function localAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
function equal(a, b) {
  const x = Buffer.from(a || ''), y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
}
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/iphone-step-1.png', ['iphone-step-1.png', 'image/png']],
  ['/iphone-step-2.png', ['iphone-step-2.png', 'image/png']],
  ['/iphone-step-3.png', ['iphone-step-3.png', 'image/png']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);
async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Очікується JSON.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new Error('Запит завеликий.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function createApplication({ store = new SettingsStore(path.join(ROOT, '.local')), clientFactory = s => new DeyeClient(s), allowLan = false } = {}) {
  let settings = await store.load();
  let client = settings ? clientFactory(settings) : null;
  let cache = null, pending = null, busy = false, failure = null;
  const csrf = randomBytes(32).toString('hex');
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (allowLan) {
    for (const network of Object.values(os.networkInterfaces())) {
      for (const entry of network ?? []) if (entry.family === 'IPv4') allowedHosts.add(entry.address);
    }
  }
  function send(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    let url;
    try { url = new URL(req.url, 'http://' + req.headers.host); }
    catch { return send(res, 400, { error: 'Некоректний запит.' }); }
    if (!allowedHosts.has(url.hostname)) return send(res, 403, { error: 'Недозволений Host.' });
    if (req.headers.origin && req.headers.origin !== url.origin)
      return send(res, 403, { error: 'Запит з іншого сайту заборонено.' });
    const local = localAddress(req.socket.remoteAddress);
    try {
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        const content = await readFile(path.join(ROOT, 'public', file)); res.writeHead(200, { 'Content-Type': type }); return res.end(content);
      }
      if (req.method === 'GET' && url.pathname === '/api/config') {
        return send(res, 200, {
          configured: Boolean(settings?.stationId), connected: Boolean(settings),
          canConfigure: local, csrf: local ? csrf : undefined,
          appId: local ? settings?.appId || '' : undefined,
          login: local ? settings?.login || '' : undefined,
          station: settings?.stationId ? { id: settings.stationId, name: settings.stationName } : null
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/stations') {
        if (!local) return send(res, 403, { error: 'Вибір станції доступний на комп’ютері-сервері.' });
        if (!client) return send(res, 409, { error: 'Спочатку підключіть Deye.' });
        return send(res, 200, { stations: await client.stations() });
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        if (!settings?.stationId) return send(res, 409, { error: 'Спочатку підключіть Deye та виберіть станцію.' });
        if (failure && Date.now() - failure.at < 30000) return send(res, 502, { error: failure.message });
        if (cache && Date.now() - cache.at < 60000) return send(res, 200, cache.data);
        if (!pending) {
          const currentClient = client;
          pending = currentClient.dashboard().then(data => {
            if (client === currentClient) { cache = { at: Date.now(), data }; failure = null; }
            return data;
          }).catch(error => {
            if (client === currentClient) failure = { at: Date.now(), message: error.message };
            throw error;
          }).finally(() => { if (client === currentClient) pending = null; });
        }
        return send(res, 200, await pending);
      }
      if (req.method === 'POST' && ['/api/connect', '/api/station'].includes(url.pathname)) {
        if (!local) return send(res, 403, { error: 'Налаштування доступні лише на комп’ютері-сервері.' });
        if (!equal(req.headers['x-csrf-token'], csrf)) return send(res, 403, { error: 'Оновіть сторінку перед збереженням.' });
        if (busy) return send(res, 409, { error: 'Попередні налаштування ще зберігаються.' });
        busy = true;
        try {
          const body = await jsonBody(req);
          if (url.pathname === '/api/connect') {
            const candidate = {};
            for (const key of ['appId', 'login', 'appSecret', 'password']) {
              if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > 2048)
                return send(res, 400, { error: 'Заповніть усі поля підключення.' });
              candidate[key] = ['appId', 'login'].includes(key) ? body[key].trim() : body[key];
            }
            const proposedClient = clientFactory(candidate);
            const stations = await proposedClient.stations();
            if (!stations.length) return send(res, 400, { error: 'Акаунт не має доступних станцій.' });
            const selected = stations.find(s => s.id === settings?.stationId) || (stations.length === 1 ? stations[0] : null);
            if (selected) { candidate.stationId = selected.id; candidate.stationName = selected.name; }
            await store.save(candidate);
            settings = candidate; client = proposedClient; cache = null; pending = null; failure = null;
            return send(res, 200, { stations, selected: candidate.stationId || null });
          }
          if (!client) return send(res, 409, { error: 'Спочатку підключіть Deye.' });
          const stations = await client.stations();
          const selected = stations.find(s => s.id === String(body.stationId));
          if (!selected) return send(res, 400, { error: 'Станція недоступна цьому акаунту.' });
          const candidate = { ...settings, stationId: selected.id, stationName: selected.name };
          await store.save(candidate);
          settings = candidate; client = clientFactory(candidate); cache = null; pending = null; failure = null;
          return send(res, 200, { station: selected });
        } finally { busy = false; }
      }
      send(res, 404, { error: 'Сторінку не знайдено.' });
    } catch (error) {
      send(res, 502, { error: error instanceof SyntaxError ? 'Некоректний JSON.' : error.message || 'Помилка сервера.' });
    }
  });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const allowLan = process.argv.includes('--lan');
  const port = Number(process.env.PORT || 3131);
  const server = await createApplication({ allowLan });
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? 'Порт ' + port + ' уже зайнятий. Перевірте відкритий сервер.' : error.message);
    process.exitCode = 1;
  });
  server.listen(port, allowLan ? '0.0.0.0' : '127.0.0.1', () => {
    console.log('C13PowerDashboard: http://localhost:' + port);
    if (allowLan) for (const network of Object.values(os.networkInterfaces()))
      for (const entry of network ?? []) if (entry.family === 'IPv4' && !entry.internal)
        console.log('Телефон у вашій Wi-Fi мережі: http://' + entry.address + ':' + port);
    console.log('Зупинка: Ctrl+C. Дані Deye не записуються в журнал.');
  });
}


