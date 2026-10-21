'use strict';
const staticMode = document.querySelector('meta[name="dashboard-mode"]')?.content === 'static';
const $ = id => document.getElementById(id);
const clock = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' });
const date = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' });
const decimal = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
let config = null, snapshot = null, loading = false, requestVersion = 0;
const isExample = () => $('view-mode').value !== 'live';
function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
function unknown(message) {
  render({ station: config?.station, stale: true, collectedAt: snapshot?.collectedAt, grid: 'unknown', output: 'unknown', soc: null, events: {} });
  notice(message);
}
function inverterState(data, stale) {
  if (stale || !['on', 'off'].includes(data.output)) return 'unknown';
  const watts = data.loadWatts;
  const hasLoad = typeof watts === 'number' && Number.isFinite(watts) && watts > 0;
  const noLoad = watts === 0;
  if (data.output === 'on' && hasLoad) return 'supplying';
  if (data.output === 'off' && hasLoad) return 'unknown';
  if (noLoad && data.batteryMode === 'charging') return 'charging';
  if (data.output === 'off') return 'off';
  if (noLoad && ['idle', 'discharging'].includes(data.batteryMode)) return 'standby';
  return 'unknown';
}
function render(data, example = false) {
  const stale = data.stale || !data.collectedAt || Date.now() - data.collectedAt > 900000;
  const grid = stale ? 'unknown' : data.grid;
  const output = stale ? 'unknown' : data.output;
  const soc = stale ? null : data.soc;
  $('station-name').textContent = data.station?.name || 'Чавдар 13';
  $('source-text').textContent = example ? 'Демонстрація' : stale ? 'Немає свіжих даних' : 'Deye Cloud';
  $('source-pill').dataset.state = example ? 'demo' : stale ? 'unknown' : 'on';
  $('data-time').textContent = data.collectedAt ? 'Дані станом на ' + clock.format(data.collectedAt) : 'Очікуємо дані';
  $('data-age').textContent = data.collectedAt ? date.format(data.collectedAt) : '';
  $('grid-card').dataset.state = grid;
  $('grid-value').textContent = ({ on: 'Є', off: 'Немає', unstable: 'Нестабільна', unknown: 'Невідомо' })[grid] || 'Невідомо';
  $('grid-detail').textContent = grid === 'on' ? 'Напруга на всіх фазах' :
    grid === 'off' ? (data.allPhasesZero ? 'Усі фази: 0 В' : 'Немає вхідної напруги') :
    grid === 'unstable' ? 'Перевірте стан фаз' : 'Немає актуальних показників';
  const event = grid === 'on' ? data.events?.appeared : grid === 'off' ? data.events?.disappeared : null;
  $('grid-event').hidden = !event;
  $('grid-event').textContent = event ? (grid === 'on' ? 'З’явилася ≈ ' : 'Зникла ≈ ') +
    (date.format(event.at) !== date.format(data.collectedAt) ? date.format(event.at) + ', ' : '') + clock.format(Math.round(event.at / 60000) * 60000) : '';
  const operation = inverterState(data, stale);
  $('output-card').dataset.state = ({ supplying: 'on', charging: 'on', standby: 'standby', off: 'off', unknown: 'unknown' })[operation];
  $('output-value').textContent = ({
    supplying: 'Будинок живиться від інвертора',
    charging: 'Інвертор заряджає акумулятор',
    standby: 'Інвертор у режимі очікування',
    off: 'Немає напруги на виході',
    unknown: 'Стан невідомий'
  })[operation];
  $('load').hidden = output !== 'on' || data.loadWatts == null;
  const watts = data.loadWatts;
  $('load-value').textContent = watts == null ? '—' :
    watts > 0 && watts < 1 ? '< 1' : decimal.format(watts < 1000 ? watts : watts / 1000);
  $('load-unit').textContent = watts != null && watts < 1000 ? 'Вт' : 'кВт';
  $('output-detail').hidden = output === 'on' && data.loadWatts != null;
  $('output-detail').textContent = output === 'on' ? 'Напруга на виході є' : output === 'off' ? 'Напруги на виході немає' :
    output === 'unstable' ? 'Показники напруги нестабільні' : 'Недостатньо актуальних показників';
  $('battery-card').dataset.state = soc == null ? 'unknown' : soc <= 20 ? 'off' : soc <= 40 ? 'unstable' : 'on';
  $('soc-value').textContent = soc == null ? '—' : decimal.format(soc);
  $('soc-percent').hidden = soc == null;
  $('battery-progress').hidden = soc == null;
  $('battery-progress').value = soc ?? 0;
  $('battery-mode').textContent = stale ? 'Немає актуальних показників' :
    ({ discharging: 'Розряджається', charging: 'Заряджається', idle: 'У режимі очікування', unknown: 'Стан заряду невідомий' })[data.batteryMode] || 'Стан заряду невідомий';
  $('update-note').textContent = example ? 'Демонстраційні значення для перегляду оформлення' : (staticMode ? 'Перевірка файлу щохвилини · оновлення через GitHub Actions' : 'Автоматичне оновлення щохвилини');
  notice(example ? 'Приклад відображення — це не поточні показники будинку.' :
    stale ? 'Дані застаріли або недоступні. Поточний стан живлення невідомий.' :
    data.historyError ? 'Поточні показники отримано. Час зміни мережі тимчасово недоступний.' : '');
}
function example(mode) {
  const now = Date.now();
  const mains = mode === 'on' || mode === 'standby';
  return { station: { name: 'Чавдар 13' }, collectedAt: now - (mode === 'stale' ? 1800000 : 300000),
    stale: mode === 'stale', grid: mains ? 'on' : 'off', output: mode === 'output-off' ? 'off' : 'on',
    allPhasesZero: !mains, soc: mode === 'on' ? 82 : mode === 'standby' ? 100 : mode === 'output-off' ? 10 : 61,
    batteryMode: mode === 'on' ? 'charging' : ['standby', 'output-off'].includes(mode) ? 'idle' : 'discharging',
    loadWatts: mains || mode === 'output-off' ? 0 : 16800,
    events: { appeared: { at: now - 3600000 }, disappeared: { at: now - 10800000 } } };
}
async function api(path, body) {
  if (staticMode) {
    if (body !== undefined) throw new Error('Налаштування змінюються через GitHub Secrets.');
    if (path === '/api/config') return { configured: true, connected: true, canConfigure: false };
    if (path !== '/api/status') throw new Error('Ця дія доступна лише локально.');
    const response = await fetch(new URL('./data/status.json?t=' + Date.now(), document.baseURI),
      { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Показники ще не опубліковано або файл недоступний.');
    const data = await response.json();
    if (!data || !Number.isFinite(data.collectedAt)) throw new Error('Немає коректного часу вимірювання.');
    return data;
  }
  const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(180000),
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': config.csrf }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не вдалося отримати дані.');
  return data;
}
async function refresh() {
  if (isExample() || loading || !config?.configured) return;
  const version = requestVersion;
  loading = true; $('refresh').disabled = true; $('refresh').classList.add('spinning');
  try {
    const data = await api('/api/status');
    if (version !== requestVersion || isExample()) return;
    snapshot = data; render(data);
  } catch (error) {
    if (version === requestVersion && !isExample()) unknown(error.message);
  } finally { loading = false; $('refresh').disabled = false; $('refresh').classList.remove('spinning'); }
}
function stations(rows, selected) {
  $('station-select').replaceChildren(...rows.map(row => {
    const option = document.createElement('option');
    option.value = row.id; option.textContent = row.name; option.selected = row.id === selected;
    return option;
  }));
  $('station-panel').hidden = false; $('connect-form').hidden = true;
}
async function openSettings() {
  if (!config?.canConfigure) return;
  $('settings-dialog').showModal(); $('form-message').textContent = '';
  $('app-id').value = config.appId || ''; $('login').value = config.login || '';
  $('station-panel').hidden = true; $('connect-form').hidden = config.connected;
  if (config.connected) {
    $('form-message').textContent = 'Завантажуємо станції…';
    try { const data = await api('/api/stations'); stations(data.stations, config.station?.id); $('form-message').textContent = ''; }
    catch (error) { $('form-message').textContent = error.message; $('connect-form').hidden = false; }
  }
}
async function submit(form, action) {
  const button = form.querySelector('button[type=submit]');
  button.disabled = true; $('form-message').textContent = 'Підключаємося…';
  try { await action(); $('form-message').textContent = ''; }
  catch (error) { $('form-message').textContent = error.message; }
  finally { button.disabled = false; }
}
$('connect-form').addEventListener('submit', event => {
  event.preventDefault();
  submit(event.currentTarget, async () => {
    const data = await api('/api/connect', { appId: $('app-id').value, login: $('login').value, appSecret: $('app-secret').value, password: $('password').value });
    $('app-secret').value = ''; $('password').value = '';
    config = await api('/api/config'); requestVersion++; snapshot = null;
    stations(data.stations, data.selected);
  });
});
$('station-form').addEventListener('submit', event => {
  event.preventDefault();
  submit(event.currentTarget, async () => {
    await api('/api/station', { stationId: $('station-select').value });
    config = await api('/api/config'); requestVersion++; snapshot = null;
    $('settings-dialog').close(); $('view-mode').value = 'live';
    unknown('Завантажуємо показники вибраної станції…');
    await refresh();
  });
});
$('change-account').addEventListener('click', () => { $('station-panel').hidden = true; $('connect-form').hidden = false; });
$('close-settings').addEventListener('click', () => $('settings-dialog').close());
$('settings-dialog').addEventListener('close', () => { $('app-secret').value = ''; $('password').value = ''; });
$('settings-button').addEventListener('click', openSettings);
$('refresh').addEventListener('click', () => isExample() ? render(example($('view-mode').value), true) : refresh());
$('view-mode').addEventListener('change', () => {
  requestVersion++;
  if (isExample()) render(example($('view-mode').value), true);
  else { unknown(config?.configured ? 'Завантажуємо дані…' : 'Налаштуйте підключення до Deye Cloud.'); refresh(); }
});
(async () => {
  try {
    config = await api('/api/config');
    $('settings-button').hidden = !config.canConfigure;
    if (config.station) $('station-name').textContent = config.station.name;
    if (config.configured) await refresh();
    else { notice(config.canConfigure ? 'Підключіть Deye Cloud у налаштуваннях або виберіть приклад унизу.' : 'Підключення потрібно налаштувати на комп’ютері-сервері.'); }
  } catch (error) { unknown((staticMode ? 'Публічні дані недоступні. ' : 'Локальний сервер недоступний. ') + error.message); }
})();
setInterval(refresh, 60000);
setInterval(() => {
  if (!isExample() && snapshot && Date.now() - snapshot.collectedAt > 900000) render(snapshot);
}, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });





