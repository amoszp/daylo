import { parseRoster } from './roster.js';

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (n, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const DOW = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const DOWL = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MON = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const pad2 = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dowIdx = (d) => (d.getDay() + 6) % 7;
const monday = (d) => addDays(d, -dowIdx(d));
const sameDay = (a, b) => key(a) === key(b);
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const monthKey = (y, m) => `${y}-${pad2(m + 1)}`;
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const shortDate = (d) => `${DOW[dowIdx(d)]} ${d.getDate()} ${MONS[d.getMonth()]}`;

// Keeps the app pinned to the visible area (address bar, on-screen keyboard).
function setAppHeight() {
  const vv = window.visualViewport;
  document.documentElement.style.setProperty('--app-h', `${vv ? vv.height : window.innerHeight}px`);
  document.documentElement.style.setProperty('--app-top', `${vv ? vv.offsetTop : 0}px`);
  updateKeyboard();
}

// While the on-screen keyboard is up, the tab bar steps aside and toasts move to the top,
// so the list being typed into keeps the room (the bar would otherwise ride on the keyboard).
const TYPING = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea';
const coarse = matchMedia('(pointer: coarse)');
function keyboardOpen() {
  const el = document.activeElement;
  if (!el || !el.matches?.(TYPING)) return false;
  const vv = window.visualViewport;
  const shrunk = vv ? vv.height < window.innerHeight * 0.8 : false;
  return coarse.matches || shrunk;
}
function updateKeyboard() {
  const app = document.getElementById('app');
  if (app) app.classList.toggle('kb', keyboardOpen());
}
setAppHeight();
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', setAppHeight);
  window.visualViewport.addEventListener('scroll', setAppHeight);
} else {
  window.addEventListener('resize', setAppHeight);
}
document.addEventListener('focusin', updateKeyboard);
// Focus can hop from one field to the next without the keyboard closing: decide after it lands.
document.addEventListener('focusout', () => setTimeout(updateKeyboard, 60));

/* ---------- shift types ---------- */
const TYPES = {
  early: { name: 'Temprano', icon: 'sun-horizon-fill', s: '08:00', e: '17:00' },
  mid: { name: 'Intermedio', icon: 'sun-fill', s: '11:30', e: '20:30' },
  late: { name: 'Tarde', icon: 'moon-stars-fill', s: '15:00', e: '00:00' },
  train: { name: 'Formación', icon: 'graduation-cap-fill', s: '09:00', e: '18:00' },
  off: { name: 'Libre', icon: 'couch-fill' },
  hol: { name: 'Festivo', icon: 'flag-banner-fill' },
};
const DEFAULTS = Object.fromEntries(['early', 'mid', 'late', 'train'].map((k) => [k, { s: TYPES[k].s, e: TYPES[k].e }]));
const ORDER = ['early', 'mid', 'late', 'train', 'off', 'hol'];
const WORK = (t) => t === 'early' || t === 'mid' || t === 'late' || t === 'train' || t === 'other';
const VIA = { car: { name: 'Coche', icon: 'car' }, bus: { name: 'Guagua', icon: 'bus' } };
const STARTER_PACK = ['Portátil y cargador', 'Ratón', 'Auriculares', 'Comida', 'Agua'];

/* ---------- state ---------- */
let days = {};       // 'YYYY-MM-DD' -> { t, s?, e?, loc?, via? }
let pack = [];       // { id, name, done, creado }
let me = null;
let ical = { on: false };
const ui = { tab: store.get('daylo-tab', 'week'), week: monday(today()), month: monthStart(today()), mode: store.get('daylo-mode', 'system'), packEdit: false, credits: false };
if (!['week', 'month', 'office', 'settings'].includes(ui.tab)) ui.tab = 'week';

const kind = (it) => (it ? (it.t === 'other' ? 'mid' : it.t) : null);
const label = (it) => (it.t === 'other' ? 'Otro turno' : TYPES[it.t].name);
const iconOf = (it) => (TYPES[it.t]?.icon || 'clock');
const range = (it) => (it.t === 'other' ? (it.s && it.e ? `${it.s}–${it.e}` : '') : (TYPES[it.t].s ? `${TYPES[it.t].s}–${TYPES[it.t].e}` : ''));
const isOffice = (it) => !!it && WORK(it.t) && it.loc === 'office';

/* ---------- theme ---------- */
function applyTheme() {
  $('#app').dataset.mode = ui.mode;
  const dark = ui.mode === 'dark' || (ui.mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#theme-color').setAttribute('content', dark ? '#1A1717' : '#F9F7F4');
  document.body.style.background = dark ? '#1A1717' : '#F9F7F4';
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* ---------- server ---------- */
class HttpError extends Error { constructor(status, body) { super(`HTTP ${status}`); this.status = status; this.body = body; } }
async function api(method, path, body) {
  const headers = { 'x-daylo': '1' };
  let payload;
  if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  if (res.status === 401 && !path.startsWith('/api/auth/')) { showLogin(); throw new HttpError(401); }
  if (!res.ok) { let b = null; try { b = await res.json(); } catch { /* not json */ } throw new HttpError(res.status, b); }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Writes are applied on screen at once and sent in order; offline they wait and retry.
const queue = [];
let flushing = false, offline = false;
function enqueue(op) { queue.push(op); flush(); }
async function flush() {
  if (flushing) return;
  flushing = true;
  while (queue.length) {
    const op = queue[0];
    try {
      await api(op.method, op.path, op.body);
      queue.shift();
      setOffline(false);
    } catch (err) {
      if (err.status === 401) { flushing = false; return; }
      if (err.status && err.status < 500 && err.status !== 408 && err.status !== 429) { queue.shift(); toast('No se pudo guardar un cambio'); continue; }
      setOffline(true);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  flushing = false;
}
window.addEventListener('online', () => flush());
window.addEventListener('beforeunload', (e) => { if (queue.length) { e.preventDefault(); e.returnValue = ''; } });
function setOffline(on) { if (offline === on) return; offline = on; $('#offline').hidden = !on; }

const strip = (o) => { const { id, ...rest } = o; return rest; };
function saveDay(k) {
  const it = days[k];
  if (it) enqueue({ method: 'PUT', path: `/api/items/dia/${k}`, body: strip(it) });
  else enqueue({ method: 'DELETE', path: `/api/items/dia/${k}` });
}
/** Sends many day changes as one all-or-nothing batch. */
function saveDays(keys) {
  const ops = keys.map((k) => (days[k] ? { op: 'put', kind: 'dia', id: k, data: strip(days[k]) } : { op: 'del', kind: 'dia', id: k }));
  for (let i = 0; i < ops.length; i += 400) enqueue({ method: 'POST', path: '/api/batch', body: { ops: ops.slice(i, i + 400) } });
}
const savePack = (p) => enqueue({ method: 'PUT', path: `/api/items/pack/${p.id}`, body: strip(p) });
const deletePack = (p) => enqueue({ method: 'DELETE', path: `/api/items/pack/${p.id}` });
const saveTipo = (k) => enqueue({ method: 'PUT', path: `/api/items/tipo/${k}`, body: { s: TYPES[k].s, e: TYPES[k].e } });
const saveSetting = (id, data) => enqueue({ method: 'PUT', path: `/api/items/ajuste/${id}`, body: data });

async function loadData() {
  const { items } = await api('GET', '/api/data');
  days = {};
  for (const d of items.dia || []) { const { id, ...rest } = d; if (/^\d{4}-\d{2}-\d{2}$/.test(id) && (TYPES[rest.t] || rest.t === 'other')) days[id] = rest; }
  for (const k of Object.keys(DEFAULTS)) Object.assign(TYPES[k], DEFAULTS[k]);
  for (const t of items.tipo || []) if (TYPES[t.id] && DEFAULTS[t.id] && /^\d{2}:\d{2}$/.test(t.s) && /^\d{2}:\d{2}$/.test(t.e)) Object.assign(TYPES[t.id], { s: t.s, e: t.e });
  pack = (items.pack || []).filter((p) => typeof p.name === 'string').sort((a, b) => (a.creado || 0) - (b.creado || 0));
  const tema = (items.ajuste || []).find((a) => a.id === 'tema');
  if (tema && ['system', 'light', 'dark'].includes(tema.mode)) { ui.mode = tema.mode; store.set('daylo-mode', ui.mode); applyTheme(); }
  // First visit: the packing list starts with the usual things, once.
  if (!(items.ajuste || []).some((a) => a.id === 'inicio')) {
    if (!pack.length) STARTER_PACK.forEach((name, i) => { const p = { id: uid(), name, done: false, creado: Date.now() + i }; pack.push(p); savePack(p); });
    saveSetting('inicio', { creado: Date.now() });
  }
  try { ical = await api('GET', '/api/ical'); } catch { ical = { on: false }; }
}

/* ---------- range: from the first day with data to one period past the last ---------- */
function dataBounds() {
  const ks = Object.keys(days).sort();
  const t = today();
  const first = ks.length ? fromKey(ks[0]) : t;
  const last = ks.length ? fromKey(ks[ks.length - 1]) : t;
  return { first: first < t ? first : t, last: last > t ? last : t };
}
const minWeek = () => monday(dataBounds().first);
const maxWeek = () => addDays(monday(dataBounds().last), 7);
const minMonth = () => monthStart(dataBounds().first);
const maxMonth = () => { const l = dataBounds().last; return new Date(l.getFullYear(), l.getMonth() + 1, 1); };
function clampView() {
  if (ui.week < minWeek()) ui.week = minWeek();
  if (ui.week > maxWeek()) ui.week = maxWeek();
  if (ui.month < minMonth()) ui.month = minMonth();
  if (ui.month > maxMonth()) ui.month = maxMonth();
}

/* ---------- header ---------- */
function header() {
  const bare = ui.tab === 'settings' || ui.tab === 'office';
  $('#top').hidden = bare;
  $('#main').classList.toggle('bare', bare);
  if (bare) return;
  const prev = $('#prev'), next = $('#next'), todayBtn = $('#today'), period = $('#period');
  const t = today();
  if (ui.tab === 'week') {
    const a = ui.week, b = addDays(a, 6);
    period.textContent = a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${MONS[b.getMonth()]}` : `${a.getDate()} ${MONS[a.getMonth()]} – ${b.getDate()} ${MONS[b.getMonth()]}`;
    prev.disabled = ui.week <= minWeek(); next.disabled = ui.week >= maxWeek();
    todayBtn.hidden = sameDay(ui.week, monday(t));
  } else {
    period.textContent = `${cap(MON[ui.month.getMonth()])} ${ui.month.getFullYear()}`;
    prev.disabled = ui.month <= minMonth(); next.disabled = ui.month >= maxMonth();
    todayBtn.hidden = ui.month.getMonth() === t.getMonth() && ui.month.getFullYear() === t.getFullYear();
  }
}

/* ---------- week ---------- */
function nextOff(from) {
  for (let i = 1; i < 70; i++) { const it = days[key(addDays(from, i))]; if (!it) return null; if (it.t === 'off' || it.t === 'hol') return addDays(from, i); }
  return null;
}
function placeHTML(it) {
  if (!isOffice(it)) return '<span class="place"></span>';
  const v = it.via ? VIA[it.via] : null;
  return `<span class="place on" role="img" aria-label="En la oficina${v ? `, en ${v.name.toLowerCase()}` : ''}">${ico('buildings-fill')}${v ? ico(`${v.icon}-fill`) : ''}</span>`;
}
function renderWeek() {
  const t = today();
  let h = '<div class="days">', work = 0, off = 0, hol = 0, office = 0, any = false;
  for (let i = 0; i < 7; i++) {
    const d = addDays(ui.week, i), it = days[key(d)];
    if (it) { any = true; if (it.t === 'off') off++; else if (it.t === 'hol') hol++; else work++; if (isOffice(it)) office++; }
    const lbl = it ? label(it) : 'Sin turno';
    h += `<button class="day press${sameDay(d, t) ? ' is-today' : ''}${it && WORK(it.t) ? '' : ' muted'}" data-day="${key(d)}" aria-label="${DOWL[i]} ${d.getDate()}: ${lbl}${it && range(it) ? ` ${range(it)}` : ''}${isOffice(it) ? ', en la oficina' : ''}">
      <span class="dnum"><small>${DOW[i]}</small><b>${d.getDate()}</b></span>
      ${it ? `<span class="badge k-${kind(it)}">${ico(iconOf(it))}</span>` : '<span class="badge"></span>'}
      <span class="lbl">${lbl}</span>
      ${placeHTML(it)}
      <span class="tm">${it && range(it) ? range(it) : ''}</span>
    </button>`;
  }
  h += '</div>';
  if (any) {
    h += `<div class="sum"><span><b>${work}</b> ${work === 1 ? 'turno' : 'turnos'}</span><span><b>${office}</b> en oficina</span><span><b>${off}</b> ${off === 1 ? 'libre' : 'libres'}</span>${hol ? `<span><b>${hol}</b> ${hol === 1 ? 'festivo' : 'festivos'}</span>` : ''}</div>`;
    if (sameDay(ui.week, monday(t))) { const nx = nextOff(t); if (nx) h += `<div class="sum-next">Próximo libre <b>${shortDate(nx)}</b></div>`; }
  } else h += emptyHTML(ui.week);
  $('#view').innerHTML = h;
}

/* ---------- month ---------- */
function cellHTML(d, inMonth, preview, src = days) {
  const it = src[key(d)], isT = sameDay(d, today());
  if (!inMonth) return `<div class="cell out" aria-hidden="true"><span class="n">${d.getDate()}</span><span class="ph"></span>${preview ? '' : '<span class="om"></span>'}</div>`;
  const cls = it ? ` has k-${kind(it)}` : ' nodata';
  const mark = it ? ico(iconOf(it)) : '<span class="ph"></span>';
  const aria = `${d.getDate()} de ${MON[d.getMonth()]}: ${it ? label(it) : 'sin turno'}${isOffice(it) ? ', en la oficina' : ''}`;
  if (preview) return `<div class="cell${cls}" role="img" aria-label="${aria}"><span class="n">${d.getDate()}</span>${mark}</div>`;
  return `<button class="cell press${cls}${isT ? ' is-today' : ''}" data-day="${key(d)}" aria-label="${aria}"><span class="n">${d.getDate()}</span>${mark}<span class="om">${isOffice(it) ? ico('buildings-fill') : ''}</span></button>`;
}
function gridHTML(y, m, preview, src) {
  const first = new Date(y, m, 1), start = monday(first), n = daysIn(y, m);
  const cells = Math.ceil((dowIdx(first) + n) / 7) * 7;
  let h = '<div class="grid">';
  for (let i = 0; i < cells; i++) { const d = addDays(start, i); h += cellHTML(d, d.getMonth() === m, preview, src); }
  return h + '</div>';
}
const wkHTML = (extra = '') => `<div class="wk${extra}" aria-hidden="true">${DOW.map((x) => `<span>${x.slice(0, 1)}</span>`).join('')}</div>`;
function counts(y, m) {
  const c = { early: 0, mid: 0, late: 0, train: 0, off: 0, hol: 0, other: 0, office: 0, car: 0, bus: 0 };
  let n = 0;
  for (let d = 1; d <= daysIn(y, m); d++) {
    const it = days[key(new Date(y, m, d))];
    if (!it) continue;
    c[it.t]++; n++;
    if (isOffice(it)) { c.office++; if (it.via) c[it.via]++; }
  }
  c.mid += c.other;
  return { c, n };
}
function renderMonth() {
  const y = ui.month.getFullYear(), m = ui.month.getMonth();
  let h = wkHTML() + gridHTML(y, m, false);
  const { c, n } = counts(y, m);
  if (n) {
    h += `<div class="tally" aria-label="Leyenda del mes">${ORDER.map((k) => `<span><span class="badge sm k-${k}">${ico(TYPES[k].icon)}</span><span class="tn">${TYPES[k].name}</span><b>${c[k]}</b></span>`).join('')}${
      [['office', 'buildings-fill', 'Oficina'], ['car', 'car-fill', 'En coche'], ['bus', 'bus-fill', 'En guagua']].map(([k, ic, nm]) => `<span><span class="badge sm k-off">${ico(ic)}</span><span class="tn">${nm}</span><b>${c[k]}</b></span>`).join('')}</div>`;
  } else h += emptyHTML(ui.month);
  $('#view').innerHTML = h;
}
function emptyHTML(d) {
  const target = ui.tab === 'week' ? monthStart(addDays(d, 3)) : d;
  const mn = MON[target.getMonth()];
  const none = !Object.keys(days).length;
  return `<div class="empty"><h3>${none ? 'Aún no hay turnos' : `${cap(mn)} aún sin turnos`}</h3><p>Los turnos llegan con un mes de antelación. Cuando te pasen el cuadrante, pégalo aquí.</p>
    <button class="btn primary press" data-import="${target.getFullYear()}-${target.getMonth()}">${ico('clipboard-text')}Pegar turnos de ${mn}</button></div>`;
}

/* ---------- office ---------- */
function nextOffice() {
  const t = today();
  for (let i = 0; i < 70; i++) { const d = addDays(t, i); if (isOffice(days[key(d)])) return d; }
  return null;
}
const viaCtl = (k, it) => `<div class="seg-ctl two" role="group" aria-label="Cómo vas">${Object.entries(VIA).map(([v, o]) => `<button class="press" data-via="${v}" data-key="${k}" aria-pressed="${it.via === v}">${ico(o.icon)}${o.name}</button>`).join('')}</div>`;
function renderOffice() {
  const d = nextOffice(), t = today();
  let h = '';
  if (d) {
    const it = days[key(d)];
    const when = sameDay(d, t) ? 'Hoy' : sameDay(d, addDays(t, 1)) ? 'Mañana' : cap(DOWL[dowIdx(d)]);
    h += `<section class="next-office" aria-label="Próximo día en la oficina"><div class="k">Próximo día en la oficina</div>
      <div class="d"><span class="badge k-${kind(it)}">${ico(iconOf(it))}</span><div><b>${when}, ${d.getDate()} de ${MON[d.getMonth()]}</b><br><span>${label(it)} ${range(it)}</span></div></div>
      ${viaCtl(key(d), it)}</section>`;
  } else {
    h += '<div class="empty first"><h3>Sin días de oficina por delante</h3><p>Toca un día en Semana o Mes y elige Oficina.</p></div>';
  }
  const done = pack.filter((p) => p.done).length;
  h += `<div class="pack-head"><h4>Qué llevar</h4>${pack.length ? `<button class="linkbtn press" id="pack-edit">${ui.packEdit ? 'Hecho' : 'Editar lista'}</button>` : ''}</div>
    <div class="list"><form class="addrow" id="addform" role="search"><input id="newitem" placeholder="Busca o añade algo" aria-label="Buscar o añadir a la lista" autocomplete="off" enterkeyhint="done" maxlength="80"><button class="btn secondary press" id="packadd" type="submit" hidden>${ico('plus')}Añadir</button></form>${
      // Ticked items first (Moe), each group in the order it was added.
      [...pack.filter((p) => p.done), ...pack.filter((p) => !p.done)].map((p) => `<div class="chk" role="checkbox" tabindex="0" aria-checked="${p.done}" data-pack="${p.id}">${ico(p.done ? 'check-square-fill' : 'square', 'i box')}<span class="nm">${esc(p.name)}</span>${
        ui.packEdit ? `<button class="del press" data-del="${p.id}" aria-label="Quitar ${esc(p.name)}">${ico('trash')}</button>` : ''}</div>`).join('')}
    </div>
    ${pack.length ? `<div class="progress"><b>${done} de ${pack.length}</b> en la mochila</div>
    <div class="stack"><button class="btn secondary full press" id="pack-reset"${done ? '' : ' disabled'}>Desmarcar todo</button></div>` : ''}`;
  $('#view').innerHTML = h;
}
function filterPack() {
  const input = $('#newitem'); if (!input) return;
  const v = input.value, q = norm(v);
  document.querySelectorAll('.chk').forEach((r) => { const p = pack.find((x) => x.id === r.dataset.pack); r.hidden = !!q && !norm(p?.name).includes(q); });
  const add = $('#packadd');
  add.hidden = !q || pack.some((p) => norm(p.name) === q);
  add.setAttribute('aria-label', `Añadir ${v.trim()} a la lista`);
}

/* ---------- settings ---------- */
function renderSettings() {
  const t = (k) => `<div class="row"><span class="badge sm k-${k}">${ico(TYPES[k].icon)}</span><span class="grow"><b>${TYPES[k].name}</b></span>
    <span class="times"><input type="time" id="s-${k}" value="${TYPES[k].s}" aria-label="${TYPES[k].name}: empieza" data-k="${k}" data-f="s"><span>a</span><input type="time" id="e-${k}" value="${TYPES[k].e}" aria-label="${TYPES[k].name}: termina" data-k="${k}" data-f="e"></span></div>`;
  const webcal = ical.on && ical.url ? ical.url.replace(/^https?:/, 'webcal:') : '';
  $('#view').innerHTML = `
  <div class="sec"><h4>Horarios de cada turno</h4><div class="list">${['early', 'mid', 'late', 'train'].map(t).join('')}</div></div>
  <div class="sec"><h4>Cuadrante</h4><div class="list">
    <button class="row press" data-import="next"><span class="badge sm k-off">${ico('clipboard-text')}</span><span class="grow"><b>Pegar cuadrante del mes</b><span class="sub">Copia el texto que te envían y pégalo tal cual</span></span>${ico('caret-right', 'i chev')}</button>
  </div></div>
  <div class="sec"><h4>Calendario del iPhone</h4><div class="list">
    <div class="row"><span class="badge sm k-off">${ico('calendar-plus')}</span><span class="grow"><b>Ver turnos en Calendario</b><span class="sub">Se actualiza solo cuando cambias un turno</span></span>
      <button class="switch press" role="switch" id="ical" aria-checked="${ical.on}" aria-label="Ver turnos en Calendario"></button></div>
    ${webcal ? `<a class="row press" href="${esc(webcal)}"><span class="badge sm k-off">${ico('calendar-check')}</span><span class="grow"><b>Añadir al Calendario</b><span class="sub">Ábrelo en el iPhone y acepta la suscripción</span></span>${ico('caret-right', 'i chev')}</a>
    <button class="row press" id="ical-copy"><span class="badge sm k-off">${ico('copy')}</span><span class="grow"><b>Copiar enlace</b><span class="sub">Para otro calendario</span></span></button>` : ''}
  </div></div>
  <div class="sec"><h4>Apariencia</h4><div class="list"><div class="seg-wrap">
    <div class="seg-ctl" role="group" aria-label="Apariencia">${[['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `<button class="press" data-mode="${v}" aria-pressed="${ui.mode === v}">${l}</button>`).join('')}</div>
  </div></div></div>
  <div class="sec"><h4>Cuenta</h4><div class="list">
    <div class="row"><span class="grow"><b>${esc(me?.displayName || me?.username || '')}</b><span class="sub">${esc(me?.username || '')}</span></span></div>
    <button class="row press" id="logout"><span class="badge sm k-off">${ico('sign-out')}</span><span class="grow"><b>Cerrar sesión</b></span></button>
    <button class="row press" id="credits" aria-expanded="${ui.credits}"><span class="badge sm k-off">${ico('info')}</span><span class="grow"><b>Créditos y licencias</b></span></button>
    ${ui.credits ? '<div class="credits"><p>Iconos: Phosphor Icons, licencia MIT.</p><p>Tipografía: Inter, SIL Open Font License 1.1.</p></div>' : ''}
  </div></div>
  <div class="sec"><h4>Datos</h4><div class="list">
    <button class="row press danger-row" id="wipe"><span class="grow"><b>Borrar los turnos de un mes</b></span>${ico('caret-right', 'i chev')}</button>
  </div></div>`;
}

/* ---------- render ---------- */
function render() {
  clampView();
  header();
  if (ui.tab === 'week') renderWeek(); else if (ui.tab === 'month') renderMonth(); else if (ui.tab === 'office') renderOffice(); else renderSettings();
  document.querySelectorAll('.nav button').forEach((b) => {
    const on = b.dataset.tab === ui.tab;
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    const base = { week: 'rows', month: 'calendar-dots', office: 'buildings', settings: 'gear-six' }[b.dataset.tab];
    b.querySelector('use').setAttribute('href', `#i-${base}${on ? '-fill' : ''}`);
  });
}

/* ---------- toast with undo ---------- */
let toastTimer = null, undoFn = null;
function toast(msg, undo) {
  $('#toast-msg').textContent = msg; undoFn = undo || null; $('#toast-undo').hidden = !undo;
  // Shorter while typing: it sits at the top then, over whatever is scrolled there.
  const ms = $('#app').classList.contains('kb') ? 2500 : 5000;
  $('#toast').classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('on'), ms);
}
$('#toast-undo').addEventListener('click', () => { const f = undoFn; undoFn = null; $('#toast').classList.remove('on'); if (f) f(); });

/* ---------- sheets ---------- */
let lastFocus = null, sheetKind = null;
function openSheet(title, html, kindName) {
  lastFocus = document.activeElement; sheetKind = kindName;
  $('#sh-title').textContent = title; $('#sh-body').innerHTML = html;
  $('#scrim').classList.add('on'); $('#sheet').classList.add('on');
  setTimeout(() => $('#sh-close').focus(), 60);
}
function closeSheet() {
  if (!$('#sheet').classList.contains('on')) return;
  $('#scrim').classList.remove('on'); $('#sheet').classList.remove('on'); sheetKind = null;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}
$('#sh-close').addEventListener('click', closeSheet);
$('#scrim').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

function dayBody(k) {
  const it = days[k];
  let h = `<div class="sh-sec"><h4>Turno</h4><div class="picks">${ORDER.map((t) => `<button class="pick press" data-set="${t}" data-key="${k}" aria-pressed="${!!it && it.t === t}"><span class="badge sm k-${t}">${ico(TYPES[t].icon)}</span><span class="grow"><b>${TYPES[t].name}</b>${TYPES[t].s ? `<small>${TYPES[t].s}–${TYPES[t].e}</small>` : ''}</span></button>`).join('')}</div></div>`;
  if (it && it.t === 'other') h = `<p class="hint">Este día tiene un horario distinto: ${range(it)}.</p>` + h;
  if (it && WORK(it.t)) {
    h += `<div class="sh-sec"><h4>Dónde trabajas</h4><div class="seg-ctl two" role="group" aria-label="Dónde trabajas">
      <button class="press" data-loc="home" data-key="${k}" aria-pressed="${it.loc !== 'office'}">${ico('house')}Casa</button>
      <button class="press" data-loc="office" data-key="${k}" aria-pressed="${it.loc === 'office'}">${ico('buildings')}Oficina</button></div></div>`;
    if (it.loc === 'office') h += `<div class="sh-sec"><h4>Cómo vas</h4>${viaCtl(k, it)}</div>`;
  }
  if (it) h += `<div class="stack"><button class="btn secondary full press" data-clear="${k}">Quitar el turno de este día</button></div>`;
  return h;
}
function openDay(k) {
  const d = fromKey(k);
  openSheet(`${cap(DOWL[dowIdx(d)])}, ${d.getDate()} de ${MON[d.getMonth()]}`, dayBody(k), `day:${k}`);
}
function refreshDay(k) { if (sheetKind === `day:${k}`) $('#sh-body').innerHTML = dayBody(k); render(); }
function changeDay(k, next, msg) {
  const before = days[k] ? { ...days[k] } : undefined;
  if (next) days[k] = next; else delete days[k];
  saveDay(k); refreshDay(k);
  toast(msg, () => { if (before) days[k] = before; else delete days[k]; saveDay(k); refreshDay(k); });
}

/* paste the roster */
let imp = null;
function importMonths() {
  const t = today(), out = [];
  const l = dataBounds().last;
  const end = new Date(l.getFullYear(), l.getMonth() + 1, 1);
  for (let d = monthStart(t); d <= end && out.length < 4; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push(d);
  return out;
}
function monthHasData(y, m) { const p = `${monthKey(y, m)}-`; return Object.keys(days).some((k) => k.startsWith(p)); }
function openImport(y, m) {
  if (y === undefined) {
    const free = importMonths().find((d) => !monthHasData(d.getFullYear(), d.getMonth()));
    const d = free || importMonths().at(-1);
    y = d.getFullYear(); m = d.getMonth();
  }
  imp = { y, m, text: '', parsed: null, start: 1 };
  openSheet('Pegar cuadrante', '', 'import');
  renderImport();
}
function renderImport() {
  const mn = MON[imp.m], n = daysIn(imp.y, imp.m);
  if (!imp.parsed) {
    $('#sh-body').innerHTML = `
      <div class="months" role="group" aria-label="Mes del cuadrante">${importMonths().map((d) => `<button class="press" data-im="${d.getFullYear()}-${d.getMonth()}" aria-pressed="${d.getFullYear() === imp.y && d.getMonth() === imp.m}">${cap(MON[d.getMonth()])} ${d.getFullYear()}</button>`).join('')}</div>
      <p class="hint">Pega el texto tal como te llega, con un día debajo de otro. Se usa la primera hora de cada turno, la de Canarias.</p>
      <textarea id="roster" spellcheck="false" autocapitalize="off" aria-label="Texto del cuadrante" placeholder="Support&#10;15:00-00:00&#10;DAY OFF&#10;PUBLIC HOLIDAY">${esc(imp.text)}</textarea>
      <div class="stack"><button class="btn primary full press" id="read"${imp.text.trim() ? '' : ' disabled'}>Leer cuadrante de ${mn}</button></div>`;
    return;
  }
  const items = imp.parsed, count = items.length;
  if (count < n) imp.start = Math.min(Math.max(1, imp.start), n - count + 1); else imp.start = 1;
  const fits = count >= 1 && imp.start + count - 1 <= n;
  const preview = {};
  items.forEach((it, i) => { if (imp.start + i <= n) preview[key(new Date(imp.y, imp.m, imp.start + i))] = it; });
  const c = {}; items.forEach((it) => { c[it.t] = (c[it.t] || 0) + 1; });
  const work = items.filter((it) => WORK(it.t)).length;
  const has = monthHasData(imp.y, imp.m);
  const lastDay = imp.start + count - 1;
  $('#sh-body').innerHTML = `<div class="result">
    <div class="counts">${count} ${count === 1 ? 'día' : 'días'}: ${work} ${work === 1 ? 'turno' : 'turnos'}, ${c.off || 0} ${c.off === 1 ? 'libre' : 'libres'}, ${c.hol || 0} ${c.hol === 1 ? 'festivo' : 'festivos'}</div>
    ${count > n ? `<div class="warn">El texto tiene ${count} días y ${mn} tiene ${n}. Revisa que no sobre ninguno.</div>` : ''}
    ${count === 0 ? '<div class="warn">No se ha encontrado ningún día. Revisa que el texto sea el del cuadrante.</div>' : ''}
    ${c.other ? `<div class="warn">${c.other} ${c.other === 1 ? 'turno no coincide' : 'turnos no coinciden'} con tus horarios. Se guardan con su propia hora.</div>` : ''}
    ${count && count < n ? `<div class="stepper"><span><b>Empieza el día</b><br><span class="hint tight">Termina el ${lastDay} de ${mn}</span></span>
      <span class="ctl"><button class="press" data-step="-1" aria-label="Un día antes"${imp.start <= 1 ? ' disabled' : ''}>${ico('minus')}</button><output aria-live="polite">${imp.start}</output><button class="press" data-step="1" aria-label="Un día después"${imp.start + count - 1 >= n ? ' disabled' : ''}>${ico('plus')}</button></span></div>` : ''}
    ${wkHTML(' flush')}${gridHTML(imp.y, imp.m, true, preview)}
    <div class="stack"><button class="btn primary full press" id="save"${fits ? '' : ' disabled'}>${has ? 'Reemplazar' : 'Guardar'} ${mn}</button>
    <button class="btn secondary full press" id="back">Volver al texto</button></div></div>`;
}
function saveImport() {
  const n = daysIn(imp.y, imp.m), changed = [], before = {};
  // A pasted month replaces the days it covers; office/transport marks on those days are kept.
  imp.parsed.forEach((it, i) => {
    const d = imp.start + i; if (d > n) return;
    const k = key(new Date(imp.y, imp.m, d));
    before[k] = days[k] ? { ...days[k] } : undefined;
    const keep = days[k] && WORK(it.t) ? { loc: days[k].loc, via: days[k].via } : {};
    days[k] = { ...it, ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v)) };
    changed.push(k);
  });
  saveDays(changed);
  const mn = MON[imp.m];
  closeSheet(); ui.tab = 'month'; ui.month = new Date(imp.y, imp.m, 1); store.set('daylo-tab', ui.tab); render();
  toast(`${cap(mn)} guardado`, () => { for (const k of changed) { if (before[k]) days[k] = before[k]; else delete days[k]; } saveDays(changed); render(); });
}

function openWipe() {
  const months = [...new Set(Object.keys(days).map((k) => k.slice(0, 7)))].sort();
  const html = months.length
    ? `<p class="hint">Elige el mes. Podrás deshacerlo justo después.</p><div class="stack first">${months.map((mk) => { const [y, m] = mk.split('-').map(Number); return `<button class="btn secondary full press" data-wipe="${mk}">Borrar ${MON[m - 1]} ${y}</button>`; }).join('')}</div>`
    : '<p class="hint">No hay turnos guardados.</p>';
  openSheet('Borrar los turnos de un mes', html, 'wipe');
}
function confirmWipe(mk) {
  const [y, m] = mk.split('-').map(Number);
  $('#sh-title').textContent = `¿Borrar ${MON[m - 1]}?`;
  $('#sh-body').innerHTML = `<p class="hint">Se quitan todos los turnos de ${MON[m - 1]} ${y}, también los días de oficina.</p><div class="confirm-actions"><button class="btn secondary press" id="keep">No, mantener</button><button class="btn danger press" data-dowipe="${mk}">Sí, borrar</button></div>`;
}
function confirmIcalOff() {
  openSheet('¿Quitar los turnos de Calendario?', `<p class="hint">El calendario suscrito dejará de recibir tus turnos. Si lo vuelves a activar, tendrás que añadirlo de nuevo.</p><div class="confirm-actions"><button class="btn secondary press" id="keep">No, mantener</button><button class="btn danger press" id="ical-off">Sí, quitar</button></div>`, 'ical');
}

/* ---------- events ---------- */
function step(dir) {
  if (ui.tab === 'week') { const n = addDays(ui.week, 7 * dir); if (n < minWeek() || n > maxWeek()) return; ui.week = n; }
  else if (ui.tab === 'month') { const n = new Date(ui.month.getFullYear(), ui.month.getMonth() + dir, 1); if (n < minMonth() || n > maxMonth()) return; ui.month = n; }
  render();
}

$('#app').addEventListener('click', async (e) => {
  const chk = e.target.closest('.chk');
  if (chk && !e.target.closest('button')) { togglePack(chk.dataset.pack); return; }
  const t = e.target.closest('button'); if (!t || t.disabled) return;
  if (t.closest('#f-login')) return;
  if (t.dataset.tab) { ui.tab = t.dataset.tab; ui.packEdit = false; store.set('daylo-tab', ui.tab); render(); $('#view').scrollTop = 0; return; }
  if (t.id === 'prev' || t.id === 'next') { step(t.id === 'next' ? 1 : -1); return; }
  if (t.id === 'today') { ui.week = monday(today()); ui.month = monthStart(today()); render(); return; }
  if (t.dataset.day) { openDay(t.dataset.day); return; }
  if (t.dataset.set) {
    const k = t.dataset.key, cur = days[k]; if (cur && cur.t === t.dataset.set) return;
    const next = { ...(cur || {}), t: t.dataset.set }; delete next.s; delete next.e;
    if (!WORK(next.t)) { delete next.loc; delete next.via; }
    changeDay(k, next, `Cambiado a ${TYPES[t.dataset.set].name}`); return;
  }
  if (t.dataset.clear) { changeDay(t.dataset.clear, null, 'Turno quitado'); return; }
  if (t.dataset.loc) {
    const k = t.dataset.key, next = { ...days[k] };
    if (t.dataset.loc === 'office') { if (next.loc === 'office') return; next.loc = 'office'; } else { if (next.loc !== 'office') return; delete next.loc; delete next.via; }
    changeDay(k, next, t.dataset.loc === 'office' ? 'Día en la oficina' : 'Día en casa'); return;
  }
  if (t.dataset.via) {
    const k = t.dataset.key; if (days[k]?.via === t.dataset.via) return;
    changeDay(k, { ...days[k], via: t.dataset.via }, `Vas en ${VIA[t.dataset.via].name.toLowerCase()}`); return;
  }
  if (t.dataset.import) {
    if (t.dataset.import === 'next') openImport();
    else { const [y, m] = t.dataset.import.split('-').map(Number); openImport(y, m); }
    return;
  }
  if (t.dataset.im) { const [y, m] = t.dataset.im.split('-').map(Number); imp.y = y; imp.m = m; renderImport(); return; }
  if (t.id === 'read') { imp.text = $('#roster').value; imp.parsed = parseRoster(imp.text, Object.fromEntries(['early', 'mid', 'late'].map((k) => [k, { s: TYPES[k].s, e: TYPES[k].e }]))); imp.start = 1; renderImport(); return; }
  if (t.dataset.step) { imp.start += Number(t.dataset.step); renderImport(); return; }
  if (t.id === 'back') { imp.parsed = null; renderImport(); return; }
  if (t.id === 'save') { saveImport(); return; }
  if (t.id === 'ical') {
    if (ical.on) { confirmIcalOff(); return; }
    try { ical = await api('POST', '/api/ical', { on: true }); render(); toast('Listo. Toca Añadir al Calendario'); } catch { toast('No se pudo activar. Inténtalo de nuevo.'); }
    return;
  }
  if (t.id === 'ical-off') {
    try { ical = await api('POST', '/api/ical', { on: false }); closeSheet(); render(); toast('Turnos quitados de Calendario'); } catch { toast('No se pudo quitar. Inténtalo de nuevo.'); }
    return;
  }
  if (t.id === 'ical-copy') {
    try { await navigator.clipboard.writeText(ical.url); toast('Enlace copiado'); } catch { toast('No se pudo copiar el enlace'); }
    return;
  }
  if (t.dataset.mode) { ui.mode = t.dataset.mode; store.set('daylo-mode', ui.mode); applyTheme(); saveSetting('tema', { mode: ui.mode }); render(); return; }
  if (t.id === 'credits') { ui.credits = !ui.credits; render(); return; }
  if (t.id === 'logout') {
    try { await api('POST', '/api/auth/logout'); } catch { /* signed out locally anyway */ }
    showLogin(); return;
  }
  if (t.id === 'wipe') { openWipe(); return; }
  if (t.dataset.wipe) { confirmWipe(t.dataset.wipe); return; }
  if (t.id === 'keep') { closeSheet(); return; }
  if (t.dataset.dowipe) {
    const mk = t.dataset.dowipe, [, m] = mk.split('-').map(Number), before = {};
    for (const k of Object.keys(days)) if (k.startsWith(`${mk}-`)) { before[k] = days[k]; delete days[k]; }
    const ks = Object.keys(before);
    saveDays(ks); closeSheet(); render();
    toast(`${cap(MON[m - 1])} borrado`, () => { Object.assign(days, before); saveDays(ks); render(); });
    return;
  }
  if (t.id === 'pack-edit') { ui.packEdit = !ui.packEdit; render(); return; }
  if (t.dataset.del) {
    const i = pack.findIndex((p) => p.id === t.dataset.del), item = pack[i];
    pack.splice(i, 1); deletePack(item); render();
    toast(`${item.name} quitado`, () => { pack.splice(i, 0, item); savePack(item); render(); });
    return;
  }
  if (t.id === 'pack-reset') {
    const was = pack.filter((p) => p.done);
    was.forEach((p) => { p.done = false; savePack(p); }); render();
    toast('Lista desmarcada', () => { was.forEach((p) => { p.done = true; savePack(p); }); render(); });
  }
});

function togglePack(id) {
  const p = pack.find((x) => x.id === id); if (!p) return;
  p.done = !p.done; savePack(p);
  const q = $('#newitem')?.value || '';
  render();
  if (q) { $('#newitem').value = q; filterPack(); }
}
$('#app').addEventListener('keydown', (e) => {
  const c = e.target.closest?.('.chk');
  if (c && e.target === c && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); togglePack(c.dataset.pack); }
});
$('#app').addEventListener('submit', (e) => {
  if (e.target.id !== 'addform') return;
  e.preventDefault();
  const v = $('#newitem').value.trim().slice(0, 80);
  if (!v || pack.some((p) => norm(p.name) === norm(v))) return;
  const item = { id: uid(), name: v, done: false, creado: Date.now() };
  pack.push(item); savePack(item); render();
  keepTyping(item.id);
  toast(`${v} añadido`, () => { pack.splice(pack.indexOf(item), 1); deletePack(item); render(); });
});
/**
 * After adding an item: the field keeps the focus (and the keyboard stays up), the field sits
 * at the top of the visible list, and the new item is shown if it fits below it.
 */
function keepTyping(newId) {
  const field = $('#newitem');
  if (!field) return;
  field.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    const view = $('#view'), form = $('#addform');
    const row = newId && document.querySelector(`.chk[data-pack="${CSS.escape(newId)}"]`);
    const pad = parseFloat(getComputedStyle(view).scrollPaddingTop) || 0;
    const top = (el) => el.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop;
    const fieldTop = Math.max(0, top(form) - pad);
    // Scroll just enough to show the new item, but never past the field.
    const need = row ? top(row) + row.offsetHeight - view.clientHeight : view.scrollTop;
    view.scrollTop = Math.min(fieldTop, Math.max(view.scrollTop, need));
  });
}
$('#app').addEventListener('focusin', (e) => {
  // The search field stays in view above the keyboard (and below a top toast).
  if (e.target.id === 'newitem') setTimeout(() => e.target.scrollIntoView({ block: 'nearest' }), 300);
});
$('#app').addEventListener('input', (e) => {
  if (e.target.id === 'newitem') { filterPack(); return; }
  if (e.target.id === 'roster') { imp.text = e.target.value; const b = $('#read'); if (b) b.disabled = !imp.text.trim(); }
});
$('#app').addEventListener('change', (e) => {
  const el = e.target;
  if (el.type !== 'time' || !el.dataset.k) return;
  if (!/^\d{2}:\d{2}$/.test(el.value)) { el.value = TYPES[el.dataset.k][el.dataset.f]; return; }
  const k = el.dataset.k, f = el.dataset.f, before = TYPES[k][f];
  if (before === el.value) return;
  TYPES[k][f] = el.value; saveTipo(k);
  toast(`${TYPES[k].name}: ${TYPES[k].s}–${TYPES[k].e}`, () => { TYPES[k][f] = before; saveTipo(k); render(); });
});

/* Swipe is an extra; the arrows are always there. */
let sx = null, sy = null;
$('#view').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
$('#view').addEventListener('touchend', (e) => {
  if (sx === null || (ui.tab !== 'week' && ui.tab !== 'month')) { sx = null; return; }
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  sx = null;
});

// A day can change while the app sits open (midnight): refresh "today" when it comes back.
let shownDay = key(today());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !me) return;
  if (key(today()) !== shownDay) { shownDay = key(today()); ui.week = monday(today()); ui.month = monthStart(today()); }
  loadData().then(render).catch(() => {});
});

/* ---------- sign-in ---------- */
let loginMode = 'entrar';
function showLogin() {
  me = null;
  closeSheet();
  $('#login').hidden = false; $('#main').hidden = true; $('#boot').hidden = true;
  renderLogin();
}
function renderLogin() {
  const alta = loginMode === 'alta';
  $('#login-name-wrap').hidden = !alta;
  $('#login-pass').setAttribute('autocomplete', alta ? 'new-password' : 'current-password');
  $('#login-go').textContent = alta ? 'Crear cuenta' : 'Entrar';
  $('#login-switch').textContent = alta ? 'Ya tengo cuenta' : 'Crear una cuenta';
  $('#login-err').hidden = true;
  loginValid();
}
const loginValid = () => { $('#login-go').disabled = !($('#login-user').value.trim() && $('#login-pass').value); };
['#login-user', '#login-pass'].forEach((s) => $(s).addEventListener('input', loginValid));
$('#login-switch').addEventListener('click', () => { loginMode = loginMode === 'alta' ? 'entrar' : 'alta'; renderLogin(); });
$('#f-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('#login-go').disabled) return;
  const alta = loginMode === 'alta';
  const body = { username: $('#login-user').value.trim(), password: $('#login-pass').value };
  if (alta) body.displayName = $('#login-name').value.trim();
  $('#login-go').disabled = true;
  const err = $('#login-err');
  try {
    await api('POST', alta ? '/api/auth/signup' : '/api/auth/login', body);
    $('#login-pass').value = '';
    await start();
  } catch (ex) {
    err.textContent = ex.status === 429 ? 'Demasiados intentos. Prueba de nuevo dentro de 15 minutos.'
      : ex.status === 409 ? 'Ese usuario ya existe. Elige otro.'
      : ex.status === 400 && alta ? 'Revisa los datos: la contraseña necesita al menos 4 caracteres.'
      : ex.status === 401 ? 'Usuario o contraseña incorrectos.'
      : 'No hay conexión con el servidor. Prueba de nuevo en un momento.';
    err.hidden = false;
    loginValid();
  }
});

async function start() {
  try {
    const { user } = await api('GET', '/api/auth/me');
    if (!user) return showLogin();
    me = user;
    await loadData();
  } catch (err) {
    if (err.status === 401) return showLogin();
    $('#boot').textContent = 'No hay conexión con el servidor. Vuelve a abrir la app en un momento.';
    return;
  }
  $('#login').hidden = true; $('#boot').hidden = true; $('#main').hidden = false;
  render();
}
start();
