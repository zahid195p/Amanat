// POST /api/profile-code {profileId, code}            admin only: set a new code
// POST /api/profile-code {profileId, role, perms, disabled, name}  admin only: sync role/permissions
// Any role/permission/disable change signs that profile out on all devices so the new rights apply.
import { json, fail, body, validId, validCode, hashCode, verifyUser, getProf, putProf, cleanPerms, ROLES, revokeSessions } from '../../server/lib.js';

export async function onRequestPost({ request, env }) {
  const me = await verifyUser(request, env);
  if (!me) return fail(401, 'Log in again.');
  if (me.role !== 'admin') return fail(403, 'Only an admin can change profiles.');
  const b = await body(request);
  if (!validId(b.profileId)) return fail(400, 'Unknown profile.');
  const id = b.profileId;
  const prev = (await getProf(env, id)) || { role: 'sorter', perms: null, disabled: false, name: '' };

  if (b.code !== undefined) {
    if (!validCode(b.code)) return fail(400, 'The code must be 4 to 64 characters.');
    await env.AMANAT_KV.put('code:' + id, JSON.stringify(await hashCode(b.code)));
    await env.AMANAT_KV.delete('lock:' + id);
    if (!(await getProf(env, id))) await putProf(env, id, { ...prev, perms: cleanPerms(prev.role, prev.perms) });
    return json({ ok: true });
  }

  const role = b.role !== undefined ? b.role : prev.role;
  if (!ROLES.includes(role)) return fail(400, 'Unknown role.');
  if (id === me.uid && (role !== 'admin' || b.disabled)) return fail(400, 'You cannot remove your own admin rights.');
  const next = {
    role,
    perms: cleanPerms(role, b.perms !== undefined ? b.perms : prev.perms),
    disabled: b.disabled !== undefined ? !!b.disabled : !!prev.disabled,
    name: b.name !== undefined ? String(b.name).trim().slice(0, 40) : prev.name,
  };
  await putProf(env, id, next);
  const rightsChanged = next.role !== prev.role || next.disabled !== !!prev.disabled || JSON.stringify(next.perms) !== JSON.stringify(cleanPerms(prev.role, prev.perms));
  let signedOut = false;
  if (rightsChanged && id !== me.uid) {
    try { await revokeSessions(env, id, next.disabled, request); signedOut = true; } catch (e) { return json({ ok: true, profile: next, warning: String(e.message || e) }); }
  }
  return json({ ok: true, profile: next, signedOut });
}
