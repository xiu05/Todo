// Shared helpers for the Pawgress API (files starting with "_" are not exposed as routes by Vercel).
const crypto = require('crypto');

// Find the Upstash REST credentials whatever prefix Vercel gave them
// (UPSTASH_REDIS_REST_URL, KV_REST_API_URL, or a custom prefix such as STORAGE_REST_API_URL).
const envKey = (re) => Object.keys(process.env).find((k) => re.test(k) && process.env[k]);
const URL_KEY = envKey(/REST(_API)?_URL$/);
const TOKEN_KEY = Object.keys(process.env).find((k) => /REST(_API)?_TOKEN$/.test(k) && !/READ_ONLY/.test(k) && process.env[k]);
const REDIS_URL = URL_KEY && process.env[URL_KEY];
const REDIS_TOKEN = TOKEN_KEY && process.env[TOKEN_KEY];

const missing = () => {
  const m = [];
  if (!REDIS_URL) m.push('Upstash Redis REST URL (connect Upstash under Storage)');
  if (!REDIS_TOKEN) m.push('Upstash Redis REST token (connect Upstash under Storage)');
  return m;
};

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()).result;
}

const sha = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
const sameSecret = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

const SESSION_SECS = 60 * 60 * 24 * 90; // sessions last 90 days (renewed whenever you use the app)
const K = {
  user: (name) => `purrgress:user:${name}`,
  state: (uid) => `purrgress:state:${uid}`,
  sess: (token) => `purrgress:sess:${sha(token)}`, // only a hash of the token is stored
  userSess: (uid) => `purrgress:usess:${uid}`,
  rl: (what, who) => `purrgress:rl:${what}:${sha(who).slice(0, 24)}`,
};

const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(String(pw), salt, 64, (e, k) => (e ? rej(e) : res(k.toString('hex')))));

// Returns { uid, name, token } for a valid "Authorization: Bearer <token>", else null. Renews the session.
async function auth(req) {
  const m = /^Bearer\s+(\S{20,200})$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const raw = await redis(['GET', K.sess(m[1])]);
  if (!raw) return null;
  redis(['EXPIRE', K.sess(m[1]), SESSION_SECS]).catch(() => {});
  const s = JSON.parse(raw);
  return { uid: s.uid, name: s.name, token: m[1] };
}

// Counts an attempt; true when over the limit.
async function limited(what, who, max, secs) {
  const key = K.rl(what, who);
  const n = await redis(['INCR', key]);
  if (n === 1) await redis(['EXPIRE', key, secs]);
  return n > max;
}

const ip = (req) => String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || 'unknown').trim();
const bodyOf = (req) => { try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (e) { return {}; } };

module.exports = { redis, missing, sha, sameSecret, scrypt, auth, limited, ip, bodyOf, K, SESSION_SECS };
