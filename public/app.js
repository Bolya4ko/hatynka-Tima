'use strict';
const $ = id => document.getElementById(id);
const clock = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' });
const date = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' });
const decimal = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
let snapshot = null, loading = false, requestVersion = 0;
let displayedMeasurementTime = null;
let displayedGridEvent = null;
const isExample = () => $('view-mode').value !== 'live';
// First load: grey bars in the cards and bouncing bubbles instead of the cloud-delay note.
function setLoading(on) {
  document.querySelector('.cards')?.classList.toggle('skeleton', on);
  document.querySelector('.freshness')?.classList.toggle('loading', on);
}
function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
function unknown(message) {
  render({ station: snapshot?.station, stale: true, collectedAt: snapshot?.collectedAt, grid: 'unknown', output: 'unknown', soc: null, events: {} });
  notice(message);
}
function inverterState(data, stale) {
  if (stale || !['on', 'off'].includes(data.grid) || !['on', 'off'].includes(data.output)) return 'unknown';
  // This dashboard follows the building's ATS scheme: mains has priority.
  // Nonzero output telemetry alone does not establish that the ATS feeds the building from the inverter.
  if (data.grid === 'on') {
    if (data.batteryMode === 'charging') return 'charging';
    if (data.output === 'off') return 'off';
    if (data.batteryMode === 'idle') return 'standby';
    return 'unknown';
  }
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
function measurementAge(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  if (timestamp > now) return 'Час вимірювання попереду годинника';
  const seconds = Math.floor((now - timestamp) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return 'Пройшло ' + (hours ? hours + ' год. ' : '') + minutes + ' хв. ' + seconds % 60 + ' с.';
}
function updateMeasurementAge() {
  const element = $('data-elapsed');
  element.textContent = measurementAge(displayedMeasurementTime);
  element.hidden = !element.textContent;
}
function updateGridDuration() {
  const badge = $('grid-duration');
  const now = Date.now();
  const event = displayedGridEvent;
  const valid = event && Number.isFinite(event.at) && event.at > 0 && event.at <= event.measuredAt &&
    Number.isFinite(event.measuredAt) && now >= event.measuredAt && now - event.measuredAt <= 3600000;
  badge.hidden = !valid;
  badge.textContent = valid ? (event.grid === 'on' ? 'Є вже ≈ ' : 'Немає вже ≈ ') +
    measurementAge(event.at, now).replace(/^Пройшло /, '') : '';
  if (!valid) $('grid-event').hidden = true;
}
function measurementDateLabel(timestamp, now = Date.now()) {
  const calendar = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const day = value => {
    const parts = Object.fromEntries(calendar.formatToParts(value).map(p => [p.type, p.value]));
    return parts.year + '-' + parts.month + '-' + parts.day;
  };
  const today = day(now);
  const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  const measured = day(timestamp);
  const label = measured === today ? 'сьогодні' : measured === yesterday ? 'вчора' :
    new Intl.DateTimeFormat('uk-UA', {
      timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long',
      ...(measured.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {})
    }).format(timestamp);
  return 'Дані станом на ' + label + ' ' + clock.format(timestamp);
}
function render(data, example = false) {
  displayedMeasurementTime = data.collectedAt ?? null;
  updateMeasurementAge();
  const stale = data.stale || !data.collectedAt || Date.now() - data.collectedAt > 3600000;
  const grid = stale ? 'unknown' : data.grid;
  const output = stale ? 'unknown' : data.output;
  const soc = stale ? null : data.soc;
  $('station-name').textContent = data.station?.name || 'Чавдар 13';
  $('source-text').textContent = example ? 'Демонстрація' : stale ? 'Немає свіжих даних' : 'Deye Cloud';
  $('source-pill').dataset.state = example ? 'demo' : stale ? 'unknown' : 'on';
  $('data-time').textContent = data.collectedAt ? measurementDateLabel(data.collectedAt) : 'Очікуємо дані';
  $('grid-card').dataset.state = grid;
  $('grid-value').textContent = ({ on: 'Є', off: 'Немає', unstable: 'Нестабільна', unknown: 'Невідомо' })[grid] || 'Невідомо';
  $('grid-detail').textContent = grid === 'on' ? 'Напруга є на всіх фазах' :
    grid === 'off' ? (data.allPhasesZero ? 'Усі фази: 0 В' : 'Немає вхідної напруги') :
    grid === 'unstable' ? 'Перевірте стан фаз' : 'Немає актуальних показників';
  const event = data.historyError || data.historyAvailable === false ? null :
    grid === 'on' ? data.events?.appeared : grid === 'off' ? data.events?.disappeared : null;
  $('grid-event').hidden = !event;
  $('grid-event').textContent = event ? (grid === 'on' ? 'З’явилася ≈ ' : 'Зникла ≈ ') +
    (date.format(event.at) !== date.format(data.collectedAt) ? date.format(event.at) + ', ' : '') + clock.format(Math.round(event.at / 60000) * 60000) : '';
  displayedGridEvent = event && !stale ? { at: event.at, measuredAt: data.collectedAt, grid } : null;
  updateGridDuration();
  const operation = inverterState(data, stale);
  $('output-card').dataset.state = ({ supplying: 'on', charging: 'on', standby: 'standby', off: 'off', unknown: 'unknown' })[operation];
  $('output-value').textContent = ({
    supplying: 'Будинок живиться від інвертора',
    charging: 'Інвертор заряджає акумулятор',
    standby: 'Інвертор у режимі очікування',
    off: 'Немає напруги на виході',
    unknown: 'Стан невідомий'
  })[operation];
  $('load').hidden = operation !== 'supplying';
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
  $('update-note').textContent = example ? 'Демонстраційні значення для перегляду оформлення' : 'Автоматичне оновлення щохвилини';
  notice(example ? 'Приклад відображення — це не поточні показники будинку.' :
    stale ? 'Дані застаріли або недоступні. Поточний стан живлення невідомий.' :
    '');
}
function example(mode) {
  const now = Date.now();
  const mains = mode === 'on' || mode === 'standby';
  return { station: { name: 'Чавдар 13' }, collectedAt: now - (mode === 'stale' ? 3660000 : 300000),
    stale: mode === 'stale', grid: mains ? 'on' : 'off', output: mode === 'output-off' ? 'off' : 'on',
    allPhasesZero: !mains, soc: mode === 'on' ? 82 : mode === 'standby' ? 100 : mode === 'output-off' ? 10 : 61,
    batteryMode: mode === 'on' ? 'charging' : ['standby', 'output-off'].includes(mode) ? 'idle' : 'discharging',
    loadWatts: mains || mode === 'output-off' ? 0 : 16800,
    events: { appeared: { at: now - 3600000 }, disappeared: { at: now - 10800000 } } };
}
async function api() {
  const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  // For testing: ?api=http://127.0.0.1:8787 reads from a Worker running on this computer (wrangler dev). Only localhost is allowed.
  const local = query.get('api');
  const apiUrl = local && /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(local) ? local
    : document.querySelector('meta[name="dashboard-api"]')?.content?.trim();
  if (!apiUrl) throw new Error('Не вказано адресу джерела даних.');
  const source = new URL('/api/status', apiUrl);
  // Optional: ?station=ID opens another station from the Worker's allowed list. Default: the main station.
  const station = query.get('station');
  if (station && /^\d{1,20}$/.test(station)) source.searchParams.set('station', station);
  let response;
  try { response = await fetch(source, { cache: 'no-store', signal: AbortSignal.timeout(45000) }); }
  catch (error) {
    throw new Error(error?.name === 'TimeoutError' ? 'Сервер не відповів вчасно. Спробуємо ще раз.' : 'Немає зв’язку із сервером даних. Перевірте інтернет.');
  }
  if (!response.ok) throw new Error('Не вдалося отримати дані. Спробуйте пізніше.');
  const data = await response.json();
  if (!data || !Number.isFinite(data.collectedAt)) throw new Error('Немає коректного часу вимірювання.');
  return data;
}
async function refresh() {
  if (isExample() || loading) return;
  const version = requestVersion;
  loading = true; $('refresh').disabled = true; $('refresh').classList.add('spinning');
  // Skeleton only on the very first load: later refreshes keep the numbers on screen.
  if (!snapshot) { setLoading(true); $('data-time').textContent = 'Завантажуємо дані…'; }
  try {
    const data = await api();
    if (version !== requestVersion || isExample()) return;
    // Never show an older measurement than the one already on screen (different servers may answer out of order).
    if (snapshot && Number.isFinite(snapshot.collectedAt) && data.collectedAt < snapshot.collectedAt) return;
    snapshot = data; render(data);
  } catch (error) {
    if (version === requestVersion && !isExample()) { unknown(error.message); setTimeout(refresh, 10000); }
  } finally {
    // An answer to an outdated request (the view was switched meanwhile) must not touch the state of the new one.
    if (version === requestVersion) { loading = false; $('refresh').disabled = false; $('refresh').classList.remove('spinning'); setLoading(false); }
  }
}
function showExample() {
  const mode = $('view-mode').value;
  setLoading(mode === 'loading');
  if (mode === 'loading') { render({ stale: true, collectedAt: null, grid: 'unknown', output: 'unknown', soc: null, events: {} }, true); notice(''); $('data-time').textContent = 'Завантажуємо дані…'; }
  else render(example(mode), true);
}
$('refresh').addEventListener('click', () => isExample() ? showExample() : refresh());
$('view-mode').addEventListener('change', () => {
  requestVersion++;
  if (isExample()) showExample();
  else {
    // Back to real data: show what we already have, or the loading state, and ask for fresh data. No yellow message.
    loading = false;
    if (snapshot) { setLoading(false); render(snapshot); }
    else {
      setLoading(true);
      render({ stale: true, collectedAt: null, grid: 'unknown', output: 'unknown', soc: null, events: {} });
      notice(''); $('data-time').textContent = 'Завантажуємо дані…';
    }
    refresh();
  }
});
refresh();
setInterval(refresh, 60000);
setInterval(() => { updateMeasurementAge(); updateGridDuration(); }, 1000);
setInterval(() => {
  if (!isExample() && snapshot && Date.now() - snapshot.collectedAt > 3600000) render(snapshot);
}, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

const installHelp = $('install-help');
$('open-install-help').addEventListener('click', () => installHelp.showModal());
$('close-install-help').addEventListener('click', () => installHelp.close());
