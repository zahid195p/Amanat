// Sheets and full-screen layers: group editor, viewer, counter, flights, settings, bulk paste, exports.
import morphdom from 'morphdom';
import {
  S, $, $$, esc, rid, now, plural, todayISO, fmtDate, fmtTime, fmtBytes, fmtPhone, isAdmin, can, curFlight, groupById, gColor, gTitle,
  itemsIn, active, qtyOf, piecesIn, numLabel, itemLabel, svcKey, svcSort, mainSvc, missing, trackUrl, waMessage, toast, sheet, closeSheet,
  closeAll, choose, ask, pushLayer, closeTop, schedule, upd, put, del, w, D, saveLater, flushAll, logEv, newGroup, saveBook, lookupBook,
  moveItems, combine, deleteItems, setDone, setStep, setFlight, nextTmp, getDoc, getDocs, collection, query, where, writeBatch,
  increment, deleteField, db, STEPS, PERM_LABELS, DEFAULT_PERMS, PROFILE_COLORS, DEFAULT_WA, DEFAULT_TRACK, FREE_BYTES, setDoc,
  commitUndos, auth, signOut, unsubscribeAll,
} from './core.js';
import { FIELDS, SERVICES, CITIES, phoneKey, isMobile, waNumber, findPhones, localParse, fixUp } from './parse.js';
import { fullPhoto, cachePhoto, compressOne, handleFiles } from './images.js';
import { api, readText, readBulk, readImage, nameItems, aiAllowed } from './api.js';
import { ICON, telLinks, pendingBadge } from './views.js';

const LIVE = new Set(); // layers re-rendered from snapshots (B16)
export function refreshOpenLayers() { LIVE.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } }); }
const morph = (el, html) => {
  const nx = el.cloneNode(false); nx.innerHTML = html;
  morphdom(el, nx, { onBeforeElUpdated: (from, to) => { if (from.isEqualNode(to)) return false; if (from === document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(from.tagName)) to.value = from.value; return true; } });
};
function download(name, data, type) {
  const blob = new Blob([data], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name.replace(/[\\/:*?"<>|]+/g, ' ');
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const fileName = (f, ext) => `Amanat ${f.label || 'flight'} ${f.date || ''}`.trim() + '.' + ext;
async function copy(text, what = 'Copied') { try { await navigator.clipboard.writeText(text); toast(what); } catch (e) { toast('Copy is blocked here.'); } }
export { copy };
function pickFile(accept, multiple) {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = !!multiple;
    i.onchange = () => res([...(i.files || [])]); i.click();
  });
}

/* =================== group editor =================== */
export function openGroupSheet(gid, assignIds = [], prefill = null) {
  const g = gid ? groupById(gid) : null;
  const d = g || { name: '', phone: '', phone2: '', address: '', city: '', service: '', note: '', raw: '' };
  const eg = can('group'), es = can('send');
  const ro = eg ? '' : 'readonly';
  const sh = sheet(g ? 'Edit group' : 'New group', `
 ${eg ? `<label class="fld"><span>Paste one person's message as it is (one parcel)</span><textarea id="gs-raw" style="min-height:110px" placeholder="Ali Khan&#10;0300 1234567&#10;House 12, Street 4, Ali Town, Lahore&#10;TCS">${esc(d.raw || '')}</textarea></label>
 <div class="row" style="margin-bottom:8px"><button class="btn dark" id="gs-read">Fill in from the message</button>${aiAllowed() ? '<button class="btn" id="gs-shot">Read a screenshot</button>' : ''}<span class="status" id="gs-st"></span></div>
 <div id="gs-diff"></div>` : ''}
 <div class="two"><label class="fld"><span>Name</span><input id="gs-name" value="${esc(d.name)}" ${ro}></label><label class="fld"><span>Phone</span><input id="gs-phone" type="tel" inputmode="tel" value="${esc(d.phone)}" ${ro}></label></div>
 <div id="gs-dup"></div>
 <label class="fld"><span>Address</span><textarea id="gs-address" style="min-height:64px" ${ro}>${esc(d.address)}</textarea></label>
 <div class="two"><label class="fld"><span>City</span><input id="gs-city" list="cities" value="${esc(d.city)}" ${ro}></label><label class="fld"><span>Other phones</span><input id="gs-phone2" value="${esc(d.phone2)}" ${ro}></label></div>
 <datalist id="cities">${CITIES.map((c) => `<option value="${c}">`).join('')}</datalist>
 <label class="fld"><span>Service (tap more than one for "TCS / Leopards")</span><input id="gs-service" value="${esc(d.service)}" placeholder="TCS" ${ro}></label>
 ${eg ? `<div class="chips" id="gs-chips" style="margin:-4px 0 12px">${SERVICES.map((s) => `<button class="chip" data-svc="${s}">${s}</button>`).join('')}</div>` : ''}
 <label class="fld"><span>Note</span><input id="gs-note" value="${esc(d.note)}" placeholder="Fragile, wrap well" ${ro}></label>
 ${g && es ? `<div class="box"><div class="two"><label class="fld"><span>Tracking number</span><input id="gs-tracking" value="${esc(g.tracking || '')}" autocomplete="off"></label><div class="two"><label class="fld"><span>Weight kg</span><input id="gs-weight" inputmode="decimal" value="${esc(g.weight ?? '')}"></label><label class="fld"><span>Charges Rs</span><input id="gs-charges" inputmode="numeric" value="${esc(g.charges ?? '')}"></label></div></div>
   <div class="fld"><span class="lab">Status</span><div class="steps" id="gs-steps"></div></div>
   <div class="fld"><span class="lab">Booking slip photo</span><div class="row" id="gs-receipt"></div></div></div>` : ''}
 ${g ? '<div class="fld"><span class="lab">Items in this group</span><div id="gs-items"></div></div>' : ''}
 ${assignIds.length ? `<p class="status">${plural(assignIds.length, 'selected item')} will go into this group.</p>` : ''}
 <div class="row"><button class="btn primary grow" id="gs-save">${g ? 'Save' : 'Make group'}</button>${g && eg ? '<button class="btn danger" id="gs-del">Delete group</button>' : ''}</div>`, { onClose: () => LIVE.delete(live) });
  const F = (k) => sh.querySelector('#gs-' + k);
  const st = F('st');
  let aiState = null; // {ai, pending}
  let chips = null;

  // Live parts (re-rendered from snapshots).
  const live = () => {
    const cur = g && groupById(g.id);
    if (g && !cur) { sh.querySelector('.sh-b').innerHTML = '<p class="dim">This group was deleted.</p>'; LIVE.delete(live); return; }
    if (F('items')) {
      const its = itemsIn(g.id);
      morph(F('items'), its.length ? its.map((i) => `<div class="row irow"><img src="${i.photos?.[0]?.t || ''}" alt=""><span class="grow">${numLabel(i)} ${esc(itemLabel(i))}</span>${eg ? `<button class="btn sm" data-out="${i.id}">Take out</button>` : ''}</div>`).join('') : '<p class="dim">No items yet. Drag photos onto this group.</p>');
    }
    if (F('steps')) morph(F('steps'), STEPS.map(([k, l]) => { const s = cur.steps?.[k]; return `<button class="step ${s ? 'on' : ''}" data-step="${k}">${l}${s ? `<small>${esc(fmtTime(s.at))}<br>${esc(profNameOf(s.by))}</small>` : ''}</button>`; }).join(''));
    if (F('receipt')) morph(F('receipt'), cur.receipt ? `<img class="rthumb" src="${cur.receipt.t}" alt="Booking slip" data-rview="${cur.receipt.p}"><button class="btn sm" data-rnew>Replace</button><button class="btn sm danger" data-rdel>Remove</button>` : '<button class="btn sm" data-rnew>Add photo of booking slip</button>');
  };
  LIVE.add(live); live();
  sh.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button,img'); if (!t) return;
    if (t.dataset.out) { moveItems([t.dataset.out], '', true); return; }
    if (t.dataset.step) { const cur = groupById(g.id); setStep(cur, t.dataset.step, !cur.steps?.[t.dataset.step]); return; }
    if (t.dataset.rview) { openPhoto('Booking slip', t.dataset.rview, 'receipts'); return; }
    if (t.hasAttribute('data-rdel')) { const cur = groupById(g.id); if (cur.receipt) { del('receipts/' + cur.receipt.p); upd('groups/' + g.id, { receipt: deleteField() }); } return; }
    if (t.hasAttribute('data-rnew')) {
      const [f] = await pickFile('image/*'); if (!f) return;
      try {
        const full = await compressOne(f, 1400, 0.7); const thumb = await compressOne(f, 240, 0.55); const pid = rid();
        const cur = groupById(g.id);
        put('receipts/' + pid, { fid: S.fid, gid: g.id, d: full, at: now() }); cachePhoto(pid, full);
        if (cur.receipt) del('receipts/' + cur.receipt.p);
        upd('groups/' + g.id, { receipt: { p: pid, t: thumb } }); logEv(`added booking slip for ${gTitle(cur)}`);
      } catch (e) { toast(e.message); }
    }
  });

  // B3: pasting only fills empty fields; differing values are offered one by one.
  const fill = (r) => {
    const diffs = [];
    for (const k of FIELDS) {
      const nv = String(r[k] || '').trim(); if (!nv) continue;
      const cv = F(k).value.trim();
      if (!cv) F(k).value = nv; else if (cv !== nv) diffs.push([k, nv]);
    }
    showDiffs(diffs); checkDup();
  };
  const showDiffs = (diffs) => {
    const box = F('diff'); if (!box) return;
    box.innerHTML = diffs.length ? `<div class="diff"><b>The message has different values. Keep yours or use the new one:</b>${diffs.map(([k, v]) => `<div class="drow"><span class="dk">${k}</span><span class="grow"><s>${esc(F(k).value)}</s><br>${esc(v)}</span><button class="btn sm" data-use="${k}">Use new</button></div>`).join('')}<button class="btn sm" data-useall>Use all new</button></div>` : '';
    box.querySelectorAll('[data-use]').forEach((b) => (b.onclick = () => { F(b.dataset.use).value = diffs.find((x) => x[0] === b.dataset.use)[1]; b.closest('.drow').remove(); if (!box.querySelector('.drow')) box.innerHTML = ''; }));
    const all = box.querySelector('[data-useall]'); if (all) all.onclick = () => { diffs.forEach(([k, v]) => (F(k).value = v)); box.innerHTML = ''; };
  };
  if (eg) {
    // Instant: the offline reader fills the fields at once; AI then corrects them a moment later.
    let readSeq = 0;
    const read = async () => {
      const t = F('raw').value.trim(); if (!t) return;
      const seq = ++readSeq;
      const before = {}; FIELDS.forEach((k) => (before[k] = F(k).value.trim()));
      fill(fixUp(localParse(t), t));
      const after = {}; FIELDS.forEach((k) => (after[k] = F(k).value.trim()));
      const byLocal = FIELDS.filter((k) => !before[k] && after[k]);
      chips?.();
      if (!aiAllowed() || !navigator.onLine) {
        aiState = { ai: false, pending: aiAllowed() };
        st.className = 'status err';
        st.textContent = aiAllowed() ? 'Offline: filled in by the basic reader. It will be marked "AI check pending".' : 'Filled in by the basic reader. Check each field.';
        return;
      }
      st.className = 'status'; st.textContent = 'Filled in. Checking with AI…';
      const r = await readText(t);
      if (seq !== readSeq) return;
      aiState = r;
      if (r.ai) {
        const diffs = [];
        for (const k of FIELDS) {
          const nv = String(r.data[k] || '').trim(); if (!nv) continue;
          const cur = F(k).value.trim();
          if (!cur || (byLocal.includes(k) && cur === after[k])) F(k).value = nv; // empty, or untouched since the basic reader
          else if (cur !== nv) diffs.push([k, nv]);
        }
        showDiffs(diffs); checkDup(); chips?.();
      }
      st.className = 'status' + (r.ai ? '' : ' err');
      st.textContent = r.ai ? 'Checked by AI. Check each field, then save.' : `AI could not check it (${r.why}). The basic reader filled it in, so check every field.`;
    };
    F('read').onclick = read;
    F('raw').addEventListener('paste', () => setTimeout(read, 60));
    const shot = F('shot'); if (shot) shot.onclick = async () => {
      const [f] = await pickFile('image/*'); if (!f) return;
      st.className = 'status'; st.textContent = 'Reading the screenshot…';
      try {
        const list = await readImage(await compressOne(f, 1400, 0.75));
        if (!list.length) { st.textContent = 'No address found in the screenshot.'; return; }
        fill(list[0]); st.textContent = list.length > 1 ? `Found ${list.length} parcels; filled in the first. Use "Read a screenshot" on the Groups tab to make all.` : 'Filled in from the screenshot. Check each field.';
        aiState = { ai: true };
      } catch (e) { st.className = 'status err'; st.textContent = e.message; }
    };
    // B6: chips toggle and combine with " / ".
    chips = () => { const cur = F('service').value.split('/').map((s) => s.trim()).filter(Boolean); sh.querySelectorAll('[data-svc]').forEach((b) => b.classList.toggle('on', cur.includes(b.dataset.svc))); };
    sh.querySelectorAll('[data-svc]').forEach((b) => (b.onclick = () => {
      let cur = F('service').value.split('/').map((s) => s.trim()).filter(Boolean); const s = b.dataset.svc;
      cur = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
      F('service').value = cur.join(' / '); chips();
    }));
    F('service').addEventListener('input', chips); chips();
    // Address book (feature 27): a known phone fills the empty fields.
    F('phone').addEventListener('change', async () => {
      checkDup();
      const b = await lookupBook(F('phone').value); if (!b) return;
      let n = 0; for (const k of ['name', 'phone2', 'address', 'city', 'service']) if (b[k] && !F(k).value.trim()) { F(k).value = b[k]; n++; }
      if (n) { st.className = 'status'; st.textContent = 'Known receiver: filled from the address book.'; chips(); }
    });
  }
  // Duplicate phone warning (feature 18).
  const dupOf = () => { const k = phoneKey(F('phone').value); if (!k) return null; return S.groups.find((x) => x.id !== g?.id && !x.done && [x.phone, ...String(x.phone2 || '').split(',')].some((p) => phoneKey(p) === k)); };
  const checkDup = () => { const box = F('dup'); if (!box) return; const x = dupOf(); box.innerHTML = x ? `<div class="note bad"><span>${esc(gTitle(x))} already has a group with this phone on this flight.</span></div>` : ''; };
  checkDup();
  if (prefill) fill(prefill);

  F('save').onclick = async () => {
    const data = {}; for (const k of FIELDS) data[k] = F(k).value.trim();
    if (F('raw')) data.raw = F('raw').value.trim();
    const extra = {};
    if (F('tracking')) {
      extra.tracking = F('tracking').value.trim();
      const wv = parseFloat(F('weight').value); extra.weight = wv > 0 ? wv : null;
      const cv = parseFloat(String(F('charges').value).replace(/,/g, '')); extra.charges = cv > 0 ? cv : null;
    }
    if (aiState) data.aiPending = !!aiState.pending && !aiState.ai;
    if (!g) {
      const x = dupOf();
      if (x) {
        const c = await choose('Same phone number', `${gTitle(x)} already has a group with this phone. Put these items in that group instead?`, [{ label: 'Cancel', v: null }, { label: 'Make a new group', v: 'new' }, { label: 'Merge into ' + gTitle(x), v: 'merge', cls: 'primary' }]);
        if (!c) return;
        if (c === 'merge') {
          const patch = {}; for (const k of FIELDS) if (data[k] && !x[k]) patch[k] = data[k];
          if (Object.keys(patch).length) upd('groups/' + x.id, patch);
          if (assignIds.length) moveItems(assignIds, x.id, true);
          closeSheet(); toast('Merged into ' + gTitle(x)); return;
        }
      }
      newGroup(data, assignIds); closeSheet(); toast('Group made'); return;
    }
    const cur = groupById(g.id) || g; const patch = {};
    if (eg) for (const k of [...FIELDS, 'raw', 'aiPending']) if (data[k] !== undefined && data[k] !== (cur[k] ?? (k === 'aiPending' ? false : ''))) patch[k] = data[k];
    for (const k of Object.keys(extra)) if (extra[k] !== (cur[k] ?? (k === 'tracking' ? '' : null))) patch[k] = extra[k];
    if (Object.keys(patch).length) { upd('groups/' + g.id, patch); if (eg) saveBook({ ...cur, ...patch }); logEv(`edited ${gTitle({ ...cur, ...patch })} (${Object.keys(patch).join(', ')})`); }
    closeSheet(); toast('Saved');
  };
  const delb = F('del'); if (delb) delb.onclick = async () => {
    if (!(await ask('Delete this group? Its items go back to "not in a group".'))) return;
    itemsIn(g.id).forEach((i) => upd('items/' + i.id, { groupId: '' }));
    del('groups/' + g.id); logEv(`deleted group ${gTitle(g)}`); closeSheet();
  };
  if (!g && eg && !prefill) setTimeout(() => F('raw')?.focus(), 120);
  return sh;
}
const profNameOf = (uid) => S.profiles.find((p) => p.id === uid)?.name || '';

// AI re-check for groups saved offline ("AI check pending").
export async function aiCheck(gid) {
  const g = groupById(gid); if (!g) return;
  if (!g.raw) { upd('groups/' + gid, { aiPending: false }); return; }
  const sh = openGroupSheet(gid);
  sh.querySelector('#gs-read')?.click();
}

/* =================== pick group =================== */
export function openPickGroup(ids) {
  // B4: sent groups are not offered.
  const sh = sheet('Add to group', `<button class="btn primary wide" data-pg="__new" style="margin-bottom:10px">+ New group (paste address)</button><div class="gpick">${active().map((g) => `<button data-pg="${g.id}" style="--g:${gColor(g)}"><i></i>${esc(gTitle(g))} <span class="dim" style="font-weight:500">${esc(g.service || '')}</span></button>`).join('')}</div>`);
  sh.querySelectorAll('[data-pg]').forEach((b) => (b.onclick = () => { closeSheet(); if (b.dataset.pg === '__new') openGroupSheet(null, ids); else moveItems(ids, b.dataset.pg); }));
}

/* =================== viewer (swipe, pinch, arrows) =================== */
let VIEW = null;
export const viewerOpen = () => !!VIEW;
export function viewerNav(d) { VIEW?.nav(d); }
export function openViewer(id, order) {
  const sh = sheet('Item', '<div id="vw"></div>', { cls: 'wide', onClose: () => { flushAll(); LIVE.delete(draw); VIEW = null; } });
  const st = { id, order, ph: 0, loaded: null };
  const box = sh.querySelector('#vw');
  const nav = (d) => { flushAll(); const idx = st.order.indexOf(st.id); const j = idx + d; if (st.order[j]) { st.id = st.order[j]; st.ph = 0; resetZoom(); draw(); sh.scrollTop = 0; } };
  VIEW = { nav };
  let zoom = { s: 1, x: 0, y: 0 };
  const resetZoom = () => { zoom = { s: 1, x: 0, y: 0 }; apply(); };
  const apply = () => { const im = sh.querySelector('#vw-img'); if (im) im.style.transform = `translate(${zoom.x}px,${zoom.y}px) scale(${zoom.s})`; };
  function draw() {
    const it = S.items.find((i) => i.id === st.id);
    if (!it || S.hidden.has(it.id)) { st.order = st.order.filter((x) => x !== st.id && S.items.some((i) => i.id === x)); if (st.order.length) { st.id = st.order[0]; } else { box.innerHTML = '<p class="dim">This item was removed.</p>'; return; } return draw(); }
    sh.querySelector('.sh-h h2').textContent = 'Item ' + numLabel(it);
    const ph = it.photos || []; if (st.ph >= ph.length) st.ph = 0; const cur = ph[st.ph]; const idx = st.order.indexOf(it.id);
    const archived = curFlight()?.archived;
    const html = `<div class="vimg" id="vw-box"><img id="vw-img" src="${(cur && st.loaded?.[0] === cur.p && st.loaded[1]) || cur?.t || ''}" alt="Item ${numLabel(it)}" draggable="false"></div>
 ${archived ? '<p class="dim" style="font-size:13px">Flight archived: only the small photo is kept.</p>' : ''}
 ${ph.length > 1 ? `<div class="vstrip">${ph.map((p, k) => `<img src="${p.t}" alt="Photo ${k + 1}" data-k="${k}" class="${k === st.ph ? 'on' : ''}">`).join('')}</div>` : ''}
 <div class="vnav"><button class="btn sm" data-nav="-1" ${idx <= 0 ? 'disabled' : ''}>Previous</button><b>${idx + 1} of ${st.order.length}</b><button class="btn sm" data-nav="1" ${idx < 0 || idx >= st.order.length - 1 ? 'disabled' : ''}>Next</button></div>
 ${can('name') ? `<div class="row" style="flex-wrap:nowrap;margin-bottom:10px"><input id="vw-name" class="grow" value="${esc(it.name || '')}" placeholder="Name, e.g. small grey sneakers"><input id="vw-qty" style="width:80px" inputmode="numeric" value="${esc(it.qty ?? '')}" placeholder="Qty"></div>` : `<p style="font-weight:700;font-size:18px">${esc(itemLabel(it))}</p>`}
 <div class="fld"><span class="lab">Group</span><div class="gpick">${can('group') ? `<button data-vg="" class="${!groupById(it.groupId) ? 'on' : ''}">Not in a group</button>${S.groups.filter((g) => !g.done || g.id === it.groupId).map((g) => `<button data-vg="${g.id}" class="${it.groupId === g.id ? 'on' : ''}" style="--g:${gColor(g)}"><i></i>${esc(gTitle(g))}</button>`).join('')}<button data-vg="__new">+ New group</button>` : esc(gTitle(groupById(it.groupId)) || 'Not in a group')}</div></div>
 <div class="row">${can('upload') && ph.length > 1 ? '<button class="btn sm" id="vw-split">Make this photo its own item</button>' : ''}${isAdmin() ? `<button class="btn sm danger" id="vw-delp">${ph.length > 1 ? 'Delete this photo' : 'Delete this item'}</button>` : ''}${pendingBadge(it._pending)}</div>`;
    morph(box, html);
    if (cur && !archived && st.loaded?.[0] !== cur.p) {
      const pid = cur.p; st.loaded = [pid, null];
      fullPhoto(pid).then((d) => { if (d && st.loaded?.[0] === pid) { st.loaded[1] = d; const im = sh.querySelector('#vw-img'); if (im) im.src = d; } }).catch(() => {});
    }
  }
  LIVE.add(draw); draw();
  box.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-k],[data-nav],[data-vg],#vw-split,#vw-delp'); if (!t) return;
    const it = S.items.find((i) => i.id === st.id); if (!it) return; const ph = it.photos || []; const cur = ph[st.ph];
    if (t.dataset.k) { st.ph = Number(t.dataset.k); resetZoom(); draw(); }
    else if (t.dataset.nav) nav(Number(t.dataset.nav));
    else if (t.dataset.vg !== undefined) { if (t.dataset.vg === '__new') { closeSheet(); openGroupSheet(null, [it.id]); return; } moveItems([it.id], t.dataset.vg, true); }
    else if (t.id === 'vw-split') {
      const rest = ph.filter((_, k) => k !== st.ph);
      upd('items/' + it.id, { photos: rest });
      put('items/' + rid(), { fid: it.fid, n: null, tmp: nextTmp(), name: '', qty: null, photos: [cur], groupId: '', at: now(), by: S.me.uid });
      logEv(`split a photo out of ${numLabel(it)}`); toast('Made into a new item'); st.ph = 0;
    } else if (t.id === 'vw-delp') {
      if (ph.length > 1) {
        if (!(await ask('Delete this photo?'))) return;
        upd('items/' + it.id, { photos: ph.filter((_, k) => k !== st.ph) }); del('photos/' + cur.p);
        upd('flights/' + it.fid, { bytes: increment(-((cur.s || 0) + (cur.t?.length || 0))) }); st.ph = 0;
      } else { deleteItems([it.id]); }
    }
  });
  box.addEventListener('input', (ev) => {
    const it = S.items.find((i) => i.id === st.id); if (!it) return;
    if (ev.target.id === 'vw-name') saveLater('items/' + it.id, { name: ev.target.value.trim() });
    if (ev.target.id === 'vw-qty') { const v = parseInt(ev.target.value, 10); saveLater('items/' + it.id, { qty: v > 0 ? v : null }); }
  });
  // Gestures: swipe left/right to move, pinch or double-tap to zoom, drag to pan when zoomed.
  const pts = new Map(); let start = null, pinch0 = null, lastTap = 0;
  box.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#vw-box')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) start = { x: e.clientX, y: e.clientY, zx: zoom.x, zy: zoom.y, t: Date.now() };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), s: zoom.s }; }
  });
  box.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch0) { const [a, b] = [...pts.values()]; zoom.s = Math.min(4, Math.max(1, (pinch0.s * Math.hypot(a.x - b.x, a.y - b.y)) / pinch0.d)); if (zoom.s === 1) { zoom.x = zoom.y = 0; } apply(); e.preventDefault(); }
    else if (pts.size === 1 && start && zoom.s > 1) { zoom.x = start.zx + e.clientX - start.x; zoom.y = start.zy + e.clientY - start.y; apply(); e.preventDefault(); }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId);
    if (pts.size) return;
    if (pinch0) { pinch0 = null; start = null; return; }
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (zoom.s === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) nav(dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      const t = Date.now();
      if (t - lastTap < 320) { zoom.s = zoom.s > 1 ? 1 : 2.5; zoom.x = zoom.y = 0; apply(); lastTap = 0; } else lastTap = t;
    }
    start = null;
  };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
}
export function openPhoto(title, pid, col) {
  const sh = sheet(title, '<div class="vimg"><img id="ph-img" alt=""></div>', { cls: 'wide' });
  fullPhoto(pid, col).then((d) => { const im = sh.querySelector('#ph-img'); if (im && d) im.src = d; else if (im) im.alt = 'Photo not available offline'; }).catch(() => {});
}

/* =================== counter screen =================== */
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); }
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* not supported or denied */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && $('.counter')) keepAwake(true); });
export function openCounter(id) {
  if (!groupById(id)) return;
  const d = document.createElement('div'); d.className = 'counter'; d.setAttribute('role', 'dialog');
  document.body.appendChild(d);
  const fulls = new Map(); // full photos, kept so a re-render does not drop back to thumbnails
  const draw = () => {
    const g = groupById(id); if (!g) { closeTop(); return; }
    const its = itemsIn(id); const packed = g.packed || {}; const nPacked = its.filter((i) => packed[i.id]).length;
    const tu = trackUrl(g);
    morph(d, `<div class="c-top"><span class="c-meth">${esc(g.service || 'Parcel')}</span><button class="c-x" data-cx>Close</button></div>
 <div class="c-lab">Receiver</div><div class="c-name">${esc(g.name || 'No name given')}</div>
 <div class="c-lab">Phone, tap to copy</div><button class="c-phone" data-copy="${esc(g.phone || '')}">${esc(fmtPhone(g.phone) || 'No phone')}</button>${g.phone2 ? `<div class="c-addr">Also ${esc(fmtPhone(g.phone2))}</div>` : ''}
 <div class="row c-acts">${telLinks(g, true)}</div>
 <div class="c-lab">Address</div><div class="c-addr">${esc(g.address || 'No address given')}</div>${g.city ? `<div class="c-city">${esc(g.city)}</div>` : ''}
 <div class="c-grid"><div>Pieces<b>${piecesIn(id)}</b></div><div>Sender<b>${esc(fmtPhone(S.cfg.sender || '') || '–')}</b></div>${g.tracking ? `<div>Tracking<b>${esc(g.tracking)}</b>${tu ? `<a href="${esc(tu)}" target="_blank" rel="noopener">Track</a>` : ''}</div>` : ''}${g.weight ? `<div>Weight<b>${esc(g.weight)} kg</b></div>` : ''}</div>
 ${can('send') ? `<div class="c-steps">${STEPS.map(([k, l]) => `<button class="step ${g.steps?.[k] ? 'on' : ''}" data-cstep="${k}">${l}</button>`).join('')}</div>` : ''}
 <div class="c-items"><h3>What goes in this parcel (${plural(its.length, 'item')})${its.length ? ` · packed ${nPacked} of ${its.length}` : ''}</h3>${its.length ? `<div class="c-grid2">${its.map((i) => { const ph = i.photos || []; return `<div class="c-it ${packed[i.id] ? 'packed' : ''}" data-key="c-${i.id}"><img class="main" data-full="${esc(ph[0]?.p || '')}" src="${fulls.get(ph[0]?.p) || ph[0]?.t || ''}" alt="Item ${numLabel(i)}"><div class="c-cap"><b>${numLabel(i)}</b>${esc(i.name || 'No name')}${Number(i.qty) > 1 ? ` ×${esc(i.qty)}` : ''}</div>${ph.length > 1 ? `<div class="c-more">${ph.slice(1).map((x) => `<img src="${x.t}" alt="">`).join('')}</div>` : ''}${can('send') ? `<button class="pack" data-pack="${i.id}">${packed[i.id] ? '✓ Packed' : 'Tick when packed'}</button>` : ''}</div>`; }).join('')}</div>` : '<p style="font-size:20px">No items in this group yet.</p>'}</div>`);
  };
  // Full photos: morph would reset src to the thumb, so keep a map and re-apply.
  const origDraw = draw;
  const drawKeep = () => { origDraw(); d.querySelectorAll('img[data-full]').forEach((im) => { if (fulls.has(im.dataset.full)) return; if (im.dataset.full && !curFlight()?.archived) { fulls.set(im.dataset.full, ''); } else return; fullPhoto(im.dataset.full).then((x) => { if (x) { fulls.set(im.dataset.full, x); im.src = x; } }).catch(() => {}); }); };
  d.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button'); if (!t) return;
    const g = groupById(id); if (!g) return;
    if (t.hasAttribute('data-cx')) closeTop();
    else if (t.dataset.copy !== undefined) copy(t.dataset.copy, 'Phone copied');
    else if (t.dataset.cstep) setStep(g, t.dataset.cstep, !g.steps?.[t.dataset.cstep]);
    else if (t.dataset.pack) upd('groups/' + id, { ['packed.' + t.dataset.pack]: !(g.packed || {})[t.dataset.pack] });
  });
  LIVE.add(drawKeep); drawKeep(); keepAwake(true);
  pushLayer(() => { LIVE.delete(drawKeep); d.remove(); keepAwake(false); });
}

/* =================== receiver message (feature 22) =================== */
export function msgReceiver(gid) {
  const g = groupById(gid); if (!g) return;
  const num = waNumber(g.phone); if (!num) { toast('The receiver phone is not a mobile number.'); return; }
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(waMessage(g))}`, '_blank', 'noopener');
  logEv(`messaged ${gTitle(g)} on WhatsApp`);
}

/* =================== bulk paste & screenshot review (features 15, 16) =================== */
export function openBulk(initial) {
  const sh = sheet('Paste many addresses', `
  <label class="fld"><span>Paste the whole WhatsApp chat. Each parcel becomes its own group.</span><textarea id="bk-text" style="min-height:160px"></textarea></label>
  <div class="row" style="margin-bottom:10px"><button class="btn dark" id="bk-read">Read the addresses</button><span class="status" id="bk-st"></span></div>
  <div id="bk-list"></div>`, { cls: 'wide' });
  const st = sh.querySelector('#bk-st');
  const showList = (list, pending) => {
    const box = sh.querySelector('#bk-list');
    if (!list.length) { box.innerHTML = '<p class="dim">No addresses found. Each parcel needs at least a phone number.</p>'; return; }
    box.innerHTML = `<div class="row" style="margin-bottom:8px"><span class="grow status">Check each one. Untick any you do not want.</span><button class="btn sm" id="bk-none">Untick all</button></div>${list.map((r, k) => {
      const k10 = phoneKey(r.phone); const dup = k10 && S.groups.find((x) => [x.phone, ...String(x.phone2 || '').split(',')].some((p) => phoneKey(p) === k10));
      return `<div class="bk ${dup ? 'dup' : ''}" data-k="${k}"><label class="bk-ck"><input type="checkbox" ${dup ? '' : 'checked'} data-ck="${k}"></label><div class="grow"><div class="two"><input data-f="name" value="${esc(r.name)}" placeholder="Name"><input data-f="phone" value="${esc(r.phone)}" placeholder="Phone"></div><input data-f="address" value="${esc(r.address)}" placeholder="Address"><div class="two"><input data-f="city" value="${esc(r.city)}" placeholder="City" list="cities2"><input data-f="service" value="${esc(r.service)}" placeholder="Service"></div>${r.phone2 ? `<div class="dim" style="font-size:13px">Other phones: ${esc(r.phone2)}</div>` : ''}${dup ? `<div class="warn">Already on this flight: ${esc(gTitle(dup))}</div>` : ''}${missing(r).length ? `<div class="warn">Missing: ${missing(r).join(', ')}</div>` : ''}</div></div>`;
    }).join('')}<datalist id="cities2">${CITIES.map((c) => `<option value="${c}">`).join('')}</datalist><button class="btn primary wide" id="bk-make">Make groups</button>`;
    const upCount = () => { const n = box.querySelectorAll('[data-ck]:checked').length; box.querySelector('#bk-make').textContent = `Make ${plural(n, 'group')}`; };
    box.addEventListener('change', upCount); upCount();
    box.querySelector('#bk-none').onclick = () => { box.querySelectorAll('[data-ck]').forEach((c) => (c.checked = false)); upCount(); };
    box.querySelector('#bk-make').onclick = () => {
      let n = 0;
      box.querySelectorAll('.bk').forEach((row) => {
        if (!row.querySelector('[data-ck]').checked) return;
        const r = { ...list[Number(row.dataset.k)] }; row.querySelectorAll('[data-f]').forEach((i) => (r[i.dataset.f] = i.value.trim()));
        newGroup({ ...r, aiPending: !!pending }); n++;
      });
      closeSheet(); toast(`${plural(n, 'group')} made`); S.tab = 'groups'; schedule();
    };
  };
  sh.querySelector('#bk-read').onclick = async () => {
    const t = sh.querySelector('#bk-text').value; if (!t.trim()) return;
    st.className = 'status'; st.textContent = aiAllowed() && navigator.onLine ? 'Reading with AI…' : 'Reading…';
    const r = await readBulk(t);
    st.className = 'status' + (r.ai ? '' : ' err');
    st.textContent = r.ai ? `AI found ${plural(r.list.length, 'parcel')}.` : `Basic reader found ${plural(r.list.length, 'parcel')} (${r.why}). Check them carefully.`;
    r.list.forEach((x) => (x.raw = x.raw || ''));
    showList(r.list, r.pending);
  };
  if (initial) { st.textContent = `Found ${plural(initial.length, 'parcel')} in the screenshot.`; showList(initial, false); }
}
export async function readShot() {
  const [f] = await pickFile('image/*'); if (!f) return;
  const t = toast('Reading the screenshot…', { ms: 15000 });
  try {
    const list = await readImage(await compressOne(f, 1400, 0.75)); t.remove();
    if (!list.length) toast('No address found in the screenshot.');
    else if (list.length === 1) openGroupSheet(null, [...S.sel], list[0]);
    else openBulk(list);
  } catch (e) { t.remove(); toast(e.message, { ms: 5000 }); }
}

/* =================== AI item naming (feature 17) =================== */
export async function aiName(ids) {
  const its = ids.map((id) => S.items.find((i) => i.id === id)).filter(Boolean);
  if (!its.length) { toast('No items to name.'); return; }
  const t = toast(`Asking AI to name ${plural(its.length, 'item')}…`, { ms: 60000 });
  const out = [];
  try {
    for (let k = 0; k < its.length; k += 12) out.push(...(await nameItems(its.slice(k, k + 12))));
  } catch (e) { t.remove(); toast(e.message || 'AI naming failed.', { ms: 5000 }); if (!out.length) return; }
  t.remove();
  const sug = out.filter((x) => x && x.id && x.name && its.some((i) => i.id === x.id));
  if (!sug.length) { toast('AI gave no names.'); return; }
  const sh = sheet('Names from AI', `<p class="dim">Edit or untick any name, then save.</p>${sug.map((x) => { const i = its.find((y) => y.id === x.id); return `<div class="row irow"><input type="checkbox" checked data-ok="${i.id}" style="width:24px;min-height:24px"><img src="${i.photos?.[0]?.t || ''}" alt=""><b>${numLabel(i)}</b><input class="grow" data-nm="${i.id}" value="${esc(x.name)}"><span class="dim" style="font-size:13px">${esc(i.name || '')}</span></div>`; }).join('')}<button class="btn primary wide" id="an-save" style="margin-top:10px">Save names</button>`);
  sh.querySelector('#an-save').onclick = () => {
    let n = 0;
    sh.querySelectorAll('[data-nm]').forEach((inp) => { if (sh.querySelector(`[data-ok="${inp.dataset.nm}"]`).checked && inp.value.trim()) { upd('items/' + inp.dataset.nm, { name: inp.value.trim() }); n++; } });
    closeSheet(); toast(`${plural(n, 'name')} saved`); logEv(`named ${plural(n, 'item')} with AI`);
  };
}

/* =================== flights =================== */
export function openFlights() {
  const used = S.flights.reduce((s, f) => s + (f.bytes || 0), 0); const pct = Math.min(100, Math.round((used / FREE_BYTES) * 100));
  const body = `${can('flights') ? `<div class="box"><div class="two"><label class="fld"><span>Flight</span><input id="nf-label" placeholder="PK 853"></label><label class="fld"><span>Date</span><input id="nf-date" type="date" value="${todayISO()}"></label></div><button class="btn primary wide" data-act="createFlight">Add flight</button></div>` : ''}
 <div class="meter"><div class="row"><span class="grow"><b>Storage</b> ${fmtBytes(used)} of ${fmtBytes(FREE_BYTES)} free</span><span class="dim">${pct}%</span></div><div class="progress"><i style="width:${pct}%;${pct > 80 ? 'background:var(--stop)' : ''}"></i></div><div class="dim" style="font-size:13px">Archive or delete old flights to free space. Archiving keeps names, groups and small photos.</div></div>
 ${S.flights.map((f) => `<div class="gcard" style="--g:${f.id === S.fid ? 'var(--sign)' : 'var(--line)'}"><div class="gc-top"><span class="gc-name">${esc(f.label || 'Flight')}</span>${f.archived ? '<span class="svc alt">Archived</span>' : ''}${f.deleting ? '<span class="svc none">Deleting</span>' : ''}<span class="dim">${esc(fmtDate(f.date))}</span></div><div class="dim" style="font-size:13px">${fmtBytes(f.bytes || 0)}</div><div class="row" style="margin-top:8px">${f.id === S.fid ? '<span class="status grow">Open now</span>' : `<button class="btn sm primary grow" data-act="openFlight" data-id="${f.id}">Open</button>`}<button class="btn sm" data-act="activity" data-id="${f.id}">Activity</button>${can('export') ? `<button class="btn sm" data-act="mdFlight" data-id="${f.id}">Summary</button><button class="btn sm" data-act="csvFlight" data-id="${f.id}">Excel (CSV)</button>` : ''}${isAdmin() && !f.archived ? `<button class="btn sm" data-act="archiveFlight" data-id="${f.id}">Archive</button>` : ''}${isAdmin() ? `<button class="btn sm danger" data-act="delFlight" data-id="${f.id}">Delete</button>` : ''}</div></div>`).join('')}
 ${isAdmin() ? '<div class="box" style="margin-top:14px"><b>Backup</b><p class="dim" style="font-size:14px">A full backup file of every flight, group, item and setting. Keep it somewhere safe.</p><div class="row"><button class="btn sm" data-act="backup">Download backup</button><button class="btn sm" data-act="backupPhotos">Backup with full photos</button><button class="btn sm" data-act="restore">Restore from file</button></div></div>' : ''}`;
  sheet('Flights', body);
}
export function createFlight() {
  const label = $('#nf-label').value.trim(); if (!label) { toast('Enter the flight number or a name.'); return; }
  const id = rid(); put('flights/' + id, { label, date: $('#nf-date').value, at: now(), by: S.me.uid, nextN: 1, bytes: 0 });
  logEv(`added flight ${label}`, id); closeAll(); setFlight(id);
}
async function loadFlight(fid) {
  const [qi, qg] = await Promise.all([getDocs(query(collection(db, 'items'), where('fid', '==', fid))), getDocs(query(collection(db, 'groups'), where('fid', '==', fid)))]);
  return {
    items: qi.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.n || 1e9) - (b.n || 1e9)),
    groups: qg.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.at || 0) - (b.at || 0)),
  };
}
function buildMD(f, items, groups) {
  const L = [`# ${f.label || 'Flight'}, ${f.date || ''}`, '', `Saved ${new Date().toLocaleString('en-GB')}. ${plural(items.length, 'item')}, ${plural(groups.length, 'group')}.`, ''];
  const lab = (i) => `${numLabel(i)} ${i.name || '(no name)'}${Number(i.qty) > 1 ? ' x' + i.qty : ''}${(i.photos || []).length > 1 ? ` (${i.photos.length} photos)` : ''}`;
  const by = {}; groups.forEach((g) => { const k = svcKey(g.service); (by[k] = by[k] || []).push(g); });
  Object.keys(by).sort(svcSort).forEach((k) => {
    L.push(`## ${k}`, '');
    by[k].forEach((g) => {
      L.push(`### ${g.name || 'No name'}${g.done ? ' (sent)' : ''}`, '');
      [['Phone', fmtPhone(g.phone)], ['Second phone', fmtPhone(g.phone2)], ['Address', g.address], ['City', g.city], ['Service', g.service], ['Tracking', g.tracking], ['Weight kg', g.weight], ['Charges Rs', g.charges], ['Note', g.note]].forEach(([a, b]) => { if (b) L.push(`- ${a}: ${b}`); });
      const its = items.filter((i) => i.groupId === g.id); L.push(`- Items: ${its.length ? its.map(lab).join('; ') : 'none'}`, '');
    });
  });
  const un = items.filter((i) => !groups.some((g) => g.id === i.groupId)); if (un.length) L.push('## Not in any group', '', ...un.map((i) => '- ' + lab(i)), '');
  return L.join('\n');
}
export async function downloadMD(fid) {
  const f = S.flights.find((x) => x.id === fid); if (!f) return false;
  try { const { items, groups } = await loadFlight(fid); download(fileName(f, 'md'), buildMD(f, items, groups), 'text/markdown'); return true; }
  catch (e) { console.warn(e); toast('The summary could not be made.'); return false; }
}
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export async function downloadCSV(fid) {
  const f = S.flights.find((x) => x.id === fid); if (!f) return;
  try {
    const { items, groups } = await loadFlight(fid);
    const rows = [['Service', 'Name', 'Phone', 'Other phones', 'Address', 'City', 'Items', 'Pieces', 'Tracking', 'Weight kg', 'Charges Rs', 'Status', 'Sent at', 'Note']];
    const st = (g) => [...STEPS].reverse().find(([k]) => g.steps?.[k])?.[1] || (g.done ? 'Sent' : 'Open');
    groups.sort((a, b) => svcSort(svcKey(a.service), svcKey(b.service))).forEach((g) => {
      const its = items.filter((i) => i.groupId === g.id);
      rows.push([g.service, g.name, g.phone, g.phone2, g.address, g.city, its.map((i) => `${numLabel(i)} ${i.name || ''}`.trim()).join('; '), its.reduce((s, i) => s + qtyOf(i), 0), g.tracking, g.weight, g.charges, st(g), g.steps?.sent ? fmtTime(g.steps.sent.at) : '', g.note]);
    });
    items.filter((i) => !groups.some((g) => g.id === i.groupId)).forEach((i) => rows.push(['', '(not in a group)', '', '', '', '', `${numLabel(i)} ${i.name || ''}`, qtyOf(i), '', '', '', '', '', '']));
    download(fileName(f, 'csv'), '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'), 'text/csv');
  } catch (e) { console.warn(e); toast('The export could not be made.'); }
}
export async function openActivity(fid) {
  const sh = sheet('Activity', '<div class="spin"></div>');
  try {
    const q = await getDocs(query(collection(db, 'log'), where('fid', '==', fid)));
    const L = q.docs.map((d) => d.data()).sort((a, b) => b.at - a.at).slice(0, 400);
    sh.querySelector('.sh-b').innerHTML = L.length ? `<ul class="log">${L.map((x) => `<li><span class="dim">${esc(fmtTime(x.at))}</span> ${esc(x.text)}</li>`).join('')}</ul>` : '<p class="dim">Nothing yet.</p>';
  } catch (e) { sh.querySelector('.sh-b').innerHTML = '<p class="dim">Could not load the activity.</p>'; }
}
// B14: chunked batches with progress; resumable because the flight is flagged first.
async function wipe(col, fid, prog) {
  for (;;) {
    const q = await getDocs(query(collection(db, col), where('fid', '==', fid)));
    if (!q.docs.length) return;
    for (let k = 0; k < q.docs.length; k += 400) {
      const b = writeBatch(db); q.docs.slice(k, k + 400).forEach((d) => b.delete(d.ref)); await b.commit();
      prog(Math.min(q.docs.length, k + 400));
    }
  }
}
export async function deleteFlight(fid, resume) {
  const f = S.flights.find((x) => x.id === fid); if (!f) return;
  if (!resume) {
    const c = await choose('Delete ' + (f.label || 'flight') + '?', 'This removes its photos, names and groups from Amanat. Download the summary first if you want a record.', [{ label: 'Cancel', v: null }, { label: 'Delete only', v: 'del', cls: 'danger' }, { label: 'Download, then delete', v: 'dl', cls: 'primary' }]);
    if (!c) return; if (c === 'dl' && !(await downloadMD(fid))) return;
  }
  if (!navigator.onLine) { toast('Connect to the internet to delete a flight.'); return; }
  closeAll();
  const t = toast('Deleting…', { ms: 600000 }); const span = t.querySelector('span');
  try {
    await setDoc(D('flights/' + fid), { deleting: true }, { merge: true });
    let n = 0;
    for (const col of ['photos', 'receipts', 'log', 'items', 'groups']) await wipe(col, fid, (k) => { span.textContent = `Deleting ${col}… ${n + k}`; });
    await del('flights/' + fid);
    if (S.fid === fid) setFlight(S.flights.find((x) => x.id !== fid)?.id || null);
    t.remove(); toast('Flight deleted');
  } catch (e) { console.warn(e); t.remove(); toast('Deleting stopped (' + (e.code || e.message) + '). Open the flight to finish.'); }
}
export async function archiveFlight(fid) {
  const f = S.flights.find((x) => x.id === fid); if (!f) return;
  if (!(await ask(`Archive ${f.label || 'this flight'}? The full photos are deleted to free space. Names, groups, small photos and the summary stay.`, 'Archive'))) return;
  if (!navigator.onLine) { toast('Connect to the internet to archive.'); return; }
  const t = toast('Archiving…', { ms: 600000 }); const span = t.querySelector('span');
  try {
    await wipe('photos', fid, (k) => { span.textContent = `Removing full photos… ${k}`; });
    const { items } = await loadFlight(fid);
    const bytes = items.reduce((s, i) => s + (i.photos || []).reduce((a, p) => a + (p.t?.length || 0), 0), 0);
    upd('flights/' + fid, { archived: true, bytes });
    logEv('archived the flight', fid); t.remove(); toast('Flight archived');
  } catch (e) { t.remove(); toast('Archiving stopped: ' + (e.code || e.message)); }
}
const BACKUP_COLS = ['profiles', 'config', 'flights', 'items', 'groups', 'log', 'book'];
export async function backup(withPhotos) {
  if (!navigator.onLine) { toast('Connect to the internet to make a full backup.'); return; }
  const t = toast('Making the backup…', { ms: 600000 });
  try {
    const out = { app: 'amanat', v: 1, at: now(), data: {} };
    for (const c of [...BACKUP_COLS, ...(withPhotos ? ['photos', 'receipts'] : [])]) { const q = await getDocs(collection(db, c)); out.data[c] = q.docs.map((d) => ({ id: d.id, ...d.data() })); }
    download(`Amanat backup ${todayISO()}.json`, JSON.stringify(out), 'application/json'); t.remove();
  } catch (e) { t.remove(); toast('Backup failed: ' + (e.code || e.message)); }
}
export async function restore() {
  const [f] = await pickFile('application/json,.json'); if (!f) return;
  let data; try { data = JSON.parse(await f.text()); } catch (e) { toast('That file is not an Amanat backup.'); return; }
  if (data?.app !== 'amanat' || !data.data) { toast('That file is not an Amanat backup.'); return; }
  const n = Object.values(data.data).reduce((s, a) => s + a.length, 0);
  if (!(await ask(`Restore ${n} records from ${fmtTime(data.at)}? Records with the same id are overwritten; nothing is deleted.`, 'Restore'))) return;
  const t = toast('Restoring…', { ms: 600000 }); const span = t.querySelector('span'); let k = 0;
  try {
    for (const [c, docs] of Object.entries(data.data)) {
      if (![...BACKUP_COLS, 'photos', 'receipts'].includes(c)) continue;
      for (let i = 0; i < docs.length; i += 300) {
        const b = writeBatch(db); docs.slice(i, i + 300).forEach(({ id, ...d }) => b.set(D(c + '/' + id), d)); await b.commit(); k += Math.min(300, docs.length - i); span.textContent = `Restoring… ${k} of ${n}`;
      }
    }
    t.remove(); toast('Restored');
  } catch (e) { t.remove(); toast('Restore stopped: ' + (e.code || e.message)); }
}

/* =================== menu, settings, profiles =================== */
export function openMenu() {
  const c = S.cfg;
  const sh = sheet('Menu', `
  <div class="box"><div class="row"><span class="grow"><b>${esc(S.me.name)}</b> <span class="dim">${S.me.role === 'admin' ? 'Admin' : 'Sorter'}</span></span><button class="btn sm" data-act="switchFace">Switch profile</button></div></div>
  <div class="box"><b>AI helper</b><p class="dim" style="font-size:14px">AI reads pasted addresses and screenshots and suggests item names. It uses Google Gemini's free tier, where Google may use what is sent to improve its products. The basic reader always works without AI.</p>
   <label class="tgl"><input type="checkbox" id="mn-ailocal" ${S.aiLocalOff ? '' : 'checked'}> Use AI on this device</label>
   ${isAdmin() ? `<label class="tgl"><input type="checkbox" id="mn-ai" ${c.aiOff ? '' : 'checked'}> AI on for everyone</label>` : ''}</div>
  ${isAdmin() ? `<div class="box"><b>Settings</b>
   <label class="fld"><span>Sender phone, shown on the counter screen</span><input id="st-sender" type="tel" inputmode="tel" value="${esc(c.sender || '')}"></label>
   <label class="fld"><span>WhatsApp message to the receiver. Use {name} {service} {tracking} {pieces} {city} {sender}</span><textarea id="st-wa" style="min-height:70px">${esc(c.waTemplate || DEFAULT_WA)}</textarea></label>
   <div class="fld"><span class="lab">Tracking pages ({n} is the tracking number)</span>${['TCS', 'Leopards', 'Daewoo', 'Faisal Movers', 'Cargo'].map((s) => `<div class="row trk"><span>${s}</span><input class="grow" data-trk="${s}" value="${esc((c.trackUrls || {})[s] ?? DEFAULT_TRACK[s] ?? '')}" placeholder="https://…{n}"></div>`).join('')}</div>
   <button class="btn wide" id="st-save">Save settings</button></div>
   <div class="box"><div class="row"><b class="grow">Profiles</b><button class="btn sm primary" data-act="addProfile">Add profile</button></div>${S.profiles.map((p) => `<div class="prow" style="--pc:${esc(p.color || '#4F6475')}"><i></i><span class="grow"><b>${esc(p.name)}</b> <span class="dim">${p.role === 'admin' ? 'Admin' : 'Sorter'}${p.disabled ? ', turned off' : ''}</span></span><button class="btn sm" data-act="editProfile" data-id="${p.id}">Edit</button></div>`).join('')}</div>` : ''}
  <div class="box"><b>This device</b><p class="dim" style="font-size:14px" id="mn-dev">Checking storage…</p><label class="tgl"><input type="checkbox" id="mn-theme" ${document.documentElement.dataset.theme === 'dark' ? 'checked' : ''}> Dark mode</label></div>`);
  navigator.storage?.persisted?.().then((p) => navigator.storage.estimate?.().then((e) => { const el = sh.querySelector('#mn-dev'); if (el) el.textContent = `${p ? 'Data is kept safe on this device.' : 'Install Amanat to the Home Screen so the browser keeps its data.'} Using ${fmtBytes(e?.usage)} here.`; })).catch(() => {});
  sh.querySelector('#mn-ailocal').onchange = (e) => { S.aiLocalOff = !e.target.checked; try { localStorage.setItem('amanat3.aiOff', S.aiLocalOff ? '1' : '0'); } catch (x) { /* ignore */ } schedule(); };
  sh.querySelector('#mn-theme').onchange = (e) => { const v = e.target.checked ? 'dark' : 'light'; document.documentElement.dataset.theme = v; try { localStorage.setItem('amanat3.theme', v); } catch (x) { /* ignore */ } };
  const ai = sh.querySelector('#mn-ai'); if (ai) ai.onchange = async (e) => {
    const off = !e.target.checked; w(setDoc(D('config/main'), { aiOff: off }, { merge: true }));
    try { await api('settings', { aiOff: off }); } catch (x) { toast('Saved here; the server switch needs internet: ' + x.message); }
  };
  const sv = sh.querySelector('#st-save'); if (sv) sv.onclick = () => {
    const trackUrls = {}; sh.querySelectorAll('[data-trk]').forEach((i) => (trackUrls[i.dataset.trk] = i.value.trim()));
    w(setDoc(D('config/main'), { sender: sh.querySelector('#st-sender').value.trim(), waTemplate: sh.querySelector('#st-wa').value.trim() || DEFAULT_WA, trackUrls }, { merge: true }));
    toast('Settings saved');
  };
}
export function openProfile(id) {
  const p = id ? S.profiles.find((x) => x.id === id) : null;
  const role = p?.role || 'sorter'; const perms = { ...DEFAULT_PERMS[role], ...(p?.perms || {}) };
  const self = p?.id === S.me.uid;
  const sh = sheet(p ? 'Edit ' + p.name : 'Add profile', `
  <div class="two"><label class="fld"><span>Name</span><input id="pf-name" value="${esc(p?.name || '')}"></label><label class="fld"><span>Role</span><select id="pf-role" ${self ? 'disabled' : ''}><option value="sorter" ${role === 'sorter' ? 'selected' : ''}>Sorter</option><option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin (everything)</option></select></label></div>
  <label class="fld"><span>What they do (shown on the login card)</span><input id="pf-job" value="${esc(p?.job || '')}" placeholder="Groups the photos and adds addresses"></label>
  <div class="fld"><span class="lab">Colour</span><div class="chips">${PROFILE_COLORS.map((c) => `<button class="chip sw ${(p?.color || PROFILE_COLORS[0]) === c ? 'on' : ''}" data-col="${c}" style="--pc:${c}" aria-label="Colour ${c}"></button>`).join('')}</div></div>
  <div class="fld" id="pf-perms"><span class="lab">Allowed to</span>${Object.entries(PERM_LABELS).map(([k, l]) => `<label class="tgl"><input type="checkbox" data-perm="${k}" ${perms[k] ? 'checked' : ''}> ${l}</label>`).join('')}<p class="dim" style="font-size:13px">Deleting photos, items and flights is for admins only.</p></div>
  <label class="fld"><span>${p ? 'New code (leave empty to keep the current one)' : 'Code (at least 4 characters)'}</span><input id="pf-code" type="password" autocomplete="new-password"></label>
  ${p && !self ? `<label class="tgl"><input type="checkbox" id="pf-off" ${p.disabled ? 'checked' : ''}> Turn this profile off (signs it out everywhere)</label>` : ''}
  <div class="status err" id="pf-err"></div>
  <button class="btn primary wide" id="pf-save">${p ? 'Save' : 'Add profile'}</button>`);
  let color = p?.color || PROFILE_COLORS[S.profiles.length % PROFILE_COLORS.length];
  sh.querySelectorAll('[data-col]').forEach((b) => (b.onclick = () => { color = b.dataset.col; sh.querySelectorAll('[data-col]').forEach((x) => x.classList.toggle('on', x === b)); }));
  const permBox = sh.querySelector('#pf-perms');
  const roleSel = sh.querySelector('#pf-role');
  const syncRole = () => { permBox.style.display = roleSel.value === 'admin' ? 'none' : ''; }; roleSel.onchange = syncRole; syncRole();
  sh.querySelector('#pf-save').onclick = async () => {
    const err = sh.querySelector('#pf-err'); err.textContent = '';
    const name = sh.querySelector('#pf-name').value.trim(); const code = sh.querySelector('#pf-code').value;
    if (!name) { err.textContent = 'Enter a name.'; return; }
    if (!p && code.length < 4) { err.textContent = 'Choose a code of at least 4 characters.'; return; }
    if (code && code.length < 4) { err.textContent = 'The code must be at least 4 characters.'; return; }
    if (!navigator.onLine) { err.textContent = 'Changing profiles needs internet.'; return; }
    const r = self ? 'admin' : roleSel.value;
    const pm = {}; sh.querySelectorAll('[data-perm]').forEach((i) => (pm[i.dataset.perm] = i.checked));
    const disabled = !!sh.querySelector('#pf-off')?.checked;
    const pid = p?.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) + '-' + rid().slice(-4);
    const btn = sh.querySelector('#pf-save'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const res = await api('profile-code', { profileId: pid, role: r, perms: pm, disabled, name });
      if (code) await api('profile-code', { profileId: pid, code });
      w(setDoc(D('profiles/' + pid), { name, role: r, perms: r === 'admin' ? DEFAULT_PERMS.admin : pm, color, job: sh.querySelector('#pf-job').value.trim(), disabled, ...(p ? {} : { at: now() }) }, { merge: true }));
      closeSheet(); toast(p ? 'Profile saved' + (res.signedOut ? '. They need to log in again.' : '') : `Profile added. Give ${name} the code.`);
      if (res.warning) toast(res.warning, { ms: 6000 });
    } catch (e) { btn.disabled = false; btn.textContent = p ? 'Save' : 'Add profile'; err.textContent = e.message; }
  };
}
export async function switchProfile() {
  flushAll(); commitUndos(); // B12
  if (!navigator.onLine && !(await ask('You are offline. Logging in again needs internet. Switch anyway?', 'Switch'))) return;
  closeAll(); S.sel.clear();
  unsubscribeAll();
  try { await signOut(auth); } catch (e) { /* ignore */ }
}
