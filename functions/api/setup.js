// First-run setup: creates the developer account. Works only while nobody exists in this
// data space, and only with the setup phrase.
// GET  /api/setup -> {needed, configured}
// POST /api/setup {setupKey, name, code} -> {token, pid, key}
import { json, fail, body, validCode, hashCode, checkCode, putProf, tokenFor, kvKey, randomId, envOf } from '../../server/lib.js';
import { SETUP_KEY_HASH } from '../../server/setup-key.js';

const configured = (env) => ({ kv: !!env.AMANAT_KV, serviceAccount: !!env.FIREBASE_SERVICE_ACCOUNT, gemini: !!env.GEMINI_API_KEY });

export async function onRequestGet({ request, env }) {
  const c = configured(env);
  const needed = c.kv ? !(await env.AMANAT_KV.get(kvKey(request, 'setup:done'))) : true;
  return json({ needed, configured: c, space: envOf(request) });
}

export async function onRequestPost({ request, env }) {
  const c = configured(env);
  if (!c.kv || !c.serviceAccount) return fail(503, 'Setup is not finished on Cloudflare yet.', { configured: c });
  const kv = env.AMANAT_KV;
  if (await kv.get(kvKey(request, 'setup:done'))) return fail(409, 'Amanat is already set up. Open your private link instead.');
  const { setupKey, name, code } = await body(request);
  const keyOk = env.SETUP_KEY ? setupKey === env.SETUP_KEY : await checkCode(String(setupKey || ''), SETUP_KEY_HASH);
  if (!keyOk) return fail(401, 'The setup phrase is not right.');
  const nm = String(name || '').trim().slice(0, 40);
  if (!nm) return fail(400, 'Enter a name.');
  if (!validCode(code) || code.length < 6) return fail(400, 'The code must be at least 6 characters.');
  const pid = randomId(12), key = randomId(28);
  const prof = { role: 'dev', name: nm, disabled: false };
  let token;
  try { token = await tokenFor(request, env, pid, prof); } // checks the service account first
  catch (e) { return fail(500, 'The Firebase service account secret is not valid: ' + e.message); }
  await kv.put(kvKey(request, 'code:' + pid), JSON.stringify(await hashCode(code)));
  await putProf(request, env, pid, prof);
  await kv.put(kvKey(request, 'link:' + key), pid);
  await kv.put(kvKey(request, 'setup:done'), String(Date.now()));
  return json({ token, pid, key, role: 'dev' });
}
