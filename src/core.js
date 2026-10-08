// State, helpers, Firebase wiring, UI primitives (toast, sheets, history) and all data writes.
import { initializeApp } from 'firebase/app';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED,
  connectFirestoreEmulator, collection, doc, query, where, onSnapshot, setDoc, updateDoc, deleteDoc,
  getDoc, getDocs, writeBatch, runTransaction, increment, waitForPendingWrites, deleteField,
} from 'firebase/firestore';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator,
  signInWithCustomToken, signOut, onAuthStateChanged,
} from 'firebase/auth';
import { firebaseConfig } from './firebase-config.js';
import { FIELDS, phoneKey, fmtPhone, SVC_ORDER } from './parse.js';

export { fmtPhone };
export const GC = ['#D99A00', '#2D6FC7', '#C3362B', '#1E8757', '#8440A8', '#C75B12', '#12918F', '#6D4C41', '#C2185B', '#4F6475'];
export const PROFILE_COLORS = ['#2D6FC7', '#1E8757', '#C3362B', '#8440A8', '#C75B12', '#12918F', '#D99A00', '#C2185B'];
export const STEPS = [['arrived', 'Arrived'], ['packed', 'Packed'], ['booked', 'Booked'], ['sent', 'Sent'], ['delivered', 'Delivered']];
export const PERM_LABELS = {
  upload: 'Add photos', name: 'Name items', group: 'Make and edit groups', send: 'Mark parcels sent, tracking, receipts',
  flights: 'Add flights', ai: 'Use AI', export: 'Export and download',
};
export const DEFAULT_PERMS = {
  admin: { upload: true, name: true, group: true, send: true, flights: true, ai: true, export: true },
  sorter: { upload: false, name: false, group: true, send: true, flights: false, ai: true, export: false },
};
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
  user: undefined, me: null, profiles: [], profilesLoaded: false, setup: null,
  cfg: {}, flights: [], flightsLoaded: false, flightsFromCache: true,
  fid: null, items: [], groups: [], itemsLoaded: false,
  tab: 'photos', show: null, sel: new Set(), lastSel: null, q: '',
  gf: { city: '', service: '', status: 'open', sort: 'oldest' },
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
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
export const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
export function fmtDate(d) { if (!d) return ''; const x = new Date(d + 'T00:00:00'); return isNaN(x) ? d : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
export function fmtTime(t) { if (!t) return ''; const d = new Date(t); return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
export function fmtBytes(b) { b = Math.max(0, b || 0); if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB'; if (b < 1024 ** 3) return (b / 1024 / 1024).toFixed(1) + ' MB'; return (b / 1024 ** 3).toFixed(2) + ' GB'; }
export const isAdmin = () => S.me?.role === 'admin';
export const can = (p) => isAdmin() || !!S.me?.perms?.[p];
export const curFlight = () => S.flights.find((f) => f.id === S.fid) || null;
export const groupById = (id) => (id ? S.groups.find((g) => g.id === id) : null);
export const gColor = (g) => GC[(g?.ci || 0) % GC.length];
export const gTitle = (g) => (g ? g.name || 'No name yet' : '');
export const visItems = () => S.items.filter((i) => !S.hidden.has(i.id));
export const itemsIn = (gid) => visItems().filter((i) => i.groupId === gid);
export const ungrouped = () => visItems().filter((i) => !groupById(i.groupId));
export const active = () => S.groups.filter((g) => !g.done);
export const sentGroups = () => S.groups.filter((g) => g.done);
export const toSend = () => visItems().filter((i) => !groupById(i.groupId)?.done);
export const qtyOf = (i) => (Number(i.qty) > 0 ? Number(i.qty) : 1);
export const piecesIn = (gid) => itemsIn(gid).reduce((s, i) => s + qtyOf(i), 0);
export const numLabel = (i) => (i.n ? '#' + i.n : '#~' + (i.tmp || '?'));
export const itemLabel = (i) => (i.name || 'Item ' + numLabel(i)) + (Number(i.qty) > 1 ? ' ×' + i.qty : '');
export const profName = (uid) => S.profiles.find((p) => p.id === uid)?.name || (uid === S.me?.uid ? S.me?.name : '') || 'Someone';
export const mainSvc = (s) => String(s || '').split('/')[0].trim();
export function svcKey(s) { const t = mainSvc(s); return t || 'No service yet'; }
export function svcSort(a, b) {
  const ia = SVC_ORDER.indexOf(a), ib = SVC_ORDER.indexOf(b);
  if (a === 'No service yet') return 1; if (b === 'No service yet') return -1;
  return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib) || a.localeCompare(b);
}
export function missing(g) {
  const m = [];
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
export function initFirebase() {
  if (!S.configured && !EMU) return false;
  const app = initializeApp(EMU ? { apiKey: 'demo', projectId: 'demo-amanat', appId: 'demo' } : firebaseConfig);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: CACHE_SIZE_UNLIMITED }) });
  auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  if (EMU) {
    connectFirestoreEmulator(db, location.hostname, 8080);
    connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
    S.configured = true;
  }
  return true;
}
export { onAuthStateChanged, signInWithCustomToken, signOut, waitForPendingWrites };
export const D = (path) => doc(db, path);

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
export const upd = (path, data) => w(updateDoc(D(path), data), 'update ' + path);
export const put = (path, data) => w(setDoc(D(path), data), 'set ' + path);
export const del = (path) => w(deleteDoc(D(path)), 'delete ' + path);
export { increment, deleteField, getDoc, getDocs, collection, query, where, writeBatch, doc, setDoc, runTransaction };

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
  if (!fid || !S.me) return;
  put('log/' + rid(), { fid, at: now(), by: S.me.uid, text: `${S.me.name} ${text}` });
}

/* ---------- subscriptions ---------- */
let unsubBase = [], unsubF = [];
const docsOf = (q) => q.docs.map((d) => ({ id: d.id, ...d.data(), _pending: d.metadata.hasPendingWrites }));
export function subscribeProfiles() {
  return onSnapshot(collection(db, 'profiles'), (q) => {
    S.profiles = docsOf(q).sort((a, b) => (a.at || 0) - (b.at || 0));
    S.profilesLoaded = true;
    if (S.me) { const p = S.profiles.find((x) => x.id === S.me.uid); if (p) S.me.name = p.name; }
    schedule();
  }, (e) => { console.warn(e); S.profilesLoaded = true; schedule(); });
}
export function subscribeBase() {
  unsubBase.forEach((u) => u()); unsubBase = [];
  unsubBase.push(onSnapshot(D('config/main'), (s) => { S.cfg = s.exists() ? s.data() : {}; schedule(); }, dbErr));
  unsubBase.push(onSnapshot(collection(db, 'flights'), { includeMetadataChanges: true }, (q) => {
    S.flights = docsOf(q).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.at || 0) - (a.at || 0));
    S.flightsLoaded = true; S.flightsFromCache = q.metadata.fromCache;
    pickFlight(); schedule();
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
  S.fid = fid; S.subbed = fid; lsSet('amanat3.fid', fid); S.sel.clear(); S.show = null; S.gridLimit = 120;
  unsubF.forEach((u) => u()); unsubF = []; S.items = []; S.groups = []; S.itemsLoaded = false;
  if (fid) {
    unsubF.push(onSnapshot(query(collection(db, 'items'), where('fid', '==', fid)), { includeMetadataChanges: true }, (q) => {
      S.items = docsOf(q).sort((a, b) => (a.n || 1e9) - (b.n || 1e9) || (a.at || 0) - (b.at || 0));
      S.itemsLoaded = true;
      for (const id of [...S.sel]) if (!S.items.some((i) => i.id === id)) S.sel.delete(id);
      countPending(); schedule(); numberItems();
    }, dbErr));
    unsubF.push(onSnapshot(query(collection(db, 'groups'), where('fid', '==', fid)), { includeMetadataChanges: true }, (q) => {
      S.groups = docsOf(q).sort((a, b) => (a.at || 0) - (b.at || 0));
      countPending(); schedule();
    }, dbErr));
  }
  schedule();
}
function countPending() { S.pendingDocs = S.items.filter((i) => i._pending).length + S.groups.filter((g) => g._pending).length; }

/* ---------- online state ---------- */
addEventListener('online', () => { S.online = true; schedule(); numberItems(); });
addEventListener('offline', () => { S.online = false; schedule(); });

/* ---------- item numbers — B7 ----------
   New items are written with n:null and a local temporary number (shown "#~3").
   Once an item has reached the server, a transaction on the flight's counter
   (flights/{fid}.nextN) gives it the next real number. Two devices can run this
   at the same time: the transaction re-reads each item and skips numbered ones. */
let numbering = false;
export async function numberItems() {
  if (numbering || !S.fid || !navigator.onLine || !S.me) return;
  const todo = S.items.filter((i) => !i.n && !i._pending).sort((a, b) => (a.at || 0) - (b.at || 0) || a.id.localeCompare(b.id)).slice(0, 40);
  if (!todo.length) return;
  numbering = true;
  const fid = S.fid, fallback = S.items.reduce((m, i) => Math.max(m, i.n || 0), 0) + 1;
  try {
    await runTransaction(db, async (tx) => {
      const fref = D('flights/' + fid);
      const fs = await tx.get(fref);
      let next = Math.max(fs.data()?.nextN || 1, fallback);
      const snaps = await Promise.all(todo.map((i) => tx.get(D('items/' + i.id))));
      snaps.forEach((s, k) => { if (s.exists() && !s.data().n) tx.update(D('items/' + todo[k].id), { n: next++ }); });
      tx.update(fref, { nextN: next });
    });
  } catch (e) { console.warn('numbering', e); }
  numbering = false;
  if (S.items.some((i) => !i.n && !i._pending)) setTimeout(numberItems, 1500);
}
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
  put('groups/' + id, {
    fid: S.fid, ci, ...clean, raw: data.raw || '', done: false, at: now(), by: S.me.uid,
    aiPending: !!data.aiPending, tracking: '', weight: null, charges: null,
    steps: { arrived: { at: now(), by: S.me.uid } }, packed: {},
  });
  saveBook(clean);
  logEv(`made group ${clean.name || '(no name)'}`);
  if (assignIds.length) moveItems(assignIds, id, true);
  return id;
}
export function saveBook(d) {
  const k = phoneKey(d.phone); if (!k) return;
  const rec = { at: now() }; for (const f of ['name', 'phone', 'phone2', 'address', 'city', 'service']) if (d[f]) rec[f] = d[f];
  w(setDoc(D('book/' + k), rec, { merge: true }), 'book');
}
export async function lookupBook(phone) {
  const k = phoneKey(phone); if (!k) return null;
  try { const s = await getDoc(D('book/' + k)); return s.exists() ? s.data() : null; } catch (e) { return null; }
}
export function moveItems(ids, gid, quiet) {
  const before = ids.map((id) => [id, S.items.find((i) => i.id === id)?.groupId || '']);
  ids.forEach((id) => upd('items/' + id, { groupId: gid || '' }));
  S.sel.clear(); schedule();
  const g = groupById(gid);
  const nums = ids.map((id) => S.items.find((i) => i.id === id)).filter(Boolean).map(numLabel).join(', ');
  logEv(gid ? `moved ${nums} to ${gTitle(g)}` : `took ${nums} out of its group`);
  if (!quiet) toast(`${plural(ids.length, 'item')} ${gid ? 'added to ' + gTitle(g) : 'taken out of its group'}`, {
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
    gid = await choose('Which group?', 'These items are in different groups. Which group should the combined item go to?', [
      ...gids.map((g) => ({ label: gTitle(groupById(g)), v: g })), { label: 'No group', v: '__none' }]);
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
  const gs = gids.map(groupById).filter(Boolean);
  const prev = gs.map((g) => [g.id, !!g.done, g.steps?.sent || null]);
  for (const g of gs) upd('groups/' + g.id, { done, 'steps.sent': done ? { at: now(), by: S.me.uid } : deleteField() });
  logEv(`${done ? 'marked sent' : 'marked not sent'}: ${gs.map(gTitle).join(', ')}`);
  toast(gs.length === 1 ? `${gTitle(gs[0])} ${done ? 'marked sent' : 'back to not sent'}` : `${plural(gs.length, 'parcel')} marked ${done ? 'sent' : 'not sent'}`, {
    undo: () => { prev.forEach(([id, d, st]) => upd('groups/' + id, { done: d, 'steps.sent': st || deleteField() })); logEv('undid mark sent'); },
  });
}
export function setStep(g, key, on) {
  const patch = { ['steps.' + key]: on ? { at: now(), by: S.me.uid } : deleteField() };
  if (key === 'sent') patch.done = on;
  upd('groups/' + g.id, patch);
  logEv(`${on ? 'set' : 'cleared'} "${key}" for ${gTitle(g)}`);
}
