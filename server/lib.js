// Shared helpers for the Cloudflare Pages Functions in /functions/api.
// Secrets (set in Cloudflare, never in the repo):
//   FIREBASE_SERVICE_ACCOUNT  the whole service-account JSON
//   GEMINI_API_KEY            Google AI Studio key
// Binding: AMANAT_KV (KV namespace) holds code hashes, roles and login locks.
import { SignJWT, importPKCS8, jwtVerify, createRemoteJWKSet } from 'jose';

import { envOfHost } from '../src/env.js';

// dev = developer (sees everything), owner = runs the business, dispatcher = collects and sends,
// client = receives parcels, passenger = carries the luggage.
export const ROLES = ['dev', 'owner', 'dispatcher', 'client', 'passenger'];
export const BOSS = ['dev', 'owner'];
export const STAFF = ['dev', 'owner', 'dispatcher'];
export const envOf = (request) => envOfHost(new URL(request.url).hostname);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}
export const fail = (status, error, extra = {}) => json({ error, ...extra }, status);

export async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

export function serviceAccount(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  if (!sa.private_key || !sa.client_email || !sa.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT is incomplete');
  return sa;
}

/* ---------- codes: salted PBKDF2 ---------- */
const ITER = 100000; // Workers cap PBKDF2 at 100k iterations
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(code, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(code)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return new Uint8Array(bits);
}
export async function hashCode(code) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { v: 1, iter: ITER, salt: b64(salt), hash: b64(await derive(code, salt, ITER)) };
}
export async function checkCode(code, rec) {
  if (!rec?.hash) return false;
  const got = await derive(code, unb64(rec.salt), rec.iter || ITER);
  const want = unb64(rec.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
export function validCode(code) {
  return typeof code === 'string' && code.length >= 4 && code.length <= 64;
}

/* ---------- KV records (every key starts with the data space: "test:" or "live:") ----------
   <space>:prof:<pid>  {role, name, disabled}
   <space>:code:<pid>  {v, iter, salt, hash}
   <space>:lock:<pid>  {fails, until}
   <space>:link:<key>  pid          (the private link) */
export const kvKey = (request, k) => envOf(request) + ':' + k;
export async function getProf(request, env, pid) { return env.AMANAT_KV.get(kvKey(request, 'prof:' + pid), 'json'); }
export async function putProf(request, env, pid, p) { await env.AMANAT_KV.put(kvKey(request, 'prof:' + pid), JSON.stringify(p)); }
export const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(id);
const AB = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomId(n) { let o = ''; while (o.length < n) { const b = crypto.getRandomValues(new Uint8Array(n * 2)); for (const x of b) { if (x < 224 && o.length < n) o += AB[x % 56]; } } return o; }
export function randomPin() { const b = crypto.getRandomValues(new Uint32Array(1)); return String(b[0] % 1000000).padStart(6, '0'); }
export const uidOf = (request, pid) => envOf(request) + ':' + pid;
export async function tokenFor(request, env, pid, prof, extra = {}) {
  return mintCustomToken(env, uidOf(request, pid) + (extra.viewAs ? '~view' : ''), { env: envOf(request), pid, role: prof.role, name: prof.name || '', ...extra });
}

/* ---------- Firebase custom token (login) ---------- */
let keyCache = null;
async function signingKey(sa) {
  if (!keyCache || keyCache.email !== sa.client_email) keyCache = { email: sa.client_email, key: await importPKCS8(sa.private_key, 'RS256') };
  return keyCache.key;
}
export async function mintCustomToken(env, uid, claims) {
  const sa = serviceAccount(env);
  return new SignJWT({ uid, claims })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience('https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(await signingKey(sa));
}

/* ---------- Firebase ID token check (AI, admin calls) ---------- */
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
// Local testing only: with AUTH_EMULATOR_HOST set AND the request coming to localhost,
// tokens from the Firebase Auth emulator (unsigned) are accepted.
export const emulator = (request, env) => !!env.AUTH_EMULATOR_HOST && ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname);
function decodeUnsigned(tok) {
  const p = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  if (p.exp && p.exp * 1000 < Date.now()) throw new Error('expired');
  return { payload: p };
}
export async function verifyUser(request, env) {
  const h = request.headers.get('authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!tok) return null;
  const sa = serviceAccount(env);
  try {
    const { payload } = emulator(request, env) ? decodeUnsigned(tok) : await jwtVerify(tok, JWKS, {
      issuer: 'https://securetoken.google.com/' + sa.project_id,
      audience: sa.project_id,
    });
    if (!ROLES.includes(payload.role) || payload.env !== envOf(request) || !validId(payload.pid)) return null;
    if (payload.viewAs) return { pid: payload.pid, role: payload.role, name: payload.name || '', viewAs: true };
    const prof = await getProf(request, env, payload.pid);
    if (!prof || prof.disabled) return null;
    // KV is the source of truth for the role, so a change takes effect at once.
    return { pid: payload.pid, role: prof.role, name: prof.name, boss: BOSS.includes(prof.role), staff: STAFF.includes(prof.role) };
  } catch {
    return null;
  }
}

/* ---------- Google OAuth for Identity Toolkit admin calls ---------- */
let accessCache = null;
export async function accessToken(env) {
  if (accessCache && accessCache.exp > Date.now() + 60000) return accessCache.tok;
  const sa = serviceAccount(env);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(await signingKey(sa));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!r.ok) throw new Error('Google token exchange failed: ' + r.status);
  const d = await r.json();
  accessCache = { tok: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return accessCache.tok;
}
// Signs a profile out everywhere (and optionally disables it) so new claims apply.
export async function revokeSessions(env, uid, disable, request) {
  const sa = serviceAccount(env);
  const emu = request && emulator(request, env);
  const base = emu ? `http://${env.AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  const r = await fetch(`${base}/v1/projects/${sa.project_id}/accounts:update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (emu ? 'owner' : await accessToken(env)) },
    body: JSON.stringify({ localId: uid, validSince: String(Math.floor(Date.now() / 1000)), disableUser: !!disable }),
  });
  if (!r.ok) {
    const t = await r.text();
    if (!/USER_NOT_FOUND/.test(t)) throw new Error('accounts:update failed: ' + t.slice(0, 200));
  }
}

/* ---------- Firestore from the server (service account; rules do not apply) ----------
   Used for pages of people who get no database access (passengers, clients) and for
   timed releases. Paths are inside this request's data space: apps/<space>/… */
function fsRoot(request, env) {
  const sa = serviceAccount(env);
  const emu = !!env.FIRESTORE_EMULATOR_HOST && emulator(request, env);
  return { emu, url: `${emu ? 'http://' + env.FIRESTORE_EMULATOR_HOST : 'https://firestore.googleapis.com'}/v1/projects/${sa.project_id}/databases/(default)/documents/apps/${envOf(request)}` };
}
async function fsFetch(request, env, path, init = {}) {
  const { emu, url } = fsRoot(request, env);
  return fetch(url + path, { ...init, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (emu ? 'owner' : await accessToken(env)) } });
}
function dec(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decFields(v.mapValue.fields);
  return null;
}
const decFields = (f = {}) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, dec(v)]));
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
  return { stringValue: String(v) };
}
const docOf = (d) => ({ id: d.name.split('/').pop(), ...decFields(d.fields) });
export async function fsGet(request, env, path) {
  const r = await fsFetch(request, env, '/' + path);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('database read failed: ' + r.status);
  return docOf(await r.json());
}
export async function fsWhere(request, env, coll, field, value) {
  const r = await fsFetch(request, env, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: coll }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: enc(value) } }, limit: 500 } }) });
  if (!r.ok) throw new Error('database query failed: ' + r.status);
  return (await r.json()).filter((x) => x.document).map((x) => docOf(x.document));
}
export async function fsPatch(request, env, path, data) {
  const mask = Object.keys(data).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const r = await fsFetch(request, env, `/${path}?${mask}&currentDocument.exists=true`, { method: 'PATCH', body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }) });
  if (!r.ok) throw new Error('database write failed: ' + r.status);
}
// Opens a passenger's contact when its time has come ("10 minutes before landing").
export const tripDue = (t, nowMs = Date.now()) => !t.released && typeof t.dueAt === 'number' && t.dueAt > 0 && t.dueAt <= nowMs;
export async function openTrip(request, env, t) {
  await fsPatch(request, env, 'tripsPrivate/' + t.id, { released: true, rel: t.dids || [], relAt: Date.now(), relBy: 'timer' });
}
// Several documents in one request (a function may make only ~50 requests).
export async function fsMany(request, env, paths) {
  if (!paths.length) return new Map();
  const { emu, url } = fsRoot(request, env);
  const base = url.replace(/^https?:\/\/[^/]+\/v1\//, ''); // projects/…/documents/apps/<space>
  const r = await fetch(url.replace(/\/documents\/.*$/, '/documents:batchGet'), { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (emu ? 'owner' : await accessToken(env)) }, body: JSON.stringify({ documents: paths.map((p) => `${base}/${p}`) }) });
  if (!r.ok) throw new Error('database read failed: ' + r.status);
  const out = new Map();
  for (const x of await r.json()) if (x.found) { const d = docOf(x.found); out.set(x.found.name.split('/').slice(-2).join('/'), d); }
  return out;
}
export async function fsWhereIn(request, env, coll, field, values) {
  const out = [];
  for (let k = 0; k < values.length; k += 30) {
    const r = await fsFetch(request, env, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: coll }], where: { fieldFilter: { field: { fieldPath: field }, op: 'IN', value: enc(values.slice(k, k + 30)) } }, limit: 2000 } }) });
    if (!r.ok) throw new Error('database query failed: ' + r.status);
    out.push(...(await r.json()).filter((x) => x.document).map((x) => docOf(x.document)));
  }
  return out;
}
