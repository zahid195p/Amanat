// POST /api/ai  (Firebase ID token required)
//   {task:'parse', text}            -> {result:{name,phone,...}}
//   {task:'bulk',  text}            -> {result:[{name,phone,...,raw}]}
//   {task:'image', image:dataURL}   -> {result:[{name,phone,...}]}
//   {task:'name',  images:[{id,image}]} -> {result:[{id,name}]}
// The Gemini key stays on the server. Model: GEMINI_MODEL, else gemini-flash-latest.
import { json, fail, body, verifyUser } from '../../server/lib.js';
import { PARSE_PROMPT, SERVICES } from '../../src/parse.js';

// Fast model first (answers in ~0.5-2 s); the bigger flash model is often overloaded and slow.
const FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
const TIMEOUT_MS = { parse: 12000, bulk: 25000, image: 20000, name: 20000 };
const ADDR = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' }, phone: { type: 'STRING' }, phone2: { type: 'STRING' }, address: { type: 'STRING' },
    city: { type: 'STRING' }, service: { type: 'STRING' }, note: { type: 'STRING' },
  },
  required: ['name', 'phone', 'phone2', 'address', 'city', 'service', 'note'],
};
const ADDR_RAW = { ...ADDR, properties: { ...ADDR.properties, raw: { type: 'STRING' } }, required: [...ADDR.required, 'raw'] };

const BULK_PROMPT = `Below is a WhatsApp chat (it may include dates, sender names and chatter) that contains delivery messages for SEVERAL parcels.
Find every separate parcel. For each one return the fields below, following exactly the same rules as for one message, plus "raw": the exact lines of the chat you used for that parcel.
Skip greetings, questions and messages with no address or phone. Do not merge two different receivers. Keep the order of the chat.
Valid services: ${SERVICES.join(', ')}.

Rules for one parcel:
`;
const IMAGE_PROMPT = `The image is a screenshot of a chat (WhatsApp or similar) or a photo of a written note with delivery details. Read the text in it (English, Roman Urdu or Urdu) and return one entry per parcel you find, following these rules:
`;
const NAME_PROMPT = `Each image is a photo of one item that arrived in a shipment. For every image give a short plain English name of 2 to 5 words that a courier clerk would understand, e.g. "black leather shoes", "kids pink jacket", "steel water bottle". Mention the colour when clear. No brand guesses, no full sentences. Return one entry per image with the id given before it.`;

function dataUrlPart(d) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(d || ''));
  if (!m) return null;
  return { inline_data: { mime_type: m[1], data: m[2] } };
}
const rulesOnly = () => PARSE_PROMPT.replace(/Reply with only one JSON object[\s\S]*$/, '').trim();

async function gemini(env, parts, schema, ms = 15000) {
  const models = [env.GEMINI_MODEL, ...FALLBACK_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
  let last = null;
  for (const model of models) {
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
        }),
        signal: AbortSignal.timeout(ms),
      });
    } catch (e) { last = { status: 504, text: 'timeout' }; continue; } // too slow: try the next model
    if (r.status === 429) { last = { status: 429 }; continue; } // this model's free quota is used up: try the next
    if (r.status >= 500 || r.status === 404) { last = { status: r.status, text: await r.text() }; continue; }
    if (!r.ok) return { error: 'ai_error', status: 502, detail: (await r.text()).slice(0, 300) };
    const d = await r.json();
    const txt = d?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    try { return { data: JSON.parse(txt), model }; } catch { last = { status: 502, text: 'bad_answer' }; }
  }
  if (last?.status === 429) return { error: 'rate_limited', status: 429 };
  return { error: 'ai_busy', status: 503, detail: last?.text?.slice(0, 300) };
}

export async function onRequestPost({ request, env }) {
  const me = await verifyUser(request, env);
  if (!me) return fail(401, 'Log in again.');
  if (!me.perms.ai) return fail(403, 'AI is turned off for this profile.');
  if (!env.GEMINI_API_KEY) return fail(503, 'not_configured');
  if ((await env.AMANAT_KV.get('cfg:aiOff')) === '1') return fail(503, 'ai_off');
  const b = await body(request);
  let out;
  if (b.task === 'parse') {
    const text = String(b.text || '').slice(0, 6000);
    if (!text.trim()) return fail(400, 'No text');
    out = await gemini(env, [{ text: PARSE_PROMPT + text + '\n"""' }], ADDR, TIMEOUT_MS.parse);
  } else if (b.task === 'bulk') {
    const text = String(b.text || '').slice(0, 40000);
    if (!text.trim()) return fail(400, 'No text');
    out = await gemini(env, [{ text: BULK_PROMPT + rulesOnly() + '\n\nChat:\n"""\n' + text + '\n"""' }], { type: 'ARRAY', items: ADDR_RAW }, TIMEOUT_MS.bulk);
  } else if (b.task === 'image') {
    const img = dataUrlPart(b.image);
    if (!img) return fail(400, 'No image');
    out = await gemini(env, [{ text: IMAGE_PROMPT + rulesOnly() }, img], { type: 'ARRAY', items: ADDR }, TIMEOUT_MS.image);
  } else if (b.task === 'name') {
    const imgs = Array.isArray(b.images) ? b.images.slice(0, 24) : [];
    if (!imgs.length) return fail(400, 'No images');
    const parts = [{ text: NAME_PROMPT }];
    for (const it of imgs) { const p = dataUrlPart(it.image); if (p) parts.push({ text: 'id: ' + String(it.id).slice(0, 40) }, p); }
    out = await gemini(env, parts, { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, name: { type: 'STRING' } }, required: ['id', 'name'] } }, TIMEOUT_MS.name);
  } else return fail(400, 'Unknown task');
  if (out.error) return fail(out.status || 502, out.error, out.detail ? { detail: out.detail } : {});
  return json({ result: out.data, model: out.model });
}
