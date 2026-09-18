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
- **Previous-level memory**: when you assess a week, the button showing where that agent stood last
  time is outlined with a dashed border and captioned with the date, so movement is visible at the
  moment of scoring. It prefers the same knowledge area; if the agent has no history in that area it
  falls back to their most recent record in any area and names it, e.g. `Last time · 11 Sep (Paper)`.
  Agents with no history at all read "No earlier record".
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
- **Reads**: the app polls every 20s (7s while it is behind, and on tab focus or regaining network). If the remote revision is newer than the
  one it holds, it swaps in the remote state and re-renders. Last write wins.
- **Offline**: if the sheet is unreachable, everything still works from `localStorage` and the
  status pill in the header turns red. The next successful save pushes the local state up.
- **CORS**: requests go out as `Content-Type: text/plain` so they stay CORS-*simple* requests —
  Apps Script cannot answer a preflight `OPTIONS`, so this matters. Don't change it to
  `application/json`.
- **Flakiness**: `/exec` replies with a 302 to a single-use `googleusercontent.com` URL. A cached or
  expired one surfaces as a spurious 404, so every request carries a unique `?cb=` value and
  `cache: 'no-store'`, and transient failures are retried up to 3 times before the UI says anything.
  A failed push sets a dirty flag; the poller keeps retrying until the sheet accepts it.

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

**Pill says "Retrying…".**
Nothing to do. Apps Script occasionally drops a request (its `/exec` endpoint answers with a one-shot
redirect that sometimes 404s). Each call is retried up to 3 times, and the pill only turns red after
3 consecutive failures, so a brief "Retrying" is normal.

**Pill says "Sync error" or "Not saved".**
"Not saved" means you have local edits that haven't reached the sheet — they are safe in the browser
and are pushed automatically as soon as the connection recovers; polling speeds up to every 7s until
it does. Nothing is lost by closing the tab and reopening it later on the same browser. Open
Settings > Cloud Sync for the exact message.
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

## 8. Regression suite

`qa-suite.mjs` is a Playwright suite covering 81 checks across the passcode gate, dashboard maths,
the assessment save/edit/delete cycle, the previous-level marker, filters, roster admin,
backup/restore, HTML escaping, and cloud sync (including injected 404s and a simulated outage). It
runs against a local copy of `index.html` with a mock Apps Script backend, so it touches nothing
live.

```bash
npm i playwright && npx playwright install chromium
node qa-suite.mjs
```

It asserts figures against an independent recompute from raw state rather than against the UI's own
numbers, so a maths regression fails the suite rather than agreeing with itself.

## 9. Files

| File | Purpose |
|---|---|
| `index.html` | The entire app — HTML, CSS, JS, data, sync layer, passcode gate |
| `Code.gs` | Google Apps Script backend |
| `qa-suite.mjs` | Playwright regression suite (81 checks) |
