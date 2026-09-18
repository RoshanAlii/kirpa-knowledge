/**
 * Kirpa Knowledge — Google Sheet backend
 * ------------------------------------------------------------------
 * Paste this into Extensions > Apps Script of the Google Sheet that
 * should hold the data, then Deploy > New deployment > Web app with:
 *     Execute as:      Me
 *     Who has access:  Anyone
 * Copy the /exec URL into the dashboard's Settings > Cloud Sync.
 * ------------------------------------------------------------------
 * Tabs it manages (created automatically, do not rename):
 *   _state       machine-readable JSON state (chunked) + revision
 *   Assessments  readable mirror, one row per assessment
 *   Roster       readable mirror, one row per agent
 * Edit Assessments/Roster by hand at your own risk — they are rewritten
 * on every save from the dashboard.
 */

var TOKEN      = 'kirpa_aa7abca846471b077fa6671cbf6943f4';
var STATE_TAB  = '_state';
var CHUNK      = 40000;   // a cell holds 50k chars; stay under it

function doGet(e)  { return route(e, {}); }

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  return route(e, body);
}

function route(e, body) {
  var p      = (e && e.parameter) ? e.parameter : {};
  var action = body.action || p.action || 'get';
  var token  = body.token  || p.token  || '';

  if (token !== TOKEN) return json({ ok: false, error: 'Invalid token' });

  try {
    if (action === 'ping') return json({ ok: true, time: new Date().toISOString() });
    if (action === 'get')  return json(readState());
    if (action === 'put')  return json(writeState(body.state));
    return json({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

function book() { return SpreadsheetApp.getActiveSpreadsheet(); }

function tab(name) {
  var ss = book();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

/* ------------------------------- read ------------------------------- */

function readState() {
  var sh   = tab(STATE_TAB);
  var meta = {};
  try { meta = JSON.parse(sh.getRange('A1').getValue() || '{}'); } catch (e) {}

  if (!meta.rev) return { ok: true, rev: 0, state: null, updatedAt: null };

  var n = meta.chunks || 0;
  if (n < 1) return { ok: true, rev: 0, state: null, updatedAt: null };

  var vals = sh.getRange(2, 1, n, 1).getValues();
  var raw  = '';
  for (var i = 0; i < n; i++) raw += vals[i][0];

  var st = null;
  try { st = JSON.parse(raw); } catch (e) {
    return { ok: false, error: 'Stored state is corrupt: ' + e.message };
  }
  return { ok: true, rev: meta.rev, state: st, updatedAt: meta.updatedAt || null };
}

/* ------------------------------- write ------------------------------ */

function writeState(st) {
  if (!st || !st.teams || !st.records) throw new Error('Payload is missing teams/records');

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var sh   = tab(STATE_TAB);
    var meta = {};
    try { meta = JSON.parse(sh.getRange('A1').getValue() || '{}'); } catch (e) {}

    var rev  = (meta.rev || 0) + 1;
    var now  = new Date().toISOString();
    var raw  = JSON.stringify(st);

    var parts = [];
    for (var i = 0; i < raw.length; i += CHUNK) parts.push([raw.substr(i, CHUNK)]);
    if (!parts.length) parts.push(['']);

    var oldRows = Math.max(meta.chunks || 0, 1);
    sh.getRange(2, 1, Math.max(oldRows, parts.length) + 5, 1).clearContent();
    sh.getRange(2, 1, parts.length, 1).setValues(parts);
    sh.getRange('A1').setValue(JSON.stringify({ rev: rev, updatedAt: now, chunks: parts.length }));

    mirror(st, now);
    return { ok: true, rev: rev, updatedAt: now };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------- human-readable mirror tabs --------------------- */

function mirror(st, now) {
  var LEVELS = { 1: 'Poor', 2: 'Weak', 3: 'Good', 4: 'Very Good' };
  var SCORES = { 1: 25, 2: 50, 3: 75, 4: 100 };

  // ----- Assessments -----
  var leaderOf = {};
  (st.teams || []).forEach(function (t) { leaderOf[t.name] = t.leader; });

  var rows = [['Week Ending', 'Team', 'Team Leader', 'Agent', 'Knowledge Area', 'Level', 'Score %', 'Comment']];
  (st.records || []).slice().sort(function (a, b) {
    return String(b.week).localeCompare(String(a.week)) ||
           String(a.team).localeCompare(String(b.team)) ||
           String(a.agent).localeCompare(String(b.agent)) ||
           String(a.area).localeCompare(String(b.area));
  }).forEach(function (r) {
    rows.push([r.week, r.team, leaderOf[r.team] || '', r.agent, r.area || '',
               r.level ? LEVELS[r.level] : '', r.level ? SCORES[r.level] : '', r.comment || '']);
  });
  writeTable('Assessments', rows);

  // ----- Roster -----
  var inactive = st.inactive || [];
  var rr = [['Team', 'Team Leader', 'Agent', 'Status']];
  (st.teams || []).forEach(function (t) {
    (t.members || []).forEach(function (m) {
      rr.push([t.name, t.leader, m, inactive.indexOf(t.name + '|' + m) >= 0 ? 'Inactive' : 'Active']);
    });
  });
  writeTable('Roster', rr);

  tab(STATE_TAB).getRange('C1').setValue('Last sync: ' + now);
}

function writeTable(name, rows) {
  var sh = tab(name);
  sh.clear();
  if (!rows.length) return;
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold').setBackground('#fff2e6');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, rows[0].length);
}

/* ------------------------- manual helpers --------------------------- */

/** Run once from the editor to confirm the script can touch the sheet. */
function selfTest() {
  var r = readState();
  Logger.log(JSON.stringify(r).slice(0, 500));
}
