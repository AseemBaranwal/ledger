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
      const rows = body.ex.map(x => {
        const totalReps = x.r.reduce((a, b) => a + b, 0);
        return [
          body.d,
          body.s,
          body.g || '',
          x.k,
          x.w,
          x.r.join(','),
          x.r.length,
          totalReps,
          Math.round(totalReps * (x.w || 1)),
          body.n || ''
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
  const currentSession = null;

  rows.forEach(row => {
    const [date, session, gym, exercise, weight, reps, sets, totalReps, volume, notes] = row;
    if (!date) return;

    const key = date + session;
    if (!sessions[key]) {
      sessions[key] = {
        d: date,
        s: session,
        g: gym || '',
        ex: [],
        n: notes || ''
      };
    }

    if (exercise) {
      sessions[key].ex.push({
        k: exercise,
        w: weight,
        r: reps ? reps.split(',').map(Number) : []
      });
    }
  });

  return Object.values(sessions);
}

function parseBodyRows_(rows) {
  return rows.map(row => {
    const [date, weight, bf, muscle, waist, ferritin] = row;
    if (!date) return null;
    return {
      d: date,
      wt: weight,
      bf: bf,
      smm: muscle || null,
      waist: waist || null,
      fer: ferritin || null
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
