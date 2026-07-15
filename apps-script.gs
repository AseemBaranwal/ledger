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
 */

const HEADERS = [
  'date', 'session', 'gym', 'exercise', 'weight', 'reps', 'sets', 'total_reps', 'volume', 'notes'
];

function doGet(e) {
  try {
    const action = e.parameter.action || 'export';

    if (action === 'export') {
      const sh = ensureSheet_();
      const bs = ensureBodySheet_();

      const sessRows = sh.getDataRange().getValues().slice(1);
      const bodyRows = bs.getDataRange().getValues().slice(1);

      const sessions = parseSessionRows_(sessRows);
      const body = parseBodyRows_(bodyRows);

      const data = { sessions, body, lastSync: null };
      return ContentService.createTextOutput(JSON.stringify(data))
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
        // Get weight for each set, fall back to single weight if using old format
        const weights = x.ws || Array(x.r.length).fill(x.w);
        const avgWeight = weights.length ? weights.reduce((a,b)=>a+b,0)/weights.length : x.w;
        return [
          body.d,
          body.s,
          body.g || '',
          x.k,
          weights.join(','),  // weights for each set
          x.r.join(','),       // reps for each set
          x.r.length,          // number of sets
          totalReps,
          Math.round(totalReps * avgWeight),
          idx === 0 ? (body.n || '') : ''  // Only write notes on first exercise row
        ];
      });
      if (rows.length) {
        sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
      }
    }

    if (body.type === 'body') {
      const bs = ensureBodySheet_();
      bs.appendRow([
        body.d, body.wt, body.bf, body.smm || '', body.waist || '', body.fer || ''
      ]);
    }

    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err.message);
  }
}

function parseSessionRows_(rows) {
  const sessions = {};
  const sessionNotes = {};

  rows.forEach((row, rowIdx) => {
    const [date, session, gym, exercise, weight, reps, sets, totalReps, volume, notes] = row;
    if (!date || !session) return;

    // Normalize date to ISO format
    const dateStr = normalizeDateString_(date);
    if (!dateStr) return;

    const key = dateStr + '|' + session;

    // Store notes only from first row of each session
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
      const repsArray = reps
        ? String(reps).split(',').map(r => {
            const n = Number(r.trim());
            return isNaN(n) ? 0 : n;
          })
        : [];

      const weightsStr = String(weight || '');
      const weightsArray = weightsStr
        ? weightsStr.split(',').map(w => {
            const n = Number(w.trim());
            return isNaN(n) ? null : n;
          })
        : [];

      const exObj = {
        k: String(exercise).trim(),
        r: repsArray
      };

      // If per-set weights exist, use ws. Otherwise fallback to single weight
      if (weightsArray.length > 0 && weightsArray.some(w => w !== null)) {
        exObj.ws = weightsArray;
      } else {
        exObj.w = weightsArray.length > 0 && weightsArray[0] !== null ? weightsArray[0] : null;
      }

      sessions[key].ex.push(exObj);
    }
  });

  // Ensure all sessions have their notes
  Object.keys(sessions).forEach(key => {
    if (!sessions[key].n && sessionNotes[key]) {
      sessions[key].n = sessionNotes[key];
    }
  });

  return Object.values(sessions);
}

function normalizeDateString_(val) {
  if (!val) return null;

  // If already ISO format, return as-is
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return val;
  }

  // Try to parse as Date object or string
  try {
    const d = new Date(val);
    if (isNaN(d)) return null;
    return d.toISOString().split('T')[0];
  } catch (e) {
    return null;
  }
}

function parseBodyRows_(rows) {
  return rows.map(row => {
    const [date, weight, bf, muscle, waist, ferritin] = row;
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
  }).filter(x => x);
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
