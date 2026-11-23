// Vercel serverless function: stores each signed-in account's Purrgress state as one JSON value in Upstash Redis.
// Requires only the Upstash Redis REST variables (added automatically when you connect Upstash from the Vercel Marketplace):
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  (older "KV_REST_API_URL" / "KV_REST_API_TOKEN" names also work)
const { redis, missing, auth, bodyOf, K } = require('./_lib');

const MAX_BYTES = 900 * 1024; // Upstash values are limited to ~1 MB

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const miss = missing();
  if (miss.length) return res.status(501).json({ error: 'not_configured', missing: miss });

  try {
    const me = await auth(req); // each account has its own document
    if (!me) return res.status(401).json({ error: 'unauthorized' });
    const KEY = K.state(me.uid);
    if (req.method === 'GET') {
      const raw = await redis(['GET', KEY]);
      if (!raw) return res.status(200).json({ state: null, updatedAt: 0 });
      const doc = JSON.parse(raw);
      if (req.query && req.query.meta) return res.status(200).json({ updatedAt: doc.updatedAt });
      return res.status(200).json(doc);
    }

    if (req.method === 'PUT') {
      const body = bodyOf(req);
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
