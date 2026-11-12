// POST /api/people {action, ...}   (private links, codes and roles; the names live in Firestore)
//   create {name, role}        -> {pid, key, pin}      developer or owner
//   pin    {pid}               -> {pin}                new code, unlocks
//   relink {pid}               -> {key}                new private link, signs them out
//   update {pid, name?, disabled?}
//   viewAs {pid}               -> {token}              read-only login as that person
//   myCode {code}                                      anyone: change my own code
// Only the developer can create or change a developer or an owner.
import { json, fail, body, validId, validCode, hashCode, verifyUser, getProf, putProf, kvKey, randomId, randomPin, tokenFor, uidOf, revokeSessions, ROLES } from '../../server/lib.js';

export async function onRequestPost({ request, env }) {
  const me = await verifyUser(request, env);
  if (!me) return fail(401, 'Log in again.');
  if (me.viewAs) return fail(403, 'You are only viewing. Nothing was changed.');
  const b = await body(request);
  const kv = env.AMANAT_KV;

  if (b.action === 'myCode') {
    if (!validCode(b.code) || b.code.length < (me.boss ? 6 : 4)) return fail(400, `The code must be at least ${me.boss ? 6 : 4} characters.`);
    await kv.put(kvKey(request, 'code:' + me.pid), JSON.stringify(await hashCode(b.code)));
    return json({ ok: true });
  }
  if (!me.boss) return fail(403, 'Only the owner can manage people.');
  const high = (role) => role === 'dev' || role === 'owner';

  if (b.action === 'create') {
    const name = String(b.name || '').trim().slice(0, 40);
    if (!name) return fail(400, 'Enter a name.');
    if (!ROLES.includes(b.role)) return fail(400, 'Unknown role.');
    if (high(b.role) && me.role !== 'dev') return fail(403, 'Only the developer can add an owner or developer.');
    const pid = randomId(12), key = randomId(28), pin = randomPin();
    await kv.put(kvKey(request, 'code:' + pid), JSON.stringify(await hashCode(pin)));
    await putProf(request, env, pid, { role: b.role, name, disabled: false });
    await kv.put(kvKey(request, 'link:' + key), pid);
    return json({ pid, key, pin });
  }

  if (!validId(b.pid)) return fail(400, 'Unknown person.');
  const prof = await getProf(request, env, b.pid);
  if (!prof) return fail(404, 'Unknown person.');
  if (high(prof.role) && me.role !== 'dev' && b.pid !== me.pid) return fail(403, 'Only the developer can change an owner or developer.');
  const signOut = async (disable) => { try { await revokeSessions(env, uidOf(request, b.pid), disable, request); } catch (e) { return String(e.message || e); } return ''; };

  if (b.action === 'pin') {
    const pin = randomPin();
    await kv.put(kvKey(request, 'code:' + b.pid), JSON.stringify(await hashCode(pin)));
    await kv.delete(kvKey(request, 'lock:' + b.pid));
    return json({ pin });
  }
  if (b.action === 'relink') {
    if (validId(b.oldKey) && (await kv.get(kvKey(request, 'link:' + b.oldKey))) === b.pid) await kv.delete(kvKey(request, 'link:' + b.oldKey));
    const key = randomId(28);
    await kv.put(kvKey(request, 'link:' + key), b.pid);
    const warning = b.pid === me.pid ? '' : await signOut(prof.disabled);
    return json({ key, warning });
  }
  if (b.action === 'update') {
    if (b.pid === me.pid && b.disabled) return fail(400, 'You cannot turn yourself off.');
    const next = { ...prof };
    if (b.name !== undefined) next.name = String(b.name).trim().slice(0, 40) || prof.name;
    if (b.disabled !== undefined) next.disabled = !!b.disabled;
    await putProf(request, env, b.pid, next);
    const warning = next.disabled !== !!prof.disabled ? await signOut(next.disabled) : '';
    return json({ ok: true, warning });
  }
  if (b.action === 'viewAs') {
    if (high(prof.role)) return fail(400, 'View-as is for dispatchers, clients and passengers.');
    return json({ token: await tokenFor(request, env, b.pid, prof, { viewAs: true }), role: prof.role, name: prof.name });
  }
  return fail(400, 'Unknown action.');
}
