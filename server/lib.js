// Shared helpers for the Cloudflare Pages Functions in /functions/api.
// Secrets (set in Cloudflare, never in the repo):
//   FIREBASE_SERVICE_ACCOUNT  the whole service-account JSON
//   GEMINI_API_KEY            Google AI Studio key
//   SETUP_KEY                 one-time phrase that unlocks first-admin setup
// Binding: AMANAT_KV (KV namespace) holds code hashes, roles and login locks.
import { SignJWT, importPKCS8, jwtVerify, createRemoteJWKSet } from 'jose';

export const ROLES = ['admin', 'sorter'];
export const PERMS = ['upload', 'name', 'group', 'send', 'flights', 'ai', 'export'];
export const DEFAULT_PERMS = {
  admin: { upload: true, name: true, group: true, send: true, flights: true, ai: true, export: true },
  sorter: { upload: false, name: false, group: true, send: true, flights: false, ai: true, export: false },
};

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

/* ---------- KV records ---------- */
// prof:<id>  {role, perms, disabled, name}
// code:<id>  {v, iter, salt, hash}
// lock:<id>  {fails, until}
export async function getProf(env, id) { return env.AMANAT_KV.get('prof:' + id, 'json'); }
export async function putProf(env, id, p) { await env.AMANAT_KV.put('prof:' + id, JSON.stringify(p)); }
export const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(id);
export function cleanPerms(role, perms) {
  const base = DEFAULT_PERMS[role] || DEFAULT_PERMS.sorter;
  const out = {};
  for (const k of PERMS) out[k] = role === 'admin' ? true : (perms && typeof perms[k] === 'boolean' ? perms[k] : base[k]);
  return out;
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
    if (!ROLES.includes(payload.role)) return null;
    const prof = await getProf(env, payload.sub);
    if (!prof || prof.disabled) return null;
    // KV is the source of truth for role and perms, so a demotion takes effect at once.
    return { uid: payload.sub, role: prof.role, perms: cleanPerms(prof.role, prof.perms) };
  } catch {
    return null;
  }
}

/* ---------- Google OAuth for Identity Toolkit admin calls ---------- */
let accessCache = null;
async function accessToken(env) {
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
