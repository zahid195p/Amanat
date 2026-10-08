// First-run setup. Works only while no admin exists, and only with SETUP_KEY.
// GET  /api/setup -> {needed, configured}
// POST /api/setup {setupKey, profileId, name, code} -> {token}
import { json, fail, body, validId, validCode, hashCode, putProf, mintCustomToken, cleanPerms } from '../../server/lib.js';

function configured(env) {
  return { kv: !!env.AMANAT_KV, serviceAccount: !!env.FIREBASE_SERVICE_ACCOUNT, setupKey: !!env.SETUP_KEY, gemini: !!env.GEMINI_API_KEY };
}

export async function onRequestGet({ env }) {
  const c = configured(env);
  const needed = c.kv ? !(await env.AMANAT_KV.get('setup:done')) : true;
  return json({ needed, configured: c });
}

export async function onRequestPost({ request, env }) {
  const c = configured(env);
  if (!c.kv || !c.serviceAccount || !c.setupKey) return fail(503, 'Setup is not finished on Cloudflare yet.', { configured: c });
  if (await env.AMANAT_KV.get('setup:done')) return fail(409, 'Amanat is already set up. Log in instead.');
  const { setupKey, profileId, name, code } = await body(request);
  if (setupKey !== env.SETUP_KEY) return fail(401, 'The setup key is not right.');
  if (!validId(profileId) || !String(name || '').trim()) return fail(400, 'Enter a name.');
  if (!validCode(code)) return fail(400, 'The code must be 4 to 64 characters.');
  let token;
  try { token = await mintCustomToken(env, profileId, { role: 'admin', perms: cleanPerms('admin') }); } // checks the service account first
  catch (e) { return fail(500, 'The Firebase service account secret is not valid: ' + e.message); }
  await env.AMANAT_KV.put('code:' + profileId, JSON.stringify(await hashCode(code)));
  await putProf(env, profileId, { role: 'admin', perms: cleanPerms('admin'), disabled: false, name: String(name).trim().slice(0, 40) });
  await env.AMANAT_KV.put('setup:done', String(Date.now()));
  return json({ token, role: 'admin' });
}
