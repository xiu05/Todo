// Vercel serverless function: stores your whole Purrgress state as one JSON value in Upstash Redis.
// Required environment variables (Vercel → Project → Settings → Environment Variables):
//   PURRGRESS_PASSCODE            a passcode only you know (the app asks for it once per device)
//   UPSTASH_REDIS_REST_URL        } added automatically when you connect Upstash Redis from the Vercel Marketplace
//   UPSTASH_REDIS_REST_TOKEN      } (older "KV_REST_API_URL" / "KV_REST_API_TOKEN" names also work)
const crypto = require('crypto');

const KEY = 'purrgress:state';
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const MAX_BYTES = 900 * 1024; // Upstash values are limited to ~1 MB

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()).result;
}

const sameSecret = (a, b) => {
  const h = (x) => crypto.createHash('sha256').update(String(x)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.PURRGRESS_PASSCODE || !REDIS_URL || !REDIS_TOKEN) return res.status(501).json({ error: 'not_configured' });
  if (!sameSecret(req.headers['x-passcode'] || '', process.env.PURRGRESS_PASSCODE)) return res.status(401).json({ error: 'bad_passcode' });

  try {
    if (req.method === 'GET') {
      const raw = await redis(['GET', KEY]);
      if (!raw) return res.status(200).json({ state: null, updatedAt: 0 });
      const doc = JSON.parse(raw);
      if (req.query && req.query.meta) return res.status(200).json({ updatedAt: doc.updatedAt });
      return res.status(200).json(doc);
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || typeof body.state !== 'object' || body.state === null) return res.status(400).json({ error: 'bad_body' });
      const json = JSON.stringify(body.state);
      if (Buffer.byteLength(json) > MAX_BYTES) return res.status(413).json({ error: 'too_large' });
      // Optimistic concurrency: refuse to overwrite a newer version this device has not seen.
      const cur = await redis(['GET', KEY]);
      const curDoc = cur ? JSON.parse(cur) : null;
      if (curDoc && curDoc.updatedAt > (body.baseAt || 0) && !body.force) return res.status(409).json(curDoc);
      const updatedAt = Math.max(Date.now(), (curDoc ? curDoc.updatedAt : 0) + 1);
      await redis(['SET', KEY, JSON.stringify({ state: body.state, updatedAt })]);
      return res.status(200).json({ updatedAt });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    return res.status(502).json({ error: 'storage_error' });
  }
};
