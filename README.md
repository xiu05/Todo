# Purrgress

A personal brand → project → task tracker with a pet cat. The whole app is one file, `index.html`.
It works on its own (data is saved in your browser). To use the **same data on several devices**, deploy to Vercel and turn on cloud sync.

## Deploy on Vercel with accounts + cloud sync

1. Push this repo to GitHub and import it in Vercel (no build settings needed — it's a static site plus the `api/` functions).
2. In the Vercel project: **Storage → Create / Connect → Upstash Redis** (Marketplace). Free tier is plenty. This adds
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (older projects may use `KV_REST_API_URL` / `KV_REST_API_TOKEN`; both work).
   **That is the only required setup.** Redeploy once after connecting it.
3. *(Optional)* **Settings → Environment Variables:** add `PURRGRESS_PASSCODE` = an invite code. If set, creating an account needs it,
   so strangers who find your URL can't sign up. Leave it out if you don't mind open sign-ups.
4. Open your Vercel URL → click **☁** → **New here? Create account** (username or email + a password of 8+ characters).
   - First device: your current data is uploaded to the new account.
   - Other devices: **Sign in** → choose **Use cloud data**.

### Accounts
- Each account has its own private data; nobody else's tasks are ever mixed in.
- Passwords are stored only as salted `scrypt` hashes. Sign-in sessions last 90 days on a device (renewed while you use it);
  only a hash of the session token is stored on the server.
- **Sign out** keeps the data on that device. If a different account signs in on the same device, you're asked whether to start fresh.
- **☁ → Account** lets you change your password (this signs your other devices out) or delete the account and its cloud data.
- Too many wrong passwords from one username/IP are temporarily blocked.
- There is no "forgot password" email — pick a password you'll remember (or use a password manager).

### If the ☁ panel says "The server isn't set up yet"
The message lists what is missing. Fix it in Vercel and **redeploy** (variables only apply to new deployments):
- "Upstash Redis REST URL/token" missing → open the project's **Storage** tab and connect an Upstash Redis database
  (it must expose a *REST* URL and token; a plain `REDIS_URL` alone is not enough). Any variable prefix works (`UPSTASH_REDIS_…`, `KV_…`, `STORAGE_…`).
- Check the variables are enabled for the environment you're visiting (Production vs Preview).
- A variable created under the team-wide **Shared** tab must be *linked* to the project, or added in the project's own Settings → Environment Variables.
- After any change, wait for a **new** deployment to finish (Deployments tab shows Ready) — old deployments never see new variables.
- "Wrong invite code" → you set `PURRGRESS_PASSCODE`; enter it in the *Invite code* box when creating an account.

### How sync behaves
- Changes upload ~1.5 s after you make them. Other devices pick them up when you open the page, return to the tab, or every 45 s while it's visible.
- If two devices changed things before syncing, you're asked which version to keep (nothing is merged silently).
- Synced: brands, projects, tasks, comments, links, time logs, timer, pomodoro settings, music playlist, pet.
  Not synced: theme, which tab/brand you're viewing.
- **Uploaded files** are kept in each browser (IndexedDB) and do **not** sync yet — attach a link (Drive, Dropbox…) if you need it on other devices.
- Locally (no server) the ☁ sign-in just reports that no sync server is available; everything else keeps working without an account.

## Files
- `index.html` — the app
- `api/account.js` — sign up / sign in / sign out / change password / delete account
- `api/state.js` — reads/writes each account's JSON document in Upstash Redis
- `api/_lib.js` — shared helpers (Redis client, sessions, rate limiting)
