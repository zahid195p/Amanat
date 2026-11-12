# Amanat progress log

## Done (Phase 1 code)
- Vite + vanilla JS PWA (offline app shell, self-hosted fonts, icons, install hint, storage.persist).
- Firestore with persistent offline cache; writes never awaited in UI; sync pill + "waiting to upload" badges.
- Item numbers (B7): items saved with n:null and temp "#~N"; a transaction on flights/{fid}.nextN numbers them once synced.
- Login with codes: /api/login (PBKDF2 hashes in KV, 5 tries then 10-min lock), Firebase custom tokens (jose RS256).
- First-run setup screen (/api/setup) guarded by SETUP_KEY secret, so the admin code never goes through chat.
- Admin: profiles (add, rename, role, permissions, new code, turn off -> signs out everywhere).
- firestore.rules: role/permission based; deletes of items/photos/flights admin only.
- AI via /api/ai (Gemini, key server-side): one message, bulk chat, screenshot, item naming. Offline/rate-limit -> local parser + "AI check pending".
- Bugs B1-B17 addressed. Features 1-10,12,13,15-18,21-27,32,33,36-38.
- Local end-to-end test (tests/e2e.mjs) against emulators: 38/38 pass, incl. offline reload + sync between 2 devices.

## Live (2026-10-08)
- Firebase project `amanat-zahid` (Spark, Firestore asia-south1, rules deployed, Auth on).
- Cloudflare Pages project `amanat` → https://amanat-2oq.pages.dev, deployed by GitHub Actions on push; KV `amanat`; secrets copied from GitHub repo secrets.
- Domain is **fazol.skin** (Namecheap DNS), not fazool. Custom domain `amanat.fazol.skin` added in Pages; needs CNAME amanat → amanat-2oq.pages.dev at Namecheap.
- Gemini: `gemini-flash-latest` (= gemini-3.8-flash on 2026-10-08), fallback `gemini-flash-lite-latest`.
- Smoke test in deploy job: home 200, sw 200, /api/setup configured, /api/login answers.

## Next
- Zahid: Namecheap CNAME, first setup on the site, add Tayyab profile.
- Rotate the Cloudflare token (it was pasted in chat).
- Rules check via console as sorter (planned test), Gemini model check once key exists.

## Decisions
- Gemini model: GEMINI_MODEL env, default `gemini-flash-latest`, falls back to `gemini-2.5-flash`. Free-tier limits could not be verified from here (Google docs blocked); roughly 10-15 requests/min, 250-1500/day.
- Firestore Spark limits: 1 GiB stored, 50k reads, 20k writes, 20k deletes per day.

## Version 2 (started 2026-11-12)

Goal: owner (Tayyab), dispatchers, passengers and clients each get a private link + code and see
only their own part; contacts reach a device only after the owner releases them.

### Step 1: done, on the test site https://amanat-test.pages.dev
- Data lives under `apps/{space}/…`; `space` is `live` on amanat.fazol.skin / amanat-2oq.pages.dev and
  `test` everywhere else (`src/env.js`). KV keys are prefixed the same way. Live still runs version 1
  from Pages project `amanat`; the workflow now deploys only Pages project `amanat-test`.
- Login: `/#k=<key>` + code (`/api/login`), no people list. `/api/people` creates people, codes, links,
  turn off, view-as. First run: `/api/setup` (setup phrase) makes the developer.
- Roles: dev, owner (everything), dispatcher (flights they are on; no delete/regroup/flight edits),
  client and passenger (no database access; placeholder page until steps 2 and 3).
- Receiver details (name, phones, address, raw message) are in `groupsPrivate/{id}`; `rel` lists the
  dispatchers they are released to. `core.js` `upd/put/del('groups/…')` split the two documents.
- Dispatcher queries use one `array-contains` clause (`dids` / `rel`) so no composite index is needed.
- View as: second Firebase app signed in with a `viewAs` token; rules make it read-only.
- Rules are published by `scripts/deploy-rules.mjs` in the workflow (v1 block unchanged).
- `tests/e2e.mjs`: 64 checks, including direct database attempts by a dispatcher, a dispatcher not
  on the flight, a client login and a view-as login.

### Step 2: done, on the test site
- Flight tab: landing time (always Pakistan time, `landAt`), passengers (`trips` = bag counts, open to the
  flight's dispatchers; `tripsPrivate` = who the passenger is, locked like receivers).
- Timed release: `auto` minutes before landing -> `dueAt`. The owner's app opens due contacts itself; a
  dispatcher's app calls `/api/tick`, and the server checks the time and opens it. Default in Menu, Settings.
- Passenger page: `/api/portal` (server reads Firestore with the service account; passengers have no
  database access). Shows flight, bag counts, and the dispatchers' names and phones once released.
- Receive check: `items.recv` = ok / missing / damaged, set from the selection bar or the viewer.
- Not done: which items are in which passenger's bags (items belong to the flight, not to a passenger).
- `tests/e2e.mjs`: 81 checks.

### Step 3: done, on the test site
- A parcel is linked to a client with `cid` (group editor; picked automatically when the phone matches).
  `cid`, `slipOk`, `pickOk` live in `groupsPrivate`.
- Client page from `/api/portal`: own parcels across flights (items, photos, status, running totals),
  slip and tracking once `slipOk` (or the `slipAuto` setting), dispatcher contact for Pickup parcels once
  `pickOk`. `?slip=<id>` returns the full slip. POST `address` lets the client correct details until the
  parcel is booked; the owner sees a "changed the delivery details" flag (`cEdit`).
- The server batches reads (`fsMany`, `fsWhereIn`) to stay under the per-request limit.
- `tests/e2e.mjs`: 97 checks.

### Next
- Step 4: slips with AI matching, expenses.
- Switch live to version 2: migrate root collections into `apps/live`, deploy to project `amanat`.
