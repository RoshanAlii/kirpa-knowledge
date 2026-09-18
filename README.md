# Kirpa Knowledge — Weekly Sales Knowledge Board

Static dashboard for tracking weekly knowledge assessments across Kirpa Properties' six sales teams.
Hosted on GitHub Pages; shared data lives in a Google Sheet via a small Apps Script web app.

**Live:** https://roshanalii.github.io/kirpa-knowledge/

> ⚠️ This is a **one-week pilot setup**. The passcode is client-side only — it keeps the board out of
> casual view, it is not real access control. Do not put anything confidential beyond names and
> assessment levels in here until it moves to a proper server-backed deployment.

---

## 1. What it does

- 40-agent roster across 6 teams, each with a team leader
- Weekly assessment entry per team, per knowledge area, on a 4-point scale
  (Poor 25% / Weak 50% / Good 75% / Very Good 100%)
- Five knowledge areas: Objection Handling · Investment / ROI · Dubai Area & Market ·
  Project / Product · Sales Presentation. Plus the imported handwritten paper week (11 Sep 2026).
- Dashboard: company score, level distribution, per-area scores, ranked training gaps, insights
- Agent drill-down with full assessment history and coaching comments
- Team view, weekly + team reports, CSV export, print

## 2. Architecture

```
GitHub Pages (index.html, static)
        │  HTTPS POST, JSON
        ▼
Google Apps Script Web App  (Code.gs)
        │
        ▼
Google Sheet
   ├── _state        JSON state blob (chunked) + revision counter   ← machine
   ├── Assessments   one row per assessment                          ← readable
   └── Roster        one row per agent                               ← readable
```

- **Writes**: every save in the app pushes the full state, debounced ~1s. The script bumps a
  revision counter under a script lock, then rewrites the two readable tabs.
- **Reads**: the app polls every 20s (and on tab focus). If the remote revision is newer than the
  one it holds, it swaps in the remote state and re-renders. Last write wins.
- **Offline**: if the sheet is unreachable, everything still works from `localStorage` and the
  status pill in the header turns red. The next successful save pushes the local state up.
- **CORS**: requests go out as `Content-Type: text/plain` so they stay CORS-*simple* requests —
  Apps Script cannot answer a preflight `OPTIONS`, so this matters. Don't change it to
  `application/json`.

## 3. One-time setup (~5 minutes)

### a. Create the sheet
1. Go to <https://sheets.new>, name it **Kirpa Knowledge Data**.

### b. Add the script
2. **Extensions → Apps Script**.
3. Delete whatever is in `Code.gs` and paste the contents of [`Code.gs`](Code.gs).
4. Save (💾).

### c. Deploy it
5. **Deploy → New deployment → ⚙️ → Web app**.
6. Set:
   - Description: `kirpa-knowledge`
   - Execute as: **Me**
   - Who has access: **Anyone**
7. **Deploy** → authorise (Google will warn "unverified app" → *Advanced* → *Go to …(unsafe)* — it's
   your own script).
8. Copy the **Web app URL**. It ends in `/exec`.

### d. Connect the dashboard
9. Open the live link, enter the passcode.
10. **Settings → Cloud Sync**, paste the URL, leave the token as-is, click **Connect & Sync**.
11. Click **Push to Sheet** once to seed the sheet with the current roster and paper-week data.
12. The header pill should read **Synced**. Check the Google Sheet — `Assessments` and `Roster` are
    now populated.

Every other team leader just opens the live link, enters the passcode, and pastes the same URL in
Settings once. After that their browser stays in sync automatically.

### e. Already done: the URL is baked in
`index.html` ships with the deployed `/exec` URL in `DEFAULT_API_URL`, so every browser connects on
first load — team leaders only enter the passcode. Settings > Cloud Sync is there to override it or
to disconnect. If you ever **re-deploy** the script as a *new deployment* (rather than editing the
existing one), the URL changes and you must update `DEFAULT_API_URL` and commit. Editing the
existing deployment via **Manage deployments** keeps the URL stable — prefer that.

## 4. Changing the passcode

The passcode is stored as a SHA-256 hash in `index.html`:
```js
var PASSCODE_SHA256 = 'd707acfa...';
```
Generate a new one and replace that string:
```bash
printf '%s' 'YourNewPasscode' | shasum -a 256
```
Anyone who ticked "remember this device" will be asked again once the hash changes.

## 5. Changing the shared token

The token is a shared secret between the page and the script — it stops random traffic hitting your
web app. It appears in **two** places and must match:
- `Code.gs` → `var TOKEN = '...'` (then **Deploy → Manage deployments → edit → Deploy**)
- `index.html` → `var DEFAULT_TOKEN = '...'`

Because the page is public, this token is visible to anyone who reads the source. It is a speed
bump, not security.

## 6. Backups

- **Settings → Export Backup** downloads the full JSON state. Do this at the end of the pilot week.
- The Google Sheet itself is a backup — `File → Version history` gives you every revision.

## 6b. Troubleshooting

**Header pill says "Local only" but the URL is baked in.**
The browser is serving a cached copy of `index.html`. GitHub Pages sets `Cache-Control: max-age=600`,
so it clears itself within 10 minutes. To force it now: hard refresh (Cmd/Ctrl + Shift + R), or load
`.../kirpa-knowledge/?v=2`.

**Pill says "Sync error".**
Open Settings > Cloud Sync and read the line under the buttons — it carries the actual message.
- *Invalid token* → the token in `index.html` and in `Code.gs` no longer match. See section 5.
- *Unexpected reply from the web app* → the deployment's "Who has access" is not **Anyone**.
  Fix in **Deploy > Manage deployments > edit (pencil)**.
- Anything network-shaped → the script may be mid-redeploy. Wait a minute, click **Pull from Sheet**.

**Someone clicked Disconnect and now their browser won't reconnect.**
Disconnect stores an explicit empty URL, which overrides the baked-in one. Paste the `/exec` URL back
into Settings and click **Connect & Sync**.

**Two leaders edited the same team at the same time.**
Last write wins — the later save overwrites. The Google Sheet's **File > Version history** has the
earlier state if you need to recover it.

**Do team leaders need access to the Google Sheet?**
No. The web app runs as Ali's account ("Execute as: Me"), so the sheet stays private. Only share it
with people who need to read the raw data.

## 7. Known limits of this pilot

| Limit | Detail |
|---|---|
| Passcode is client-side | Anyone who views source can read the hash and the token. |
| No user accounts | No per-leader logins, no audit trail of who changed what. |
| Last write wins | Two leaders saving the same team within the same second: one overwrites the other. Assign one team per leader and it won't come up. |
| Apps Script quotas | ~20k URL-fetch/executions per day on a consumer account. Nowhere near it at this scale. |
| Data lives in your Google account | Fine for a pilot, but agent performance data on a public URL is the thing to fix in the permanent build. |

**Permanent replacement should be**: real auth (Google Workspace SSO for the kirpa domain),
per-row writes instead of whole-state pushes, and a private host. Supabase or a small Next.js app
on Vercel does all three.

## 8. Files

| File | Purpose |
|---|---|
| `index.html` | The entire app — HTML, CSS, JS, data, sync layer, passcode gate |
| `Code.gs` | Google Apps Script backend |
