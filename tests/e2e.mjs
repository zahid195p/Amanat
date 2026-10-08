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

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
const A = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const a = await A.newPage();
const errs = [];
a.on('pageerror', (e) => errs.push('A: ' + e.message));
a.on('console', (m) => { if (m.type() === 'error') errs.push('A console: ' + m.text()); });

// 1. Setup
await a.goto(URL);
ok(await until(a, () => !!document.querySelector('#su-name')), 'setup screen shows');
await a.fill('#su-name', 'Zahid');
await a.fill('#su-code', '4321zz'); await a.fill('#su-code2', '4321zz'); await a.fill('#su-key', 'wrong');
await a.click('[data-act=setup]');
ok(await until(a, () => /setup key/i.test(document.querySelector('#login-err')?.textContent || '')), 'wrong setup key refused');
await a.fill('#su-key', 'test-setup-key'); await a.fill('#su-code', '4321zz'); await a.fill('#su-code2', '4321zz');
await a.click('[data-act=setup]');
ok(await until(a, () => /No flight yet/.test(document.body.innerText)), 'admin logged in after setup');

// 2. Flight
await a.click('[data-act=flights]');
await a.fill('#nf-label', 'PK 853');
await a.click('[data-act=createFlight]');
ok(await until(a, () => /PK 853/.test(document.querySelector('#hdr').innerText)), 'flight created');

// 3. Upload photos
await a.setInputFiles('input[data-up][multiple]', [1, 2, 3, 4].map((n) => `${IMG}/p${n}.jpg`));
ok(await until(a, () => document.querySelectorAll('.card').length === 4), '4 photo cards appear');
ok(await until(a, () => [...document.querySelectorAll('.card .num')].map((x) => x.textContent).sort().join() === '#1,#2,#3,#4', null, 20000), 'items numbered #1-#4');
await a.setInputFiles('input[data-up][multiple]', [`${IMG}/bad.heic`]);
ok(await until(a, () => /bad\.heic/.test(document.body.innerText)), 'HEIC failure names the file (B10)');

// 4. Name item, make group by paste
await a.fill('.card:nth-child(1) .nm', 'black shoes');
await wait(800);
await a.click('.card:nth-child(1) .ph'); await a.click('.card:nth-child(2) .ph', { modifiers: ['Shift'] });
ok(await a.evaluate(() => document.querySelectorAll('.card.sel').length === 2), 'shift-click range select');
await a.click('#selbar [data-act=selToGroup]');
await a.click('[data-pg=__new]');
await a.fill('#gs-raw', 'Qasim Imtiaz\n03161749964\nWasu Road Near Chungi Number 8 Mandi Bahauddin\nTCS / Leopards');
await a.click('#gs-read');
ok(await until(a, () => document.querySelector('#gs-phone')?.value === '03161749964' && document.querySelector('#gs-city')?.value === 'Mandi Bahauddin'), 'basic reader fills the fields');
await a.click('#gs-save');
ok(await until(a, () => /Qasim Imtiaz/.test(document.querySelector('.gpanel')?.innerText || '')), 'group made with 2 items');
await a.click('[data-act=tab][data-v=service]');
ok(await until(a, () => { const s = document.querySelector('[data-key="sec-TCS"]'); return s && /Qasim/.test(s.innerText) && /or Leopards/.test(s.innerText); }), 'combined service listed under TCS with tag (B5)');
ok(await a.evaluate(() => !!document.querySelector('a[href^="https://wa.me/923161749964"]') && !!document.querySelector('a[href^="tel:03161749964"]')), 'tel and WhatsApp links');

// 5. Duplicate phone warning
await a.click('[data-act=tab][data-v=groups]');
await a.click('[data-act=newGroupSel]');
await a.fill('#gs-phone', '0316 1749964'); await a.dispatchEvent('#gs-phone', 'change');
ok(await until(a, () => /already has a group with this phone/.test(document.querySelector('#gs-dup')?.innerText || '')), 'duplicate phone warning');
ok(await until(a, () => document.querySelector('#gs-name')?.value === 'Qasim Imtiaz'), 'address book fills name from phone');
await a.keyboard.press('Escape');

// 6. Mark sent with undo
await a.click('[data-act=tab][data-v=service]');
await a.click('.parcel .pk');
ok(await until(a, () => /marked sent/.test(document.querySelector('#toasts').innerText)), 'mark sent toast');
await a.click('#toasts .undo');
ok(await until(a, () => !document.querySelector('.parcel.done') && document.querySelectorAll('.parcel').length === 1), 'undo mark sent (B9)');

// 7. Add sorter profile
await a.click('[data-act=menu]');
await a.click('[data-act=addProfile]');
await a.fill('#pf-name', 'Tayyab bhai'); await a.fill('#pf-code', '5555');
await a.click('#pf-save');
ok(await until(a, () => /Profile added/.test(document.querySelector('#toasts').innerText)), 'sorter profile added');
await a.keyboard.press('Escape');

// 8. Second device (iPhone size) logs in as sorter
const B = await browser.newContext({ viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true });
const b = await B.newPage();
b.on('pageerror', (e) => errs.push('B: ' + e.message));
await b.goto(URL);
ok(await until(b, () => /Tayyab bhai/.test(document.body.innerText)), 'login card for sorter');
await b.click('text=Tayyab bhai');
await b.fill('#pin-in', '1111'); await b.click('[data-act=login]');
ok(await until(b, () => /not right/.test(document.querySelector('#login-err')?.textContent || '')), 'wrong code refused');
await b.fill('#pin-in', '5555'); await b.click('[data-act=login]');
ok(await until(b, () => document.querySelectorAll('.card').length >= 2 || /Every item|not in any group/.test(document.body.innerText)), 'sorter sees the flight');
ok(await b.evaluate(() => !document.querySelector('.del') && !document.querySelector('[data-up]')), 'sorter has no delete or upload (B2)');
ok(await b.evaluate(() => document.documentElement.scrollWidth <= 375), 'no horizontal scroll at 375px');

// 9. Live sync A -> B
await a.click('[data-act=tab][data-v=photos]');
await a.click('[data-act=show][data-v=all]');
await a.fill('.card:nth-child(3) .nm', 'red bag');
await b.click('[data-act=show][data-v=all]');
ok(await until(b, () => /red bag/.test(document.body.innerText), null, 10000), 'name syncs to the other device');

// 10. Offline on A
await A.setOffline(true);
await a.evaluate(() => window.dispatchEvent(new Event('offline')));
ok(await until(a, () => /Offline/.test(document.querySelector('#hdr').innerText)), 'pill shows Offline');
await a.setInputFiles('input[data-up][multiple]', [5, 6].map((n) => `${IMG}/p${n}.jpg`));
ok(await until(a, () => [...document.querySelectorAll('.card .num')].some((x) => x.textContent.startsWith('#~'))), 'offline items get temporary numbers #~');
ok(await until(a, () => document.querySelectorAll('.card .pend').length >= 2), 'waiting-to-upload badges shown');
await a.fill('.card:nth-child(4) .nm', 'offline name');
await wait(900);
await a.click('[data-act=tab][data-v=groups]');
await a.click('[data-act=newGroupSel]');
await a.fill('#gs-raw', 'Ali Khan 0300 1234567 House 12 Street 4 Lahore TCS');
await a.click('#gs-read');
await wait(300);
await a.click('#gs-save');
ok(await until(a, () => /Ali Khan/.test(document.body.innerText)), 'group made offline');
await a.reload();
ok(await until(a, () => /Ali Khan/.test(document.body.innerText), null, 20000), 'after offline reload, offline group is still there');
await a.click('[data-act=tab][data-v=photos]').catch(() => {});
ok(await until(a, () => document.querySelectorAll('.card').length >= 6, null, 15000), 'after offline reload, offline photos still there');
await a.screenshot({ path: `${shots}/a-offline.png` });
await A.setOffline(false);
await a.evaluate(() => window.dispatchEvent(new Event('online')));
ok(await until(a, () => /Online/.test(document.querySelector('#hdr').innerText) && !document.querySelector('.card .pend'), null, 40000), 'back online: everything synced, badges clear');
ok(await until(a, () => ![...document.querySelectorAll('.card .num')].some((x) => x.textContent.startsWith('#~')), null, 20000), 'temporary numbers replaced by real ones');
ok(await until(b, () => /Ali Khan/.test(document.body.innerText) || (document.querySelector('[data-act=tab][data-v=groups]')?.click(), false), null, 20000), 'offline work reaches the other device');
const nums = await a.evaluate(() => [...document.querySelectorAll('.card .num')].map((x) => x.textContent));
ok(new Set(nums).size === nums.length, 'no duplicate item numbers: ' + nums.join(' '));

// 11. Counter + back gesture
await b.click('[data-act=tab][data-v=service]');
await b.click('[data-act=counter]');
ok(await until(b, () => !!document.querySelector('.counter')), 'counter opens');
await b.goBack();
ok(await until(b, () => !document.querySelector('.counter')), 'back closes the counter (B11)');
ok(await b.evaluate(() => location.href.startsWith('http://localhost:8788')), 'still in the app after back');

await a.screenshot({ path: `${shots}/a-desktop.png`, fullPage: false });
await b.screenshot({ path: `${shots}/b-mobile.png`, fullPage: false });
console.log(errs.length ? 'Page errors:\n' + errs.join('\n') : 'No page errors');
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
