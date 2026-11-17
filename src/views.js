// Rendering of the main screens. Everything is re-rendered from state (snapshots) via morphdom.
import morphdom from 'morphdom';
import {
  S, $, esc, plural, fmtDate, fmtPhone, fmtBytes, isAdmin, can, curFlight, groupById, gColor, gTitle, visItems, itemsIn, gLabel, pLabel,
  safeImg, isDispatcher, isStaff, SPACE, ROLE_LABEL, fmtLanding, fmtClock, fmtIn, timeOfPk, AUTO_CHOICES, RECV,
  ungrouped, active, sentGroups, toSend, qtyOf, piecesIn, numLabel, itemLabel, svcKey, svcSort, mainSvc, missing,
  trackUrl, STEPS, FREE_BYTES, layerCount,
} from './core.js';
import { CITIES, SERVICES, waNumber, isMobile } from './parse.js';
import { aiAllowed } from './api.js';
import { refreshOpenLayers } from './sheets.js';

export const ICON = {
  trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.1 4.5 4.5 0 0 0 7 18z"/><path d="M12 11v5M9.5 13.5 12 11l2.5 2.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  wa: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.2-.2-.5-.3z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
};
export const pendingBadge = (on) => (on ? `<span class="pend" title="Saved on this device, waiting to upload">${ICON.cloud}</span>` : '');

export function render() {
  $('#hdr').innerHTML = hdr();
  const v = $('#view');
  const nx = document.createElement('main'); nx.id = 'view'; nx.innerHTML = view();
  morphdom(v, nx, {
    getNodeKey: (n) => (n.nodeType === 1 ? n.id || n.getAttribute('data-key') || undefined : undefined),
    onBeforeElUpdated: (from, to) => {
      if (from.isEqualNode(to)) return false;
      if (from === document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(from.tagName)) to.value = from.value;
      return true;
    },
  });
  const on = !!S.me && S.flightsLoaded;
  const tb = $('#tabs'); tb.hidden = !on;
  if (on) {
    const un = ungrouped().length;
    tb.innerHTML = [['flight', 'Flight'], ['photos', 'Items'], ['groups', 'Parcels'], ['service', 'Send']].map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${l}${k === 'photos' && un && S.items.length ? `<span class="dot" title="Not in a parcel">${un}</span>` : ''}</button>`).join('');
  }
  selbar(on);
  refreshOpenLayers();
  observeSentinel();
}

function syncPill() {
  const n = Math.max(S.inflight, S.pendingDocs);
  if (!S.online) return `<span class="pill off" title="Changes are saved on this device and upload when the internet is back">Offline${n ? ' · ' + n + ' waiting' : ''}</span>`;
  if (n) return `<span class="pill sync" title="Uploading changes">Syncing ${n}</span>`;
  if (S.flightsFromCache) return '<span class="pill sync" title="Connecting to the server">Connecting</span>';
  return '<span class="pill ok" title="Everything is uploaded">Online</span>';
}
function hdr() {
  const brand = `<div class="brand">Amanat${SPACE === 'test' ? '<span class="testtag" title="Test site: nothing here touches the real data">TEST</span>' : ''}</div>`;
  if (!S.me || !isStaff()) return brand + (S.me ? `<span></span><div class="hdr-r"><button class="face" data-act="${S.me.viewAs ? 'exitView' : 'switchFace'}">${S.me.viewAs ? 'Stop viewing' : 'Log out'}</button></div>` : '');
  const f = curFlight();
  return `${brand}<button class="tag" data-act="flights" aria-label="Choose flight"><span class="hole"></span><span class="tag-t">${f ? esc(f.label || 'Flight') : 'Add a flight'}</span>${f ? `<span class="tag-s">${esc(fmtDate(f.date))}</span>` : ''}</button><div class="hdr-r">${syncPill()}<button class="face" data-act="menu" aria-label="Menu and settings">${esc(S.me.name || 'Me')}</button></div>`;
}

function view() {
  if (S.fatal) return `<div class="empty narrow"><h2>Can't open Amanat</h2><p>${esc(S.fatal)}</p></div>`;
  if (!S.configured) return `<div class="empty narrow"><h2>Almost ready</h2><p>Amanat is not connected to its database yet. Add the Firebase web config to <code>src/firebase-config.js</code> and deploy again.</p></div>`;
  if (S.user === undefined) return '<div class="spin" aria-label="Loading"></div>';
  if (!S.me) return !S.key && S.setup?.needed ? vSetup() : vLogin();
  const banner = S.me.viewAs ? `<div class="note view" data-key="viewas"><span>Viewing as <b>${esc(S.me.name)}</b> (${ROLE_LABEL[S.me.role]}). This is exactly what they can see. Nothing can be changed.</span><button class="btn sm" data-act="exitView">Stop viewing</button></div>` : '';
  if (S.me.role === 'passenger') return banner + vPassenger();
  if (S.me.role === 'client') return banner + vClient();
  if (!isStaff()) return banner + `<div class="empty narrow"><h2>Hello ${esc(S.me.name)}</h2><p>Nothing to show.</p></div>`;
  return banner + staffView();
}
function staffView() {
  if (!S.flightsLoaded) return '<div class="spin" aria-label="Loading"></div>';
  if (!curFlight()) return `<div class="empty narrow"><h2>No flight yet</h2>${can('flights') ? '<p>Add the flight first. Items and parcels are kept per flight.</p><button class="btn primary" data-act="flights">Add a flight</button>' : '<p>You are not on any flight right now. It appears here when the owner adds you to one.</p>'}</div>`;
  if (curFlight().deleting) return `<div class="empty narrow"><h2>This flight is being deleted</h2><p>${isAdmin() ? '<button class="btn danger" data-act="resumeDelete">Finish deleting</button>' : 'Pick another flight.'}</p><button class="btn" data-act="flights">Flights</button></div>`;
  let h = installHint();
  if (S.tab === 'flight') h += vFlight();
  else if (S.tab === 'groups') h += vGroups();
  else if (S.tab === 'service') h += vService();
  else h += vPhotos();
  return h;
}

function installHint() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!ios || standalone || S.hideInstall) return '';
  return `<div class="note" data-key="install"><span>Install Amanat: tap <b>Share</b>, then <b>Add to Home Screen</b>. Then it opens offline and iPhone keeps its data safe.</span><button class="btn sm" data-act="hideInstall">OK</button></div>`;
}

/* ---------- login & setup ---------- */
function vClientLogin() {
  const st = S.cstate;
  const err = `<div class="status err" id="login-err">${esc(S.loginErr || '')}</div>`;
  const busy = S.loggingIn ? 'disabled' : '';
  if (S.cmode === 'key' && !S.loginErr) return '<div class="spin" aria-label="Loading"></div>';
  let h = '<div class="faces"><h1 style="font-size:32px">Your parcels</h1>';
  if (!st) h += `<p>Type the phone number Tayyab has for you.</p><label class="fld"><span>Phone number</span><input id="cl-phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(S.cphone || '')}" placeholder="0300 1234567"></label><button class="btn primary wide" data-act="clientStep" ${busy}>${S.loggingIn ? 'Checking…' : 'Continue'}</button>`;
  else if (st === 'new') h += `<p>First time on this phone number. Choose a 4-digit code. You need it only if you open this on another phone.</p><label class="fld"><span>Choose a 4-digit code</span><input id="cl-code" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></label><label class="fld"><span>Type it again</span><input id="cl-code2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></label><button class="btn primary wide" data-act="clientStep" ${busy}>${S.loggingIn ? 'Opening…' : 'Open my parcels'}</button>`;
  else if (st === 'code') h += `<p>Type your 4-digit code. If you forgot it, ask Tayyab to reset it.</p><label class="fld"><span>Your code</span><input id="cl-code" type="password" inputmode="numeric" maxlength="4" autocomplete="current-password"></label><button class="btn primary wide" data-act="clientStep" ${busy}>${S.loggingIn ? 'Opening…' : 'Open my parcels'}</button>`;
  else if (st === 'off') h += '<p>For this number, please use the private link Tayyab sent you.</p>';
  h += err + (st ? '<button class="btn sm" data-act="clientBack">Use a different number</button>' : '') + '</div>';
  return h;
}
function vLogin() {
  if (S.cmode) return vClientLogin();
  if (S.key && S.who) {
    return `<div class="faces"><h1 style="font-size:32px">${S.who.name ? 'Hello ' + esc(S.who.name) : 'Welcome back'}</h1>
    <form class="pin" onsubmit="return false"><input id="pin-in" type="password" inputmode="text" autocomplete="current-password" placeholder="Your code" aria-label="Your code"><button class="btn primary" data-act="login" ${S.loggingIn ? 'disabled' : ''}>${S.loggingIn ? 'Opening…' : 'Open'}</button></form>
    <div class="status err" id="login-err">${esc(S.loginErr || '')}</div>
    <p class="dim">You stay signed in on this device, even offline. Never share your link or code.</p>
    <button class="btn sm" data-act="otherLink">Use a different link</button></div>`;
  }
  if (S.key && !S.loginErr) return '<div class="spin" aria-label="Loading"></div>';
  return `<div class="faces"><h1 style="font-size:32px">Open your private link</h1><p>Amanat opens with the private link that was sent to you. If you have it, paste it here.</p>
  <div class="pin"><input id="link-in" autocomplete="off" placeholder="Paste your link" aria-label="Your private link"><button class="btn primary" data-act="useLink">Continue</button></div>
  <div class="status err" id="login-err">${esc(S.loginErr || '')}</div>
  <p style="margin-top:18px">Waiting for a parcel? <button class="btn sm" data-act="clientStart">Open with my phone number</button></p></div>`;
}
function vSetup() {
  const c = S.setup?.configured;
  const missingCfg = c ? Object.entries({ kv: 'KV namespace binding AMANAT_KV', serviceAccount: 'secret FIREBASE_SERVICE_ACCOUNT' }).filter(([k]) => !c[k]).map(([, v]) => v) : [];
  return `<div class="faces"><h1 style="font-size:32px">Set up Amanat</h1><p>This runs once and makes the developer login. You choose your own code; nobody else can see it.</p>
  ${missingCfg.length ? `<div class="note bad"><span>Cloudflare is still missing: ${esc(missingCfg.join(', '))}.</span></div>` : ''}
  <label class="fld"><span>Your name</span><input id="su-name" value="Zahid" autocomplete="name"></label>
  <label class="fld"><span>Choose your code (at least 6 characters)</span><input id="su-code" type="password" autocomplete="new-password"></label>
  <label class="fld"><span>Type it again</span><input id="su-code2" type="password" autocomplete="new-password"></label>
  <label class="fld"><span>Setup phrase</span><input id="su-key" type="password" autocomplete="off"></label>
  <button class="btn primary wide" data-act="setup" ${S.loggingIn ? 'disabled' : ''}>${S.loggingIn ? 'Setting up…' : 'Set up and open'}</button><div class="status err" id="login-err">${esc(S.loginErr || '')}</div>
  <p class="dim" style="margin-top:14px">Already have a private link? <button class="btn sm" data-act="haveLink">Paste it</button></p></div>`;
}

/* ---------- search ---------- */
const lc = (s) => String(s || '').toLowerCase();
function groupText(g) { return lc([g.name, g.phone, g.phone2, g.city, g.address, g.tracking, g.service, g.note, ...itemsIn(g.id).map((i) => i.name)].join(' ')); }
export function matchGroup(g) { const q = lc(S.q).trim(); if (!q) return true; if (/^p~?\d+$/.test(q)) return lc(pLabel(g)) === q; const d = q.replace(/\D/g, ''); return groupText(g).includes(q) || (d.length >= 4 && (String(g.phone) + String(g.phone2)).replace(/\D/g, '').includes(d)); }
function matchItem(i) {
  const q = lc(S.q).trim(); if (!q) return true;
  const g = groupById(i.groupId);
  return lc(i.name).includes(q) || numLabel(i).includes(q.replace(/^#?/, '#')) || (g && matchGroup(g));
}
const searchBox = (ph) => `<div class="search"><input id="q" type="search" data-q value="${esc(S.q)}" placeholder="${ph}" aria-label="Search" autocomplete="off"></div>`;

/* ---------- flight day: landing time, passengers, bags ---------- */
const bagWord = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function tripHint(t, f) {
  if (t.released) return '';
  if (t.auto === null || t.auto === undefined) return 'The owner will release the contact.';
  if (!t.dueAt) return 'Opens by timer once the landing time is set.';
  return `Opens at ${fmtClock(t.dueAt)} Pakistan time (${t.auto ? t.auto + ' min before landing' : 'landing time'}).`;
}
function vFlight() {
  const f = curFlight(); const boss = isAdmin(); const ts = S.trips;
  const sum = (k) => ts.reduce((a, t) => a + (Number(t[k]) || 0), 0);
  let h = boss ? flightSteps(f) : '';
  h += `<div class="box" data-key="fl-head"><h2 style="font-size:28px">${esc(f.label || 'Flight')}</h2>`;
  if (boss) h += `<div class="two" style="margin-top:8px"><label class="fld"><span>Date</span><input id="fl-date" type="date" value="${esc(f.date || '')}"></label><label class="fld"><span>Landing time (Pakistan time)</span><input id="fl-time" type="time" value="${esc(timeOfPk(f.landAt))}"></label></div><button class="btn" data-act="saveLanding">Save date and time</button>`;
  h += `<p style="margin:8px 0 0;font-weight:600">${f.landAt ? `Lands ${esc(fmtLanding(f.landAt))}, ${esc(fmtIn(f.landAt))}` : esc(fmtDate(f.date)) + (boss ? '' : '. The landing time is not set yet.')}</p></div>`;
  h += `<div class="dgrid"><div><b>${ts.length}</b>passenger${ts.length === 1 ? '' : 's'}</div><div><b>${sum('checked')}</b>checked bags</div><div><b>${sum('hand')}</b>hand carries</div>${sum('weight') ? `<div><b>${+sum('weight').toFixed(1)}</b>kg</div>` : ''}<div><b>${sum('gotChecked') + sum('gotHand')}</b>collected</div></div>`;
  if (!ts.length) h += `<div class="empty"><h2>No passengers yet</h2><p>${boss ? 'Add who is carrying the luggage on this flight.' : 'The owner has not added the passengers yet.'}</p></div>`;
  h += ts.map((t, k) => {
    const who = t.locked ? `Passenger ${k + 1}` : t.name || `Passenger ${k + 1}`;
    const got = (kind, n, g) => (n ? `<div class="bagrow"><span class="grow">${kind === 'hand' ? 'Hand carries' : 'Checked bags'}: collected <b>${g || 0} of ${n}</b></span>${can('send') ? `<button class="btn sm" data-act="gotBag" data-id="${t.id}" data-k="${kind}" data-d="-1" aria-label="One less">−</button><button class="btn sm primary" data-act="gotBag" data-id="${t.id}" data-k="${kind}" data-d="1" aria-label="One more">+</button>` : ''}</div>` : '');
    let c = `<div class="gcard trip ${t.released ? 'open' : ''}" data-key="trip-${t.id}" style="--g:${t.released ? 'var(--go)' : 'var(--line)'}"><div class="gc-top"><span class="gc-name">${esc(who)}</span><span class="dim">${bagWord(t.checked || 0, 'checked bag')}, ${bagWord(t.hand || 0, 'hand carry').replace('carrys', 'carries')}${t.weight ? ', ' + esc(t.weight) + ' kg' : ''}</span></div>`;
    if (boss) {
      c += `<div class="three"><label class="fld"><span>Checked bags</span><input inputmode="numeric" data-trip="${t.id}" data-f="checked" value="${esc(t.checked ?? 0)}"></label><label class="fld"><span>Hand carries</span><input inputmode="numeric" data-trip="${t.id}" data-f="hand" value="${esc(t.hand ?? 0)}"></label><label class="fld"><span>Weight kg</span><input inputmode="decimal" data-trip="${t.id}" data-f="weight" value="${esc(t.weight ?? '')}"></label></div>`;
      c += t.released
        ? `<div class="rel on">Passenger and dispatcher can see each other's contact <button class="btn sm" data-act="tripRelease" data-id="${t.id}" data-on="0">Hide</button></div>`
        : `<label class="fld"><span>Open the contact between passenger and dispatcher</span><select data-trip="${t.id}" data-f="auto">${AUTO_CHOICES.map(([v, l]) => `<option value="${v ?? ''}" ${(t.auto ?? null) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><div class="rel hid">${esc(tripHint(t, f))} <button class="btn sm" data-act="tripRelease" data-id="${t.id}" data-on="1">Release now</button></div>`;
    }
    c += got('checked', t.checked, t.gotChecked) + got('hand', t.hand, t.gotHand);
    if (!boss) c += t.locked ? `<div class="rel hid">Contact not released yet. ${esc(tripHint(t, f))}</div>` : '';
    if (!t.locked && t.phone) c += `<div class="row" style="margin-top:8px"><b>${esc(fmtPhone(t.phone))}</b>${telLinks({ phone: t.phone }, true)}</div>`;
    else if (!t.locked && !boss) c += '<div class="dim">No phone number saved for this passenger.</div>';
    if (boss) c += `<div class="row" style="margin-top:8px"><button class="btn sm danger" data-act="delTrip" data-id="${t.id}">Remove from flight</button></div>`;
    return c + '</div>';
  }).join('');
  h += expensesBox(boss);
  if (boss) {
    const free = S.people.filter((p) => p.role === 'passenger' && !p.disabled && !ts.some((t) => t.pid === p.id));
    h += `<div class="box" data-key="fl-add" id="fl-add"><b>Add a passenger</b>
    <div class="two" style="margin-top:8px"><label class="fld"><span>Name</span><input id="np-name" autocomplete="off"></label><label class="fld"><span>Phone</span><input id="np-phone" type="tel" inputmode="tel"></label></div>
    <button class="btn primary" data-act="newPassenger">Add passenger</button>
    ${free.length ? `<div class="row" style="margin-top:10px"><span class="dim">Or someone from before:</span><select id="fl-pass" class="grow" style="width:auto">${free.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button class="btn" data-act="addTrip">Add</button></div>` : ''}</div>`;
    const ds = S.people.filter((p) => p.role === 'dispatcher' && !p.disabled);
    h += `<div class="box" data-key="fl-disp" id="fl-disp"><b>Dispatchers on this flight</b>
    <p class="dim" style="font-size:14px;margin:4px 0 8px">They see the flight time, the bags and the items. They see a client's address only when you share it.</p>
    ${ds.length ? `<div class="chips">${ds.map((p) => `<button class="chip ${(f.dids || []).includes(p.id) ? 'on' : ''}" data-act="flDisp" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div>` : ''}
    <div class="two" style="margin-top:10px"><label class="fld"><span>New dispatcher name</span><input id="nd-name" autocomplete="off"></label><label class="fld"><span>Phone</span><input id="nd-phone" type="tel" inputmode="tel"></label></div>
    <button class="btn" data-act="newDispatcher">Add dispatcher</button></div>`;
    if (SPACE === 'test') h += '<div class="box" data-key="fl-demo"><b>Test site only</b><p class="dim" style="font-size:14px;margin:4px 0 8px">Fill a new example flight with a passenger, a dispatcher, clients, items and parcels, so you can try everything.</p><button class="btn" data-act="demo">Fill with demo data</button></div>';
  }
  return h;
}

function expensesBox(boss) {
  const es = S.expenses; const rs = (n) => 'Rs ' + Math.round(n).toLocaleString('en-PK');
  const total = es.reduce((a, e) => a + (Number(e.amount) || 0), 0);
  const courier = boss ? S.groups.reduce((a, g) => a + (Number(g.charges) || 0), 0) : 0;
  const cats = {}; es.forEach((e) => (cats[e.cat || 'Other'] = (cats[e.cat || 'Other'] || 0) + (Number(e.amount) || 0)));
  return `<div class="box" data-key="fl-exp"><div class="row"><b class="grow">${boss ? 'Expenses' : 'My expenses'} · ${rs(total)}</b><button class="btn sm primary" data-act="addExpense">Add expense</button></div>
  ${boss && (courier || total) ? `<div class="dim" style="font-size:14px;margin-top:4px">${Object.entries(cats).map(([k, v]) => `${esc(k)} ${rs(v)}`).join(' · ')}${courier ? `${total ? ' · ' : ''}Courier charges on parcels ${rs(courier)}` : ''}. <b>All together ${rs(total + courier)}</b></div>` : ''}
  ${es.map((e) => `<div class="prow" data-key="ex-${e.id}">${e.receipt?.t ? `<img class="rthumb sm" src="${safeImg(e.receipt.t)}" alt="Receipt" data-act="expPhoto" data-id="${esc(e.receipt.p)}">` : ''}<span class="grow"><b>${rs(Number(e.amount) || 0)}</b> ${esc(e.cat || '')}${e.note ? ' · ' + esc(e.note) : ''}${pendingBadge(e._pending)}<br><span class="dim" style="font-size:13px">${boss && e.byName ? esc(e.byName) + ' · ' : ''}${esc(fmtDate(new Date((e.at || 0) + 5 * 3600000).toISOString().slice(0, 10)))}</span></span>${boss || e.by === S.me.uid ? `<button class="btn sm danger" data-act="delExpense" data-id="${e.id}" aria-label="Delete expense">${ICON.trash}</button>` : ''}</div>`).join('') || '<p class="dim" style="margin-bottom:0">Rides, packing and other costs for this flight. Courier charges are entered on each parcel.</p>'}</div>`;
}

// The owner's to-do list for this flight. The first step not done is marked as next.
function flightSteps(f) {
  const its = visItems(), gs = S.groups, open = gs.filter((g) => !g.done);
  const un = ungrouped().length, noAddr = gs.filter((g) => !g.locked && !g.address).length;
  const clients = new Set(gs.map((g) => g.cid).filter(Boolean)); const opened = [...clients].filter((id) => S.people.find((p) => p.id === id)?.codeSet).length;
  const shared = open.filter((g) => g.released).length, slips = gs.filter((g) => g.receipt || g.tracking).length;
  const steps = [
    { done: !!(f.landAt && S.trips.length), t: 'Flight and passenger', d: `${f.landAt ? 'Lands ' + fmtClock(f.landAt) : 'No landing time yet'} · ${plural(S.trips.length, 'passenger')}`, act: 'goto', v: 'fl-add' },
    { done: its.length > 0, t: 'Items', d: plural(its.length, 'photo'), act: 'tab', v: 'photos' },
    { done: its.length > 0 && !un && gs.length > 0, t: 'Who gets what', d: gs.length ? `${plural(gs.length, 'parcel')}${un ? ` · ${un} item${un === 1 ? '' : 's'} not in a parcel` : ''}` : 'Paste the addresses to make the parcels', act: 'tab', v: 'groups' },
    { done: clients.size > 0 && !noAddr, t: 'Client addresses', d: clients.size ? `${opened} of ${clients.size} clients opened the link${noAddr ? ` · ${noAddr} with no address` : ''}` : 'Clients come from the parcels', act: 'clients' },
    { done: (f.dids || []).length > 0 && open.length > 0 && shared === open.length, t: 'Share with dispatcher', d: (f.dids || []).length ? `${shared} of ${open.length} addresses shared` : 'No dispatcher on this flight yet', act: (f.dids || []).length ? 'tab' : 'goto', v: (f.dids || []).length ? 'service' : 'fl-disp' },
    { done: gs.length > 0 && slips === gs.length, t: 'Slips', d: `${slips} of ${gs.length}`, act: 'tab', v: 'service' },
  ];
  const next = steps.findIndex((x) => !x.done);
  return `<div class="steplist" data-key="fl-steps">${steps.map((x, k) => `<button class="stepi ${x.done ? 'done' : ''} ${k === next ? 'now' : ''}" data-act="${x.act}" data-v="${x.v || ''}"><span class="sn">${x.done ? '✓' : k + 1}</span><span class="grow"><b>${x.t}</b><small>${esc(x.d)}</small></span></button>`).join('')}</div>`;
}

/* ---------- the passenger's own page ---------- */
function vPassenger() {
  const p = S.portal;
  if (!p) return '<div class="spin" aria-label="Loading"></div>';
  if (p.error) return `<div class="empty narrow"><h2>Hello ${esc(S.me.name)}</h2><p>${esc(p.error)}</p><button class="btn" data-act="portalReload">Try again</button></div>`;
  if (!p.trips.length) return `<div class="empty narrow"><h2>Hello ${esc(S.me.name)}</h2><p>You have no flight right now. It appears here when it is added.</p><button class="btn" data-act="portalReload">Refresh</button></div>`;
  return `<div class="faces"><h1 style="font-size:30px">Hello ${esc(S.me.name)}</h1>${p.trips.map((t) => `<div class="box" data-key="pt-${esc(t.id)}"><h2 style="font-size:26px">${esc(t.flight.label)}</h2>
   <p style="font-weight:600">${t.flight.landAt ? 'Lands ' + esc(fmtLanding(t.flight.landAt)) : esc(fmtDate(t.flight.date))}</p>
   <div class="dgrid"><div><b>${t.checked}</b>checked bags</div><div><b>${t.hand}</b>hand carries</div>${t.weight ? `<div><b>${esc(t.weight)}</b>kg</div>` : ''}</div>
   <h3 style="font-size:20px;margin-top:10px">Who collects the luggage</h3>
   ${t.released ? (t.dispatchers.length ? t.dispatchers.map((d) => `<div class="row" style="margin-top:6px"><b class="grow">${esc(d.name)}${d.phone ? ' · ' + esc(fmtPhone(d.phone)) : ''}</b>${telLinks({ phone: d.phone }, true)}</div>`).join('') : '<p class="dim">The person is not chosen yet.</p>') : `<p class="dim">You will see the name and number here ${t.dueAt ? 'at ' + esc(fmtClock(t.dueAt)) + ' Pakistan time' : 'when it is released'}.</p>`}</div>`).join('')}
   <button class="btn" data-act="portalReload">Refresh</button></div>`;
}

/* ---------- the client's own page ---------- */
const C_STATUS = { coming: 'On the way', arrived: 'Arrived, being prepared', packed: 'Packed', booked: 'Booked with courier', sent: 'Sent', delivered: 'Delivered' };
function vClient() {
  const p = S.portal;
  if (!p) return '<div class="spin" aria-label="Loading"></div>';
  if (p.error) return `<div class="empty narrow"><h2>Hello ${esc(S.me.name)}</h2><p>${esc(p.error)}</p><button class="btn" data-act="portalReload">Try again</button></div>`;
  const ps = p.parcels || []; const me = p.me || {};
  const mine = `<div class="box ${me.address ? '' : 'needs'}" data-key="c-me"><div class="row"><b class="grow">My delivery details</b><button class="btn sm ${me.address ? '' : 'primary'}" data-act="myDetails">${me.address ? 'Change' : 'Add my address'}</button></div>
   ${me.address ? `<div class="caddr" style="border:0;padding:0;margin:6px 0 0">${esc(me.name || '')}${me.phone ? ' · ' + esc(fmtPhone(me.phone)) : ''}<br>${esc([me.address, me.city].filter(Boolean).join(', '))}<br><span class="dim">Send by: ${esc(me.service || 'not chosen yet')}</span></div>` : '<p class="warn" style="margin:6px 0 0">We do not have your address yet. Please add it so we can send your parcels.</p>'}</div>`;
  if (!ps.length) return `<div class="cpage"><h1 style="font-size:30px">Hello ${esc(S.me.name)}</h1>${mine}<p class="dim">You have no parcels yet. They appear here when they are on a flight.</p><button class="btn" data-act="portalReload">Refresh</button></div>`;
  // Things that come over several flights (15 seed packets, a few per flight): running totals.
  const tot = new Map();
  for (const x of ps) for (const i of x.items) { const k = i.name.trim().toLowerCase(); if (!k) continue; const t = tot.get(k) || { name: i.name.trim(), got: 0, sent: 0 }; t.got += i.qty; if (x.status === 'sent' || x.status === 'delivered') t.sent += i.qty; tot.set(k, t); }
  const rows = [...tot.values()].filter((t) => t.got > 1).sort((a, b) => b.got - a.got);
  let h = `<div class="cpage"><h1 style="font-size:30px">Hello ${esc(S.me.name)}</h1>${mine}`;
  if (rows.length) h += `<div class="box" data-key="c-tot"><b>Your items so far</b><table class="dtab"><tr><th>Item</th><th>Arrived</th><th>Sent to you</th></tr>${rows.map((t) => `<tr><td>${esc(t.name)}</td><td>${t.got}</td><td>${t.sent}</td></tr>`).join('')}</table></div>`;
  h += ps.map((x) => {
    const tu = x.slip?.tracking ? trackUrl({ tracking: x.slip.tracking, service: x.service }) : '';
    return `<div class="gcard cparcel st-${esc(x.status)}" data-key="cp-${esc(x.id)}" style="--g:${x.status === 'sent' || x.status === 'delivered' ? 'var(--go)' : 'var(--sign)'}">
    <div class="gc-top"><span class="gc-name">${esc(x.flight.label)} <span class="dim" style="font-size:15px;font-family:var(--f-body)">${esc(fmtDate(x.flight.date))}</span></span><span class="svc">${esc(C_STATUS[x.status] || '')}</span></div>
    ${x.items.length ? `<div class="citems">${x.items.map((i) => `<div class="cit">${i.t ? `<img src="${safeImg(i.t)}" alt="" loading="lazy">` : '<span class="noimg"></span>'}<span>${esc(i.name || 'Item')}${i.qty > 1 ? ' ×' + i.qty : ''}</span></div>`).join('')}</div>` : '<p class="dim">The items are not listed yet.</p>'}
    <div class="caddr"><b>${esc(x.name || 'No name yet')}</b>${x.phone ? ' · ' + esc(fmtPhone(x.phone)) : ''}<br>${esc([x.address, x.city].filter(Boolean).join(', ') || 'No address yet')}<br><span class="dim">Send by: ${esc(x.service || 'not chosen yet')}</span></div>
    ${x.slip ? `<div class="cslip">${x.slip.tracking ? `<span>Tracking <b>${esc(x.slip.tracking)}</b> <button class="ib" data-act="copy" data-v="${esc(x.slip.tracking)}" aria-label="Copy tracking number">${ICON.copy}</button>${tu ? ` <a href="${esc(tu)}" target="_blank" rel="noopener">Track</a>` : ''}</span>` : ''}${x.slip.has ? `<button class="slipb" data-act="clientSlip" data-id="${esc(x.id)}" aria-label="Open the booking slip">${x.slip.t ? `<img src="${safeImg(x.slip.t)}" alt="Booking slip">` : 'Open slip'}</button>` : ''}</div>` : ''}
    ${x.pickup ? `<div class="cslip"><span class="grow"><b>Collect from:</b> ${x.pickup.length ? x.pickup.map((d) => `${esc(d.name)}${d.phone ? ' · ' + esc(fmtPhone(d.phone)) : ''} ${telLinks({ phone: d.phone })}`).join('<br>') : 'not chosen yet'}</span></div>` : ''}
    </div>`;
  }).join('');
  return h + '<button class="btn" data-act="portalReload">Refresh</button></div>';
}

/* ---------- photos ---------- */
function card(i) {
  const g = groupById(i.groupId); const sel = S.sel.has(i.id); const ph = i.photos || [];
  const edit = can('name');
  return `<div class="card ${sel ? 'sel' : ''}" data-key="it-${i.id}" data-iid="${i.id}">
 <div class="ph" data-tsel="${i.id}" role="button" tabindex="0" aria-pressed="${sel}" aria-label="Select item ${numLabel(i)}">${ph[0] ? `<img src="${safeImg(ph[0].t)}" alt="" draggable="false" loading="lazy" decoding="async">` : ''}<span class="num">${numLabel(i)}</span>${ph.length > 1 ? `<span class="stack">${ph.length} photos</span>` : ''}${g ? `<span class="gtag" style="--g:${gColor(g)}">${esc(gLabel(g))}</span>` : ''}${i.recv ? `<span class="recv r-${esc(i.recv)}">${esc(RECV[i.recv] || '')}</span>` : ''}<span class="ck">${sel ? '✓' : ''}</span>${i._pending ? `<span class="pend on-ph">${ICON.cloud}</span>` : ''}</div>
 <button class="zoom" data-act="view" data-id="${i.id}" aria-label="Open large">⤢</button>
 <div class="meta">${edit ? `<input class="nm" id="nm-${i.id}" data-name="${i.id}" value="${esc(i.name || '')}" placeholder="Name it, e.g. brown shoes" aria-label="Name"><input class="qt" id="qt-${i.id}" data-qty="${i.id}" inputmode="numeric" value="${esc(i.qty ?? '')}" placeholder="Qty" aria-label="Quantity">` : `<div class="nmt ${i.name ? '' : 'none'}">${esc(i.name || 'No name')}${Number(i.qty) > 1 ? ` ×${esc(i.qty)}` : ''}</div>`}${isAdmin() ? `<button class="del" data-act="delItem" data-id="${i.id}" aria-label="Delete item ${numLabel(i)}" title="Delete">${ICON.trash}</button>` : ''}</div></div>`;
}
export function telLinks(g, big) {
  const out = [];
  const p = String(g.phone || '').trim();
  if (p) out.push(`<a class="btn sm" href="tel:${esc(p.replace(/[^\d+]/g, ''))}" aria-label="Call ${esc(fmtPhone(p))}">${ICON.phone}${big ? ' Call' : ''}</a>`);
  if (p && isMobile(p)) out.push(`<a class="btn sm wa" href="https://wa.me/${waNumber(p)}" target="_blank" rel="noopener" aria-label="WhatsApp ${esc(fmtPhone(p))}">${ICON.wa}${big ? ' WhatsApp' : ''}</a>`);
  return out.join('');
}
// Owner: is the receiver visible to the dispatcher? Dispatcher: a note while it is hidden.
export function releaseLine(g) {
  if (g.locked) return '<div class="rel hid">The owner has not shared this address yet</div>';
  if (!isAdmin() || g.done) return '';
  if (g.typedBy) return `<div class="rel on">Added by ${esc(S.people.find((p) => p.id === g.typedBy)?.name || 'the dispatcher')}, who can see it <button class="btn sm" data-act="release" data-id="${g.id}" data-on="1">Share with all dispatchers</button></div>`;
  return g.released
    ? `<div class="rel on">Shared with dispatcher <button class="btn sm" data-act="release" data-id="${g.id}" data-on="0">Stop sharing</button></div>`
    : `<div class="rel hid">Address not shared with dispatcher <button class="btn sm" data-act="release" data-id="${g.id}" data-on="1">Share</button></div>`;
}
// Owner: whose parcel this is, and what that client may see on their page.
export function clientLine(g) {
  if (!isAdmin() || g.locked || !g.cid) return '';
  const c = S.people.find((p) => p.id === g.cid);
  let h = `<div class="rel cl">Client: ${esc(c?.name || 'removed')}${g.cEdit ? ` <span class="warn">changed the delivery details</span> <button class="btn sm" data-act="cEditOk" data-id="${g.id}">OK</button>` : ''}</div>`;
  const tg = (key, on, what) => `<div class="rel ${on ? 'on' : 'hid'}">${what} ${on ? 'visible to client' : 'hidden from client'} <button class="btn sm" data-act="clientShow" data-id="${g.id}" data-k="${key}" data-on="${on ? 0 : 1}">${on ? 'Hide' : 'Show'}</button></div>`;
  if ((g.tracking || g.receipt) && !S.cfg.slipAuto) h += tg('slipOk', g.slipOk, 'Slip and tracking');
  if (/pickup/i.test(g.service || '')) h += tg('pickOk', g.pickOk, 'Dispatcher contact (pickup)');
  return h;
}
export function groupCard(g, compact) {
  const its = itemsIn(g.id); const m = missing(g); const n = compact ? 8 : 16;
  const svcs = String(g.service || '').split('/').map((s) => s.trim()).filter(Boolean);
  return `<div class="gcard ${g.done ? 'sent' : ''}" data-key="g-${g.id}" data-big="${g.id}" ${g.done ? '' : `data-drop="${g.id}"`} style="--g:${gColor(g)}">
 <div class="gc-top"><span class="pno" title="Parcel number: write it on the box">${esc(pLabel(g))}</span><span class="gc-name">${g.done ? '✓ ' : ''}${esc(gTitle(g))}</span>${pendingBadge(g._pending)}<span class="svc ${g.service ? '' : 'none'}">${esc(svcs[0] || 'No service')}</span>${svcs.length > 1 ? `<span class="svc alt">or ${esc(svcs.slice(1).join(' / '))}</span>` : ''}</div>
 <div class="gc-sub">${esc([g.city, fmtPhone(g.phone)].filter(Boolean).join(', ') || (g.locked ? '' : 'No phone or city'))}</div>
 ${!compact && g.address ? `<div style="font-size:15px">${esc(g.address)}</div>` : ''}
 ${m.length ? `<div class="warn">Missing: ${m.join(', ')}</div>` : ''}
 ${releaseLine(g)}${clientLine(g)}
 ${g.aiPending ? `<div class="aip">AI check pending${S.online && aiAllowed() ? ` <button class="btn sm" data-act="aiCheck" data-id="${g.id}">Check now</button>` : ''}</div>` : ''}
 ${its.length ? `<div class="gthumbs">${its.slice(0, n).map((i) => `<img src="${safeImg(i.photos?.[0]?.t || '')}" alt="${esc(itemLabel(i))}" title="${esc(itemLabel(i))}" loading="lazy">`).join('')}${its.length > n ? `<span class="dim">+${its.length - n}</span>` : ''}</div><div class="dim" style="font-size:14px">${esc(its.map(itemLabel).join(', '))}</div>` : `<div class="dim" style="font-size:14px;margin:6px 0">${g.done ? 'No items' : 'Drop items here'}</div>`}
 <div class="row" style="margin-top:8px">${S.sel.size && !g.done && can('group') ? `<button class="btn sm primary" data-act="addSelTo" data-id="${g.id}">Add ${S.sel.size} here</button>` : ''}${telLinks(g)}${can('group') || can('send') ? `<button class="btn sm" data-act="editGroup" data-id="${g.id}">Edit</button>` : ''}${can('send') ? `<button class="btn sm ${g.done ? '' : 'dark'}" data-act="toggleDone" data-id="${g.id}">${g.done ? 'Undo sent' : 'Mark sent'}</button>` : ''}</div></div>`;
}
function uploadPanel() {
  if (!S.uq.length) return '';
  const c = (s) => S.uq.filter((u) => u.status === s).length;
  const total = S.uq.length, finished = c('saved') + c('done') + c('failed');
  const label = { waiting: 'Waiting', working: 'Preparing', saved: 'On this device, uploading', done: 'Uploaded', failed: 'Failed' };
  return `<div class="uq" data-key="uq"><div class="row"><span class="status grow">${finished < total ? `Adding ${finished} of ${total}` : `${c('done')} uploaded${c('saved') ? `, ${c('saved')} waiting for internet` : ''}${c('failed') ? `, ${c('failed')} failed` : ''}`}</span><button class="btn sm" data-act="uqToggle">${S.uqOpen ? 'Hide' : 'Details'}</button>${finished === total ? '<button class="btn sm" data-act="uqClear">Clear</button>' : ''}</div><div class="progress"><i style="width:${Math.round((finished / total) * 100)}%"></i></div>
  ${S.uqOpen || c('failed') ? `<ul class="uql">${S.uq.filter((u) => S.uqOpen || u.status === 'failed').map((u) => `<li class="uq-${u.status}"><span class="grow">${esc(u.name)}<br><small>${esc(u.status === 'failed' ? u.err || 'Failed' : label[u.status])}</small></span>${u.status === 'failed' ? `${u.file ? `<button class="btn sm" data-act="uqRetry" data-id="${u.id}">Retry</button>` : ''}<button class="btn sm" data-act="uqDrop" data-id="${u.id}">Remove</button>` : ''}</li>`).join('')}</ul>` : ''}</div>`;
}
function shownItems() {
  const base = S.show === 'un' ? ungrouped() : S.show === 'todo' ? toSend() : S.show === 'unchecked' ? visItems().filter((i) => !i.recv) : visItems();
  return base.filter(matchItem);
}
export { shownItems };
function vPhotos() {
  const un = ungrouped(); const ts = toSend(); if (!S.show) S.show = can('upload') ? 'todo' : 'un';
  const shown = shownItems();
  let h = '';
  if (can('upload')) {
    h += `<div class="up"><label class="btn primary"><span>Camera</span><input class="vh" type="file" accept="image/*" capture="environment" data-up></label><label class="btn"><span>Photos or files</span><input class="vh" type="file" accept="image/*,.heic,.heif" multiple data-up></label></div><div class="drophint">You can also drop photos anywhere on this page.</div>`;
  }
  h += uploadPanel();
  const all = visItems();
  if (all.length && un.length) h += `<div class="note bad"><span>${plural(un.length, 'item')} not in a parcel yet</span>${S.show !== 'un' ? '<button class="btn sm" data-act="show" data-v="un">Show them</button>' : ''}</div>`;
  if (all.length && !un.length) h += `<div class="note"><span>Every item is in a parcel.</span><button class="btn sm" data-act="tab" data-v="service">Go to Send</button></div>`;
  const checked = all.filter((i) => i.recv).length, bad = all.filter((i) => i.recv === 'missing' || i.recv === 'damaged').length;
  if (all.length && (checked || isDispatcher())) h += `<div class="note ${bad ? 'bad' : ''}"><span>Receive check: ${checked} of ${all.length} checked${bad ? `, ${bad} missing or damaged` : ''}</span>${checked < all.length && S.show !== 'unchecked' ? '<button class="btn sm" data-act="show" data-v="unchecked">Show unchecked</button>' : ''}</div>`;
  h += `<div class="tray" aria-label="Parcels"><button class="gchip" data-drop="" data-act="noop"><span>No parcel</span><b>${un.length}</b></button>${active().map((g) => `<button class="gchip" data-key="tray-${g.id}" data-drop="${g.id}" data-act="editGroup" data-id="${g.id}" style="--g:${gColor(g)}"><i></i><span><b class="pn">${esc(pLabel(g))}</b> ${esc(gTitle(g))}</span><b>${itemsIn(g.id).length}</b></button>`).join('')}${can('group') ? '<button class="gchip add" data-act="newGroupSel">+ New parcel</button>' : ''}</div>`;
  h += `<div class="board"><div><div class="toolbar"><div class="seg"><button class="${S.show === 'un' ? 'on' : ''}" data-act="show" data-v="un">No parcel ${un.length}</button><button class="${S.show === 'todo' ? 'on' : ''}" data-act="show" data-v="todo">Still to send ${ts.length}</button><button class="${S.show === 'all' ? 'on' : ''}" data-act="show" data-v="all">All ${all.length}</button></div>${shown.length ? '<button class="btn sm" data-act="selAll">Select all shown</button>' : ''}${aiAllowed() && can('name') && all.some((i) => !i.name) ? '<button class="btn sm" data-act="aiNameAll" title="Send thumbnails to AI to suggest names">Name with AI</button>' : ''}</div>
 ${all.length > 12 ? searchBox('Search items, #number or parcel') : ''}
 <p class="dim hint">${matchMedia('(pointer:fine)').matches ? 'Click photos to select (Shift-click for a range, or drag a box). Drag them onto a parcel on the right.' : 'Tap photos to select, then Put in parcel. Or hold a photo and drag it onto a parcel above.'}</p>`;
  if (!all.length) h += `<div class="empty"><h2>No photos yet</h2><p>${can('upload') ? 'Take a photo of each item, or add many at once from your library.' : 'No photos have been uploaded for this flight yet. They appear here as soon as they are.'}</p></div>`;
  else if (!shown.length) h += S.q ? '<div class="empty"><h2>Nothing found</h2><p>No item matches the search.</p></div>' : '<div class="empty"><h2>All in parcels</h2><p>Every item is in a parcel.</p></div>';
  else {
    // Fast grid: render in batches; a sentinel near the end loads the next batch.
    const lim = Math.max(S.gridLimit, 60);
    h += `<div class="grid" id="grid">${shown.slice(0, lim).map(card).join('')}</div>${shown.length > lim ? `<div id="more" class="dim more">Loading ${shown.length - lim} more…</div>` : ''}`;
  }
  h += `</div><aside class="gpanel" aria-label="Parcels">${can('group') ? '<button class="btn primary wide" data-act="newGroupSel" style="margin-bottom:10px">+ New parcel (paste addresses)</button><div class="dropzone" data-drop="">Drop here to take out of a group</div>' : ''}${active().map((g) => groupCard(g, true)).join('') || '<p class="dim">No parcels waiting to be sent.</p>'}${sentList()}</aside></div>`;
  return h;
}
let io = null;
function observeSentinel() {
  const m = document.getElementById('more');
  if (!m) return;
  if (!io) io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { S.gridLimit += 120; import('./core.js').then((c) => c.schedule()); } }, { rootMargin: '800px' });
  io.disconnect(); io.observe(m);
}
function sentList() {
  const sg = sentGroups().filter(matchGroup); if (!sg.length) return '';
  return `<div class="sentbox"><button class="btn sm wide" data-act="toggleSent">${S.showSent ? 'Hide' : 'Show'} sent parcels (${sg.length})</button>${S.showSent ? `<div style="margin-top:8px">${sg.map((g) => groupCard(g, true)).join('')}</div>` : ''}</div>`;
}

/* ---------- groups ---------- */
function filteredGroups() {
  const f = S.gf;
  let gs = S.groups.filter(matchGroup);
  if (f.city) gs = gs.filter((g) => lc(g.city) === lc(f.city));
  if (f.service) gs = gs.filter((g) => svcKey(g.service) === f.service);
  if (f.status === 'open') gs = gs.filter((g) => !g.done);
  if (f.status === 'sent') gs = gs.filter((g) => g.done);
  if (f.status === 'missing') gs = gs.filter((g) => !g.done && missing(g).length);
  const by = { parcel: (a, b) => (a.pn || 1e9) - (b.pn || 1e9) || (a.at || 0) - (b.at || 0), newest: (a, b) => (b.at || 0) - (a.at || 0), oldest: (a, b) => (a.at || 0) - (b.at || 0), name: (a, b) => lc(a.name).localeCompare(lc(b.name)), city: (a, b) => lc(a.city).localeCompare(lc(b.city)) || lc(a.name).localeCompare(lc(b.name)) };
  return gs.sort(by[f.sort] || by.parcel);
}
function vGroups() {
  let h = `<div class="row" style="margin-bottom:12px">${can('group') ? `<button class="btn primary" data-act="newGroupSel">+ New parcel (paste addresses)</button><button class="btn" data-act="bulk">Paste many addresses</button>${aiAllowed() ? '<button class="btn" data-act="shot">Read a screenshot</button>' : ''}` : ''}</div>`;
  if (!S.groups.length) return h + '<div class="empty"><h2>No parcels yet</h2><p>Make one parcel for each client. Paste the person\'s message as it is; name, phones, address, city and service are filled in for you.</p></div>';
  const cities = [...new Set(S.groups.map((g) => g.city).filter(Boolean))].sort();
  const svcs = [...new Set(S.groups.map((g) => svcKey(g.service)))].sort(svcSort);
  const f = S.gf;
  h += searchBox('Search P3, name, phone, city, tracking, item');
  h += `<div class="filters"><div class="seg">${[['open', 'To send'], ['missing', 'Missing details'], ['sent', 'Sent'], ['all', 'All']].map(([k, l]) => `<button class="${f.status === k ? 'on' : ''}" data-act="gf" data-k="status" data-v="${k}">${l}</button>`).join('')}</div>
  <select data-gf="city" aria-label="City"><option value="">All cities</option>${cities.map((c) => `<option ${f.city === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
  <select data-gf="service" aria-label="Service"><option value="">All services</option>${svcs.map((c) => `<option ${f.service === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
  <select data-gf="sort" aria-label="Sort">${[['parcel', 'Parcel number'], ['oldest', 'Oldest first'], ['newest', 'Newest first'], ['name', 'Name A–Z'], ['city', 'City']].map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
  const gs = filteredGroups();
  return h + (gs.length ? `<div class="glist">${gs.map((g) => groupCard(g, false)).join('')}</div>` : '<div class="empty"><h2>Nothing here</h2><p>No parcel matches these filters.</p></div>');
}

/* ---------- by service ---------- */
function dashboard() {
  const its = visItems(); const pieces = its.reduce((s, i) => s + qtyOf(i), 0);
  const gs = S.groups; const sent = gs.filter((g) => g.done).length; const pct = gs.length ? Math.round((sent / gs.length) * 100) : 0;
  const by = {}; gs.forEach((g) => { const k = svcKey(g.service); by[k] = by[k] || { n: 0, sent: 0, kg: 0, rs: 0 }; by[k].n++; if (g.done) by[k].sent++; by[k].kg += Number(g.weight) || 0; by[k].rs += Number(g.charges) || 0; });
  const kg = gs.reduce((s, g) => s + (Number(g.weight) || 0), 0), rs = gs.reduce((s, g) => s + (Number(g.charges) || 0), 0);
  const used = S.flights.reduce((s, f) => s + (f.bytes || 0), 0);
  return `<details class="dash" data-key="dash" ${S.dash ? 'open' : ''}><summary data-act="dashToggle"><b>Flight summary</b><span class="dim">${plural(gs.length, 'parcel')}, ${pct}% sent</span></summary>
  <div class="dgrid"><div><b>${its.length}</b>items</div><div><b>${pieces}</b>pieces</div><div><b>${gs.length}</b>parcels</div><div><b>${sent}</b>sent</div>${kg ? `<div><b>${+kg.toFixed(2)}</b>kg</div>` : ''}${rs ? `<div><b>${rs.toLocaleString('en-PK')}</b>Rs charges</div>` : ''}</div>
  <div class="progress big"><i style="width:${pct}%"></i></div>
  <table class="dtab"><tr><th>Service</th><th>Parcels</th><th>Sent</th><th>kg</th><th>Rs</th></tr>${Object.keys(by).sort(svcSort).map((k) => `<tr><td>${esc(k)}</td><td>${by[k].n}</td><td>${by[k].sent}</td><td>${by[k].kg ? +by[k].kg.toFixed(2) : ''}</td><td>${by[k].rs ? by[k].rs.toLocaleString('en-PK') : ''}</td></tr>`).join('')}</table>
  <div class="dim" style="font-size:13px;margin-top:6px">Storage used (all flights): ${fmtBytes(used)} of ${fmtBytes(FREE_BYTES)} free</div></details>`;
}
function parcel(g, k) {
  const its = itemsIn(g.id); const m = missing(g); const svcs = String(g.service || '').split('/').map((s) => s.trim()).filter(Boolean);
  const tu = trackUrl(g);
  const step = [...STEPS].reverse().find(([s]) => g.steps?.[s]);
  return `<div class="parcel ${g.done ? 'done' : ''}" data-key="p-${g.id}" data-big="${g.id}" style="--g:${gColor(g)}">${can('send') ? `<button class="pk" data-act="toggleDone" data-id="${g.id}" aria-label="${g.done ? 'Mark not sent' : 'Mark sent'}">${g.done ? '✓' : ''}</button>` : `<span class="pk">${g.done ? '✓' : ''}</span>`}
   <span class="p-name"><span class="pno">${esc(pLabel(g))}</span> ${esc(gTitle(g))}${g.phone ? ` <span style="font-weight:600">${esc(fmtPhone(g.phone))}</span>` : ''}${g.phone2 ? `<span class="dim" style="font-weight:500">, ${esc(fmtPhone(g.phone2))}</span>` : ''}${pendingBadge(g._pending)}${svcs.length > 1 && svcs[0] === k ? ` <span class="svc alt">or ${esc(svcs.slice(1).join(' / '))}</span>` : ''}</span>
   <div class="p-addr">${esc(g.address || '')}${g.city ? `, <b>${esc(g.city)}</b>` : ''}${g.note ? `<div class="dim">${esc(g.note)}</div>` : ''}${m.length ? `<div class="warn">Missing: ${m.join(', ')}</div>` : ''}${releaseLine(g)}${clientLine(g)}
   ${g.tracking || g.weight || g.charges || step ? `<div class="p-meta">${step ? `<span class="stp">${esc(step[1])}</span>` : ''}${g.tracking ? `<span>Tracking <b>${esc(g.tracking)}</b> <button class="ib" data-act="copy" data-v="${esc(g.tracking)}" aria-label="Copy tracking number">${ICON.copy}</button>${tu ? ` <a href="${esc(tu)}" target="_blank" rel="noopener">Track</a>` : ''}</span>` : ''}${g.weight ? `<span>${esc(g.weight)} kg</span>` : ''}${g.charges ? `<span>Rs ${Number(g.charges).toLocaleString('en-PK')}</span>` : ''}</div>` : ''}</div>
   <div class="p-items">${its.length ? its.map((i) => `<span><img src="${safeImg(i.photos?.[0]?.t || '')}" alt="" loading="lazy">${esc(itemLabel(i))}</span>`).join('') : '<span class="warn" style="background:none">No items in this parcel</span>'}</div><div class="row" style="grid-column:2;margin-top:4px"><button class="btn sm" data-act="counter" data-id="${g.id}">Show big</button>${telLinks(g)}${g.done && isMobile(g.phone) ? `<button class="btn sm" data-act="msgReceiver" data-id="${g.id}">Message client</button>` : ''}${can('group') || can('send') ? `<button class="btn sm" data-act="editGroup" data-id="${g.id}">Edit</button>` : ''}</div></div>`;
}
function vService() {
  const un = ungrouped(); let h = dashboard();
  if (un.length) h += `<div class="note bad"><span>${plural(un.length, 'item')} not in a parcel. They would be left behind.</span><button class="btn sm" data-act="showUn">Show them</button></div>`;
  const bad = active().filter((g) => missing(g).length);
  if (bad.length) h += `<div class="note bad"><span>${plural(bad.length, 'parcel')} missing details.</span><button class="btn sm" data-act="showMissing">Show them</button></div>`;
  const toShow = isAdmin() && !S.cfg.slipAuto ? S.groups.filter((g) => g.cid && (g.receipt || g.tracking) && !g.slipOk) : [];
  if (S.groups.length && (can('send') || toShow.length)) h += `<div class="row" style="margin-bottom:10px">${can('send') ? '<button class="btn" data-act="slips">Add booking slips</button>' : ''}${toShow.length ? `<button class="btn" data-act="slipsOkAll">Show ${plural(toShow.length, 'slip')} to clients</button>` : ''}</div>`;
  if (S.groups.length > 6) h += searchBox('Search name, phone, city, tracking');
  if (active().length) h += '<p class="dim hint">Double-tap any parcel to show it big.</p>';
  if (S.groups.length && !active().length) h += '<div class="note"><span>Every parcel on this flight is marked sent.</span></div>';
  if (!S.groups.length) return h + '<div class="empty"><h2>Nothing sorted yet</h2><p>Parcels appear here, sorted by TCS, Daewoo, Leopards and so on, once they are made.</p></div>';
  // B5: "TCS / Leopards" is listed under TCS with a tag, so "Mark all TCS sent" covers it.
  const by = {}; S.groups.filter(matchGroup).forEach((g) => { const k = svcKey(g.service); (by[k] = by[k] || []).push(g); });
  for (const k of Object.keys(by).sort(svcSort)) {
    const all = by[k]; const open = all.filter((g) => !g.done); const sent = all.filter((g) => g.done); const showS = S.openSent === k;
    const gs = showS ? [...open, ...sent] : open;
    const items = open.reduce((a, g) => a + piecesIn(g.id), 0);
    const kg = all.reduce((s, g) => s + (Number(g.weight) || 0), 0), rs = all.reduce((s, g) => s + (Number(g.charges) || 0), 0);
    h += `<section class="svc-sec" data-key="sec-${esc(k)}"><div class="svc-h"><h2>${esc(k)}</h2><span class="dim grow" style="font-weight:600">${open.length ? `${plural(open.length, 'parcel')} to send, ${plural(items, 'piece')}` : 'All sent'}${sent.length ? `, ${sent.length} sent` : ''}${kg ? `, ${+kg.toFixed(2)} kg` : ''}${rs ? `, Rs ${rs.toLocaleString('en-PK')}` : ''}</span>${open.length && can('send') && k !== 'No service yet' ? `<button class="btn sm dark" data-act="sendAll" data-v="${esc(k)}">Mark all ${esc(k)} sent</button>` : ''}${isAdmin() && open.some((g) => !g.released) ? `<button class="btn sm" data-act="releaseSvc" data-v="${esc(k)}">Share all ${esc(k)} addresses</button>` : ''}${sent.length ? `<button class="btn sm" data-act="openSent" data-v="${esc(k)}">${showS ? 'Hide sent' : 'Show sent'}</button>` : ''}</div>${gs.map((g) => parcel(g, k)).join('')}</section>`;
  }
  return h;
}

/* ---------- selection bar ---------- */
function selbar(on) {
  let sb = $('#selbar');
  if (on && S.sel.size && S.tab !== 'service' && !layerCount()) {
    if (!sb) { sb = document.createElement('div'); sb.id = 'selbar'; sb.className = 'selbar'; document.body.appendChild(sb); }
    const grouped = [...S.sel].some((id) => groupById(S.items.find((i) => i.id === id)?.groupId));
    sb.innerHTML = `<span class="grow">${S.sel.size} selected</span>${can('group') ? `<button class="btn sm primary" data-act="selToGroup">Put in parcel</button>${grouped ? '<button class="btn sm" data-act="selUngroup">Take out</button>' : ''}` : ''}${can('upload') && S.sel.size > 1 ? '<button class="btn sm" data-act="selCombine">Combine</button>' : ''}${aiAllowed() && can('name') ? '<button class="btn sm" data-act="aiNameSel">Name with AI</button>' : ''}${can('send') ? '<button class="btn sm" data-act="selRecv" data-v="ok">Received</button><button class="btn sm" data-act="selRecv" data-v="missing">Missing</button>' : ''}${isAdmin() ? '<button class="btn sm danger" data-act="selDelete">Delete</button>' : ''}<button class="btn sm" data-act="selClear">Clear</button>`;
  } else if (sb) sb.remove();
}
export { CITIES, SERVICES, mainSvc };
