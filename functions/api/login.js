// POST /api/login {profileId, code} -> {token}
// 5 wrong codes lock that profile for 10 minutes.
import { json, fail, body, validId, getProf, checkCode, mintCustomToken, cleanPerms } from '../../server/lib.js';

const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000;

export async function onRequestPost({ request, env }) {
  const { profileId, code } = await body(request);
  if (!validId(profileId) || typeof code !== 'string' || !code) return fail(400, 'Pick a profile and type the code.');
  const kv = env.AMANAT_KV;
  const lockKey = 'lock:' + profileId;
  const lock = (await kv.get(lockKey, 'json')) || { fails: 0, until: 0 };
  if (lock.until > Date.now()) {
    const mins = Math.ceil((lock.until - Date.now()) / 60000);
    return fail(429, `Too many wrong codes. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, { until: lock.until });
  }
  const [prof, rec] = await Promise.all([getProf(env, profileId), kv.get('code:' + profileId, 'json')]);
  const ok = !!prof && !prof.disabled && (await checkCode(code, rec));
  if (!ok) {
    const fails = (lock.until && lock.until <= Date.now() ? 0 : lock.fails) + 1;
    const next = fails >= MAX_FAILS ? { fails: 0, until: Date.now() + LOCK_MS } : { fails, until: 0 };
    await kv.put(lockKey, JSON.stringify(next), { expirationTtl: 3600 });
    if (prof?.disabled) return fail(403, 'This profile is turned off. Ask Zahid.');
    const left = MAX_FAILS - fails;
    return fail(401, next.until ? 'Too many wrong codes. Locked for 10 minutes.' : `That code is not right. ${left} tr${left === 1 ? 'y' : 'ies'} left.`);
  }
  if (lock.fails) await kv.delete(lockKey);
  const token = await mintCustomToken(env, profileId, { role: prof.role, perms: cleanPerms(prof.role, prof.perms) });
  return json({ token, role: prof.role });
}
