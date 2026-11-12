// POST /api/tick {fid}  -> {opened}
// Timed releases. A dispatcher's app calls this when a release time has passed; the server
// checks the time itself and only then opens the passenger's contact.
import { json, fail, body, verifyUser, validId, fsWhere, tripDue, openTrip } from '../../server/lib.js';

export async function onRequestPost({ request, env }) {
  const me = await verifyUser(request, env);
  if (!me || !me.staff) return fail(401, 'Log in again.');
  const { fid } = await body(request);
  if (!validId(fid)) return fail(400, 'Unknown flight.');
  const trips = await fsWhere(request, env, 'tripsPrivate', 'fid', fid);
  let opened = 0;
  for (const t of trips) {
    if (!tripDue(t) || !(me.boss || (t.dids || []).includes(me.pid))) continue;
    await openTrip(request, env, t); opened++;
  }
  return json({ opened });
}
