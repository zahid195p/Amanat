// State, helpers, Firebase wiring, UI primitives (toast, sheets, history) and all data writes.
import { initializeApp, deleteApp } from 'firebase/app';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED,
  connectFirestoreEmulator, collection, doc, query, where, onSnapshot, setDoc, updateDoc, deleteDoc,
  getDoc, getDocs, writeBatch, runTransaction, increment, waitForPendingWrites, deleteField, getFirestore, memoryLocalCache,
} from 'firebase/firestore';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator,
  signInWithCustomToken, signOut, onAuthStateChanged, inMemoryPersistence,
} from 'firebase/auth';
import { firebaseConfig } from './firebase-config.js';
import { FIELDS, phoneKey, fmtPhone, SVC_ORDER } from './parse.js';
import { envOfHost } from './env.js';

export const SPACE = envOfHost(location.hostname); // 'live' on the real site, 'test' anywhere else

export { fmtPhone };
export const GC = ['#D99A00', '#2D6FC7', '#C3362B', '#1E8757', '#8440A8', '#C75B12', '#12918F', '#6D4C41', '#C2185B', '#4F6475'];
export const PROFILE_COLORS = ['#2D6FC7', '#1E8757', '#C3362B', '#8440A8', '#C75B12', '#12918F', '#D99A00', '#C2185B'];
export const STEPS = [['arrived', 'Arrived'], ['packed', 'Packed'], ['booked', 'Booked'], ['sent', 'Sent'], ['delivered', 'Delivered']];
export const ROLE_LABEL = { dev: 'Developer', owner: 'Owner', dispatcher: 'Dispatcher', client: 'Client', passenger: 'Passenger' };
// What a dispatcher may do. The owner and developer may do everything.
const DISPATCHER_CAN = { upload: true, name: true, send: true, ai: true, group: true };
// Receiver details live in a separate locked document (groupsPrivate) until the owner releases them.
export const PRIVATE_FIELDS = ['name', 'phone', 'phone2', 'address', 'raw'];
// Also in the locked document: the client this parcel belongs to, and what that client may see.
const PRIVATE_EXTRA = ['cid', 'slipOk', 'pickOk'];
export const DEFAULT_WA = 'Assalam o Alaikum {name}. Your parcel was sent by {service}, tracking # {tracking}, {pieces} pieces.';
export const DEFAULT_TRACK = {
  TCS: 'https://www.tcsexpress.com/track/{n}',
  Leopards: 'https://www.leopardscourier.com/leopards-tracking?cn={n}',
  Daewoo: 'https://fastex.pk/track-shipment?cn={n}',
};
export const FREE_BYTES = 1024 * 1024 * 1024; // Firestore Spark: 1 GiB stored

/* ---------- state ---------- */
export const S = {
  ready: false, configured: !!firebaseConfig.projectId, fatal: null,
  user: undefined, me: null, people: [], setup: null, real: null,
  cfg: {}, flights: [], flightsLoaded: false, flightsFromCache: true,
  fid: null, items: [], groups: [], trips: [], expenses: [], left: [], leftItems: [], itemsLoaded: false, portal: null,
  tab: 'photos', show: null, sel: new Set(), lastSel: null, q: '',
  gf: { city: '', service: '', status: 'open', sort: 'parcel' },
  uq: [], gridLimit: 120, hidden: new Set(), inflight: 0, pendingDocs: 0, online: navigator.onLine,
  showSent: false, openSent: null, loginPick: null, dash: false,
};
try {
  S.fid = localStorage.getItem('amanat3.fid') || null;
  S.tab = localStorage.getItem('amanat3.tab') || 'photos';
  S.aiLocalOff = localStorage.getItem('amanat3.aiOff') === '1';
} catch (e) { /* storage blocked */ }

/* ---------- helpers ---------- */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const rid = () => Date.now().toString(36) + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => (b % 36).toString(36)).join('');
export const now = () => Date.now();
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : /(s|sh|ch|x)$/.test(w) ? 'es' : 's'}`;
export const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
export const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
export function fmtDate(d) { if (!d) return ''; const x = new Date(d + 'T00:00:00'); return isNaN(x) ? d : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
export function fmtTime(t) { if (!t) return ''; const d = new Date(t); return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
export function fmtBytes(b) { b = Math.max(0, b || 0); if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB'; if (b < 1024 ** 3) return (b / 1024 / 1024).toFixed(1) + ' MB'; return (b / 1024 ** 3).toFixed(2) + ' GB'; }
/* Flights land in Pakistan, so landing times are always typed and shown in Pakistan time,
   wherever the phone is (the owner is often in China). */
export const landAtOf = (date, time) => { const t = Date.parse(`${date}T${time || ''}:00+05:00`); return date && time && !isNaN(t) ? t : null; };
const PKT = { timeZone: 'Asia/Karachi' };
export const fmtClock = (ms) => (ms ? new Date(ms).toLocaleTimeString('en-GB', { ...PKT, hour: '2-digit', minute: '2-digit' }) : '');
export const fmtLanding = (ms) => (ms ? new Date(ms).toLocaleString('en-GB', { ...PKT, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' (Pakistan time)' : '');
export const timeOfPk = (ms) => (ms ? new Date(ms + 5 * 3600000).toISOString().slice(11, 16) : '');
export function fmtIn(ms) {
  const d = ms - Date.now(); const m = Math.round(Math.abs(d) / 60000);
  const t = m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.round(m / 1440)} days`;
  return d >= 0 ? 'in ' + t : t + ' ago';
}
export const AUTO_CHOICES = [[null, 'Only when I release it'], [0, 'At landing time'], [10, '10 minutes before landing'], [20, '20 minutes before landing'], [30, '30 minutes before landing'], [60, '1 hour before landing']];
export const dueAtOf = (auto, landAt) => (auto === null || auto === undefined || !landAt ? null : landAt - auto * 60000);
export const isAdmin = () => S.me?.role === 'dev' || S.me?.role === 'owner'; // "boss": sees and does everything
export const isDispatcher = () => S.me?.role === 'dispatcher';
export const isStaff = () => isAdmin() || isDispatcher();
export const can = (p) => isAdmin() || (isDispatcher() && !!DISPATCHER_CAN[p]);
export const curFlight = () => S.flights.find((f) => f.id === S.fid) || null;
export const groupById = (id) => (id ? S.groups.find((g) => g.id === id) || S.left.find((g) => g.id === id) || null : null);
export const gColor = (g) => GC[(g?.ci || 0) % GC.length];
export const gTitle = (g) => (g ? (g.locked ? 'Receiver hidden' : g.name || 'No name yet') : '');
// Parcel number, written on the box while packing: P1, P2… per flight ("P~3" until it syncs).
export const pLabel = (g) => (!g ? '' : g.pn ? 'P' + g.pn : 'P~' + (g.ptmp || '?'));
export const gLabel = (g) => (g ? `${pLabel(g)} ${gTitle(g)}` : '');
export const visItems = () => S.items.filter((i) => !S.hidden.has(i.id));
// A parcel's items, including those of earlier parcels sent together with it.
export const itemsIn = (gid) => {
  const own = visItems().filter((i) => i.groupId === gid);
  const g = S.groups.find((x) => x.id === gid) || S.left.find((x) => x.id === gid);
  const joined = g?.joined?.length ? S.leftItems.filter((i) => g.joined.includes(i.groupId)) : [];
  if (!own.length && S.left.some((x) => x.id === gid)) return S.leftItems.filter((i) => i.groupId === gid);
  return joined.length ? [...own, ...joined] : own;
};
export const flightLabel = (fid) => S.flights.find((f) => f.id === fid)?.label || 'an earlier flight';
export const ungrouped = () => visItems().filter((i) => !groupById(i.groupId));
export const active = () => S.groups.filter((g) => !g.done);
export const sentGroups = () => S.groups.filter((g) => g.done);
export const toSend = () => visItems().filter((i) => !groupById(i.groupId)?.done);
export const qtyOf = (i) => (Number(i.qty) > 0 ? Number(i.qty) : 1);
export const piecesIn = (gid) => itemsIn(gid).reduce((s, i) => s + qtyOf(i), 0);
export const numLabel = (i) => (i.fid && S.fid && i.fid !== S.fid ? flightLabel(i.fid) + ' ' : '') + (i.n ? '#' + i.n : '#~' + (i.tmp || '?'));
export const itemLabel = (i) => (i.fid && S.fid && i.fid !== S.fid && i.name ? flightLabel(i.fid) + ' · ' : '') + (i.name || 'Item ' + numLabel(i)) + (Number(i.qty) > 1 ? ' ×' + i.qty : '');
export const profName = (uid) => S.people.find((p) => p.id === uid)?.name || (uid === S.me?.uid ? S.me?.name : '') || '';
// Only genuine image data may go into the page (a crafted "photo" must never become code).
export const safeImg = (t) => (typeof t === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(t) ? t : '');
export const mainSvc = (s) => String(s || '').split('/')[0].trim();
export function svcKey(s) { const t = mainSvc(s); return t || 'No service yet'; }
export function svcSort(a, b) {
  const ia = SVC_ORDER.indexOf(a), ib = SVC_ORDER.indexOf(b);
  if (a === 'No service yet') return 1; if (b === 'No service yet') return -1;
  return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib) || a.localeCompare(b);
}
export function missing(g) {
  const m = [];
  if (g.locked) return m;
  if (!g.name) m.push('name');
  if (!String(g.phone || '').replace(/\D/g, '')) m.push('phone');
  if (!g.address) m.push('address');
  if (!g.service) m.push('service');
  if (g.service && !/pickup|indrive|yango|bike/i.test(g.service) && !g.city) m.push('city');
  return m;
}
export function trackUrl(g) {
  const t = String(g.tracking || '').trim(); if (!t) return '';
  const tpl = { ...DEFAULT_TRACK, ...(S.cfg.trackUrls || {}) }[mainSvc(g.service)];
  return tpl ? tpl.replace('{n}', encodeURIComponent(t)) : '';
}
export function waMessage(g) {
  let t = S.cfg.waTemplate || DEFAULT_WA;
  if (!String(g.tracking || '').trim()) t = t.replace(/,?\s*tracking\s*#?\s*\{tracking\}/i, '');
  const v = { name: g.name || '', service: g.service || 'courier', tracking: g.tracking || '', pieces: piecesIn(g.id), city: g.city || '', weight: g.weight || '', sender: S.cfg.sender || '' };
  return t.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
}

/* ---------- toast & undo ---------- */
export function toast(msg, opts = {}) {
  const t = document.createElement('div'); t.className = 'toast' + (opts.undo ? ' has-undo' : '');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  const ms = opts.ms || (opts.undo ? 6000 : 2800);
  let done = false;
  const finish = (undone) => { if (done) return; done = true; t.remove(); (undone ? opts.undo : opts.commit)?.(); };
  if (opts.undo) {
    const b = document.createElement('button'); b.className = 'undo'; b.textContent = 'Undo';
    b.onclick = () => finish(true); t.appendChild(b);
  }
  $('#toasts').appendChild(t);
  const timer = setTimeout(() => finish(false), ms);
  if (opts.undo) UNDO.push({ finish, timer });
  return t;
}
const UNDO = [];
// Commit every pending undo-able action right away (page closing, profile switch).
export function commitUndos() { while (UNDO.length) { const u = UNDO.pop(); clearTimeout(u.timer); u.finish(false); } }
addEventListener('pagehide', commitUndos);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { commitUndos(); flushAll(); } });

/* ---------- history-aware layers (sheets, counter) — B11 ---------- */
const layers = [];
let ignorePop = 0, needPush = false;
export function pushLayer(close) {
  layers.push(close);
  document.body.classList.add('noscroll');
  if (ignorePop) needPush = true; else history.pushState({ amanatLayer: layers.length }, '');
}
function popLayerNow() {
  const c = layers.pop(); try { c?.(); } catch (e) { console.warn(e); }
  if (!layers.length) document.body.classList.remove('noscroll');
}
export function closeTop() {
  if (!layers.length) return;
  popLayerNow();
  ignorePop++; history.back();
}
export const layerCount = () => layers.length;
addEventListener('popstate', () => {
  if (ignorePop) {
    ignorePop--;
    if (!ignorePop && needPush) { needPush = false; if (layers.length) history.pushState({ amanatLayer: layers.length }, ''); }
    return;
  }
  if (layers.length) { popLayerNow(); schedule(); }
});

/* ---------- sheets ---------- */
export function sheet(title, body, opts = {}) {
  const w = document.createElement('div'); w.className = 'sheet-wrap';
  w.innerHTML = `<div class="scrim" data-act="closeSheet"></div><div class="sheet ${opts.cls || ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sh-h"><h2>${esc(title)}</h2><button class="x" data-act="closeSheet">Close</button></div><div class="sh-b">${body}</div></div>`;
  $('#sheets').appendChild(w);
  const sh = w.querySelector('.sheet');
  pushLayer(() => { try { opts.onClose?.(); } catch (e) { console.warn(e); } w.remove(); });
  return sh;
}
export const closeSheet = () => { if ($('#sheets').lastElementChild) closeTop(); };
export function closeAll() { while (layers.length) closeTop(); }
export function choose(title, text, buttons) {
  return new Promise((res) => {
    let done = false;
    const sh = sheet(title, `<p>${esc(text)}</p><div class="row" style="justify-content:flex-end">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-ch="${i}">${esc(b.label)}</button>`).join('')}</div>`, { onClose: () => { if (!done) { done = true; res(null); } } });
    sh.querySelectorAll('[data-ch]').forEach((el) => (el.onclick = () => { done = true; res(buttons[Number(el.dataset.ch)].v); closeSheet(); }));
  });
}
export const ask = (text, ok = 'Delete') => choose('Are you sure?', text, [{ label: 'Cancel', v: false }, { label: ok, v: true, cls: 'danger' }]);

/* ---------- render scheduling (set by views) ---------- */
let renderFn = () => {};
export const setRender = (fn) => (renderFn = fn);
let rq = false;
export const DRAG = { active: false, pending: false, justEnded: false };
export function schedule() {
  if (rq) return; rq = true;
  requestAnimationFrame(() => { rq = false; if (DRAG.active) { DRAG.pending = true; return; } renderFn(); });
}

/* ---------- Firebase ---------- */
export let db = null, auth = null;
const EMU = import.meta.env.VITE_EMULATORS === '1';
// Private tabs (and some in-app browsers) block the on-device database. The app then still
// works, but keeps nothing after the tab is closed.
export async function storageWorks() {
  try {
    if (!('indexedDB' in window)) return false;
    return await Promise.race([
      new Promise((res) => { const r = indexedDB.open('amanat-probe'); r.onsuccess = () => { try { r.result.close(); } catch (e) { /* ignore */ } res(true); }; r.onerror = () => res(false); r.onblocked = () => res(false); }),
      new Promise((res) => setTimeout(() => res(false), 2500)),
    ]);
  } catch (e) { return false; }
}
export function initFirebase(persist = true) {
  if (!S.configured && !EMU) return false;
  S.noStore = !persist;
  const app = initializeApp(EMU ? { apiKey: 'demo', projectId: 'demo-amanat', appId: 'demo' } : firebaseConfig);
  db = initializeFirestore(app, { localCache: persist ? persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: CACHE_SIZE_UNLIMITED }) : memoryLocalCache() });
  auth = initializeAuth(app, { persistence: persist ? [indexedDBLocalPersistence, browserLocalPersistence] : [browserLocalPersistence, inMemoryPersistence] });
  if (EMU) { useEmulators(db, auth); S.configured = true; }
  main = { db, auth };
  return true;
}
function useEmulators(d, a) {
  connectFirestoreEmulator(d, location.hostname, 8080);
  connectAuthEmulator(a, `http://${location.hostname}:9099`, { disableWarnings: true });
}
let main = null, viewApp = null;
export const realAuth = () => main?.auth || auth; // the person really logged in on this device
let onMe = () => {};
export const setOnMe = (fn) => (onMe = fn); // called when the person on screen changes (view as)
/* ---------- view as ----------
   A second, separate sign-in with a read-only token for that person. The screen then shows
   exactly what the database rules let them see; nothing can be changed while viewing. */
export async function enterViewAs(token, person, acting = false) {
  flushAll(); commitUndos(); unsubscribeAll();
  viewApp = initializeApp(EMU ? { apiKey: 'demo', projectId: 'demo-amanat', appId: 'demo' } : firebaseConfig, 'view-' + Date.now());
  const vdb = initializeFirestore(viewApp, { localCache: memoryLocalCache() });
  const vauth = initializeAuth(viewApp, { persistence: inMemoryPersistence });
  if (EMU) useEmulators(vdb, vauth);
  await signInWithCustomToken(vauth, token);
  db = vdb; auth = vauth;
  if (S.real) { S.me = S.real; S.real = null; }
  S.real = S.me; S.me = { uid: person.id, role: person.role, name: person.name, viewAs: !acting, acting };
  resetData(); if (isStaff()) subscribeBase(); onMe(); schedule();
}
export async function exitViewAs() {
  if (!S.real) return;
  unsubscribeAll();
  const app = viewApp; viewApp = null;
  db = main.db; auth = main.auth;
  S.me = S.real; S.real = null;
  resetData(); subscribeBase(); schedule();
  try { await deleteApp(app); } catch (e) { /* ignore */ }
}
function resetData() {
  S.flights = []; S.flightsLoaded = false; S.items = []; S.groups = []; S.trips = []; S.portal = null; S.people = []; S.cfg = {}; S.sel.clear(); S.uq = []; S.fid = main && db === main.db ? S.fid : null;
}
const viewing = () => { if (S.me?.viewAs) { toast('You are only viewing. Nothing was changed.'); return true; } return false; };
export { onAuthStateChanged, signInWithCustomToken, signOut, waitForPendingWrites };
export const D = (path) => doc(db, 'apps/' + SPACE + '/' + path);
export const C = (name) => collection(db, 'apps', SPACE, name);

// Every write: fire and forget, counted for the sync pill, never awaited by the UI.
export function w(p, what) {
  S.inflight++; schedule();
  Promise.resolve(p).then(() => {}, (e) => {
    console.warn(what || 'write', e);
    if (e?.code === 'permission-denied') toast('Not allowed for your profile. The change was undone.');
    else if (e?.code === 'resource-exhausted') toast('The free daily limit was reached. Try again tomorrow.');
    else toast('A change could not be saved: ' + (e?.message || e));
  }).finally(() => { S.inflight = Math.max(0, S.inflight - 1); schedule(); });
  return p;
}
// Group writes are split: receiver details go to the locked groupsPrivate document.
function splitGroup(data) {
  const pub = {}, priv = {};
  for (const [k, v] of Object.entries(data)) (PRIVATE_FIELDS.includes(k) || PRIVATE_EXTRA.includes(k) ? priv : pub)[k] = v;
  return [pub, priv];
}
const isGroup = (path) => path.startsWith('groups/');
export const upd = (path, data) => {
  if (viewing()) return;
  if (!isGroup(path)) return w(updateDoc(D(path), data), 'update ' + path);
  const [pub, priv] = splitGroup(data);
  if (Object.keys(pub).length) w(updateDoc(D(path), pub), 'update ' + path);
  if (Object.keys(priv).length) w(updateDoc(D('groupsPrivate/' + path.slice(7)), priv), 'update private ' + path);
};
export const put = (path, data) => {
  if (viewing()) return;
  if (!isGroup(path)) return w(setDoc(D(path), data), 'set ' + path);
  const [pub, priv] = splitGroup(data);
  w(setDoc(D(path), pub), 'set ' + path);
  // A parcel a dispatcher types in is visible to that dispatcher; the owner shares the rest.
  w(setDoc(D('groupsPrivate/' + path.slice(7)), { fid: pub.fid, dids: pub.dids || [], released: false, rel: isDispatcher() ? [S.me.uid] : [], ...priv }), 'set private ' + path);
};
export const del = (path) => {
  if (viewing()) return;
  if (isGroup(path)) w(deleteDoc(D('groupsPrivate/' + path.slice(7))), 'delete private ' + path);
  return w(deleteDoc(D(path)), 'delete ' + path);
};
export { increment, deleteField, getDoc, getDocs, collection, query, where, writeBatch, doc, setDoc, updateDoc, runTransaction };

/* ---------- debounced field saves (name/qty typing) — B12 ---------- */
const pend = new Map();
export function saveLater(path, patch, ms = 500) {
  let p = pend.get(path); if (!p) { p = { data: {}, t: null }; pend.set(path, p); }
  Object.assign(p.data, patch); clearTimeout(p.t); p.t = setTimeout(() => flush(path), ms);
}
export function flush(path) {
  const p = pend.get(path); if (!p) return; clearTimeout(p.t); pend.delete(path);
  if (Object.keys(p.data).length) upd(path, p.data);
}
export const flushAll = () => [...pend.keys()].forEach(flush);

/* ---------- activity log ---------- */
export function logEv(text, fid = S.fid) {
  if (!fid || !S.me || S.me.viewAs) return;
  put('log/' + rid(), { fid, at: now(), by: S.me.uid, text: `${S.me.name} ${text}` });
}

/* ---------- subscriptions ---------- */
let unsubBase = [], unsubF = [];
// Data is cleaned as it arrives: odd ids are dropped and numbers must be numbers, so nothing
// a person saved can ever turn into code on someone else's screen.
const OK_ID = /^[A-Za-z0-9_-]{1,80}$/;
const docsOf = (q) => q.docs.filter((d) => OK_ID.test(d.id)).map((d) => {
  const o = { id: d.id, ...d.data(), _pending: d.metadata.hasPendingWrites };
  for (const k of ['n', 'tmp', 'pn', 'ptmp', 'ci']) if (k in o && !(typeof o[k] === 'number' && isFinite(o[k]))) o[k] = null;
  if (o.photos && !Array.isArray(o.photos)) o.photos = [];
  return o;
});
// The owner sees every flight; a dispatcher only the flights they are on.
const mineOnly = () => where('dids', 'array-contains', S.me.uid);
export function subscribeBase() {
  unsubBase.forEach((u) => u()); unsubBase = [];
  unsubBase.push(onSnapshot(D('config/main'), (s) => { S.cfg = s.exists() ? s.data() : {}; schedule(); }, dbErr));
  unsubBase.push(onSnapshot(isAdmin() ? C('flights') : query(C('flights'), mineOnly()), { includeMetadataChanges: true }, (q) => {
    S.flights = docsOf(q).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.at || 0) - (a.at || 0));
    S.flightsLoaded = true; S.flightsFromCache = q.metadata.fromCache;
    pickFlight(); schedule();
  }, dbErr));
  if (isAdmin()) unsubBase.push(onSnapshot(C('people'), (q) => {
    S.people = docsOf(q).sort((a, b) => (a.at || 0) - (b.at || 0));
    const p = S.people.find((x) => x.id === S.me?.uid); if (p && S.me) S.me.name = p.name;
    schedule();
  }, dbErr));
}
export function unsubscribeAll() {
  unsubBase.forEach((u) => u()); unsubBase = [];
  unsubF.forEach((u) => u()); unsubF = []; S.subbed = undefined;
}
function dbErr(e) {
  console.warn(e);
  if (e?.code === 'permission-denied') { S.fatal = null; toast('Your login has expired. Log in again.'); }
}
function pickFlight() {
  let f = S.fid; if (!S.flights.some((x) => x.id === f)) f = S.flights.find((x) => !x.deleting)?.id || null;
  if (f !== S.subbed) setFlight(f);
}
export function setFlight(fid) {
  flushAll(); commitUndos(); // B12
  S.fid = fid; S.subbed = fid; if (!S.me?.viewAs) lsSet('amanat3.fid', fid); S.sel.clear(); S.show = null; S.gridLimit = 120;
  unsubF.forEach((u) => u()); unsubF = []; S.items = []; S.groups = []; S.itemsLoaded = false;
  gPub = []; gPriv = new Map(); tPub = []; tPriv = new Map(); S.trips = []; S.expenses = []; S.left = []; S.leftItems = [];
  allPub = []; allPriv = new Map(); allItems = []; leftSeq++;
  if (fid) {
    // A dispatcher's queries must match the rules exactly ("only what I am on"), so they ask
    // for everything of theirs and the flight is picked out here.
    const boss = isAdmin();
    const q1 = (name, field = 'dids') => (boss ? query(C(name), where('fid', '==', fid)) : query(C(name), where(field, 'array-contains', S.me.uid)));
    const ofFlight = (q) => docsOf(q).filter((d) => d.fid === fid);
    unsubF.push(onSnapshot(q1('items'), { includeMetadataChanges: true }, (q) => {
      if (!boss) { allItems = docsOf(q); mergeLeft(); }
      S.items = ofFlight(q).sort((a, b) => (a.n || 1e9) - (b.n || 1e9) || (a.at || 0) - (b.at || 0));
      S.itemsLoaded = true;
      for (const id of [...S.sel]) if (!S.items.some((i) => i.id === id)) S.sel.delete(id);
      countPending(); schedule(); numberItems();
    }, dbErr));
    unsubF.push(onSnapshot(q1('groups'), { includeMetadataChanges: true }, (q) => { gPub = ofFlight(q); if (!boss) { allPub = docsOf(q); mergeLeft(); } mergeGroups(); numberDocs('groups'); }, dbErr));
    unsubF.push(onSnapshot(q1('groupsPrivate', 'rel'), { includeMetadataChanges: true }, (q) => { gPriv = new Map(ofFlight(q).map((d) => [d.id, d])); if (!boss) { allPriv = new Map(docsOf(q).map((d) => [d.id, d])); mergeLeft(); } mergeGroups(); }, dbErr));
    // Parcels not sent from earlier flights. The owner asks for them; a dispatcher already has them.
    if (boss) unsubF.push(onSnapshot(query(C('groups'), where('done', '==', false)), (q) => { allPub = docsOf(q); loadLeftExtra(); }, dbErr));
    unsubF.push(onSnapshot(boss ? query(C('expenses'), where('fid', '==', fid)) : query(C('expenses'), where('by', '==', S.me.uid)), { includeMetadataChanges: true }, (q) => { S.expenses = ofFlight(q).sort((a, b) => (b.at || 0) - (a.at || 0)); schedule(); }, dbErr));
    unsubF.push(onSnapshot(q1('trips'), (q) => { tPub = ofFlight(q); mergeTrips(); }, dbErr));
    unsubF.push(onSnapshot(q1('tripsPrivate', 'rel'), (q) => { tPriv = new Map(ofFlight(q).map((d) => [d.id, d])); mergeTrips(); }, dbErr));
  }
  schedule();
}
// A passenger on a flight = bag counts (open to the flight's dispatchers) + who they are (locked).
let tPub = [], tPriv = new Map();
function mergeTrips() {
  S.trips = tPub.map((t) => { const p = tPriv.get(t.id); return p ? { ...t, pid: p.pid, name: p.name || '', phone: p.phone || '', released: !!p.released } : { ...t, locked: true }; })
    .sort((a, b) => (a.at || 0) - (b.at || 0));
  schedule(); tick();
}
/* ---------- parcels left from earlier flights ----------
   A parcel stays open until it is sent, whatever flight is open now. It can go on its own,
   or "together" with the same client's parcel on this flight (joinedTo / joined). */
let allPub = [], allPriv = new Map(), allItems = [], leftSeq = 0;
const merge1 = (g, p) => { if (!p) return { ...g, locked: true }; const o = { ...g, released: !!p.released }; for (const k of PRIVATE_FIELDS) o[k] = p[k] ?? ''; o.cid = p.cid || ''; return o; };
function mergeLeft() {
  const fid = S.fid;
  S.left = allPub.filter((g) => g.fid !== fid && !g.done && !g.deleting).map((g) => merge1(g, allPriv.get(g.id)))
    .sort((a, b) => (a.at || 0) - (b.at || 0));
  const ids = new Set(S.left.map((g) => g.id));
  S.leftItems = allItems.filter((i) => ids.has(i.groupId));
  schedule();
}
async function loadLeftExtra() {
  const seq = ++leftSeq, fid = S.fid;
  const left = allPub.filter((g) => g.fid !== fid && !g.done);
  try {
    const privs = await Promise.all(left.map((g) => getDoc(D('groupsPrivate/' + g.id)).then((d) => [g.id, d.exists() ? d.data() : null], () => [g.id, null])));
    const ids = left.map((g) => g.id), its = [];
    for (let k = 0; k < ids.length; k += 30) { const q = await getDocs(query(C('items'), where('groupId', 'in', ids.slice(k, k + 30)))); its.push(...docsOf(q)); }
    if (seq !== leftSeq) return;
    allPriv = new Map(privs); allItems = its; mergeLeft();
  } catch (e) { console.warn('left', e); }
}
// Same client: by client id, or by phone number for parcels typed in by a dispatcher.
const sameClient = (a, b) => (a.cid && a.cid === b.cid) || (phoneKey(a.phone) && phoneKey(a.phone) === phoneKey(b.phone));
export const leftFor = (g) => S.left.filter((o) => !o.joinedTo && sameClient(o, g));
export function joinParcels(gid, oids) {
  const g = groupById(gid); if (!g || !oids.length) return;
  for (const o of oids) upd('groups/' + o, { joinedTo: gid, joinedFid: g.fid });
  upd('groups/' + gid, { joined: [...new Set([...(g.joined || []), ...oids])] });
  logEv(`will send ${plural(oids.length, 'earlier parcel')} together with ${gLabel(g)}`);
  toast(`Will be sent together with ${gLabel(g)}`);
}
export function unjoin(oid) {
  const o = groupById(oid); if (!o?.joinedTo) return;
  const g = groupById(o.joinedTo);
  upd('groups/' + oid, { joinedTo: deleteField(), joinedFid: deleteField() });
  if (g) upd('groups/' + g.id, { joined: (g.joined || []).filter((x) => x !== oid) });
}
// Ask first: a new parcel for a client who still has an unsent one.
let askJoin = async () => false;
export const setAskJoin = (fn) => (askJoin = fn);
export async function offerJoin(gid) {
  await new Promise((r) => setTimeout(r, 400));
  const g = groupById(gid); if (!g) return;
  const os = leftFor(g); if (!os.length) return;
  if (await askJoin(g, os)) joinParcels(gid, os.map((o) => o.id));
}

// A group on screen = its open part + the receiver details, when this login may see them.
let gPub = [], gPriv = new Map();
function mergeGroups() {
  S.groups = gPub.map((g) => {
    const p = gPriv.get(g.id);
    if (!p) return { ...g, locked: true };
    const o = { ...g, released: !!p.released, _pending: g._pending || p._pending };
    for (const k of PRIVATE_FIELDS) o[k] = p[k] ?? '';
    o.cid = p.cid || ''; o.slipOk = !!p.slipOk; o.pickOk = !!p.pickOk; o.typedBy = !p.released && (p.rel || []).length ? p.rel[0] : '';
    return o;
  }).sort((a, b) => (a.pn || 1e9) - (b.pn || 1e9) || (a.at || 0) - (b.at || 0));
  countPending(); schedule();
}
function countPending() { S.pendingDocs = S.items.filter((i) => i._pending).length + S.groups.filter((g) => g._pending).length; }

/* ---------- online state ---------- */
addEventListener('online', () => { S.online = true; schedule(); numberItems(); });
addEventListener('offline', () => { S.online = false; schedule(); });

/* ---------- item and parcel numbers — B7 ----------
   New items (and groups) are written with no number and a local temporary one
   (shown "#~3" / "P~3"). Once a doc has reached the server, a transaction on the
   flight's counter (flights/{fid}.nextN for items, .nextP for parcels) gives it the
   next real number. Two devices can run this at the same time: the transaction
   re-reads each doc and skips ones already numbered, so numbers never repeat. */
const NUMBERING = {
  items: { list: () => S.items, field: 'n', counter: 'nextN', allowed: () => true },
  groups: { list: () => S.groups, field: 'pn', counter: 'nextP', allowed: () => can('group') },
};
const numbering = {};
async function numberDocs(col) {
  const c = NUMBERING[col];
  if (numbering[col] || !S.fid || !navigator.onLine || !S.me || S.me.viewAs || !c.allowed()) return;
  const all = c.list();
  const todo = all.filter((d) => !d[c.field] && !d._pending).sort((a, b) => (a.at || 0) - (b.at || 0) || a.id.localeCompare(b.id)).slice(0, 40);
  if (!todo.length) return;
  numbering[col] = true;
  const fid = S.fid, fallback = all.reduce((m, d) => Math.max(m, d[c.field] || 0), 0) + 1;
  try {
    await runTransaction(db, async (tx) => {
      const fref = D('flights/' + fid);
      const fs = await tx.get(fref);
      let next = Math.max(fs.data()?.[c.counter] || 1, fallback);
      const snaps = await Promise.all(todo.map((d) => tx.get(D(col + '/' + d.id))));
      snaps.forEach((sn, k) => { if (sn.exists() && !sn.data()[c.field]) tx.update(D(col + '/' + todo[k].id), { [c.field]: next++ }); });
      tx.update(fref, { [c.counter]: next });
    });
  } catch (e) { console.warn('numbering ' + col, e); }
  numbering[col] = false;
  if (c.list().some((d) => !d[c.field] && !d._pending)) setTimeout(() => numberDocs(col), 1500);
}
export function numberItems() { numberDocs('items'); numberDocs('groups'); }
export function nextTmp() {
  return S.items.reduce((m, i) => Math.max(m, i.n || 0, i.tmp || 0), 0) + 1;
}

/* ---------- groups & items ---------- */
export function newGroup(data, assignIds = []) {
  if (!S.fid) return null;
  const clean = {}; for (const k of FIELDS) clean[k] = String(data[k] ?? '').trim();
  const ci = S.groups.reduce((m, g) => Math.max(m, (g.ci ?? -1) + 1), 0) + (S.gBump || 0);
  S.gBump = (S.gBump || 0) + 1; setTimeout(() => (S.gBump = 0), 3000);
  const id = rid();
  const ptmp = S.groups.reduce((m, g) => Math.max(m, g.pn || 0, g.ptmp || 0), 0) + 1 + (S.gBump - 1);
  const cid = data.cid !== undefined ? data.cid : ensureClient(clean, id);
  put('groups/' + id, {
    fid: S.fid, dids: curFlight()?.dids || [], ci, pn: null, ptmp, ...clean, cid: cid || '', raw: data.raw || '', done: false, at: now(), by: S.me.uid,
    aiPending: !!data.aiPending, tracking: '', weight: null, charges: null,
    steps: { arrived: { at: now(), by: S.me.uid } }, packed: {},
  });
  logEv(`made parcel for ${clean.name || '(no name)'}`);
  if (assignIds.length) moveItems(assignIds, id, true);
  if (!data.noAsk) offerJoin(id);
  return id;
}
/* ---------- clients ----------
   A client is a person a parcel goes to, kept across flights with their phone and address.
   Clients are made from the addresses that are pasted or typed: the phone number decides
   whether it is someone already known. Nobody has to be added by hand first. */
export const clientList = () => S.people.filter((p) => p.role === 'client' && !p.gone);
export const clientByPhone = (phone) => { const k = phoneKey(phone); return k ? clientList().find((c) => c.pk === k || phoneKey(c.phone) === k) || null : null; };
// Returns the client id now (owner, works offline) or links it a moment later (dispatcher, online).
export function ensureClient(d, gid) {
  const k = phoneKey(d.phone);
  if (!k || S.me.viewAs) return '';
  if (isAdmin()) {
    const c = clientByPhone(d.phone);
    if (c) { const fill = {}; for (const f of ['name', 'phone2', 'address', 'city', 'service']) if (d[f] && !c[f]) fill[f] = d[f]; if (Object.keys(fill).length) w(updateDoc(D('people/' + c.id), fill), 'client'); return c.id; }
    const id = rid();
    const rec = { role: 'client', name: d.name || '', phone: d.phone, pk: k, phone2: d.phone2 || '', address: d.address || '', city: d.city || '', service: d.service || '', note: '', key: '', codeSet: false, sharedOff: false, disabled: false, since: 0, at: now(), by: S.me.uid };
    S.people = [...S.people, { id, ...rec }]; // so the next pasted address with this phone finds it at once
    w(setDoc(D('people/' + id), rec), 'client');
    return id;
  }
  if (isDispatcher() && navigator.onLine && gid) {
    clientApi({ action: 'clientEnsure', ...d }).then((r) => { if (r?.cid) w(updateDoc(D('groupsPrivate/' + gid), { cid: r.cid }), 'client'); }).catch(() => {});
  }
  return '';
}
// The owner changed a parcel's details: the client keeps them for next time.
export function saveBook(d) {
  if (!isAdmin() || S.me.viewAs) return;
  const c = (d.cid && S.people.find((p) => p.id === d.cid)) || clientByPhone(d.phone);
  if (!c) return;
  const patch = {}; for (const f of ['name', 'phone', 'phone2', 'address', 'city', 'service']) if (d[f] && d[f] !== c[f]) patch[f] = d[f];
  if (patch.phone) patch.pk = phoneKey(patch.phone);
  if (Object.keys(patch).length) w(updateDoc(D('people/' + c.id), patch), 'client');
}
export async function lookupBook(phone) {
  if (!isAdmin()) return null;
  return clientByPhone(phone);
}
let clientApi = async () => null;
export const setClientApi = (fn) => (clientApi = fn);
export function moveItems(ids, gid, quiet) {
  const before = ids.map((id) => [id, S.items.find((i) => i.id === id)?.groupId || '']);
  ids.forEach((id) => upd('items/' + id, { groupId: gid || '' }));
  S.sel.clear(); schedule();
  const g = groupById(gid);
  const nums = ids.map((id) => S.items.find((i) => i.id === id)).filter(Boolean).map(numLabel).join(', ');
  logEv(gid ? `moved ${nums} to ${gLabel(g)}` : `took ${nums} out of its parcel`);
  if (!quiet) toast(`${plural(ids.length, 'item')} ${gid ? 'added to ' + gLabel(g) : 'taken out of its parcel'}`, {
    undo: () => { before.forEach(([id, old]) => upd('items/' + id, { groupId: old })); logEv(`undid moving ${nums}`); },
  });
}
export async function combine(ids, targetGroup) {
  const its = ids.map((id) => S.items.find((i) => i.id === id)).filter(Boolean).sort((a, b) => (a.n || 1e9) - (b.n || 1e9));
  if (its.length < 2) return;
  const photos = its.flatMap((i) => i.photos || []);
  if (photos.length > 12) { toast('One item can hold up to 12 photos.'); return; }
  // B8: items from different groups -> ask which group to keep.
  const gids = [...new Set(its.map((i) => i.groupId).filter((g) => groupById(g)))];
  let gid = gids[0] || '';
  if (targetGroup === undefined && gids.length > 1) {
    gid = await choose('Which parcel?', 'These items are in different parcels. Which parcel should the combined item go to?', [
      ...gids.map((g) => ({ label: gLabel(groupById(g)), v: g })), { label: 'No group', v: '__none' }]);
    if (!gid) return; if (gid === '__none') gid = '';
  }
  const first = its[0]; const rest = its.slice(1);
  const qs = its.map((i) => Number(i.qty)).filter((x) => x > 0);
  const strip = ({ id, _pending, ...d }) => d;
  const prevFirst = { photos: first.photos || [], name: first.name || '', qty: first.qty ?? null, groupId: first.groupId || '' };
  const saved = rest.map((i) => [i.id, strip(i)]);
  upd('items/' + first.id, { photos, name: its.map((i) => i.name).find(Boolean) || '', qty: qs.length ? qs.reduce((a, b) => a + b, 0) : null, groupId: gid });
  rest.forEach((i) => del('items/' + i.id));
  S.sel.clear(); schedule();
  logEv(`combined ${its.map(numLabel).join(', ')} into ${numLabel(first)}`);
  toast(`${plural(its.length, 'photo')} combined into item ${numLabel(first)}`, {
    undo: () => { upd('items/' + first.id, prevFirst); saved.forEach(([id, d]) => put('items/' + id, d)); logEv('undid a combine'); },
  });
}
// Deletes wait 6 s (hidden meanwhile) so Undo costs nothing.
export function deleteItems(ids) {
  const its = ids.map((id) => S.items.find((i) => i.id === id)).filter(Boolean);
  if (!its.length) return;
  its.forEach((i) => S.hidden.add(i.id)); S.sel.clear(); schedule();
  const fid = S.fid;
  toast(`Deleted ${its.length === 1 ? 'item ' + numLabel(its[0]) : plural(its.length, 'item')}`, {
    undo: () => { its.forEach((i) => S.hidden.delete(i.id)); schedule(); },
    commit: () => {
      let bytes = 0;
      for (const i of its) { for (const p of i.photos || []) { del('photos/' + p.p); bytes += (p.s || 0) + (p.t?.length || 0); } del('items/' + i.id); }
      if (bytes) upd('flights/' + fid, { bytes: increment(-bytes) });
      its.forEach((i) => S.hidden.delete(i.id));
      logEv(`deleted ${its.map(numLabel).join(', ')}`, fid);
    },
  });
}
export function setDone(gids, done) {
  let gs = gids.map(groupById).filter(Boolean);
  // Parcels joined to these go (or come back) with them.
  gs = [...gs, ...gs.flatMap((g) => (g.joined || []).map(groupById).filter(Boolean))].filter((g, k, a) => a.indexOf(g) === k);
  const prev = gs.map((g) => [g.id, !!g.done, g.steps?.sent || null]);
  for (const g of gs) upd('groups/' + g.id, { done, 'steps.sent': done ? { at: now(), by: S.me.uid } : deleteField() });
  logEv(`${done ? 'marked sent' : 'marked not sent'}: ${gs.map(gTitle).join(', ')}`);
  toast(gs.length === 1 ? `${gLabel(gs[0])} ${done ? 'marked sent' : 'back to not sent'}` : `${plural(gs.length, 'parcel')} marked ${done ? 'sent' : 'not sent'}`, {
    undo: () => { prev.forEach(([id, d, st]) => upd('groups/' + id, { done: d, 'steps.sent': st || deleteField() })); logEv('undid mark sent'); },
  });
}
export function setStep(g, key, on) {
  const patch = { ['steps.' + key]: on ? { at: now(), by: S.me.uid } : deleteField() };
  if (key === 'sent') patch.done = on;
  upd('groups/' + g.id, patch);
  logEv(`${on ? 'set' : 'cleared'} "${key}" for ${gLabel(g)}`);
}

/* ---------- releases: who may see a receiver's details ---------- */
export function setRelease(gids, on) {
  if (!isAdmin() || viewing()) return;
  const dids = curFlight()?.dids || [];
  const gs = gids.map(groupById).filter(Boolean);
  gs.forEach((g) => w(updateDoc(D('groupsPrivate/' + g.id), { released: on, rel: on ? dids : [], relAt: on ? now() : null, relBy: on ? S.me.uid : null }), 'release'));
  logEv(`${on ? 'released' : 'hid'} receiver details: ${gs.map(pLabel).join(', ')}`);
  toast(on ? `${plural(gs.length, 'address')} shared with the dispatcher` : `Stopped sharing ${plural(gs.length, 'address')}`);
}
// Put dispatchers on a flight. Every item and parcel of the flight carries the same list,
// because the database rules check it on each document.
export async function setFlightDispatchers(fid, dids) {
  if (!isAdmin() || viewing()) return;
  const refs = [];
  for (const name of ['items', 'groups', 'groupsPrivate', 'trips', 'tripsPrivate']) {
    const q = await getDocs(query(C(name), where('fid', '==', fid)));
    q.docs.forEach((d) => refs.push([d.ref, name.endsWith('Private') ? { dids, rel: d.data().released ? dids : [] } : { dids }]));
  }
  for (let k = 0; k < refs.length; k += 400) {
    const b = writeBatch(db); refs.slice(k, k + 400).forEach(([r, data]) => b.update(r, data)); await b.commit();
  }
  await updateDoc(D('flights/' + fid), { dids });
}

/* ---------- passengers on a flight ---------- */
export function addTrip(person) {
  const f = curFlight(); if (!f || !isAdmin() || viewing()) return;
  const id = rid(); const auto = S.cfg.autoMin === undefined ? 10 : S.cfg.autoMin; const dueAt = dueAtOf(auto, f.landAt);
  w(setDoc(D('trips/' + id), { fid: f.id, dids: f.dids || [], checked: 0, hand: 0, weight: null, auto, dueAt, gotChecked: 0, gotHand: 0, at: now() }), 'trip');
  w(setDoc(D('tripsPrivate/' + id), { fid: f.id, dids: f.dids || [], pid: person.id, name: person.name, phone: person.phone || '', released: false, rel: [], dueAt }), 'trip');
  logEv(`added passenger ${person.name}`);
}
export function updTrip(id, patch) {
  if (viewing()) return;
  const t = S.trips.find((x) => x.id === id); if (!t) return;
  if ('auto' in patch) { patch.dueAt = dueAtOf(patch.auto, curFlight()?.landAt); w(updateDoc(D('tripsPrivate/' + id), { dueAt: patch.dueAt }), 'trip'); }
  w(updateDoc(D('trips/' + id), patch), 'trip');
}
export function setTripRelease(id, on) {
  if (!isAdmin() || viewing()) return;
  const t = S.trips.find((x) => x.id === id); if (!t) return;
  // Hiding again also stops the timer, or it would reopen at once.
  if (!on) w(updateDoc(D('trips/' + id), { auto: null, dueAt: null }), 'trip');
  w(updateDoc(D('tripsPrivate/' + id), on ? { released: true, rel: curFlight()?.dids || [], relAt: now(), relBy: S.me.uid } : { released: false, rel: [], dueAt: null }), 'trip');
  logEv(`${on ? 'released' : 'hid'} the contact of passenger ${t.name}`);
  toast(on ? `${t.name} and the dispatcher can now see each other's contact` : `${t.name}'s contact is hidden again`);
}
export function delTrip(id) {
  if (!isAdmin() || viewing()) return;
  w(deleteDoc(D('tripsPrivate/' + id)), 'trip'); w(deleteDoc(D('trips/' + id)), 'trip');
}
export function gotBag(id, kind, d) {
  const t = S.trips.find((x) => x.id === id); if (!t) return;
  const key = kind === 'hand' ? 'gotHand' : 'gotChecked'; const max = kind === 'hand' ? t.hand || 0 : t.checked || 0;
  upd('trips/' + id, { [key]: Math.max(0, Math.min(max, (t[key] || 0) + d)), gotAt: now(), gotBy: S.me.uid });
}
export function saveLanding(date, time) {
  const f = curFlight(); if (!f || !isAdmin() || viewing()) return;
  const landAt = landAtOf(date, time);
  upd('flights/' + f.id, { date, landAt });
  for (const t of S.trips) { const dueAt = t.released ? null : dueAtOf(t.auto, landAt); w(updateDoc(D('trips/' + t.id), { dueAt }), 'trip'); w(updateDoc(D('tripsPrivate/' + t.id), { dueAt }), 'trip'); }
  toast(landAt ? 'Landing time saved' : 'Saved. Add a landing time to use timed release.');
}
// Timed release. The owner's app opens a due contact itself; a dispatcher's app asks the
// server, which checks the time and opens it. Called every minute and when data changes.
let ticking = false;
export async function tick() {
  if (ticking || !S.me || S.me.viewAs || !navigator.onLine || !S.fid || (EMU && window.__noTick)) return;
  const t0 = now();
  if (isAdmin()) {
    for (const t of S.trips) if (!t.locked && !t.released && t.dueAt && t.dueAt <= t0) w(updateDoc(D('tripsPrivate/' + t.id), { released: true, rel: curFlight()?.dids || [], relAt: t0, relBy: 'timer' }), 'timer');
    return;
  }
  if (!isDispatcher() || !S.trips.some((t) => t.locked && t.dueAt && t.dueAt <= t0)) return;
  ticking = true;
  try { await tickApi(S.fid); } catch (e) { /* tried again next minute */ }
  ticking = false;
}
let tickApi = async () => {};
export const setTickApi = (fn) => (tickApi = fn);
setInterval(() => { tick(); schedule(); }, 60000);

/* ---------- expenses ---------- */
export const EXP_CATS = ['Ride', 'Packing', 'Courier', 'Food', 'Other'];
export function addExpense(e) {
  if (!S.fid || viewing()) return;
  put('expenses/' + rid(), { fid: S.fid, by: S.me.uid, byName: S.me.name || '', at: now(), amount: e.amount, cat: e.cat, note: e.note || '', ...(e.receipt ? { receipt: e.receipt } : {}) });
  logEv(`added an expense: ${e.cat} Rs ${e.amount}`);
}
export function delExpense(id) {
  const e = S.expenses.find((x) => x.id === id); if (!e) return;
  if (e.receipt?.p) del('receipts/' + e.receipt.p);
  del('expenses/' + id);
}

/* ---------- receive check: did each item really arrive? ---------- */
export const RECV = { ok: 'Received', missing: 'Missing', damaged: 'Damaged' };
export function setRecv(ids, v) {
  const its = ids.map((id) => S.items.find((i) => i.id === id)).filter(Boolean); if (!its.length) return;
  its.forEach((i) => upd('items/' + i.id, { recv: v || null }));
  logEv(`marked ${its.map(numLabel).join(', ')} ${v ? RECV[v].toLowerCase() : 'not checked'}`);
  S.sel.clear(); schedule();
}

// Local test builds only: lets the end-to-end test try to go around the app and hit the
// database directly, to prove the rules (not just the screens) keep things private.
if (EMU) {
  const res = (p) => p.then((x) => 'ok:' + (x?.size ?? (x?.exists ? x.exists() : '')), (e) => e.code || String(e));
  window.__t = {
    get: (path) => res(getDoc(D(path))),
    list: (name) => res(getDocs(C(name))),
    del: (path) => res(deleteDoc(D(path))),
    upd: (path, data) => res(updateDoc(D(path), data)),
    ids: () => ({ items: S.items.map((i) => i.id), groups: S.groups.map((g) => g.id), fid: S.fid }),
    S: () => S,
  };
}
