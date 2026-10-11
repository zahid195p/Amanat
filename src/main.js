import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './style.css';
import {
  S, $, $$, now, plural, isAdmin, can, groupById, active, toSend, ungrouped, visItems, toast, closeSheet, closeTop, layerCount, ask, choose,
  schedule, setRender, DRAG, initFirebase, auth, onAuthStateChanged, signInWithCustomToken, subscribeProfiles, subscribeBase,
  unsubscribeAll, setFlight, saveLater, moveItems, combine, deleteItems, setDone, svcKey, lsSet, waitForPendingWrites, db, numberItems, put, now as tnow,
} from './core.js';
import { render, shownItems } from './views.js';
import { handleFiles, retryUpload, dropUpload, clearUploads } from './images.js';
import { api } from './api.js';
import {
  openGroupSheet, openPickGroup, openViewer, viewerOpen, viewerNav, openCounter, openFlights, createFlight, downloadMD, downloadCSV,
  deleteFlight, archiveFlight, openActivity, backup, restore, openMenu, openProfile, switchProfile, openBulk, readShot, aiName, aiCheck,
  msgReceiver, copy,
} from './sheets.js';

try { const t = localStorage.getItem('amanat3.theme'); if (t) document.documentElement.dataset.theme = t; S.hideInstall = localStorage.getItem('amanat3.noinstall') === '1'; } catch (e) { /* ignore */ }
setRender(render);

/* ---------- boot ---------- */
function boot() {
  if (!initFirebase()) { render(); return; }
  navigator.storage?.persist?.().catch(() => {});
  subscribeProfiles();
  onAuthStateChanged(auth, async (u) => {
    S.user = u || null;
    if (!u) { S.me = null; unsubscribeAll(); schedule(); maybeSetup(); return; }
    try {
      const r = await u.getIdTokenResult();
      const role = r.claims.role;
      if (!['admin', 'sorter'].includes(role)) { S.me = null; schedule(); return; }
      S.me = { uid: u.uid, role, perms: r.claims.perms || {}, name: S.profiles.find((p) => p.id === u.uid)?.name || '' };
      S.loginPick = null; S.loginErr = '';
      subscribeBase();
      waitForPendingWrites(db).then(() => { S.pendingDocs = 0; schedule(); }).catch(() => {});
    } catch (e) { console.warn(e); }
    schedule();
  });
}
async function maybeSetup() {
  try { S.setup = await api('setup', undefined, { authed: false }); } catch (e) { S.setup = null; }
  schedule();
}

/* ---------- login & setup ---------- */
async function doLogin() {
  const code = ($('#pin-in')?.value || '');
  if (!code) return;
  S.loggingIn = true; S.loginErr = ''; schedule();
  try {
    const { token } = await api('login', { profileId: S.loginPick, code }, { authed: false });
    await signInWithCustomToken(auth, token);
    S.tab = 'photos'; S.show = null;
  } catch (e) { S.loginErr = e.offline ? 'No internet. The first login on a device needs internet.' : e.message; }
  S.loggingIn = false; schedule();
}
async function doSetup() {
  const name = $('#su-name').value.trim(), code = $('#su-code').value, code2 = $('#su-code2').value, setupKey = $('#su-key').value;
  if (code !== code2) { S.loginErr = 'The two codes are not the same.'; schedule(); return; }
  S.loggingIn = true; S.loginErr = ''; schedule();
  try {
    const profileId = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'admin').slice(0, 20);
    const { token } = await api('setup', { setupKey, profileId, name, code }, { authed: false });
    await signInWithCustomToken(auth, token);
    put('profiles/' + profileId, { name, role: 'admin', color: '#2D6FC7', job: 'Uploads and names photos, sends the parcels', perms: {}, disabled: false, at: tnow() });
    toast('Amanat is set up. Add a flight, then add Tayyab bhai in Menu > Profiles.', { ms: 6000 });
  } catch (e) { S.loginErr = e.message; }
  S.loggingIn = false; schedule();
}

/* ---------- actions ---------- */
const sel = () => [...S.sel];
const ACT = {
  noop: () => {},
  closeSheet: () => closeSheet(),
  tab: (el) => { S.tab = el.dataset.v; lsSet('amanat3.tab', S.tab); window.scrollTo(0, 0); schedule(); },
  pickFace: (el) => { S.loginPick = el.dataset.v; S.loginErr = ''; schedule(); setTimeout(() => $('#pin-in')?.focus(), 50); },
  login: () => doLogin(),
  setup: () => doSetup(),
  menu: () => openMenu(),
  switchFace: () => switchProfile(),
  addProfile: () => openProfile(null),
  editProfile: (el) => openProfile(el.dataset.id),
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
    const g = document.createElement('div'); g.className = 'ghost'; g.innerHTML = `<img src="${it?.photos?.[0]?.t || ''}" alt="">${st.ids.length > 1 ? `<b>${st.ids.length}</b>` : ''}`; document.body.appendChild(g); st.ghost = g;
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
