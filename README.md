# Amanat

Offline-first web app for flight items, parcel groups and courier sending.
Installs to the Home Screen on iPhone and Android, and runs in any laptop browser.

- **Live:** https://amanat.fazool.skin (and the Cloudflare address `https://amanat.pages.dev`)
- **Stack:** Vite + vanilla JS PWA · Firebase Firestore (free Spark plan) with offline cache · Cloudflare Pages + Functions · Google Gemini (free tier)

## How it is deployed

Every push to `main` or `claude/vibrant-lamport-73cbm9` runs `.github/workflows/deploy.yml`, which:
1. builds the app,
2. creates the Cloudflare Pages project `amanat` and the KV namespace `amanat` if missing,
3. copies the GitHub secrets `FIREBASE_SERVICE_ACCOUNT` and `GEMINI_API_KEY` into Cloudflare's encrypted secrets,
4. deploys, and attaches the custom domain `amanat.fazool.skin`.

## Where each secret lives

| Secret | Where | Used for |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | GitHub repo secret | deploying |
| `FIREBASE_SERVICE_ACCOUNT` | GitHub repo secret → Cloudflare Pages secret | signing login tokens, signing people out |
| `GEMINI_API_KEY` | GitHub repo secret → Cloudflare Pages secret | the AI helper (never sent to browsers) |
| Login code hashes, roles, lockouts | Cloudflare KV `amanat` | `/api/login` |
| Setup phrase | only a PBKDF2 fingerprint in `server/setup-key.js` | first admin only; closed after setup |

The Firebase web config in `src/firebase-config.js` is public by design; `firestore.rules` protects the data.

## Domain (Namecheap)

`fazool.skin` DNS is at Namecheap. In Namecheap: **Domain List → fazool.skin → Manage → Advanced DNS → Add New Record**:
`CNAME Record` · Host `amanat` · Value `amanat.pages.dev` · TTL Automatic. Do not change the other records.

## Profiles and codes

- First run: the app shows **Set up Amanat**; enter your name, choose a code, and the setup phrase.
- After that: **Menu → Profiles** (admin) to add a profile, rename, change role or permissions, set a new code, or turn a profile off (signs it out everywhere).

## Free-tier limits to watch

- Firestore Spark: 1 GiB stored, 50,000 reads, 20,000 writes, 20,000 deletes per day. The Flights sheet shows storage used; archive old flights to free space.
- Gemini free tier: roughly 10–15 requests a minute and a few hundred to ~1,500 a day per model; the app falls back to the basic reader when limited.
- Cloudflare Pages/Functions free: 100,000 function requests a day.

## Testing locally

```
npx firebase-tools emulators:start --only firestore,auth --project demo-amanat
VITE_EMULATORS=1 npx vite build --outDir dist-emu
npx wrangler pages dev dist-emu --port 8788 --kv AMANAT_KV   # needs .dev.vars, see PROGRESS.md
node tests/e2e.mjs <folder with p1.jpg … p12.jpg and bad.heic>
```
