// Calls to our Cloudflare Pages Functions, and AI with offline fallback.
import { S, auth } from './core.js';
import { localParse, fixUp, splitChat } from './parse.js';

export async function api(path, data, { authed = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (authed) {
    const u = auth?.currentUser; if (!u) throw Object.assign(new Error('Log in again.'), { status: 401 });
    headers.authorization = 'Bearer ' + (await u.getIdToken());
  }
  let r;
  try { r = await fetch('/api/' + path, { method: data === undefined ? 'GET' : 'POST', headers, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(45000) }); }
  catch (e) {
    if (e?.name === 'TimeoutError') throw Object.assign(new Error('ai_busy'), { status: 504 });
    throw Object.assign(new Error('No internet connection.'), { status: 0, offline: true });
  }
  let d = {}; try { d = await r.json(); } catch (e) { /* not json */ }
  if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed (' + r.status + ')'), { status: r.status, data: d });
  return d;
}

export const aiAllowed = () => !!S.me && (S.me.role === 'admin' || S.me.perms?.ai) && !S.cfg.aiOff && !S.aiLocalOff;
const whyText = (e) => (e?.offline || !navigator.onLine ? 'offline' : e?.status === 429 ? 'the free AI limit is reached for now' : e?.message === 'not_configured' ? 'AI key is not set up yet' : e?.message === 'ai_off' ? 'AI is turned off' : e?.message === 'ai_busy' || e?.status === 503 || e?.status === 504 ? 'AI is busy right now, try again in a minute' : 'AI error');

// One message -> fields. Always returns something (local parser fallback).
export async function readText(text) {
  const local = () => fixUp(localParse(text), text);
  if (!aiAllowed()) return { data: local(), ai: false, why: 'AI is turned off' };
  if (!navigator.onLine) return { data: local(), ai: false, why: 'offline', pending: true };
  try {
    const { result } = await api('ai', { task: 'parse', text });
    const x = Array.isArray(result) ? result[0] : result;
    if (x && (x.name || x.phone || x.address)) return { data: fixUp(x, text), ai: true };
    return { data: local(), ai: false, why: 'empty answer' };
  } catch (e) {
    console.warn(e);
    return { data: local(), ai: false, why: whyText(e), pending: !!(e?.offline || e?.status === 429) };
  }
}
// Whole chat -> list of parcels.
export async function readBulk(text) {
  const local = () => splitChat(text).map((raw) => ({ ...fixUp(localParse(raw), raw), raw }));
  if (!aiAllowed() || !navigator.onLine) return { list: local(), ai: false, why: aiAllowed() ? 'offline' : 'AI is turned off', pending: aiAllowed() };
  try {
    const { result } = await api('ai', { task: 'bulk', text });
    const list = (Array.isArray(result) ? result : []).map((x) => ({ ...fixUp(x, x.raw || ''), raw: x.raw || '' })).filter((x) => x.name || x.phone || x.address);
    if (list.length) return { list, ai: true };
    return { list: local(), ai: false, why: 'empty answer' };
  } catch (e) {
    console.warn(e);
    return { list: local(), ai: false, why: whyText(e), pending: true };
  }
}
export async function readImage(dataUrl) {
  if (!aiAllowed()) throw new Error('AI is turned off, so screenshots cannot be read.');
  if (!navigator.onLine) throw new Error('Reading a screenshot needs internet. Try again when online.');
  try {
    const { result } = await api('ai', { task: 'image', image: dataUrl });
    return (Array.isArray(result) ? result : [result]).filter(Boolean).map((x) => fixUp(x, ''));
  } catch (e) { throw new Error('Could not read the screenshot: ' + whyText(e) + '.'); }
}
export async function nameItems(items) {
  if (!aiAllowed()) throw new Error('AI is turned off.');
  if (!navigator.onLine) throw new Error('Naming photos needs internet.');
  try {
    const { result } = await api('ai', { task: 'name', images: items.map((i) => ({ id: i.id, image: i.photos?.[0]?.t || '' })).filter((x) => x.image) });
    return (Array.isArray(result) ? result : []).map((x) => ({ ...x, id: String(x.id || '').replace(/^id:\s*/i, '').trim() }));
  } catch (e) { throw new Error('AI naming failed: ' + whyText(e) + '.'); }
}
