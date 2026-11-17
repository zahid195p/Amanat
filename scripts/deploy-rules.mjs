// Publishes firestore.rules to the Firebase project, using the service account in the
// FIREBASE_SERVICE_ACCOUNT environment variable. Run by the Deploy workflow.
import fs from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.private_key) { console.error('FIREBASE_SERVICE_ACCOUNT is not set'); process.exit(1); }
const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase' })
  .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(sa.client_email).setAudience('https://oauth2.googleapis.com/token')
  .setIssuedAt().setExpirationTime('10m').sign(await importPKCS8(sa.private_key, 'RS256'));
const tok = (await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) })).json()).access_token;
if (!tok) { console.error('Could not sign in with the service account'); process.exit(1); }
const api = async (method, path, body) => {
  const r = await fetch('https://firebaserules.googleapis.com/v1/projects/' + sa.project_id + path, { method, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(method, path, r.status, d.error?.message || ''); process.exit(1); }
  return d;
};
const content = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const rs = await api('POST', '/rulesets', { source: { files: [{ name: 'firestore.rules', content }] } });
const name = `projects/${sa.project_id}/releases/cloud.firestore`;
await api('PATCH', '/releases/cloud.firestore', { release: { name, rulesetName: rs.name } });
console.log('Rules published:', rs.name.split('/').pop());
// The server also reads the database with this account (passenger pages, timed release): check it can.
const fr = await fetch(`https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/apps/test/config/main`, { headers: { authorization: 'Bearer ' + tok } });
console.log('Server database access:', fr.status === 200 || fr.status === 404 ? 'ok' : 'FAILED ' + fr.status);
if (fr.status !== 200 && fr.status !== 404) process.exit(1);
