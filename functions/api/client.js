// Client login. No accounts, no email.
//   POST {action:'lookup', phone}          shared link: is this number a client, and has it a code?
//                                           -> {state: 'new' | 'code' | 'off' | 'none'}
//   POST {action:'claim',  phone, code}     first visit: the client chooses a 4-digit code -> {token}
//   POST {action:'login',  phone, code}     next visits on a new device -> {token}
//   POST {action:'key',    key}             personal link (made by the owner) -> {token}
// The answer never contains a name or anything else about the client before login.
import { json, fail, body, validId, hashCode, checkCode, kvKey, fsGet, fsPatch, findClientByPhone, clientToken, rateOk } from '../../server/lib.js';
import { phoneKey } from '../../src/parse.js';

const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000;
const NOT_FOUND = 'This number is not on our list. Ask Tayyab to add it, or use the private link he sent you.';

export async function onRequestPost({ request, env }) {
  const b = await body(request);
  const kv = env.AMANAT_KV;

  if (b.action === 'key') {
    if (!validId(b.key)) return fail(400, 'This link is not valid any more. Ask for a new one.');
    const pid = await kv.get(kvKey(request, 'clink:' + b.key));
    const c = pid ? await fsGet(request, env, 'people/' + pid) : null;
    if (!c || c.role !== 'client' || c.key !== b.key) return fail(404, 'This link is not valid any more. Ask for a new one.');
    if (c.disabled) return fail(403, 'This link is turned off.');
    return json({ token: await clientToken(request, env, c), role: 'client' });
  }

  if (!['lookup', 'claim', 'login'].includes(b.action)) return fail(400, 'Not possible.');
  if (!(await rateOk(request, env, 'client', 40, 3600))) return fail(429, 'Too many tries from this connection. Try again in an hour.');
  const pk = phoneKey(b.phone);
  if (!pk) return fail(400, 'Type your phone number, for example 0300 1234567.');
  const [c, cfg] = await Promise.all([findClientByPhone(request, env, pk), fsGet(request, env, 'config/main')]);
  if (!c) return fail(404, NOT_FOUND);
  if (cfg?.sharedOff || c.sharedOff) return json({ state: 'off' });
  const codeKey = kvKey(request, 'ccode:' + c.id);
  const rec = await kv.get(codeKey, 'json');
  if (b.action === 'lookup') return json({ state: rec ? 'code' : 'new' });

  const code = String(b.code || '').trim();
  if (!/^\d{4}$/.test(code)) return fail(400, 'The code is 4 digits.');
  if (b.action === 'claim') {
    if (rec) return fail(409, 'This number already has a code. Type it, or ask Tayyab to reset it.');
    await kv.put(codeKey, JSON.stringify(await hashCode(code)));
    await fsPatch(request, env, 'people/' + c.id, { codeSet: true, codeAt: Date.now() });
    return json({ token: await clientToken(request, env, c), role: 'client' });
  }
  // login
  if (!rec) return json({ state: 'new' });
  const lockKey = kvKey(request, 'clock:' + c.id);
  const lock = (await kv.get(lockKey, 'json')) || { fails: 0, until: 0 };
  if (lock.until > Date.now()) return fail(429, `Too many wrong codes. Try again in ${Math.ceil((lock.until - Date.now()) / 60000)} minutes.`);
  if (!(await checkCode(code, rec))) {
    const fails = (lock.until && lock.until <= Date.now() ? 0 : lock.fails) + 1;
    const next = fails >= MAX_FAILS ? { fails: 0, until: Date.now() + LOCK_MS } : { fails, until: 0 };
    await kv.put(lockKey, JSON.stringify(next), { expirationTtl: 3600 });
    return fail(401, next.until ? 'Too many wrong codes. Locked for 10 minutes.' : `That code is not right. ${MAX_FAILS - fails} tr${MAX_FAILS - fails === 1 ? 'y' : 'ies'} left.`);
  }
  if (lock.fails) await kv.delete(lockKey);
  return json({ token: await clientToken(request, env, c), role: 'client' });
}
