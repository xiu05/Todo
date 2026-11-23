// Vercel serverless function: accounts (sign up / sign in / sign out / change password / delete).
// Users and sessions live in Upstash Redis. Passwords are stored as salted scrypt hashes, never in plain text.
// Optional environment variable:
//   PURRGRESS_PASSCODE   if set, creating an account requires this invite code (keeps strangers from signing up).
const crypto = require('crypto');
const { redis, missing, sameSecret, scrypt, auth, limited, ip, bodyOf, K, SESSION_SECS } = require('./_lib');

const NAME_RE = /^[a-z0-9][a-z0-9._@+-]{2,39}$/;
const normName = (n) => String(n || '').trim().toLowerCase();
const pwOk = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;
const bad = (res, code, error, extra) => res.status(code).json({ error, ...extra });

async function startSession(uid, name) {
  const token = crypto.randomBytes(32).toString('base64url');
  await redis(['SET', K.sess(token), JSON.stringify({ uid, name }), 'EX', SESSION_SECS]);
  await redis(['SADD', K.userSess(uid), K.sess(token)]);
  return token;
}
async function endAllSessions(uid) {
  const keys = (await redis(['SMEMBERS', K.userSess(uid)])) || [];
  for (const k of keys) await redis(['DEL', k]);
  await redis(['DEL', K.userSess(uid)]);
}
async function checkPassword(user, pw) {
  const salt = user ? Buffer.from(user.salt, 'hex') : Buffer.alloc(16);
  const h = await scrypt(pw, salt); // runs even for unknown names so timing doesn't reveal which names exist
  return !!user && sameSecret(h, user.hash);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const miss = missing();
  if (miss.length) return bad(res, 501, 'not_configured', { missing: miss });
  const invite = process.env.PURRGRESS_PASSCODE || '';

  try {
    if (req.method === 'GET') return res.status(200).json({ ok: true, inviteRequired: !!invite });
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return bad(res, 405, 'method_not_allowed'); }
    const b = bodyOf(req), action = b.action;

    if (action === 'signup') {
      if (await limited('signup', ip(req), 10, 3600)) return bad(res, 429, 'too_many');
      const name = normName(b.name);
      if (!NAME_RE.test(name)) return bad(res, 400, 'bad_name');
      if (!pwOk(b.password)) return bad(res, 400, 'bad_password');
      if (invite && !sameSecret(b.invite || '', invite)) return bad(res, 403, 'bad_invite');
      const salt = crypto.randomBytes(16);
      const user = { id: crypto.randomBytes(9).toString('hex'), name, salt: salt.toString('hex'), hash: await scrypt(b.password, salt), created: Date.now() };
      const made = await redis(['SET', K.user(name), JSON.stringify(user), 'NX']); // NX: never overwrite an existing account
      if (!made) return bad(res, 409, 'name_taken');
      return res.status(200).json({ token: await startSession(user.id, name), user: { name } });
    }

    if (action === 'login') {
      const name = normName(b.name);
      if (await limited('login-ip', ip(req), 60, 900) || await limited('login', name, 8, 900)) return bad(res, 429, 'too_many');
      const raw = NAME_RE.test(name) ? await redis(['GET', K.user(name)]) : null;
      const user = raw ? JSON.parse(raw) : null;
      if (!(await checkPassword(user, String(b.password || '')))) return bad(res, 401, 'bad_login');
      await redis(['DEL', K.rl('login', name)]);
      return res.status(200).json({ token: await startSession(user.id, name), user: { name } });
    }

    const me = await auth(req);
    if (!me) return bad(res, 401, 'unauthorized');

    if (action === 'me') return res.status(200).json({ user: { name: me.name } });

    if (action === 'logout') {
      await redis(['DEL', K.sess(me.token)]); await redis(['SREM', K.userSess(me.uid), K.sess(me.token)]);
      return res.status(200).json({ ok: true });
    }

    if (action === 'password' || action === 'delete') {
      if (await limited('login', me.name, 8, 900)) return bad(res, 429, 'too_many');
      const raw = await redis(['GET', K.user(me.name)]);
      const user = raw ? JSON.parse(raw) : null;
      if (!(await checkPassword(user, String(b.password || '')))) return bad(res, 401, 'bad_login');
      await redis(['DEL', K.rl('login', me.name)]);
      if (action === 'password') {
        if (!pwOk(b.newPassword)) return bad(res, 400, 'bad_password');
        const salt = crypto.randomBytes(16);
        user.salt = salt.toString('hex'); user.hash = await scrypt(b.newPassword, salt);
        await redis(['SET', K.user(me.name), JSON.stringify(user)]);
        await endAllSessions(me.uid); // signs out every device…
        return res.status(200).json({ token: await startSession(me.uid, me.name), user: { name: me.name } }); // …except this one
      }
      await endAllSessions(me.uid);
      await redis(['DEL', K.state(me.uid)]); await redis(['DEL', K.user(me.name)]);
      return res.status(200).json({ ok: true });
    }

    return bad(res, 400, 'bad_action');
  } catch (e) {
    return bad(res, 502, 'storage_error');
  }
};
