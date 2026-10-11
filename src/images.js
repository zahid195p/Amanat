// Photo compression, upload queue and full-photo loading.
import { S, D, rid, now, put, upd, w, toast, plural, schedule, getDoc, increment, nextTmp, logEv, can, setDoc } from './core.js';

const isHeic = (f) => /\.(heic|heif)$/i.test(f?.name || '') || /hei[cf]/i.test(f?.type || '');
export async function decode(file) {
  if ('createImageBitmap' in window) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ } }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error(isHeic(file)
        ? `${file.name} is a HEIC photo, which this browser cannot open. Upload it from the iPhone, or save it as JPG first.`
        : `${file.name || 'This photo'} could not be opened.`));
      im.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0); // B13: the decoded image keeps its pixels
  }
}
function draw(src, max, q) {
  const wd = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const s = Math.min(1, max / Math.max(wd, h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(wd * s)); c.height = Math.max(1, Math.round(h * s));
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
export async function compress(file) {
  const src = await decode(file);
  let full = null;
  for (const [m, q] of [[1400, 0.72], [1250, 0.62], [1100, 0.55], [950, 0.5], [800, 0.45]]) { full = draw(src, m, q); if (full.length < 235000) break; }
  const thumb = draw(src, 240, 0.55);
  try { src.close?.(); } catch (e) { /* ignore */ }
  return { full, thumb };
}
export async function compressOne(file, max = 1200, q = 0.7) {
  const src = await decode(file); const d = draw(src, max, q); try { src.close?.(); } catch (e) { /* ignore */ } return d;
}

/* ---------- full photos: memory cache, then Firestore (which also serves offline from its cache) ---------- */
const photoCache = new Map();
export function cachePhoto(pid, d) { photoCache.set(pid, d); if (photoCache.size > 80) photoCache.delete(photoCache.keys().next().value); }
export async function fullPhoto(pid, col = 'photos') {
  if (!pid) return null;
  if (photoCache.has(pid)) return photoCache.get(pid);
  const s = await getDoc(D(col + '/' + pid));
  const d = s.exists() ? s.data().d : null;
  if (d) cachePhoto(pid, d);
  return d;
}

/* ---------- upload queue (feature 4) ----------
   status: waiting -> working -> saved (on this device, waiting to upload) -> done (on the server) | failed */
export function handleFiles(files) {
  const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name || ''));
  if (!list.length) { toast('Pick photos (JPG, PNG or HEIC).'); return; }
  if (!can('upload')) { toast('Your profile cannot add photos.'); return; }
  if (!S.fid) { toast('Add a flight first.'); return; }
  let tmp = Math.max(nextTmp(), ...S.uq.map((u) => (u.tmp || 0) + 1));
  for (const f of list) S.uq.push({ id: rid(), file: f, name: f.name || 'photo', status: 'waiting', fid: S.fid, tmp: tmp++ });
  schedule(); pump();
}
let running = 0;
function pump() {
  while (running < 2) {
    const job = S.uq.find((u) => u.status === 'waiting'); if (!job) break;
    running++; job.status = 'working'; schedule();
    work(job).finally(() => { running--; schedule(); pump(); maybeSummarise(); });
  }
}
async function work(job) {
  try {
    const { full, thumb } = await compress(job.file);
    const pid = rid(), iid = rid();
    cachePhoto(pid, full);
    const pw = setDoc(D('photos/' + pid), { fid: job.fid, d: full, at: now() });
    const iw = setDoc(D('items/' + iid), { fid: job.fid, n: null, tmp: job.tmp, name: '', qty: null, photos: [{ p: pid, t: thumb, s: full.length }], groupId: '', at: now(), by: S.me.uid });
    w(pw, 'photo'); w(iw, 'item');
    upd('flights/' + job.fid, { bytes: increment(full.length + thumb.length) });
    job.status = 'saved'; job.file = null; schedule();
    Promise.all([pw, iw]).then(() => { job.status = 'done'; schedule(); setTimeout(() => clearDone(), 4000); }, (e) => { job.status = 'failed'; job.err = 'Upload refused: ' + (e?.code || e?.message); schedule(); });
  } catch (e) {
    console.warn(e); job.status = 'failed'; job.err = e?.message || 'Could not read this photo.';
    toast(job.err, { ms: 6000 });
  }
}
let summary = { n: 0, fail: 0 };
function maybeSummarise() {
  if (S.uq.some((u) => u.status === 'waiting' || u.status === 'working')) return;
  const saved = S.uq.filter((u) => u.status === 'saved' || u.status === 'done').length - summary.n;
  const failed = S.uq.filter((u) => u.status === 'failed').length;
  if (saved > 0) { toast(`${plural(saved, 'photo')} added` + (failed ? `, ${failed} failed` : '') + (navigator.onLine ? '' : '. They upload when you are back online.')); logEv(`added ${plural(saved, 'photo')}`); }
  summary.n += Math.max(0, saved);
}
function clearDone() {
  if (S.uq.every((u) => u.status === 'done')) { S.uq = []; summary.n = 0; schedule(); }
}
export function retryUpload(id) {
  const j = S.uq.find((u) => u.id === id);
  if (j && j.file) { j.status = 'waiting'; j.err = ''; schedule(); pump(); }
}
export function dropUpload(id) { S.uq = S.uq.filter((u) => u.id !== id); schedule(); }
export function clearUploads() { S.uq = S.uq.filter((u) => u.status === 'waiting' || u.status === 'working' || u.status === 'saved'); summary.n = 0; schedule(); }
