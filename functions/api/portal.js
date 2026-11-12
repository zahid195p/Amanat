// GET /api/portal  -> what a passenger may see (clients come in a later step).
// Passengers have no database access; this builds their page on the server and includes the
// dispatcher's contact only once it is released (by hand or by the timer).
import { json, fail, verifyUser, fsGet, fsWhere, tripDue, openTrip } from '../../server/lib.js';

export async function onRequestGet({ request, env }) {
  const me = await verifyUser(request, env);
  if (!me) return fail(401, 'Log in again.');
  if (me.role !== 'passenger') return json({ role: me.role, trips: [] });
  const mine = await fsWhere(request, env, 'tripsPrivate', 'pid', me.pid);
  const trips = [];
  for (const t of mine) {
    const [flight, pub] = await Promise.all([fsGet(request, env, 'flights/' + t.fid), fsGet(request, env, 'trips/' + t.id)]);
    if (!flight || flight.archived || flight.deleting) continue;
    if (flight.landAt && flight.landAt < Date.now() - 3 * 86400000) continue; // old flights drop off
    let released = !!t.released;
    if (tripDue(t)) { released = true; if (!me.viewAs) { try { await openTrip(request, env, t); } catch (e) { /* the page still shows it */ } } }
    let dispatchers = [];
    if (released) {
      const ps = await Promise.all((t.dids || []).map((d) => fsGet(request, env, 'people/' + d)));
      dispatchers = ps.filter((p) => p && !p.disabled).map((p) => ({ name: p.name || '', phone: p.phone || '' }));
    }
    trips.push({
      id: t.id, flight: { label: flight.label || '', date: flight.date || '', landAt: flight.landAt || null },
      checked: pub?.checked || 0, hand: pub?.hand || 0, weight: pub?.weight || null,
      released, dueAt: released ? null : t.dueAt || null, dispatchers,
    });
  }
  trips.sort((a, b) => (a.flight.landAt || 0) - (b.flight.landAt || 0));
  return json({ role: 'passenger', name: me.name || '', trips });
}
