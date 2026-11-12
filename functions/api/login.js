// POST /api/login {key}        -> {name}            who this private link belongs to
// POST /api/login {key, code}  -> {token, role}
// 5 wrong codes lock that person for 10 minutes. There is no list of people to pick from.
import { json, fail, body, validId, getProf, checkCode, tokenFor, kvKey } from '../../server/lib.js';

const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000;
const BAD_LINK = 'This link is not valid any more. Ask for a new one.';

export async function onRequestPost({ request, env }) {
  const { key, code } = await body(request);
  if (!validId(key)) return fail(400, BAD_LINK);
  const kv = env.AMANAT_KV;
  const pid = await kv.get(kvKey(request, 'link:' + key));
  const prof = pid ? await getProf(request, env, pid) : null;
  if (!prof) return fail(404, BAD_LINK);
  if (prof.disabled) return fail(403, 'This link is turned off.');
  if (code === undefined) return json({ name: prof.name || '' });
  if (typeof code !== 'string' || !code) return fail(400, 'Type your code.');
  const lockKey = kvKey(request, 'lock:' + pid);
  const lock = (await kv.get(lockKey, 'json')) || { fails: 0, until: 0 };
  if (lock.until > Date.now()) {
    const mins = Math.ceil((lock.until - Date.now()) / 60000);
    return fail(429, `Too many wrong codes. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, { until: lock.until });
  }
  const rec = await kv.get(kvKey(request, 'code:' + pid), 'json');
  if (!(await checkCode(code.trim(), rec))) {
    const fails = (lock.until && lock.until <= Date.now() ? 0 : lock.fails) + 1;
    const next = fails >= MAX_FAILS ? { fails: 0, until: Date.now() + LOCK_MS } : { fails, until: 0 };
    await kv.put(lockKey, JSON.stringify(next), { expirationTtl: 3600 });
    const left = MAX_FAILS - fails;
    return fail(401, next.until ? 'Too many wrong codes. Locked for 10 minutes.' : `That code is not right. ${left} tr${left === 1 ? 'y' : 'ies'} left.`);
  }
  if (lock.fails) await kv.delete(lockKey);
  return json({ token: await tokenFor(request, env, pid, prof), role: prof.role });
}
