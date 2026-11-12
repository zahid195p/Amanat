// The pages of people who get no database access. Everything is read on the server and only
// what the owner has released is sent.
//   GET  /api/portal                 passenger: flights, bags, dispatcher contact once released
//                                    client: own parcels across flights, slips once released
//   GET  /api/portal?slip=<parcel>   client: the full slip photo of an own, released parcel
//   POST /api/portal {action:'address', id, name, phone, phone2, address, city, service, note}
//                                    client: correct the address of an own parcel not yet booked
import { json, fail, body, verifyUser, validId, fsGet, fsWhere, fsMany, fsWhereIn, fsPatch, tripDue, openTrip } from '../../server/lib.js';
import { SERVICES } from '../../src/parse.js';

const people = async (request, env, ids) => {
  const m = await fsMany(request, env, ids.map((d) => 'people/' + d));
  return [...m.values()].filter((p) => !p.disabled).map((p) => ({ name: p.name || '', phone: p.phone || '' }));
};
const safeThumb = (t) => (typeof t === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(t) ? t : '');
const canEdit = (g) => !g.done && !g.steps?.booked && !g.steps?.sent && !g.steps?.delivered;

async function passenger(request, env, me) {
  const mine = await fsWhere(request, env, 'tripsPrivate', 'pid', me.pid);
  const trips = [];
  for (const t of mine) {
    const [flight, pub] = await Promise.all([fsGet(request, env, 'flights/' + t.fid), fsGet(request, env, 'trips/' + t.id)]);
    if (!flight || flight.archived || flight.deleting) continue;
    if (flight.landAt && flight.landAt < Date.now() - 3 * 86400000) continue; // old flights drop off
    let released = !!t.released;
    if (tripDue(t)) { released = true; if (!me.viewAs) { try { await openTrip(request, env, t); } catch (e) { /* the page still shows it */ } } }
    trips.push({
      id: t.id, flight: { label: flight.label || '', date: flight.date || '', landAt: flight.landAt || null },
      checked: pub?.checked || 0, hand: pub?.hand || 0, weight: pub?.weight || null,
      released, dueAt: released ? null : t.dueAt || null, dispatchers: released ? await people(request, env, t.dids || []) : [],
    });
  }
  trips.sort((a, b) => (a.flight.landAt || 0) - (b.flight.landAt || 0));
  return { role: 'passenger', name: me.name || '', trips };
}

async function client(request, env, me) {
  const privs = (await fsWhere(request, env, 'groupsPrivate', 'cid', me.pid)).slice(0, 90);
  const cfg = (await fsGet(request, env, 'config/main')) || {};
  const groups = await fsMany(request, env, privs.map((p) => 'groups/' + p.id));
  const flights = await fsMany(request, env, [...new Set(privs.map((p) => 'flights/' + p.fid))]);
  const items = privs.length ? await fsWhereIn(request, env, 'items', 'groupId', privs.map((p) => p.id)) : [];
  let rows = privs.map((p) => ({ p, g: groups.get('groups/' + p.id), f: flights.get('flights/' + p.fid) })).filter((x) => x.g && x.f && !x.f.deleting);
  rows.sort((a, b) => (b.f.landAt || Date.parse(b.f.date || '') || b.f.at || 0) - (a.f.landAt || Date.parse(a.f.date || '') || a.f.at || 0) || (a.g.pn || 0) - (b.g.pn || 0));
  const parcels = [];
  for (const [k, { p, g, f }] of rows.entries()) {
    const slipOk = !!p.slipOk || !!cfg.slipAuto;
    const pickup = /pickup/i.test(g.service || '') && p.pickOk ? await people(request, env, p.dids || []) : null;
    const step = ['delivered', 'sent', 'booked', 'packed'].find((s) => g.steps?.[s]) || (g.done ? 'sent' : '');
    parcels.push({
      id: p.id, pn: g.pn || null, flight: { label: f.label || '', date: f.date || '', landAt: f.landAt || null },
      status: step || (f.landAt && f.landAt > Date.now() ? 'coming' : 'arrived'),
      name: p.name || '', phone: p.phone || '', phone2: p.phone2 || '', address: p.address || '', city: g.city || '', service: g.service || '', note: g.note || '',
      canEdit: canEdit(g),
      items: items.filter((i) => i.groupId === p.id).sort((a, b) => (a.n || 1e9) - (b.n || 1e9)).map((i) => ({ n: i.n || null, name: i.name || '', qty: Number(i.qty) > 0 ? Number(i.qty) : 1, recv: i.recv || '', t: k < 20 ? safeThumb(i.photos?.[0]?.t) : '' })),
      slip: slipOk && (g.tracking || g.receipt) ? { tracking: g.tracking || '', t: safeThumb(g.receipt?.t), has: !!g.receipt } : null,
      pickup,
    });
  }
  return { role: 'client', name: me.name || '', parcels, trackUrls: cfg.trackUrls || {} };
}

export async function onRequestGet({ request, env }) {
  const me = await verifyUser(request, env);
  if (!me) return fail(401, 'Log in again.');
  if (me.role === 'passenger') return json(await passenger(request, env, me));
  if (me.role !== 'client') return json({ role: me.role });
  const slip = new URL(request.url).searchParams.get('slip');
  if (!slip) return json(await client(request, env, me));
  if (!validId(slip)) return fail(400, 'Unknown parcel.');
  const [p, g, cfg] = await Promise.all([fsGet(request, env, 'groupsPrivate/' + slip), fsGet(request, env, 'groups/' + slip), fsGet(request, env, 'config/main')]);
  if (!p || !g || p.cid !== me.pid || !(p.slipOk || cfg?.slipAuto) || !validId(g.receipt?.p)) return fail(404, 'No slip to show.');
  const r = await fsGet(request, env, 'receipts/' + g.receipt.p);
  return r?.d && /^data:image\//.test(r.d) ? json({ d: r.d }) : fail(404, 'No slip to show.');
}

export async function onRequestPost({ request, env }) {
  const me = await verifyUser(request, env);
  if (!me) return fail(401, 'Log in again.');
  if (me.viewAs) return fail(403, 'You are only viewing. Nothing was changed.');
  const b = await body(request);
  if (me.role !== 'client' || b.action !== 'address' || !validId(b.id)) return fail(400, 'Not possible.');
  const [p, g] = await Promise.all([fsGet(request, env, 'groupsPrivate/' + b.id), fsGet(request, env, 'groups/' + b.id)]);
  if (!p || !g || p.cid !== me.pid) return fail(404, 'Unknown parcel.');
  if (!canEdit(g)) return fail(409, 'This parcel is already booked, so the address cannot be changed here. Please message us.');
  const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);
  const service = txt(b.service, 60).split('/').map((s) => s.trim()).filter((s) => SERVICES.includes(s)).join(' / ');
  await fsPatch(request, env, 'groupsPrivate/' + b.id, { name: txt(b.name, 80), phone: txt(b.phone, 30), phone2: txt(b.phone2, 80), address: txt(b.address, 400) });
  await fsPatch(request, env, 'groups/' + b.id, { city: txt(b.city, 60), service, note: txt(b.note, 200), cEdit: Date.now() });
  return json({ ok: true });
}
