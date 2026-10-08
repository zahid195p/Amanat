// Rendering of the main screens. Everything is re-rendered from state (snapshots) via morphdom.
import morphdom from 'morphdom';
import {
  S, $, esc, plural, fmtDate, fmtPhone, fmtBytes, isAdmin, can, curFlight, groupById, gColor, gTitle, visItems, itemsIn,
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
    tb.innerHTML = [['photos', 'Photos'], ['groups', 'Groups'], ['service', 'By service']].map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${l}${k === 'photos' && un && S.items.length ? `<span class="dot" title="Not in a group">${un}</span>` : ''}</button>`).join('');
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
  if (!S.me) return '<div class="brand">Amanat</div>';
  const f = curFlight();
  return `<div class="brand">Amanat</div><button class="tag" data-act="flights" aria-label="Choose flight"><span class="hole"></span><span class="tag-t">${f ? esc(f.label || 'Flight') : 'Add a flight'}</span>${f ? `<span class="tag-s">${esc(fmtDate(f.date))}</span>` : ''}</button><div class="hdr-r">${syncPill()}<button class="face" data-act="menu" aria-label="Menu and settings">${esc(S.me.name || 'Me')}</button></div>`;
}

function view() {
  if (S.fatal) return `<div class="empty narrow"><h2>Can't open Amanat</h2><p>${esc(S.fatal)}</p></div>`;
  if (!S.configured) return `<div class="empty narrow"><h2>Almost ready</h2><p>Amanat is not connected to its database yet. Add the Firebase web config to <code>src/firebase-config.js</code> and deploy again.</p></div>`;
  if (S.user === undefined) return '<div class="spin" aria-label="Loading"></div>';
  if (!S.me) return S.profilesLoaded && !S.profiles.length ? vSetup() : vLogin();
  if (!S.flightsLoaded) return '<div class="spin" aria-label="Loading"></div>';
  if (!curFlight()) return `<div class="empty narrow"><h2>No flight yet</h2><p>Add the flight first. Photos and groups are kept per flight.</p>${can('flights') ? '<button class="btn primary" data-act="flights">Add a flight</button>' : '<p class="dim">Ask an admin to add the flight.</p>'}</div>`;
  if (curFlight().deleting) return `<div class="empty narrow"><h2>This flight is being deleted</h2><p>${isAdmin() ? '<button class="btn danger" data-act="resumeDelete">Finish deleting</button>' : 'Pick another flight.'}</p><button class="btn" data-act="flights">Flights</button></div>`;
  let h = installHint();
  if (S.tab === 'groups') h += vGroups();
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
function vLogin() {
  if (!S.profilesLoaded) return '<div class="spin" aria-label="Loading"></div>';
  const ps = S.profiles.filter((p) => !p.disabled);
  return `<div class="faces"><h1 style="font-size:32px">Who is using Amanat?</h1>${ps.map((p) => `<div class="facecard ${S.loginPick === p.id ? 'on' : ''}" data-key="face-${p.id}" style="--pc:${esc(p.color || '#4F6475')}"><button class="faceb" data-act="pickFace" data-v="${p.id}"><b>${esc(p.name)}</b><span class="dim">${esc(p.job || (p.role === 'admin' ? 'Admin' : 'Sorter'))}</span></button>${S.loginPick === p.id ? `<form class="pin" data-act="noop" onsubmit="return false"><input id="pin-in" type="password" autocomplete="current-password" placeholder="Code" aria-label="Code for ${esc(p.name)}"><button class="btn primary" data-act="login" ${S.loggingIn ? 'disabled' : ''}>${S.loggingIn ? 'Opening…' : 'Open'}</button></form><div class="status err" id="login-err">${esc(S.loginErr || '')}</div>` : ''}</div>`).join('')}<p class="dim">You stay signed in on this device, even offline, until you switch profile. The first login needs internet.</p></div>`;
}
function vSetup() {
  const c = S.setup?.configured;
  const missingCfg = c ? Object.entries({ kv: 'KV namespace binding AMANAT_KV', serviceAccount: 'secret FIREBASE_SERVICE_ACCOUNT', setupKey: 'secret SETUP_KEY' }).filter(([k]) => !c[k]).map(([, v]) => v) : [];
  return `<div class="faces"><h1 style="font-size:32px">Set up Amanat</h1><p>This runs once. You become the admin and choose your own code. Nobody else can see the code.</p>
  ${missingCfg.length ? `<div class="note bad"><span>Cloudflare is still missing: ${esc(missingCfg.join(', '))}.</span></div>` : ''}
  <label class="fld"><span>Your name</span><input id="su-name" value="Zahid" autocomplete="name"></label>
  <label class="fld"><span>Choose your code (at least 4 characters)</span><input id="su-code" type="password" autocomplete="new-password"></label>
  <label class="fld"><span>Type it again</span><input id="su-code2" type="password" autocomplete="new-password"></label>
  <label class="fld"><span>Setup phrase</span><input id="su-key" type="password" autocomplete="off"></label>
  <button class="btn primary wide" data-act="setup" ${S.loggingIn ? 'disabled' : ''}>${S.loggingIn ? 'Setting up…' : 'Set up and open'}</button><div class="status err" id="login-err">${esc(S.loginErr || '')}</div></div>`;
}

/* ---------- search ---------- */
const lc = (s) => String(s || '').toLowerCase();
function groupText(g) { return lc([g.name, g.phone, g.phone2, g.city, g.address, g.tracking, g.service, g.note, ...itemsIn(g.id).map((i) => i.name)].join(' ')); }
export function matchGroup(g) { const q = lc(S.q).trim(); if (!q) return true; const d = q.replace(/\D/g, ''); return groupText(g).includes(q) || (d.length >= 4 && (String(g.phone) + String(g.phone2)).replace(/\D/g, '').includes(d)); }
function matchItem(i) {
  const q = lc(S.q).trim(); if (!q) return true;
  const g = groupById(i.groupId);
  return lc(i.name).includes(q) || numLabel(i).includes(q.replace(/^#?/, '#')) || (g && matchGroup(g));
}
const searchBox = (ph) => `<div class="search"><input id="q" type="search" data-q value="${esc(S.q)}" placeholder="${ph}" aria-label="Search" autocomplete="off"></div>`;

/* ---------- photos ---------- */
function card(i) {
  const g = groupById(i.groupId); const sel = S.sel.has(i.id); const ph = i.photos || [];
  const edit = can('name');
  return `<div class="card ${sel ? 'sel' : ''}" data-key="it-${i.id}" data-iid="${i.id}">
 <div class="ph" data-tsel="${i.id}" role="button" tabindex="0" aria-pressed="${sel}" aria-label="Select item ${numLabel(i)}">${ph[0] ? `<img src="${ph[0].t}" alt="" draggable="false" loading="lazy" decoding="async">` : ''}<span class="num">${numLabel(i)}</span>${ph.length > 1 ? `<span class="stack">${ph.length} photos</span>` : ''}${g ? `<span class="gtag" style="--g:${gColor(g)}">${esc(gTitle(g))}</span>` : ''}<span class="ck">${sel ? '✓' : ''}</span>${i._pending ? `<span class="pend on-ph">${ICON.cloud}</span>` : ''}</div>
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
export function groupCard(g, compact) {
  const its = itemsIn(g.id); const m = missing(g); const n = compact ? 8 : 16;
  const svcs = String(g.service || '').split('/').map((s) => s.trim()).filter(Boolean);
  return `<div class="gcard ${g.done ? 'sent' : ''}" data-key="g-${g.id}" data-big="${g.id}" ${g.done ? '' : `data-drop="${g.id}"`} style="--g:${gColor(g)}">
 <div class="gc-top"><span class="gc-name">${g.done ? '✓ ' : ''}${esc(gTitle(g))}</span>${pendingBadge(g._pending)}<span class="svc ${g.service ? '' : 'none'}">${esc(svcs[0] || 'No service')}</span>${svcs.length > 1 ? `<span class="svc alt">or ${esc(svcs.slice(1).join(' / '))}</span>` : ''}</div>
 <div class="gc-sub">${esc([g.city, fmtPhone(g.phone)].filter(Boolean).join(', ') || 'No phone or city')}</div>
 ${!compact && g.address ? `<div style="font-size:15px">${esc(g.address)}</div>` : ''}
 ${m.length ? `<div class="warn">Missing: ${m.join(', ')}</div>` : ''}
 ${g.aiPending ? `<div class="aip">AI check pending${S.online && aiAllowed() ? ` <button class="btn sm" data-act="aiCheck" data-id="${g.id}">Check now</button>` : ''}</div>` : ''}
 ${its.length ? `<div class="gthumbs">${its.slice(0, n).map((i) => `<img src="${i.photos?.[0]?.t || ''}" alt="${esc(itemLabel(i))}" title="${esc(itemLabel(i))}" loading="lazy">`).join('')}${its.length > n ? `<span class="dim">+${its.length - n}</span>` : ''}</div><div class="dim" style="font-size:14px">${esc(its.map(itemLabel).join(', '))}</div>` : `<div class="dim" style="font-size:14px;margin:6px 0">${g.done ? 'No items' : 'Drop items here'}</div>`}
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
  const base = S.show === 'un' ? ungrouped() : S.show === 'todo' ? toSend() : visItems();
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
  if (all.length && un.length) h += `<div class="note bad"><span>${plural(un.length, 'item')} not in any group yet</span>${S.show !== 'un' ? '<button class="btn sm" data-act="show" data-v="un">Show them</button>' : ''}</div>`;
  if (all.length && !un.length) h += `<div class="note"><span>Every item is in a group.</span><button class="btn sm" data-act="tab" data-v="service">See by service</button></div>`;
  h += `<div class="tray" aria-label="Groups"><button class="gchip" data-drop="" data-act="noop"><span>Not in a group</span><b>${un.length}</b></button>${active().map((g) => `<button class="gchip" data-key="tray-${g.id}" data-drop="${g.id}" data-act="editGroup" data-id="${g.id}" style="--g:${gColor(g)}"><i></i><span>${esc(gTitle(g))}</span><b>${itemsIn(g.id).length}</b></button>`).join('')}${can('group') ? '<button class="gchip add" data-act="newGroupSel">+ New group</button>' : ''}</div>`;
  h += `<div class="board"><div><div class="toolbar"><div class="seg"><button class="${S.show === 'un' ? 'on' : ''}" data-act="show" data-v="un">Not grouped ${un.length}</button><button class="${S.show === 'todo' ? 'on' : ''}" data-act="show" data-v="todo">Still to send ${ts.length}</button><button class="${S.show === 'all' ? 'on' : ''}" data-act="show" data-v="all">All ${all.length}</button></div>${shown.length ? '<button class="btn sm" data-act="selAll">Select all shown</button>' : ''}${aiAllowed() && can('name') && all.some((i) => !i.name) ? '<button class="btn sm" data-act="aiNameAll" title="Send thumbnails to AI to suggest names">Name with AI</button>' : ''}</div>
 ${all.length > 12 ? searchBox('Search items, #number or group') : ''}
 <p class="dim hint">${matchMedia('(pointer:fine)').matches ? 'Click photos to select (Shift-click for a range, or drag a box). Drag them onto a group on the right.' : 'Tap photos to select, then Add to group. Or hold a photo and drag it onto a group above.'}</p>`;
  if (!all.length) h += `<div class="empty"><h2>No photos yet</h2><p>${can('upload') ? 'Take a photo of each item, or add many at once from your library.' : 'No photos have been uploaded for this flight yet. They appear here as soon as they are.'}</p></div>`;
  else if (!shown.length) h += S.q ? '<div class="empty"><h2>Nothing found</h2><p>No item matches the search.</p></div>' : '<div class="empty"><h2>All grouped</h2><p>Every item is in a group.</p></div>';
  else {
    // Fast grid: render in batches; a sentinel near the end loads the next batch.
    const lim = Math.max(S.gridLimit, 60);
    h += `<div class="grid" id="grid">${shown.slice(0, lim).map(card).join('')}</div>${shown.length > lim ? `<div id="more" class="dim more">Loading ${shown.length - lim} more…</div>` : ''}`;
  }
  h += `</div><aside class="gpanel" aria-label="Groups">${can('group') ? '<button class="btn primary wide" data-act="newGroupSel" style="margin-bottom:10px">+ New group (paste address)</button><div class="dropzone" data-drop="">Drop here to take out of a group</div>' : ''}${active().map((g) => groupCard(g, true)).join('') || '<p class="dim">No groups waiting to be sent.</p>'}${sentList()}</aside></div>`;
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
  return `<div class="sentbox"><button class="btn sm wide" data-act="toggleSent">${S.showSent ? 'Hide' : 'Show'} sent groups (${sg.length})</button>${S.showSent ? `<div style="margin-top:8px">${sg.map((g) => groupCard(g, true)).join('')}</div>` : ''}</div>`;
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
  const by = { newest: (a, b) => (b.at || 0) - (a.at || 0), oldest: (a, b) => (a.at || 0) - (b.at || 0), name: (a, b) => lc(a.name).localeCompare(lc(b.name)), city: (a, b) => lc(a.city).localeCompare(lc(b.city)) || lc(a.name).localeCompare(lc(b.name)) };
  return gs.sort(by[f.sort] || by.oldest);
}
function vGroups() {
  let h = `<div class="row" style="margin-bottom:12px">${can('group') ? `<button class="btn primary" data-act="newGroupSel">+ New group (paste address)</button><button class="btn" data-act="bulk">Paste many addresses</button>${aiAllowed() ? '<button class="btn" data-act="shot">Read a screenshot</button>' : ''}` : ''}</div>`;
  if (!S.groups.length) return h + '<div class="empty"><h2>No groups yet</h2><p>Make one group for each parcel. Paste the person\'s message as it is; name, phones, address, city and service are filled in for you.</p></div>';
  const cities = [...new Set(S.groups.map((g) => g.city).filter(Boolean))].sort();
  const svcs = [...new Set(S.groups.map((g) => svcKey(g.service)))].sort(svcSort);
  const f = S.gf;
  h += searchBox('Search name, phone, city, tracking, item');
  h += `<div class="filters"><div class="seg">${[['open', 'To send'], ['missing', 'Missing details'], ['sent', 'Sent'], ['all', 'All']].map(([k, l]) => `<button class="${f.status === k ? 'on' : ''}" data-act="gf" data-k="status" data-v="${k}">${l}</button>`).join('')}</div>
  <select data-gf="city" aria-label="City"><option value="">All cities</option>${cities.map((c) => `<option ${f.city === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
  <select data-gf="service" aria-label="Service"><option value="">All services</option>${svcs.map((c) => `<option ${f.service === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
  <select data-gf="sort" aria-label="Sort">${[['oldest', 'Oldest first'], ['newest', 'Newest first'], ['name', 'Name A–Z'], ['city', 'City']].map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
  const gs = filteredGroups();
  return h + (gs.length ? `<div class="glist">${gs.map((g) => groupCard(g, false)).join('')}</div>` : '<div class="empty"><h2>Nothing here</h2><p>No group matches these filters.</p></div>');
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
   <span class="p-name">${esc(gTitle(g))}${g.phone ? ` <span style="font-weight:600">${esc(fmtPhone(g.phone))}</span>` : ''}${g.phone2 ? `<span class="dim" style="font-weight:500">, ${esc(fmtPhone(g.phone2))}</span>` : ''}${pendingBadge(g._pending)}${svcs.length > 1 && svcs[0] === k ? ` <span class="svc alt">or ${esc(svcs.slice(1).join(' / '))}</span>` : ''}</span>
   <div class="p-addr">${esc(g.address || '')}${g.city ? `, <b>${esc(g.city)}</b>` : ''}${g.note ? `<div class="dim">${esc(g.note)}</div>` : ''}${m.length ? `<div class="warn">Missing: ${m.join(', ')}</div>` : ''}
   ${g.tracking || g.weight || g.charges || step ? `<div class="p-meta">${step ? `<span class="stp">${esc(step[1])}</span>` : ''}${g.tracking ? `<span>Tracking <b>${esc(g.tracking)}</b> <button class="ib" data-act="copy" data-v="${esc(g.tracking)}" aria-label="Copy tracking number">${ICON.copy}</button>${tu ? ` <a href="${esc(tu)}" target="_blank" rel="noopener">Track</a>` : ''}</span>` : ''}${g.weight ? `<span>${esc(g.weight)} kg</span>` : ''}${g.charges ? `<span>Rs ${Number(g.charges).toLocaleString('en-PK')}</span>` : ''}</div>` : ''}</div>
   <div class="p-items">${its.length ? its.map((i) => `<span><img src="${i.photos?.[0]?.t || ''}" alt="" loading="lazy">${esc(itemLabel(i))}</span>`).join('') : '<span class="warn" style="background:none">No items in this group</span>'}</div><div class="row" style="grid-column:2;margin-top:4px"><button class="btn sm" data-act="counter" data-id="${g.id}">Show big</button>${telLinks(g)}${g.done && isMobile(g.phone) ? `<button class="btn sm" data-act="msgReceiver" data-id="${g.id}">Message receiver</button>` : ''}${can('group') || can('send') ? `<button class="btn sm" data-act="editGroup" data-id="${g.id}">Edit</button>` : ''}</div></div>`;
}
function vService() {
  const un = ungrouped(); let h = dashboard();
  if (un.length) h += `<div class="note bad"><span>${plural(un.length, 'item')} not in any group. They would be left behind.</span><button class="btn sm" data-act="showUn">Show them</button></div>`;
  const bad = active().filter((g) => missing(g).length);
  if (bad.length) h += `<div class="note bad"><span>${plural(bad.length, 'group')} missing details.</span><button class="btn sm" data-act="showMissing">Show them</button></div>`;
  if (S.groups.length > 6) h += searchBox('Search name, phone, city, tracking');
  if (active().length) h += '<p class="dim hint">Double-tap any parcel to show it big.</p>';
  if (S.groups.length && !active().length) h += '<div class="note"><span>Every parcel on this flight is marked sent.</span></div>';
  if (!S.groups.length) return h + '<div class="empty"><h2>Nothing sorted yet</h2><p>Groups appear here, sorted by TCS, Daewoo, Leopards and so on, once they are made.</p></div>';
  // B5: "TCS / Leopards" is listed under TCS with a tag, so "Mark all TCS sent" covers it.
  const by = {}; S.groups.filter(matchGroup).forEach((g) => { const k = svcKey(g.service); (by[k] = by[k] || []).push(g); });
  for (const k of Object.keys(by).sort(svcSort)) {
    const all = by[k]; const open = all.filter((g) => !g.done); const sent = all.filter((g) => g.done); const showS = S.openSent === k;
    const gs = showS ? [...open, ...sent] : open;
    const items = open.reduce((a, g) => a + piecesIn(g.id), 0);
    const kg = all.reduce((s, g) => s + (Number(g.weight) || 0), 0), rs = all.reduce((s, g) => s + (Number(g.charges) || 0), 0);
    h += `<section class="svc-sec" data-key="sec-${esc(k)}"><div class="svc-h"><h2>${esc(k)}</h2><span class="dim grow" style="font-weight:600">${open.length ? `${plural(open.length, 'parcel')} to send, ${plural(items, 'piece')}` : 'All sent'}${sent.length ? `, ${sent.length} sent` : ''}${kg ? `, ${+kg.toFixed(2)} kg` : ''}${rs ? `, Rs ${rs.toLocaleString('en-PK')}` : ''}</span>${open.length && can('send') && k !== 'No service yet' ? `<button class="btn sm dark" data-act="sendAll" data-v="${esc(k)}">Mark all ${esc(k)} sent</button>` : ''}${sent.length ? `<button class="btn sm" data-act="openSent" data-v="${esc(k)}">${showS ? 'Hide sent' : 'Show sent'}</button>` : ''}</div>${gs.map((g) => parcel(g, k)).join('')}</section>`;
  }
  return h;
}

/* ---------- selection bar ---------- */
function selbar(on) {
  let sb = $('#selbar');
  if (on && S.sel.size && S.tab !== 'service' && !layerCount()) {
    if (!sb) { sb = document.createElement('div'); sb.id = 'selbar'; sb.className = 'selbar'; document.body.appendChild(sb); }
    const grouped = [...S.sel].some((id) => groupById(S.items.find((i) => i.id === id)?.groupId));
    sb.innerHTML = `<span class="grow">${S.sel.size} selected</span>${can('group') ? `<button class="btn sm primary" data-act="selToGroup">Add to group</button>${grouped ? '<button class="btn sm" data-act="selUngroup">Take out</button>' : ''}` : ''}${can('upload') && S.sel.size > 1 ? '<button class="btn sm" data-act="selCombine">Combine</button>' : ''}${aiAllowed() && can('name') ? '<button class="btn sm" data-act="aiNameSel">Name with AI</button>' : ''}${isAdmin() ? '<button class="btn sm danger" data-act="selDelete">Delete</button>' : ''}<button class="btn sm" data-act="selClear">Clear</button>`;
  } else if (sb) sb.remove();
}
export { CITIES, SERVICES, mainSvc };
