/**
 * LEDGER → GOOGLE SHEET BRIDGE
 * ────────────────────────────────────────────────────────────────
 * Paste this into a Google Apps Script bound to a new Sheet, deploy it
 * as a Web App, and every session you save in Ledger appends a row here.
 *
 * Why bother: Claude can already read your Google Drive. Once sessions
 * land in a Sheet, check-ins need zero copy-pasting — just say
 * "check in" and Claude reads the Sheet directly.
 *
 * SETUP (5 minutes, once)
 * ───────────────────────
 *  1. sheets.new  →  rename the file "Ledger Log"
 *  2. Extensions → Apps Script
 *  3. Delete the placeholder code. Paste ALL of this in. Save.
 *  4. Deploy → New deployment → type: Web app
 *       Execute as:        Me
 *       Who has access:    Anyone
 *     (It only appends rows and serves data. It never deletes.)
 *  5. Copy the /exec URL it gives you.
 *  6. In Ledger → Sync tab → paste it into "Apps Script Web App URL" → Save.
 *
 * That's it. Sessions now write to both your phone and the Sheet.
 * If you clear your browser, restore from Sheets using the same URL.
 *
 * SETS COLUMN FORMAT
 * ───────────────────
 * Each set is written as "reps*weight" (e.g. a set of 8 reps at 45 lb is
 * "8*45"), and a whole exercise row's sets are comma-joined: "8*45,8*55,6*55".
 * A bodyweight set with no logged weight is written as just the rep count
 * ("8"). This keeps each set self-contained instead of splitting reps and
 * weights across two parallel columns you have to zip together by index —
 * much easier to read at a glance, and for Claude to parse directly.
 *
 * The column is forced to plain-text format (see FORCE_TEXT_COLUMNS below)
 * because Google Sheets will otherwise silently reinterpret a value like
 * "100,100,100,100" as the NUMBER 100100100100 (it matches the thousands-
 * separator pattern) and corrupt the data. Don't remove that formatting call.
 *
 * MIGRATING AN EXISTING SHEET
 * ────────────────────────────
 * If your Sessions sheet still has the old separate weight/reps columns,
 * run migrateSessionsSheetFormat_ once from the Apps Script editor (select
 * it in the function dropdown, click Run). It duplicates the sheet as a
 * timestamped backup tab first, then rewrites the original in place — it
 * never deletes anything, so the old data is always recoverable from the
 * backup tab if something looks wrong.
 *
 * WEIGHTS TAB
 * ───────────
 * A separate "Weights" tab holds one row per exercise code — the current
 * target weight, reps, and sets the app's Coach chat can propose changes
 * to, and the app loads on every session start. GET ?action=weights reads
 * it; POST {type:'weight', code, weight?, reps?, sets?} upserts a row by
 * code. Each of weight/reps/sets is independently optional on the POST —
 * whichever fields are omitted keep their existing value in the sheet
 * rather than being blanked out (the "weight" type name predates reps/sets
 * support and was kept as-is rather than renamed, to avoid churning every
 * caller for a wire-protocol rename with no behavior change).
 */

const HEADERS = [
  'date', 'session', 'gym', 'exercise', 'sets', 'set_count', 'total_reps', 'volume', 'notes'
];
const SETS_COL = HEADERS.indexOf('sets') + 1; // 1-indexed, for range formatting

function doGet(e) {
  try {
    const action = e.parameter.action || 'export';

    if (action === 'migrate') {
      migrateSessionsSheetFormat_();
      return ContentService.createTextOutput('migration attempted — check the Sessions sheet and look for a new Sessions_backup_* tab');
    }

    if (action === 'export') {
      const sh = ensureSheet_();
      const bs = ensureBodySheet_();

      const sessRows = dropHeaderRowIfPresent_(sh.getDataRange().getValues());
      const bodyRows = bs.getDataRange().getValues().slice(1);

      const sessions = parseSessionRows_(sessRows);
      const body = parseBodyRows_(bodyRows);

      const data = { sessions, body, lastSync: null };
      return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'weights') {
      const ws = ensureWeightsSheet_();
      const rows = ws.getDataRange().getValues().slice(1);
      const weights = rows
        .filter(function (row) { return row[0]; })
        .map(function (row) {
          return {
            code: String(row[0]),
            weight: row[1] === '' || row[1] === null ? null : Number(row[1]),
            reps: row[2] === '' || row[2] === null ? null : Number(row[2]),
            sets: row[3] === '' || row[3] === null ? null : Number(row[3]),
          };
        });
      return ContentService.createTextOutput(JSON.stringify({ weights: weights }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err.message);
  }
}

function doPost(e) {
  try {
    const sh = ensureSheet_();
    const body = JSON.parse(e.postData.contents);

    if (body.type === 'session') {
      const rows = body.ex.map((x, idx) => {
        const totalReps = x.r.reduce((a, b) => a + b, 0);
        const weights = x.ws || Array(x.r.length).fill(x.w);
        const volume = x.r.reduce((sum, r, i) => sum + r * (weights[i] || 0), 0);
        return [
          body.d,
          body.s,
          body.g || '',
          x.k,
          formatSets_(x.r, weights),
          x.r.length,
          totalReps,
          Math.round(volume),
          idx === 0 ? (body.n || '') : ''  // Only write notes on first exercise row
        ];
      });
      if (rows.length) {
        const startRow = sh.getLastRow() + 1;
        sh.getRange(startRow, 1, rows.length, HEADERS.length).setValues(rows);
        forceTextFormat_(sh, startRow, rows.length);
      }
    }

    if (body.type === 'body') {
      const bs = ensureBodySheet_();
      bs.appendRow([
        body.d, body.wt, body.bf, body.smm || '', body.waist || '', body.fer || ''
      ]);
    }

    if (body.type === 'weight') {
      const ws = ensureWeightsSheet_();
      const rows = ws.getDataRange().getValues();
      let rowIndex = -1; // 0-indexed into `rows`; -1 means "not found, append"
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(body.code)) { rowIndex = i; break; }
      }
      const existing = rowIndex >= 0 ? rows[rowIndex] : null;
      // Each of weight/reps/sets is independently optional — a field the
      // caller omitted keeps whatever was already in that column rather
      // than getting blanked out, since e.g. accepting a reps-only
      // suggestion shouldn't erase a previously-set weight target.
      const weight = (body.weight !== undefined && body.weight !== null) ? body.weight : (existing ? existing[1] : '');
      const reps = (body.reps !== undefined && body.reps !== null) ? body.reps : (existing ? existing[2] : '');
      const sets = (body.sets !== undefined && body.sets !== null) ? body.sets : (existing ? existing[3] : '');
      const now = new Date().toISOString();
      if (rowIndex >= 0) {
        ws.getRange(rowIndex + 1, 1, 1, 5).setValues([[body.code, weight, reps, sets, now]]);
      } else {
        ws.appendRow([body.code, weight, reps, sets, now]);
      }
    }

    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err.message);
  }
}

// One set → "reps*weight", or just "reps" when there's no weight to log
// (bodyweight movements). weight === null/undefined means "not logged".
function formatSets_(reps, weights) {
  return reps.map((r, i) => {
    const w = weights[i];
    return (w === null || w === undefined || w === '') ? String(r) : (r + '*' + w);
  }).join(',');
}

// Inverse of formatSets_. Returns {r: number[], ws: number[]|undefined} —
// ws is only set if at least one set in the row actually had a weight logged.
function parseSets_(setsStr) {
  if (!setsStr) return { r: [], ws: undefined };
  const parts = String(setsStr).split(',').map(function (p) { return p.trim(); }).filter(Boolean);
  const r = [];
  const ws = [];
  let hasWeight = false;
  parts.forEach(function (p) {
    const star = p.indexOf('*');
    if (star >= 0) {
      r.push(Number(p.slice(0, star)));
      ws.push(Number(p.slice(star + 1)));
      hasWeight = true;
    } else {
      r.push(Number(p));
      ws.push(null);
    }
  });
  return { r: r, ws: hasWeight ? ws : undefined };
}

// Reverses the exact corruption Sheets applies to a value like
// "100,100,100,100": it strips the commas and reads it as one number,
// 100100100100. Splitting that number's digits back into 3-digit groups
// from the left recovers the original values — but only trust the result
// if it cleanly divides into exactly the number of sets we expected.
function recoverCorruptedWeight_(value, expectedCount) {
  const digits = String(Math.trunc(Math.abs(value)));
  if (digits.length % 3 !== 0) return null;
  const groups = [];
  for (let i = 0; i < digits.length; i += 3) {
    groups.push(Number(digits.slice(i, i + 3)));
  }
  return groups.length === expectedCount ? groups : null;
}

// Google Sheets auto-detects a string like "100,100,100,100" as the number
// 100100100100 (it matches the thousands-separator pattern) unless the cell
// is explicitly plain-text formatted. Call this after every write to the
// sets column so that never silently corrupts data again.
function forceTextFormat_(sh, startRow, numRows) {
  sh.getRange(startRow, SETS_COL, numRows, 1).setNumberFormat('@');
}

// Only drop row 1 if it's actually the header row (literal label strings).
// A blind .slice(1) is what silently ate real session data on this sheet
// before: the "Sessions" tab existed but had no header written yet, so the
// very first session landed in row 1 and every export since then quietly
// discarded it assuming it was labels.
function dropHeaderRowIfPresent_(rows) {
  if (rows.length && rows[0][0] === 'date' && rows[0][1] === 'session') {
    return rows.slice(1);
  }
  return rows;
}

function parseSessionRows_(rows) {
  const sessions = {};
  const sessionNotes = {};

  rows.forEach(function (row) {
    const date = row[0], session = row[1], gym = row[2], exercise = row[3],
          sets = row[4], notes = row[8];
    if (!date || !session) return;

    const dateStr = normalizeDateString_(date);
    if (!dateStr) return;

    const key = dateStr + '|' + session;

    if (!sessions[key] && notes) {
      sessionNotes[key] = notes;
    }

    if (!sessions[key]) {
      sessions[key] = {
        d: dateStr,
        s: session,
        g: gym || '',
        ex: [],
        n: sessionNotes[key] || ''
      };
    }

    if (exercise) {
      const parsed = parseSets_(sets);
      const exObj = { k: String(exercise).trim(), r: parsed.r };
      if (parsed.ws) {
        exObj.ws = parsed.ws;
      } else {
        exObj.w = null;
      }
      sessions[key].ex.push(exObj);
    }
  });

  Object.keys(sessions).forEach(function (key) {
    if (!sessions[key].n && sessionNotes[key]) {
      sessions[key].n = sessionNotes[key];
    }
  });

  return Object.values(sessions);
}

function normalizeDateString_(val) {
  if (!val) return null;

  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return val;
  }

  try {
    const d = new Date(val);
    if (isNaN(d)) return null;
    return d.toISOString().split('T')[0];
  } catch (e) {
    return null;
  }
}

function parseBodyRows_(rows) {
  return rows.map(function (row) {
    const date = row[0], weight = row[1], bf = row[2], muscle = row[3], waist = row[4], ferritin = row[5];
    if (!date) return null;

    const dateStr = normalizeDateString_(date);
    if (!dateStr) return null;

    return {
      d: dateStr,
      wt: weight ? Number(weight) : null,
      bf: bf ? Number(bf) : null,
      smm: muscle ? Number(muscle) : null,
      waist: waist ? Number(waist) : null,
      fer: ferritin ? Number(ferritin) : null
    };
  }).filter(function (x) { return x; });
}

function ensureSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Sessions');
  if (!sh) {
    sh = ss.insertSheet('Sessions');
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#14181D')
      .setFontColor('#FFB020');
    sh.setFrozenRows(1);
  }
  return sh;
}

function ensureBodySheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Body');
  if (!sh) {
    sh = ss.insertSheet('Body');
    sh.appendRow(['date', 'weight_lb', 'body_fat_pct', 'muscle_lb', 'waist_in', 'ferritin']);
    sh.getRange(1, 1, 1, 6)
      .setFontWeight('bold')
      .setBackground('#14181D')
      .setFontColor('#8B7CF6');
    sh.setFrozenRows(1);
  }
  return sh;
}

// One row per exercise code — writes upsert by code (see doPost's
// type==='weight' handler), so this holds current targets, not a full
// history. Reads back via doGet's action==='weights', which is the shape
// configStore.ts's loadWeights() has expected on the client since before
// this sheet existed (it was silently failing until now).
function ensureWeightsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Weights');
  if (!sh) {
    sh = ss.insertSheet('Weights');
    sh.appendRow(['code', 'weight', 'reps', 'sets', 'updated_at']);
    sh.getRange(1, 1, 1, 5)
      .setFontWeight('bold')
      .setBackground('#14181D')
      .setFontColor('#00C2A8');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < 5) {
    // Pre-existing sheet from before reps/sets targets were added — insert
    // the new columns before 'updated_at' rather than appending after it,
    // so column order stays (code, weight, reps, sets, updated_at) and
    // existing rows' weight values aren't touched.
    sh.insertColumnsAfter(2, 2);
    sh.getRange(1, 3, 1, 2).setValues([['reps', 'sets']]);
    sh.getRange(1, 1, 1, 5)
      .setFontWeight('bold')
      .setBackground('#14181D')
      .setFontColor('#00C2A8');
  }
  return sh;
}

/**
 * ONE-TIME MIGRATION — run manually from the Apps Script editor.
 * Old layout: date, session, gym, exercise, weight, reps, sets(count),
 *             total_reps, volume, notes
 * New layout: date, session, gym, exercise, sets(reps*weight list),
 *             set_count, total_reps, volume, notes
 *
 * Backs up the current sheet as "Sessions_backup_<timestamp>" first, then
 * rewrites "Sessions" in place. Safe to re-run: if the header row already
 * matches the new format, it does nothing.
 */
function migrateSessionsSheetFormat_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Sessions');
  if (!sh) {
    Logger.log('No Sessions sheet found — nothing to migrate.');
    return;
  }

  const data = sh.getDataRange().getValues();
  if (!data.length) {
    Logger.log('Sessions sheet is empty — nothing to migrate.');
    return;
  }
  if (JSON.stringify(data[0]) === JSON.stringify(HEADERS)) {
    Logger.log('Sessions sheet is already in the new format. Nothing to do.');
    return;
  }

  // Some sheets never got a real header row: if the "Sessions" tab already
  // existed (but empty) before the very first session was logged,
  // ensureSheet_ never ran its header-bootstrap branch, and doPost wrote
  // that first session straight into row 1 — permanently burying the
  // header and, worse, causing doGet to silently drop that entire row
  // every time it exports (it unconditionally slices off "row 1" assuming
  // it's a header). Detect that case and treat row 1 as real data instead
  // of discarding it.
  const hasRealHeaderRow = data[0][0] === 'date' && data[0][1] === 'session';
  const oldRows = hasRealHeaderRow ? data.slice(1) : data;
  if (!hasRealHeaderRow) {
    Logger.log('No header row found — row 1 looks like real session data, not labels. ' +
      'Treating all ' + oldRows.length + ' rows (including row 1) as data to migrate. ' +
      'This also recovers whatever was silently dropped from every export until now.');
  }

  // Back up first. Never touch the original data before this succeeds.
  const backupName = 'Sessions_backup_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  sh.copyTo(ss).setName(backupName);
  Logger.log('Backed up current sheet as "' + backupName + '"');
  const newRows = oldRows.map(function (row) {
    const date = row[0], session = row[1], gym = row[2], exercise = row[3],
          weight = row[4], reps = row[5], notes = row[9];
    if (!date && !session) return null; // skip fully blank rows

    const repsArray = reps
      ? String(reps).split(',').map(function (r) {
          const n = Number(String(r).trim());
          return isNaN(n) ? 0 : n;
        })
      : [];

    let weightsArray = String(weight || '')
      ? String(weight).split(',').map(function (w) {
          const n = Number(String(w).trim());
          return isNaN(n) ? null : n;
        })
      : [];
    if (weightsArray.length > 0 && weightsArray.length < repsArray.length) {
      const first = weightsArray.filter(function (w) { return w !== null; })[0];
      if (first !== undefined) {
        // The exact corruption this migration exists to fix: Sheets sometimes
        // silently turns "100,100,100,100" into the number 100100100100 (it
        // matches the thousands-separator pattern). If the single leftover
        // value is implausibly large for a real weight, try reversing that
        // exact transform — split its digits back into 3-digit groups —
        // before falling back to just broadcasting it to every set.
        let recovered = null;
        if (weightsArray.length === 1 && Math.abs(first) > 999) {
          recovered = recoverCorruptedWeight_(first, repsArray.length);
        }
        weightsArray = recovered || Array(repsArray.length).fill(first);
      }
    }

    const setsStr = formatSets_(repsArray, weightsArray);
    const totalReps = repsArray.reduce(function (a, b) { return a + b; }, 0);
    const volume = repsArray.reduce(function (sum, r, i) {
      return sum + r * (weightsArray[i] || 0);
    }, 0);

    return [date, session, gym, exercise, setsStr, repsArray.length, totalReps, Math.round(volume), notes || ''];
  }).filter(function (r) { return r; });

  sh.clearContents();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sh.getRange(1, 1, 1, HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#14181D')
    .setFontColor('#FFB020');
  sh.setFrozenRows(1);

  if (newRows.length) {
    sh.getRange(2, 1, newRows.length, HEADERS.length).setValues(newRows);
    forceTextFormat_(sh, 2, newRows.length);
  }

  Logger.log('Migrated ' + newRows.length + ' rows to the new format. Backup: "' + backupName + '"');
}
