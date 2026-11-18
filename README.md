# Purrgress

A personal brand → project → task tracker with a pet cat. The whole app is one file, `index.html`.
It works on its own (data is saved in your browser). To use the **same data on several devices**, deploy to Vercel and turn on cloud sync.

## Deploy on Vercel with cloud sync

1. Push this repo to GitHub and import it in Vercel (no build settings needed — it's a static site plus `api/state.js`).
2. In the Vercel project: **Storage → Create / Connect → Upstash Redis** (Marketplace). Free tier is plenty. This adds
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (older projects may use `KV_REST_API_URL` / `KV_REST_API_TOKEN`; both work).
3. **Settings → Environment Variables:** add `PURRGRESS_PASSCODE` = a passcode only you know. Redeploy.
4. Open your Vercel URL on each device → click the **☁** button → enter the passcode → **Connect**.
   - First device: uploads its data.
   - Other devices: choose **Use cloud data**.

### How sync behaves
- Changes upload ~1.5 s after you make them. Other devices pick them up when you open the page, return to the tab, or every 45 s while it's visible.
- If two devices changed things before syncing, you're asked which version to keep (nothing is merged silently).
- Synced: brands, projects, tasks, comments, links, time logs, timer, pomodoro settings, music playlist, pet.
  Not synced: theme, which tab/brand you're viewing.
- **Uploaded files** are kept in each browser (IndexedDB) and do **not** sync yet — attach a link (Drive, Dropbox…) if you need it on other devices.
- The passcode is stored in the browser on each device. Anyone with the passcode can read and overwrite your data, so keep it private.
- Locally (no server) the ☁ button just reports that no sync server is available; everything else keeps working.

## Files
- `index.html` — the app
- `api/state.js` — Vercel function that reads/writes one JSON document in Upstash Redis
