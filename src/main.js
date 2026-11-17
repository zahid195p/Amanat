import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './style.css';
import {
  S, $, $$, now, plural, isAdmin, can, groupById, active, toSend, ungrouped, visItems, toast, closeSheet, closeTop, layerCount, ask, choose,
  schedule, setRender, DRAG, initFirebase, storageWorks, auth, onAuthStateChanged, signInWithCustomToken, subscribeBase, SPACE, ROLE_LABEL, isStaff, setRelease, exitViewAs, addTrip, updTrip, setTripRelease, delTrip, gotBag, saveLanding, setTickApi, setOnMe, setClientApi, setFlightDispatchers, delExpense, upd, setRecv, tick,
  unsubscribeAll, setFlight, saveLater, moveItems, combine, deleteItems, setDone, svcKey, lsSet, waitForPendingWrites, db, numberItems, put, now as tnow,
} from './core.js';
import { render, shownItems } from './views.js';
import { handleFiles, retryUpload, dropUpload, clearUploads } from './images.js';
import { api } from './api.js';
import {
  openGroupSheet, openPickGroup, openViewer, viewerOpen, viewerNav, openCounter, openFlights, createFlight, downloadMD, downloadCSV,
  deleteFlight, archiveFlight, openActivity, backup, restore, openMenu, openPeople, showMyLink, switchProfile, clientEdit, clientSlip, openClients, newPassenger, newDispatcher, fillDemo, openSlips, openExpense, openPhoto, openBulk, readShot, aiName, aiCheck,
  msgReceiver, copy,
} from './sheets.js';

try { const t = localStorage.getItem('amanat3.theme'); if (t) document.documentElement.dataset.theme = t; S.hideInstall = localStorage.getItem('amanat3.noinstall') === '1'; } catch (e) { /* ignore */ }
setRender(render);

/* ---------- boot ---------- */
// The private link looks like https://…/#k=<key>. The key is remembered on this device,
// so next time only the code is asked.
// Clients: the shared link is …/#c (phone + own code); a personal link is …/#p=<key>.
function readKey() {
  const h = location.hash + location.search;
  const pk = /[#&?]p=([A-Za-z0-9_-]{10,60})/.exec(h);
  if (pk) { S.ckey = pk[1]; S.cmode = 'key'; history.replaceState(null, '', location.pathname); }
  else if (/^#c$|[#&?]c(?:&|$)/.test(location.hash)) { S.cmode = 'phone'; history.replaceState(null, '', location.pathname); }
  const m = /[#&?]k=([A-Za-z0-9_-]{10,60})/.exec(h);
  if (m) { lsSet('amanat4.key', m[1]); S.cmode = ''; history.replaceState(null, '', location.pathname); }
  try { S.key = localStorage.getItem('amanat4.key') || ''; } catch (e) { S.key = m ? m[1] : ''; }
}
async function boot() {
  if (!initFirebase(await storageWorks())) { render(); return; }
  navigator.storage?.persist?.().catch(() => {});
  readKey();
  addEventListener('hashchange', () => { readKey(); if (!S.me) whoAmI(); });
  onAuthStateChanged(auth, async (u) => {
    if (S.real) return; // viewing as someone else: the real login is untouched
    S.user = u || null;
    if (!u) { S.me = null; unsubscribeAll(); schedule(); whoAmI(); return; }
    try {
      const r = await u.getIdTokenResult();
      const c = r.claims;
      if (c.env !== SPACE || !ROLE_LABEL[c.role]) { S.me = null; S.user = null; schedule(); whoAmI(); return; }
      S.me = { uid: c.pid, role: c.role, name: c.name || '' };
      S.loginErr = '';
      if (S.me.role === 'passenger' || S.me.role === 'client') loadPortal();
      if (isStaff()) {
        subscribeBase();
        waitForPendingWrites(db).then(() => { S.pendingDocs = 0; schedule(); }).catch(() => {});
      }
    } catch (e) { console.warn(e); }
    schedule();
  });
}
// A passenger's page comes from the server (they have no database access). Refreshed each minute.
async function loadPortal() {
  if (S.me?.role !== 'passenger' && S.me?.role !== 'client') return;
  try { S.portal = await api('portal'); if (S.portal.trackUrls) S.cfg = { trackUrls: S.portal.trackUrls }; } catch (e) { if (!S.portal) S.portal = { error: e.offline ? 'No internet. Connect and try again.' : e.message, trips: [] }; }
  schedule();
}
// Passengers: every minute (a contact may open any moment). Clients: when they come back to the page.
setInterval(() => { if (document.visibilityState === 'visible' && S.me?.role === 'passenger') loadPortal(); }, 60000);
let lastPortal = 0;
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.me?.role === 'client' && Date.now() - lastPortal > 120000) { lastPortal = Date.now(); loadPortal(); } });
if (window.__t) window.__t.api = api;
setTickApi((fid) => api('tick', { fid }));
setClientApi((d) => api('people', d));
setOnMe(() => loadPortal());
// Before login: is this a fresh install (setup), and whose link is this?
async function whoAmI() {
  S.who = null; S.loginErr = '';
  if (S.cmode === 'key') { clientKeyLogin(); return; }
  if (S.cmode === 'phone') { schedule(); return; }
  if (S.key) {
    try { S.who = await api('login', { key: S.key }, { authed: false }); }
    catch (e) { if (!e.offline) { S.loginErr = e.message; if (e.status === 404) { S.key = ''; lsSet('amanat4.key', null); } } else S.who = { name: '' }; }
  }
  if (!S.key) { try { S.setup = await api('setup', undefined, { authed: false }); } catch (e) { S.setup = null; } }
  schedule();
}

/* ---------- client login ---------- */
async function clientKeyLogin() {
  S.loggingIn = true; schedule();
  try { const { token } = await api('client', { action: 'key', key: S.ckey }, { authed: false }); await withTimeout(signInWithCustomToken(auth, token), 20000); S.cmode = ''; }
  catch (e) { S.loginErr = e.offline ? 'No internet. Connect and open the link again.' : e.message; S.cmode = 'phone'; }
  S.loggingIn = false; schedule();
}
async function clientStep() {
  const phone = ($('#cl-phone')?.value || S.cphone || '').trim();
  const code = ($('#cl-code')?.value || '').trim(), code2 = ($('#cl-code2')?.value || '').trim();
  S.cphone = phone; S.loginErr = '';
  if (S.cstate === 'new' && code !== code2) { S.loginErr = 'The two codes are not the same.'; schedule(); return; }
  S.loggingIn = true; schedule();
  try {
    if (!S.cstate || S.cstate === 'off') { const r = await api('client', { action: 'lookup', phone }, { authed: false }); S.cstate = r.state; }
    else {
      const r = await api('client', { action: S.cstate === 'new' ? 'claim' : 'login', phone, code }, { authed: false });
      if (r.token) { await withTimeout(signInWithCustomToken(auth, r.token), 20000); S.cmode = ''; S.cstate = ''; }
      else if (r.state) S.cstate = r.state;
    }
  } catch (e) { S.loginErr = e.offline ? 'No internet. Connect and try again.' : e.message; }
  S.loggingIn = false; schedule();
  setTimeout(() => ($('#cl-code') || $('#cl-phone'))?.focus(), 50);
}

/* ---------- login & setup ---------- */
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Opening took too long. Check the internet and try again. In a private tab, try a normal tab.')), ms))]);
async function doLogin() {
  const code = ($('#pin-in')?.value || '').trim();
  if (!code) return;
  S.loggingIn = true; S.loginErr = ''; schedule();
  try {
    const { token } = await api('login', { key: S.key, code }, { authed: false });
    await withTimeout(signInWithCustomToken(auth, token), 20000);
    S.tab = 'photos'; S.show = null;
  } catch (e) { S.loginErr = e.offline ? 'No internet. The first login on a device needs internet.' : e.message; }
  S.loggingIn = false; schedule();
}
function useLink() {
  const v = ($('#link-in')?.value || '').trim();
  const p = /p=([A-Za-z0-9_-]{10,60})/.exec(v);
  if (p) { S.ckey = p[1]; S.cmode = 'key'; whoAmI(); return; }
  if (/#c\b/.test(v)) { S.cmode = 'phone'; S.cstate = ''; schedule(); return; }
  const m = /k=([A-Za-z0-9_-]{10,60})/.exec(v) || /^([A-Za-z0-9_-]{10,60})$/.exec(v);
  if (!m) { S.loginErr = 'That does not look like an Amanat link.'; schedule(); return; }
  S.key = m[1]; lsSet('amanat4.key', S.key); whoAmI();
}
async function doSetup() {
  const name = $('#su-name').value.trim(), code = $('#su-code').value, code2 = $('#su-code2').value, setupKey = $('#su-key').value;
  if (code !== code2) { S.loginErr = 'The two codes are not the same.'; schedule(); return; }
  S.loggingIn = true; S.loginErr = ''; schedule();
  try {
    const { token, pid, key } = await api('setup', { setupKey, name, code }, { authed: false });
    S.key = key; lsSet('amanat4.key', key);
    await signInWithCustomToken(auth, token);
    put('people/' + pid, { name, role: 'dev', key, phone: '', city: '', note: '', disabled: false, at: tnow() });
    showMyLink(key);
  } catch (e) { S.loginErr = e.message; }
  S.loggingIn = false; schedule();
}

/* ---------- actions ---------- */
// Runs a slow action with its button disabled; errors are shown, never lost.
async function busy(el, fn) {
  if (el.disabled) return; el.disabled = true;
  try { await fn(); } catch (e) { toast(e.message || String(e), { ms: 5000 }); }
  el.disabled = false;
}
const sel = () => [...S.sel];
const ACT = {
  noop: () => {},
  closeSheet: () => closeSheet(),
  tab: (el) => { S.tab = el.dataset.v; lsSet('amanat3.tab', S.tab); window.scrollTo(0, 0); schedule(); },
  useLink: () => useLink(),
  clientStep: () => clientStep(),
  clientStart: () => { S.cmode = 'phone'; S.cstate = ''; S.loginErr = ''; schedule(); },
  clientBack: () => { S.cstate = ''; S.loginErr = ''; schedule(); },
  haveLink: () => { S.setup = null; schedule(); },
  otherLink: () => { S.cmode = ''; S.key = ''; S.who = null; lsSet('amanat4.key', null); whoAmI(); },
  login: () => doLogin(),
  setup: () => doSetup(),
  menu: () => openMenu(),
  switchFace: () => switchProfile(),
  people: () => openPeople(),
  goto: (el) => document.getElementById(el.dataset.v)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
  newPassenger: (el) => busy(el, () => newPassenger($('#np-name').value.trim(), $('#np-phone').value.trim())),
  newDispatcher: (el) => busy(el, () => newDispatcher($('#nd-name').value.trim(), $('#nd-phone').value.trim())),
  flDisp: (el) => busy(el, async () => { const f = S.flights.find((x) => x.id === S.fid); if (!f) return; if (!navigator.onLine) throw new Error('Changing dispatchers needs internet.'); const id = el.dataset.id; await setFlightDispatchers(f.id, (f.dids || []).includes(id) ? f.dids.filter((x) => x !== id) : [...(f.dids || []), id]); }),
  demo: (el) => busy(el, () => fillDemo()),
  clients: () => { closeSheet(); openClients(); },
  myDetails: () => { if (S.portal?.me) clientEdit(S.portal.me, loadPortal); },
  saveLanding: () => saveLanding($('#fl-date').value, $('#fl-time').value),
  addTrip: () => { const p = S.people.find((x) => x.id === $('#fl-pass')?.value); if (p) addTrip(p); },
  tripRelease: (el) => setTripRelease(el.dataset.id, el.dataset.on === '1'),
  delTrip: async (el) => { if (await ask('Remove this passenger from the flight?', 'Remove')) delTrip(el.dataset.id); },
  gotBag: (el) => gotBag(el.dataset.id, el.dataset.k, Number(el.dataset.d)),
  selRecv: (el) => setRecv(sel(), el.dataset.v),
  portalReload: () => loadPortal(),
  slips: () => openSlips(),
  slipsOkAll: () => { const gs = S.groups.filter((g) => g.cid && (g.receipt || g.tracking) && !g.slipOk); gs.forEach((g) => upd('groups/' + g.id, { slipOk: true })); toast(`${plural(gs.length, 'slip')} now visible to clients`); },
  addExpense: () => openExpense(),
  delExpense: async (el) => { if (await ask('Delete this expense?')) delExpense(el.dataset.id); },
  expPhoto: (el) => openPhoto('Receipt', el.dataset.id, 'receipts'),
  clientEdit: () => { if (S.portal?.me) clientEdit(S.portal.me, loadPortal); },
  clientSlip: (el) => clientSlip(el.dataset.id),
  clientShow: (el) => { const g = groupById(el.dataset.id); if (g && isAdmin()) { upd('groups/' + g.id, { [el.dataset.k]: el.dataset.on === '1' }); toast(el.dataset.on === '1' ? 'Now visible to the client' : 'Hidden from the client'); } },
  cEditOk: (el) => upd('groups/' + el.dataset.id, { cEdit: null }),
  exitView: () => exitViewAs(),
  release: (el) => setRelease([el.dataset.id], el.dataset.on === '1'),
  releaseSvc: (el) => { const ids = active().filter((g) => svcKey(g.service) === el.dataset.v && !g.released).map((g) => g.id); if (ids.length) setRelease(ids, true); },
  releaseAll: () => { const ids = active().filter((g) => !g.released).map((g) => g.id); if (ids.length) setRelease(ids, true); },
  flights: () => openFlights(),
  createFlight: () => createFlight(),
  openFlight: (el) => { setFlight(el.dataset.id); closeSheet(); },
  mdFlight: (el) => downloadMD(el.dataset.id),
  csvFlight: (el) => downloadCSV(el.dataset.id),
  delFlight: (el) => deleteFlight(el.dataset.id),
  resumeDelete: () => deleteFlight(S.fid, true),
  archiveFlight: (el) => archiveFlight(el.dataset.id),
  activity: (el) => openActivity(el.dataset.id),
  backup: () => backup(false),
  backupPhotos: () => backup(true),
  restore: () => restore(),
  show: (el) => { S.show = el.dataset.v; S.gridLimit = 120; schedule(); },
  showUn: () => { S.tab = 'photos'; S.show = 'un'; window.scrollTo(0, 0); schedule(); },
  showMissing: () => { S.tab = 'groups'; S.gf.status = 'missing'; window.scrollTo(0, 0); schedule(); },
  selAll: () => { shownItems().forEach((i) => S.sel.add(i.id)); schedule(); },
  selClear: () => { S.sel.clear(); schedule(); },
  selToGroup: () => openPickGroup(sel()),
  selUngroup: () => moveItems(sel(), ''),
  selCombine: () => combine(sel()),
  selDelete: async () => { if (!isAdmin()) return; if (!(await ask(`Delete ${plural(S.sel.size, 'item')} and their photos?`))) return; deleteItems(sel()); },
  newGroupSel: () => { if (DRAG.justEnded) return; openGroupSheet(null, sel()); },
  editGroup: (el) => { if (DRAG.justEnded) return; openGroupSheet(el.dataset.id); },
  addSelTo: (el) => moveItems(sel(), el.dataset.id),
  view: (el) => { const order = $$('#view .card').map((c) => c.dataset.iid); openViewer(el.dataset.id, order.length ? order : visItems().map((i) => i.id)); },
  toggleSent: () => { S.showSent = !S.showSent; schedule(); },
  openSent: (el) => { S.openSent = S.openSent === el.dataset.v ? null : el.dataset.v; schedule(); },
  sendAll: async (el) => {
    const k = el.dataset.v; const gs = active().filter((g) => svcKey(g.service) === k); if (!gs.length) return;
    if (!(await choose('Mark all ' + k + ' sent?', `${plural(gs.length, 'parcel')} will move to "sent" and stop showing in the lists.`, [{ label: 'Cancel', v: false }, { label: 'Mark sent', v: true, cls: 'primary' }]))) return;
    setDone(gs.map((g) => g.id), true);
  },
  delItem: async (el) => { if (!isAdmin()) return; deleteItems([el.dataset.id]); },
  toggleDone: (el) => { const g = groupById(el.dataset.id); if (g && can('send')) setDone([g.id], !g.done); },
  counter: (el) => openCounter(el.dataset.id),
  hideInstall: () => { S.hideInstall = true; lsSet('amanat3.noinstall', '1'); schedule(); },
  uqToggle: () => { S.uqOpen = !S.uqOpen; schedule(); },
  uqRetry: (el) => retryUpload(el.dataset.id),
  uqDrop: (el) => dropUpload(el.dataset.id),
  uqClear: () => clearUploads(),
  gf: (el) => { S.gf[el.dataset.k] = el.dataset.v; schedule(); },
  dashToggle: (el, ev) => { ev.preventDefault(); S.dash = !S.dash; schedule(); },
  bulk: () => openBulk(),
  shot: () => readShot(),
  aiNameAll: () => aiName(visItems().filter((i) => !i.name).map((i) => i.id)),
  aiNameSel: () => aiName(sel()),
  aiCheck: (el) => aiCheck(el.dataset.id),
  msgReceiver: (el) => msgReceiver(el.dataset.id),
  copy: (el) => copy(el.dataset.v, 'Tracking number copied'),
};

/* ---------- events ---------- */
let lastTap = { id: null, t: 0 };
document.addEventListener('click', (ev) => {
  const big = ev.target.closest('[data-big]');
  if (big && !ev.target.closest('button,input,textarea,select,a,[data-tsel]')) {
    const id = big.dataset.big, t = now();
    if (lastTap.id === id && t - lastTap.t < 400) { lastTap = { id: null, t: 0 }; openCounter(id); return; }
    lastTap = { id, t };
  }
});
document.addEventListener('dblclick', (ev) => { if (ev.target.closest('[data-big]') && !ev.target.closest('button,input,textarea,select')) ev.preventDefault(); });
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-tsel]');
  if (t && !ev.target.closest('[data-act]')) {
    if (DRAG.justEnded || BOX.justEnded) return;
    const id = t.dataset.tsel;
    // Shift-click selects the range from the last clicked item (feature 8).
    if (ev.shiftKey && S.lastSel) {
      const order = $$('#view .card').map((c) => c.dataset.iid); const a = order.indexOf(S.lastSel), b = order.indexOf(id);
      if (a >= 0 && b >= 0) { order.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => S.sel.add(x)); S.lastSel = id; schedule(); return; }
    }
    S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); S.lastSel = id; schedule(); return;
  }
  const a = ev.target.closest('[data-act]'); if (!a || a.disabled) return;
  const fn = ACT[a.dataset.act]; if (fn) Promise.resolve(fn(a, ev)).catch((e) => console.warn(e));
});
const typing = (el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName) || el?.isContentEditable;
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { if (layerCount()) { closeTop(); return; } if (S.sel.size) { S.sel.clear(); schedule(); } return; }
  if (ev.key === 'Enter' && ev.target.id === 'pin-in') { ev.preventDefault(); doLogin(); return; }
  if (ev.key === 'Enter' && ev.target.id === 'link-in') { ev.preventDefault(); useLink(); return; }
  if (ev.key === 'Enter' && /^cl-/.test(ev.target.id)) { ev.preventDefault(); clientStep(); return; }
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('[data-tsel]')) { ev.preventDefault(); ev.target.click(); return; }
  if (typing(ev.target) || !S.me) return;
  if (viewerOpen() && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) { ev.preventDefault(); viewerNav(ev.key === 'ArrowLeft' ? -1 : 1); return; }
  if (layerCount()) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a' && S.tab === 'photos') { ev.preventDefault(); ACT.selAll(); return; }
  if (ev.key.toLowerCase() === 'g' && S.sel.size && can('group') && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); openPickGroup(sel()); return; }
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && S.sel.size && isAdmin()) { ev.preventDefault(); ACT.selDelete(); }
});
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.name) saveLater('items/' + t.dataset.name, { name: t.value.trim() });
  if (t.dataset.qty) { const v = parseInt(t.value, 10); saveLater('items/' + t.dataset.qty, { qty: v > 0 ? v : null }); }
  if (t.dataset.q !== undefined && t.id === 'q') { S.q = t.value; S.gridLimit = 120; schedule(); }
});
document.addEventListener('change', (ev) => {
  if (ev.target.matches('input[data-up]')) { const fs = ev.target.files; if (fs && fs.length) handleFiles(fs); ev.target.value = ''; }
  if (ev.target.dataset.gf) { S.gf[ev.target.dataset.gf] = ev.target.value; schedule(); }
  const tr = ev.target.dataset.trip;
  if (tr) { const f = ev.target.dataset.f, v = ev.target.value; updTrip(tr, f === 'auto' ? { auto: v === '' ? null : Number(v) } : { [f]: f === 'weight' ? (parseFloat(v) > 0 ? parseFloat(v) : null) : Math.max(0, parseInt(v, 10) || 0) }); }
});
let dragDepth = 0;
document.addEventListener('dragenter', (e) => { if (can('upload') && e.dataTransfer?.types?.includes('Files')) { dragDepth++; document.body.classList.add('filedrag'); } });
document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('filedrag'); });
document.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files?.length) return; e.preventDefault(); dragDepth = 0; document.body.classList.remove('filedrag');
  if (can('upload')) { S.tab = 'photos'; handleFiles(e.dataTransfer.files); } else toast('Your profile cannot add photos.');
});

/* ---------- drag items onto groups (mouse + touch) ---------- */
(function () {
  let st = null, timer = null;
  const begin = (x, y) => {
    if (!st || !can('group')) { st = null; return; } st.active = true; DRAG.active = true;
    st.ids = S.sel.has(st.id) ? [...S.sel] : [st.id]; const it = S.items.find((i) => i.id === st.id);
    const g = document.createElement('div'); g.className = 'ghost'; g.innerHTML = `<img src="${safeImg(it?.photos?.[0]?.t || '')}" alt="">${st.ids.length > 1 ? `<b>${st.ids.length}</b>` : ''}`; document.body.appendChild(g); st.ghost = g;
    st.ids.forEach((id) => $(`.card[data-iid="${id}"]`)?.classList.add('lift')); try { navigator.vibrate?.(15); } catch (e) { /* ignore */ } move(x, y);
  };
  const move = (x, y) => {
    if (!st?.ghost) return; st.ghost.style.left = x + 'px'; st.ghost.style.top = y + 'px';
    const t = document.elementFromPoint(x, y)?.closest('[data-drop]'); $$('.hot').forEach((c) => { if (c !== t) c.classList.remove('hot'); }); if (t) t.classList.add('hot'); st.target = t || null;
    const tray = $('.tray'); if (tray && getComputedStyle(tray).display !== 'none') { const r = tray.getBoundingClientRect(); if (y > r.top - 30 && y < r.bottom + 30) { if (x < r.left + 50) tray.scrollLeft -= 14; else if (x > r.right - 50) tray.scrollLeft += 14; } }
    const pn = $('.gpanel'); if (pn && getComputedStyle(pn).display !== 'none') { const r = pn.getBoundingClientRect(); if (x > r.left) { if (y < r.top + 50) pn.scrollTop -= 14; else if (y > r.bottom - 50) pn.scrollTop += 14; } }
    if (y < 80) window.scrollBy(0, -12); else if (y > innerHeight - 80) window.scrollBy(0, 12);
  };
  const end = () => {
    clearTimeout(timer); timer = null; if (!st) return; const s = st; st = null; if (!s.active) return;
    s.ghost?.remove(); $$('.card.lift').forEach((c) => c.classList.remove('lift')); $$('.hot').forEach((c) => c.classList.remove('hot'));
    DRAG.active = false; DRAG.justEnded = true; setTimeout(() => (DRAG.justEnded = false), 350);
    if (s.target) { const gid = s.target.dataset.drop; if (!gid || !groupById(gid)?.done) moveItems(s.ids, gid); }
    schedule();
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return; const ph = e.target.closest('[data-tsel]'); if (!ph || e.target.closest('#sheets')) return;
    st = { id: ph.dataset.tsel, x: e.clientX, y: e.clientY, type: e.pointerType, active: false };
    if (e.pointerType !== 'mouse') timer = setTimeout(() => begin(st?.x, st?.y), 330);
  });
  document.addEventListener('pointermove', (e) => {
    if (!st) return;
    if (!st.active) {
      const dx = Math.abs(e.clientX - st.x), dy = Math.abs(e.clientY - st.y);
      if (st.type === 'mouse') { if (dx + dy > 8) { e.preventDefault(); begin(e.clientX, e.clientY); } }
      else if (dx > 10 || dy > 10) { clearTimeout(timer); st = null; }
      return;
    }
    move(e.clientX, e.clientY);
  });
  document.addEventListener('pointerup', () => end());
  document.addEventListener('pointercancel', () => { if (st && !st.active) { clearTimeout(timer); st = null; } });
  document.addEventListener('touchmove', (e) => { if (st?.active) { e.preventDefault(); const t = e.touches[0]; if (t) move(t.clientX, t.clientY); } }, { passive: false });
  document.addEventListener('touchend', () => { if (st?.active) end(); });
  document.addEventListener('contextmenu', (e) => { if (e.target.closest('.ph')) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => { if (e.target.closest?.('.ph')) e.preventDefault(); });
})();

/* ---------- box select on laptop (feature 8) ---------- */
const BOX = { justEnded: false };
(function () {
  let st = null;
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || S.tab !== 'photos' || layerCount()) return;
    const grid = e.target.closest('.board > div'); if (!grid || e.target.closest('.card,button,input,select,textarea,a,.toolbar,.search')) return;
    st = { x: e.pageX, y: e.pageY, el: null, base: e.shiftKey || e.ctrlKey || e.metaKey ? new Set(S.sel) : new Set() };
  });
  document.addEventListener('pointermove', (e) => {
    if (!st) return;
    const x1 = Math.min(st.x, e.pageX), y1 = Math.min(st.y, e.pageY), x2 = Math.max(st.x, e.pageX), y2 = Math.max(st.y, e.pageY);
    if (!st.el) { if (x2 - x1 + y2 - y1 < 10) return; st.el = document.createElement('div'); st.el.className = 'selbox'; document.body.appendChild(st.el); }
    Object.assign(st.el.style, { left: x1 + 'px', top: y1 + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
    const next = new Set(st.base);
    $$('#view .card').forEach((c) => { const r = c.getBoundingClientRect(); const cx1 = r.left + scrollX, cy1 = r.top + scrollY; if (cx1 < x2 && cx1 + r.width > x1 && cy1 < y2 && cy1 + r.height > y1) next.add(c.dataset.iid); });
    S.sel = next; schedule(); e.preventDefault();
  });
  document.addEventListener('pointerup', () => {
    if (!st) return; if (st.el) { st.el.remove(); BOX.justEnded = true; setTimeout(() => (BOX.justEnded = false), 200); } st = null;
  });
})();

/* ---------- service worker updates ---------- */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() { toast('A new version of Amanat is ready.', { ms: 15000, undo: () => update(true) }); const b = $$('.toast .undo').pop(); if (b) b.textContent = 'Reload'; },
    });
  }).catch(() => {});
}

render();
boot();
