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

## Next
- Zahid: Firebase + Cloudflare setup (README).
- Paste Firebase web config into src/firebase-config.js, deploy preview, Zahid tests.
- Rules check via console as sorter (planned test), Gemini model check once key exists.
- Small parser glitch: "TCS / Leopards" on its own line leaves a stray "s" in the address.

## Decisions
- Gemini model: GEMINI_MODEL env, default `gemini-flash-latest`, falls back to `gemini-2.5-flash`. Free-tier limits could not be verified from here (Google docs blocked); roughly 10-15 requests/min, 250-1500/day.
- Firestore Spark limits: 1 GiB stored, 50k reads, 20k writes, 20k deletes per day.
