// POST /api/settings {aiOff}  owner only. Mirrors the AI switch to the server so it is enforced there too.
import { json, fail, body, verifyUser, kvKey } from '../../server/lib.js';

export async function onRequestPost({ request, env }) {
  const me = await verifyUser(request, env);
  if (!me) return fail(401, 'Log in again.');
  if (!me.boss) return fail(403, 'Only the owner can change this.');
  const b = await body(request);
  if (typeof b.aiOff === 'boolean') await env.AMANAT_KV.put(kvKey(request, 'cfg:aiOff'), b.aiOff ? '1' : '0');
  return json({ ok: true });
}
