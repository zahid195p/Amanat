// POST /api/settings {aiOff}  admin only. Mirrors the AI switch to the server so it is enforced there too.
import { json, fail, body, verifyUser } from '../../server/lib.js';

export async function onRequestPost({ request, env }) {
  const me = await verifyUser(request, env);
  if (!me) return fail(401, 'Log in again.');
  if (me.role !== 'admin') return fail(403, 'Only an admin can change this.');
  const b = await body(request);
  if (typeof b.aiOff === 'boolean') await env.AMANAT_KV.put('cfg:aiOff', b.aiOff ? '1' : '0');
  return json({ ok: true });
}
