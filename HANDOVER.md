# Kirpa Knowledge — handover

Everything a new session needs to pick this up cold. Written 19 Sep 2026, updated 21 Sep 2026.

---

## 1. What it is

A weekly knowledge-assessment board for Kirpa Properties' six sales teams (~40 agents).
Team leaders score each agent **Poor / Weak / Good / Very Good** per knowledge area, per week.
The point of the system is to show **movement**, not a static snapshot.

Owner: Ali (Roshan Ali), roshan@kirpaproperties.com.
Status: **one-week pilot**, deliberately temporary. Not a permanent system.

---

## 2. Where everything lives

| Thing | Location |
|---|---|
| Live dashboard | https://roshanalii.github.io/kirpa-knowledge/ |
| Passcode | `Kirpa@2026` (client-side only — see §7) |
| Repo | https://github.com/RoshanAlii/kirpa-knowledge (public, GitHub Pages from `main`, root) |
| Google Sheet | "Kirpa Knowledge Data" — `1CZzWg87UhMw6mRSFm-8IO0SxYs_l_fmEZAwCZO5ZY6g` |
| Apps Script project | "kirpa-knowledge-api" — `1SpbT-aQ4HDJoVfYU4kNLouKsBgYEu9NbsPZb1vGhpZhvd7WO5I2I835t` |
| Web app endpoint | `https://script.google.com/macros/s/AKfycbwq4WnI3N6UhUdzHTQSZ81yGGHzNC82xXkAer6roCWeFMXV9fH90xQDwfYozugHV7R8jQ/exec` |
| Shared token | `kirpa_aa7abca846471b077fa6671cbf6943f4` |

The Sheet and Script live in Ali's **roshan@kirpaproperties.com** Google account. The web app runs
as that account ("Execute as: Me", "Who has access: Anyone"), so team leaders never need Sheet access.

Current versions: `index.html` **v2.3**, Apps Script deployment **Version 5**.

### Repo files
| File | Purpose |
|---|---|
| `index.html` | The entire app — HTML, CSS, JS, seed data, sync layer, passcode gate |
| `Code.gs` | Apps Script backend (paste target for the script project) |
| `README.md` | Setup, architecture, troubleshooting |
| `HANDOVER.md` | This file |
| `qa-suite.mjs` | Main regression suite (82 checks) |
| `qa-concurrency.mjs` | Two leaders saving simultaneously |
| `qa-partial-saves.mjs` | Partial saves, toggle-to-clear, stale-leader merge |
| `qa-race.mjs` | Stale poll reply vs a local save; per-area coverage |
| `qa-amend-past-week.mjs` | Correcting a rating in a past week |
| `qa-leaders-and-merge.mjs` | The 11-into-12 Sep week merge and the team-leader exclusion |
| `qa-ui-audit.mjs` | Layout audit - clipped text, overflow, tap targets, across 7 views x 6 widths |
| `qa-single-area.mjs` | The collapse of the five categories into one |

Run any suite with `node <file>.mjs` (needs `npm i playwright && npx playwright install chromium`).
They spin up a local copy of `index.html` plus a mock Apps Script — **nothing touches the live sheet.**

---

## 3. Data model

```js
state = {
  teams:    [{ name, leader, members:[agentName] }],
  records:  [{ week, team, agent, area, level, comment }],
  inactive: ["Team Name|Agent Name"],
  legacy:   [],          // unused since the v2.0 baseline
  version:  3
}
```

- `week` — ISO date of the **week ending**, e.g. `2026-09-12`
- `level` — 1 Poor · 2 Weak · 3 Good · 4 Very Good → scores 25 / 50 / 75 / 100
- A record's identity is **(week, team, agent, area)**. No id field.
- **No record means not assessed.** Absentees are simply absent — never a zero.
- Agent score = mean of their area scores that week. Company score = mean over **assessed** agents.

Areas: **one** - `Basic Real Estate KB`. The board originally carried five categories plus a
paper-import area, but every assessment ever recorded was the same basic real-estate test, so
they were collapsed into one on 26 Sep. `AREAS` in `index.html` is still a list: add entries and
per-area scoring, the area picker and the two per-area dashboard panels all come back on their
own. Nothing else is hard-coded to a single area.

### Sheet tabs
- `_state` — A1 holds `{rev, updatedAt, chunks}`; A2 down holds the JSON state in 40k-char chunks
- `Assessments` / `Roster` — human-readable mirrors, **rewritten on every save**, do not hand-edit
- A full year of data ≈ 42 chunk cells, max 40k each (cell limit is 50k). Verified.

---

## 4. Sync protocol

`text/plain` POST to the `/exec` URL. Actions:

| Action | Does |
|---|---|
| `head` | Returns `{rev, updatedAt}` only — one cell read. What polling uses. |
| `get` | Returns the full state. Only when `head` says the revision moved. |
| `patch` | Merges `scopes:[{week,team,area,upserts:[record],deletes:[agentName]}]` and/or `roster` |
| `put` | Full replace. Only for Import Backup / Reset / first seed. |
| `ping` | Health check |

Polling cadence: 15s active · 45s idle · 300s after 25 min untouched · 8s while a write is queued ·
failure backoff 10/25/60/120s · nothing at all when the tab is hidden.

---

## 5. Non-obvious things that will bite you

Each of these was a real bug found in testing. Do not "simplify" them away.

1. **`Content-Type: text/plain`, never `application/json`.** Apps Script cannot answer a CORS
   preflight. JSON content-type breaks all writes.
2. **Every request needs a unique `?cb=` and `cache: 'no-store'`.** `/exec` 302-redirects to a
   one-shot `googleusercontent.com` URL; a cached or expired one surfaces as a spurious 404.
3. **Revisions only move forward.** A pull is applied only when its rev is **greater** than the
   local one (or equal, immediately after our own write). Using `!==` lets a `get` issued before a
   save land after it and silently roll the save back. `qa-race.mjs` catches this.
4. **Writes are per-agent, never per-slice.** A save sends only the agents it changed, as `upserts`
   plus an explicit `deletes` list. Sending the whole (week, team, area) slice means a partial save
   or a stale browser deletes other people's entries.
5. **`SpreadsheetApp.flush()` before the lock releases.** Without it a patch arriving right after
   another reads the previous, unflushed state and drops that write.
6. **The app's own handlers are bound by reference.** `addEventListener('click', saveWeeklyAssessment)`
   captured the original function, so reassigning the global does nothing. The sync layer therefore
   intercepts `#saveWeekBtn`, `#clearTeamForm` and `.level-btn` with **capture-phase listeners on
   `document`** plus `stopPropagation()`. Keep that pattern.
7. **Deploying the Apps Script: always pick "New version" in the version dropdown.** Selecting an
   existing version *rolls the backend back*. This happened once and silently reverted the merge fix.
   Deploy → Manage deployments → pencil → Version → **New version** → Deploy. The `/exec` URL is
   stable across redeploys; only "New deployment" changes it.
8. GitHub Pages caches for 10 minutes. Add `?v=N` to check a fresh build.
9. **A record is keyed by (week, team, agent, area).** Change an agent's team or
   collapse the area list and those keys move: re-point the affected records in the
   same edit or their history orphans (the agent reads "not assessed" and loses the
   "last time" marker). Both migrations in `normalizeState` do this, and both check
   for the duplicate that a key change can create.
10. **A fixed-height control must not carry vertical padding.** `.field` had
   `height:40px` *and* `padding:10px 11px`, which left an 18px content box for a
   16px line - Chrome on macOS clipped the descenders of "Team Lipika" and
   "Objection Handling". Single-line controls size themselves with `height` plus
   horizontal padding only; `select.field` also needs `padding-right` so the text
   does not run under the native chevron. `qa-ui-audit.mjs` fails on both.
11. **`saveState()` is monkey-patched by the sync layer.** Calling it enqueues a sync op as a side
   effect. Code that wants to persist state *without* queuing a write must call
   `localStorage.setItem(STORE, ...)` directly — `settleMigration()` does exactly this, and calling
   `saveState()` there made the queue look busy and silently suppressed the migration push.

---

## 6. Behaviour worth knowing

- **Partial saves**: score whoever is present. Untouched agents keep what was saved before.
- **To clear a rating**: click the selected level again. That is the *only* way to delete one.
- **Reset Form** discards unsaved edits and reloads what is stored. It does not wipe saved scores.
- **To amend a past week**: set the top-bar week filter, open Assess (the week carries across), pick
  team + area, re-score, save. Updates in place.
- **Previous-level marker**: the dashed button shows where that agent stood last time — same area if
  available, otherwise their most recent record in any area, labelled.
- **Team leaders are never rated.** `activeMembers()` skips any member whose name equals their
  team's `leader`, so leaders are absent from the assess grid, every coverage denominator and the
  not-assessed lists. They stay on the Admin roster (flagged "Yes") and in each team card header as
  "TL · <name>". Matching is exact, so "Priyanka Sunil" is unaffected by leader "Priyanka".
- **Removing someone from rating**: Admin → Deactivate. Their records stay in the sheet and in
  their history modal; they simply leave the roster and the counts. Reactivate puts them back.
- **The 11 Sep / 12 Sep merge** runs in `normalizeState()`, so it fixes the local copy *and*
  anything pulled from the sheet, then `settleMigration()` writes the merged copy back once. It is
  idempotent and a no-op once no `2026-09-11` record survives. Safe to delete after the pilot.

---

## 7. Open issues — read before changing anything

| Issue | Detail |
|---|---|
| **Roster has two Navneets** | Team Lipika's Navneet was added through Add Agent and holds every Navneet record; Team Manpreet Ma'am's Navneet is the original seed entry and has never been scored. Almost certainly one person entered twice. Unresolved — ask Ali before deleting either. |
| **Add Agent misses cross-team duplicates** | The check only looks within the target team. Same name on another team passes silently. |
| **"+N pts vs previous week" is weak** | It compares the average of *whoever was assessed* this week against *whoever was assessed* last week — different populations. "Previous week" means the last week with any data, not 7 days earlier. Much less misleading since the 11/12 Sep merge gave it a full baseline week, but still not like-for-like. |
| **No audit trail** | The sheet stores current values, not who changed them or when. Every write goes through the script as Ali. Sheet version history is the only record. |
| **Passcode is client-side** | SHA-256 hash and the shared token are both in the public repo. It keeps the board out of casual view; it is not access control. 40 named employees with performance ratings sit on a public URL. |
| Last-write-wins per agent | Two leaders scoring the *same agent, same area, same week* within seconds: one value wins. Everything else merges correctly. |

---

## 8. What the permanent replacement needs

Real auth (Google Workspace SSO on the kirpa domain), per-row writes with an audit trail, and a
private host. Supabase or a small Next.js app on Vercel covers all three. The properties to carry
over: per-agent merge semantics, monotonic revisions, and absence meaning "not assessed".
