// POST /api/people {action, ...}   (private links, codes and roles; the names live in Firestore)
//   create {name, role}        -> {pid, key, pin}      developer or owner
//   pin    {pid}               -> {pin}                new code, unlocks
//   relink {pid}               -> {key}                new private link, signs them out
//   update {pid, name?, disabled?}
//   viewAs {pid}               -> {token}              read-only login as that person
//   myCode {code}                                      anyone: change my own code
// Clients (stored only in the database):
//   clientLink  {pid, oldKey?} -> {key}                 personal link (no code needed), signs out the old one
//   clientReset {pid}                                   forget their code; they choose a new one, everyone is signed out
//   clientEnsure {name, phone, …} -> {cid}              dispatcher or owner: find the client by phone, or add them
// Only the developer can create or change a developer or an owner.
import { json, fail, body, validId, validCode, hashCode, verifyUser, getProf, putProf, kvKey, randomId, randomPin, tokenFor, uidOf, revokeSessions, ROLES, fsGet, fsPatch, fsCreate, findClientByPhone } from '../../server/lib.js';
import { phoneKey } from '../../src/parse.js';

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
  if (b.action === 'clientEnsure') {
    if (!me.staff) return fail(403, 'Not allowed.');
    const pk = phoneKey(b.phone);
    if (!pk) return json({ cid: '' });
    const found = await findClientByPhone(request, env, pk);
    if (found) return json({ cid: found.id });
    const t = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);
    const cid = randomId(12);
    await fsCreate(request, env, 'people', cid, { role: 'client', name: t(b.name, 80), phone: t(b.phone, 30), pk, phone2: t(b.phone2, 80), address: t(b.address, 400), city: t(b.city, 60), service: t(b.service, 60), note: '', key: '', codeSet: false, sharedOff: false, disabled: false, since: 0, at: Date.now(), by: me.pid });
    return json({ cid, created: true });
  }
  if (!me.boss) return fail(403, 'Only the owner can manage people.');
  if (['clientLink', 'clientReset', 'viewAs'].includes(b.action) && validId(b.pid)) {
    const c = await fsGet(request, env, 'people/' + b.pid);
    if (c?.role === 'client') {
      if (b.action === 'viewAs') return json({ token: await tokenFor(request, env, b.pid, { role: 'client', name: c.name || '' }, { viewAs: true }), role: 'client', name: c.name });
      const since = Date.now();
      if (b.action === 'clientReset') {
        await kv.delete(kvKey(request, 'ccode:' + b.pid)); await kv.delete(kvKey(request, 'clock:' + b.pid));
        await fsPatch(request, env, 'people/' + b.pid, { codeSet: false, since });
        return json({ ok: true });
      }
      if (c.key) await kv.delete(kvKey(request, 'clink:' + c.key));
      const key = randomId(28);
      await kv.put(kvKey(request, 'clink:' + key), b.pid);
      await fsPatch(request, env, 'people/' + b.pid, { key, since });
      return json({ key });
    }
  }
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
