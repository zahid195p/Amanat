// End-to-end test against local emulators. See README "Testing locally".
// Needs: firebase emulators (firestore+auth), `wrangler pages dev dist-emu` on :8788.
// Run: node tests/e2e.mjs <dir with test photos p1.jpg..p12.jpg and bad.heic>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');

const IMG = process.argv[2];
const URL = 'http://localhost:8788/';
const shots = process.env.SHOTS || IMG;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(page, fn, arg, ms = 15000) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; }
}
const text = (page) => page.evaluate(() => document.body.innerText);

const browser = await chromium.launch();
const errs = [];
async function open(w, h, mobile) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: !!mobile, hasTouch: !!mobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  return [ctx, page];
}
// Add a person from the developer/owner screen and return their link key and code.
async function addPerson(page, name, role, phone = '') {
  if (!(await page.$('#pp-name'))) { await page.click('[data-act=menu]'); await page.click('[data-act=people]'); }
  await page.fill('#pp-name', name); await page.selectOption('#pp-role', role); await page.fill('#pp-phone', phone);
  await page.click('#pp-add');
  await page.waitForSelector('#cp-text[data-key]');
  const r = await page.evaluate(() => { const t = document.querySelector('#cp-text'); return { key: t.dataset.key, pin: t.dataset.pin, text: t.value }; });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#cp-text'));
  return r;
}
async function login(page, key, pin) {
  await page.goto(URL + '#k=' + key);
  await page.waitForSelector('#pin-in');
  await page.fill('#pin-in', pin); await page.click('[data-act=login]');
}

/* ---------- 1. setup: the developer ---------- */
const [A, a] = await open(1280, 900);
await a.goto(URL);
ok(await until(a, () => !!document.querySelector('#su-name')), 'setup screen shows on a fresh install');
ok(!/Tayyab|Who is using/.test(await text(a)), 'no list of people on the first screen');
await a.fill('#su-name', 'Zahid');
await a.fill('#su-code', 'dev-code-1'); await a.fill('#su-code2', 'dev-code-1'); await a.fill('#su-key', 'wrong');
await a.click('[data-act=setup]');
ok(await until(a, () => /setup phrase/i.test(document.querySelector('#login-err')?.textContent || '')), 'wrong setup phrase refused');
await a.fill('#su-key', 'test-setup-key'); await a.click('[data-act=setup]');
ok(await until(a, () => /Your private link/.test(document.body.innerText)), 'developer made; private link shown');
const devLink = await a.inputValue('#cp-text');
await a.keyboard.press('Escape');
ok(await until(a, () => /TEST/.test(document.querySelector('#hdr').innerText)), 'test site is marked TEST');

/* ---------- 2. people: owner, two dispatchers, a client ---------- */
const owner = await addPerson(a, 'Tayyab bhai', 'owner');
ok(/#k=/.test(owner.text) && /Code: \d{6}/.test(owner.text), 'invite has a private link and a 6-digit code');
const d1 = await addPerson(a, 'Bilal', 'dispatcher', '0333 5556667');
const d2 = await addPerson(a, 'Other City', 'dispatcher');
const cl = await addPerson(a, 'Abdullah', 'client');
const pa = await addPerson(a, 'Hamza', 'passenger', '0301 9998887');
await a.keyboard.press('Escape'); await a.keyboard.press('Escape');

/* ---------- 3. owner logs in with link + code and prepares a flight ---------- */
const [O, o] = await open(1280, 900);
await o.goto(URL + '#k=' + owner.key);
ok(await until(o, () => /Hello Tayyab bhai/.test(document.body.innerText)), 'link greets the owner by name');
await o.fill('#pin-in', '000000'); await o.click('[data-act=login]');
ok(await until(o, () => /not right/.test(document.querySelector('#login-err')?.textContent || '')), 'wrong code refused');
await o.fill('#pin-in', owner.pin); await o.click('[data-act=login]');
ok(await until(o, () => /No flight yet/.test(document.body.innerText)), 'owner logged in');
ok(await o.evaluate(() => !location.hash), 'the key is removed from the address bar');
await o.click('[data-act=flights]'); await o.fill('#nf-label', 'PK 853'); await o.click('[data-act=createFlight]');
ok(await until(o, () => /PK 853/.test(document.querySelector('#hdr').innerText)), 'flight created');
ok(await until(o, () => /No passengers yet/.test(document.body.innerText)), 'a new flight opens on the Flight tab');
await o.click('[data-act=tab][data-v=photos]');
await o.setInputFiles('input[data-up][multiple]', [1, 2, 3, 4].map((n) => `${IMG}/p${n}.jpg`));
ok(await until(o, () => [...document.querySelectorAll('.card .num')].map((x) => x.textContent).sort().join() === '#1,#2,#3,#4', null, 25000), '4 items numbered #1-#4');
await o.setInputFiles('input[data-up][multiple]', [`${IMG}/bad.heic`]);
ok(await until(o, () => /bad\.heic/.test(document.body.innerText)), 'HEIC failure names the file');
await o.click('.card:nth-child(1) .ph'); await o.click('.card:nth-child(2) .ph', { modifiers: ['Shift'] });
ok(await until(o, () => document.querySelectorAll('.card.sel').length === 2), 'shift-click range select');
await o.click('#selbar [data-act=selToGroup]'); await o.click('[data-pg=__new]');
await o.fill('#gs-raw', 'Qasim Imtiaz\n03161749964\nWasu Road Near Chungi Number 8 Mandi Bahauddin\nTCS / Leopards');
await o.click('#gs-read');
ok(await until(o, () => document.querySelector('#gs-phone')?.value === '03161749964' && document.querySelector('#gs-city')?.value === 'Mandi Bahauddin', null, 1500), 'address fills in instantly');
await o.click('#gs-save');
ok(await until(o, () => document.querySelector('.gpanel .pno')?.textContent === 'P1' && /Qasim Imtiaz/.test(document.querySelector('.gpanel').innerText)), 'parcel P1 made for Qasim');
ok(await until(o, () => /Hidden from dispatcher/.test(document.querySelector('.gpanel').innerText)), 'new parcel starts hidden from the dispatcher');
// second parcel
await o.click('[data-act=tab][data-v=groups]'); await o.click('[data-act=newGroupSel]');
await o.fill('#gs-raw', 'Sana Bibi\n0345 1234567\nHouse 5 Gulberg III Lahore\nDaewoo'); await o.click('#gs-read'); await wait(300); await o.click('#gs-save');
ok(await until(o, () => document.querySelectorAll('.gcard .pno').length === 2 && ![...document.querySelectorAll('.gcard .pno')].some((x) => x.textContent.includes('~'))), 'second parcel numbered P2');
// put Bilal on the flight
await o.click('[data-act=flights]');
await o.click('[data-disp] >> text=Bilal');
ok(await until(o, () => /Bilal can now see/.test(document.querySelector('#toasts').innerText)), 'dispatcher Bilal added to the flight');
await o.keyboard.press('Escape');

/* ---------- 4. dispatcher: sees the work, not the receivers ---------- */
const [B, b] = await open(375, 760, true);
await b.goto(URL);
ok(await until(b, () => /Open your private link/.test(document.body.innerText)) && !/Tayyab|Bilal|Zahid|Abdullah/.test(await text(b)), 'without a link: no names, only "open your private link"');
await login(b, d1.key, d1.pin);
ok(await until(b, () => document.querySelectorAll('.card').length === 4, null, 20000), 'dispatcher sees the 4 items of his flight');
await b.click('[data-act=tab][data-v=service]');
ok(await until(b, () => document.querySelectorAll('.parcel').length === 2), 'dispatcher sees both parcels');
let bt = await text(b);
ok(/P1/.test(bt) && /TCS/.test(bt) && /Mandi Bahauddin/.test(bt), 'dispatcher sees parcel number, service and city');
ok(!/Qasim|0316|Wasu Road|Sana|0345|Gulberg/.test(bt), 'receiver name, phone and address are NOT on the dispatcher screen');
ok(/not released yet/.test(bt), 'dispatcher is told the details are not released yet');
const ids = await b.evaluate(() => window.__t.ids());
const direct = await b.evaluate(async (g) => ({
  priv: await window.__t.get('groupsPrivate/' + g),
  privList: await window.__t.list('groupsPrivate'),
  people: await window.__t.list('people'),
  book: await window.__t.list('book'),
  delItem: await window.__t.del('items/' + window.__t.ids().items[0]),
  regroup: await window.__t.upd('items/' + window.__t.ids().items[0], { groupId: 'x' }),
  flight: await window.__t.upd('flights/' + window.__t.ids().fid, { label: 'hacked' }),
  svc: await window.__t.upd('groups/' + g, { service: 'x' }),
}), ids.groups[0]);
ok(direct.priv === 'permission-denied' && direct.privList === 'permission-denied', 'going around the app: receiver details are refused by the database (' + direct.priv + ')');
ok(direct.people === 'permission-denied' && direct.book === 'permission-denied', 'going around the app: people list and address book refused');
ok(direct.delItem === 'permission-denied' && direct.regroup === 'permission-denied', 'going around the app: dispatcher cannot delete or regroup items');
ok(direct.flight === 'permission-denied' && direct.svc === 'permission-denied', 'going around the app: dispatcher cannot change the flight or a parcel\'s service');
ok(await b.evaluate(() => !document.querySelector('.del') && document.documentElement.scrollWidth <= 375), 'no delete buttons; fits a 375px phone');

/* ---------- 5. a dispatcher who is not on the flight sees nothing ---------- */
const [X, x] = await open(375, 760, true);
await login(x, d2.key, d2.pin);
ok(await until(x, () => /not on any flight/.test(document.body.innerText)), 'other dispatcher: "not on any flight"');
const xd = await x.evaluate(async (i) => [await window.__t.get('flights/' + i.fid), await window.__t.get('items/' + i.items[0]), await window.__t.get('groups/' + i.groups[0])], ids);
ok(xd.every((r) => r === 'permission-denied'), 'other dispatcher: flight, items and parcels refused by the database');
await X.close();

/* ---------- 6. release one parcel ---------- */
await o.click('[data-act=tab][data-v=service]');
await o.click('[data-key="sec-TCS"] [data-act=release]');
ok(await until(b, () => /Qasim Imtiaz/.test(document.body.innerText) && /0316 1749964/.test(document.body.innerText), null, 15000), 'after release: dispatcher sees Qasim and his phone');
bt = await text(b);
ok(!/Sana|0345|Gulberg/.test(bt), 'the parcel that was not released stays hidden');
ok(await b.evaluate(() => !!document.querySelector('a[href^="https://wa.me/923161749964"]') && !!document.querySelector('a[href^="tel:03161749964"]')), 'call and WhatsApp buttons appear for the released receiver');
// dispatcher works: mark sent, with undo, and tracking
await b.click('.parcel .pk');
ok(await until(o, () => !!document.querySelector('[data-act=openSent]') || /1 sent/.test(document.body.innerText), null, 15000), 'dispatcher marks P1 sent; owner sees it');
await b.click('#toasts .undo');
ok(await until(o, () => document.querySelectorAll('.parcel:not(.done)').length === 2, null, 15000), 'undo mark sent syncs back');
// hide again
await o.click('[data-key="sec-TCS"] [data-act=release]');
ok(await until(b, () => !/Qasim/.test(document.body.innerText), null, 15000), 'owner hides it again: gone from the dispatcher screen');
await o.click('[data-act=releaseSvc][data-v=Daewoo]');
ok(await until(b, () => /Sana Bibi/.test(document.body.innerText), null, 15000), '"Show all Daewoo to dispatcher" releases that courier\'s parcels');

/* ---------- 6b. flight day: passenger, bags, timed release ---------- */
await o.evaluate(() => { window.__noTick = true; }); // so the server timer (the dispatcher's path) is what opens it
await o.click('[data-act=tab][data-v=flight]');
await o.selectOption('#fl-pass', { label: 'Hamza' }); await o.click('[data-act=addTrip]');
ok(await until(o, () => /Hamza/.test(document.querySelector('.trip')?.innerText || '')), 'owner adds passenger Hamza to the flight');
await o.fill('.trip [data-f=checked]', '2'); await o.press('.trip [data-f=checked]', 'Tab');
await o.fill('.trip [data-f=hand]', '1'); await o.press('.trip [data-f=hand]', 'Tab');
await b.click('[data-act=tab][data-v=flight]');
ok(await until(b, () => /Passenger 1/.test(document.body.innerText) && /2 checked bags, 1 hand carry/.test(document.body.innerText), null, 15000), 'dispatcher sees 1 passenger, 2 checked bags, 1 hand carry');
bt = await text(b);
ok(!/Hamza|0301/.test(bt) && /not released yet/i.test(bt), 'dispatcher does not see who the passenger is');
const tripId = await o.evaluate(() => document.querySelector('.trip [data-f=checked]').dataset.trip);
const td = await b.evaluate(async (t) => [await window.__t.get('tripsPrivate/' + t), await window.__t.list('tripsPrivate'), await window.__t.upd('trips/' + t, { checked: 9 })], tripId);
ok(td.every((r) => r === 'permission-denied'), 'going around the app: passenger identity refused, bag counts cannot be changed by the dispatcher');
// the passenger's own page
const [P, p] = await open(375, 760, true);
await login(p, pa.key, pa.pin);
ok(await until(p, () => /Hello Hamza/.test(document.body.innerText) && /PK 853/.test(document.body.innerText) && /checked bags/.test(document.body.innerText), null, 15000), 'passenger sees his flight and bag count');
let pt = await text(p);
ok(!/Bilal|0333|Qasim|Sana|Tayyab/.test(pt) && /when it is released|Pakistan time/.test(pt), 'passenger does not see the dispatcher, or any client');
const pd = await p.evaluate(async (i) => [await window.__t.get('flights/' + i.fid), await window.__t.list('items'), await window.__t.list('people'), await window.__t.list('trips')], ids);
ok(pd.every((r) => r === 'permission-denied'), 'a passenger login can read nothing from the database directly');
// timer: landing in 5 minutes, release 10 minutes before = already due
const pk = new Date(Date.now() + 5 * 60000 + 5 * 3600000).toISOString();
await o.fill('#fl-date', pk.slice(0, 10)); await o.fill('#fl-time', pk.slice(11, 16)); await o.click('[data-act=saveLanding]');
ok(await until(b, () => /Hamza/.test(document.body.innerText) && /0301 9998887/.test(document.body.innerText), null, 20000), 'timer: 10 minutes before landing the dispatcher sees the passenger (opened by the server)');
ok(await until(o, () => /can see each other/.test(document.querySelector('.trip')?.innerText || ''), null, 15000), 'owner sees that the contact is now open');
await p.click('[data-act=portalReload]');
ok(await until(p, () => /Bilal/.test(document.body.innerText) && /0333 5556667/.test(document.body.innerText) && !!document.querySelector('a[href^="https://wa.me/923335556667"]'), null, 15000), 'passenger now sees the dispatcher with call and WhatsApp buttons');
// collecting bags
await b.click('[data-act=gotBag][data-k=checked][data-d="1"]');
ok(await until(o, () => /collected 1 of 2/.test(document.querySelector('.trip')?.innerText || ''), null, 15000), 'dispatcher ticks a collected bag; owner sees 1 of 2');
// hide again
await o.click('[data-act=tripRelease][data-on="0"]');
ok(await until(b, () => !/Hamza/.test(document.body.innerText) && /Passenger 1/.test(document.body.innerText), null, 15000), 'owner hides it again: dispatcher loses the passenger contact');
await p.click('[data-act=portalReload]');
ok(await until(p, () => !/Bilal/.test(document.body.innerText) && /when it is released/.test(document.body.innerText), null, 15000), 'and the passenger loses the dispatcher contact');
await o.click('[data-act=tripRelease][data-on="1"]');
ok(await until(b, () => /Hamza/.test(document.body.innerText), null, 15000), '"Release now" by hand works too');
await o.screenshot({ path: `${shots}/o-flight.png` }); await b.screenshot({ path: `${shots}/b-flight.png` });
await P.close();
// receive check
await b.click('[data-act=tab][data-v=photos]'); await b.click('[data-act=show][data-v=all]');
await b.click('.card:nth-child(1) .ph'); await b.click('#selbar [data-act=selRecv][data-v=ok]');
await b.click('.card:nth-child(2) .ph'); await b.click('#selbar [data-act=selRecv][data-v=missing]');
await o.click('[data-act=tab][data-v=photos]'); await o.click('[data-act=show][data-v=all]');
ok(await until(o, () => /Received/.test(document.querySelector('.card:nth-child(1) .recv')?.textContent || '') && /Missing/.test(document.querySelector('.card:nth-child(2) .recv')?.textContent || '') && /2 of 4 checked, 1 missing/.test(document.body.innerText), null, 15000), 'receive check: dispatcher marks received and missing; owner sees it');
await o.click('[data-act=tab][data-v=service]'); await b.click('[data-act=tab][data-v=service]');

/* ---------- 7. view as ---------- */
await a.reload();
ok(await until(a, () => /PK 853/.test(document.querySelector('#hdr').innerText), null, 15000), 'developer sees the flight the owner made');
await a.click('[data-act=tab][data-v=service]');
ok(await until(a, () => /Qasim Imtiaz/.test(document.body.innerText) && /Sana Bibi/.test(document.body.innerText)), 'developer sees every receiver');
await a.click('[data-act=menu]'); await a.click('[data-act=people]');
await a.click('.prow:has-text("Bilal") [data-pp]'); await a.click('#mp-view');
ok(await until(a, () => /Viewing as Bilal/.test(document.body.innerText), null, 15000), 'view-as banner shows');
await a.click('[data-act=tab][data-v=service]').catch(() => {});
ok(await until(a, () => /Sana Bibi/.test(document.body.innerText) && document.querySelectorAll('.parcel').length === 2, null, 15000), 'view-as shows what Bilal sees (released parcel)');
ok(!/Qasim|0316/.test(await text(a)), 'view-as hides what Bilal cannot see');
const vw = await a.evaluate(async (i) => [await window.__t.get('groupsPrivate/' + i.groups[0]), await window.__t.upd('groups/' + i.groups[0], { done: true })], ids);
ok(vw[0] === 'permission-denied' && vw[1] === 'permission-denied', 'view-as is read-only and bound by the same rules');
await a.click('[data-act=exitView]');
ok(await until(a, () => !/Viewing as/.test(document.body.innerText) && /Qasim Imtiaz/.test(document.body.innerText) || (document.querySelector('[data-act=tab][data-v=service]')?.click(), false), null, 15000), 'stop viewing: back to the full developer view');
// view as a client: placeholder page, nothing from the database
await a.click('[data-act=menu]'); await a.click('[data-act=people]');
await a.click('.prow:has-text("Abdullah") [data-pp]'); await a.click('#mp-view');
ok(await until(a, () => /Viewing as Abdullah/.test(document.body.innerText) && /being prepared/.test(document.body.innerText), null, 15000), 'client view: placeholder page');
const cv = await a.evaluate(async (i) => [await window.__t.get('flights/' + i.fid), await window.__t.list('items'), await window.__t.get('groupsPrivate/' + i.groups[0])], ids);
ok(cv.every((r) => r === 'permission-denied'), 'a client login can read nothing from the database');
await a.click('[data-act=exitView]');
await a.click('[data-act=menu]'); await a.click('[data-act=people]');
await a.click('.prow:has-text("Hamza") [data-pp]'); await a.click('#mp-view');
ok(await until(a, () => /Viewing as Hamza/.test(document.body.innerText) && /PK 853/.test(document.body.innerText) && /Bilal/.test(document.body.innerText), null, 15000), 'view as the passenger shows his page');
await a.click('[data-act=exitView]');

/* ---------- 8. offline (owner): nothing is lost ---------- */
await o.click('[data-act=tab][data-v=photos]'); await o.click('[data-act=show][data-v=all]');
await O.setOffline(true); await o.evaluate(() => window.dispatchEvent(new Event('offline')));
ok(await until(o, () => /Offline/.test(document.querySelector('#hdr').innerText)), 'pill shows Offline');
await o.setInputFiles('input[data-up][multiple]', [5, 6].map((n) => `${IMG}/p${n}.jpg`));
ok(await until(o, () => [...document.querySelectorAll('.card .num')].some((x) => x.textContent.startsWith('#~'))), 'offline items get temporary numbers');
await o.click('[data-act=tab][data-v=groups]'); await o.click('[data-act=newGroupSel]');
await o.fill('#gs-raw', 'Ali Khan 0300 1234567 House 12 Street 4 Lahore TCS'); await o.click('#gs-read'); await wait(300); await o.click('#gs-save');
ok(await until(o, () => /Ali Khan/.test(document.body.innerText) || (document.querySelector('[data-act=gf][data-v=all]')?.click(), false)), 'parcel made offline');
await o.reload();
ok(await until(o, () => /Ali Khan/.test(document.body.innerText), null, 20000), 'after an offline reload the offline parcel is still there');
await o.screenshot({ path: `${shots}/o-offline.png` });
await O.setOffline(false); await o.evaluate(() => window.dispatchEvent(new Event('online')));
ok(await until(o, () => /Online/.test(document.querySelector('#hdr').innerText), null, 40000), 'back online: synced');
ok(await until(o, () => { const p = [...document.querySelectorAll('.gcard .pno')].map((x) => x.textContent); return p.length === 3 && !p.some((t) => t.includes('~')) && new Set(p).size === 3; }, null, 25000), 'offline parcel got a real, unique number');
await b.click('[data-act=tab][data-v=photos]'); await b.click('[data-act=show][data-v=all]');
ok(await until(b, () => document.querySelectorAll('.card').length === 6, null, 25000), 'offline photos reach the dispatcher');
const nums = await b.evaluate(() => [...document.querySelectorAll('.card .num')].map((x) => x.textContent));
ok(new Set(nums).size === 6 && !nums.some((n) => n.includes('~')), 'no duplicate item numbers: ' + nums.join(' '));
// dispatcher adds a photo himself
await b.setInputFiles('input[data-up][multiple]', [`${IMG}/p7.jpg`]);
ok(await until(o, () => (document.querySelector('[data-act=tab][data-v=photos]')?.click(), document.querySelector('[data-act=show][data-v=all]')?.click(), document.querySelectorAll('.card').length === 7), null, 25000), 'a photo added by the dispatcher reaches the owner');

/* ---------- 9. counter + back gesture ---------- */
await b.click('[data-act=tab][data-v=service]'); await b.click('[data-act=counter]');
ok(await until(b, () => /^P\d+$/.test(document.querySelector('.counter .c-pno')?.textContent || '')), 'counter opens with big parcel number');
await b.goBack();
ok(await until(b, () => !document.querySelector('.counter')) && (await b.evaluate(() => location.href.startsWith('http://localhost:8788'))), 'back closes the counter and stays in the app');

/* ---------- 10. turning a person off ---------- */
await a.click('[data-act=menu]'); await a.click('[data-act=people]');
await a.click('.prow:has-text("Bilal") [data-pp]'); await a.click('#mp-off'); await a.click('[data-ch="1"]');
ok(await until(a, () => /Bilal is turned off/.test(document.querySelector('#toasts').innerText)), 'Bilal turned off');
const [Y, y] = await open(375, 760, true);
await y.goto(URL + '#k=' + d1.key);
ok(await until(y, () => /turned off/.test(document.body.innerText)), 'a turned-off link cannot log in');
await y.goto(URL + '#k=ThisKeyDoesNotExist12345');
ok(await until(y, () => /not valid/.test(document.body.innerText)), 'an unknown link is refused');
// lockout
await y.goto(URL + '#k=' + cl.key); await y.waitForSelector('#pin-in');
for (let k = 0; k < 5; k++) { await y.fill('#pin-in', '11111' + k); await y.click('[data-act=login]'); await wait(350); }
ok(await until(y, () => /Locked for 10 minutes|Too many wrong codes/.test(document.querySelector('#login-err')?.textContent || '')), '5 wrong codes lock the link for 10 minutes');
await y.fill('#pin-in', cl.pin); await y.click('[data-act=login]');
ok(await until(y, () => /Too many wrong codes/.test(document.querySelector('#login-err')?.textContent || '')), 'even the right code is refused while locked');

await o.screenshot({ path: `${shots}/o-desktop.png` });
await b.screenshot({ path: `${shots}/b-mobile.png` });
console.log(errs.length ? 'Page errors:\n' + [...new Set(errs)].join('\n') : 'No page errors');
console.log('developer link looked like: ' + devLink.replace(/k=.*/, 'k=…'));
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
