// Google Apps Script — paste this entire file into your Apps Script editor.
// It turns your Google Sheet into a simple REST endpoint for the workout app.
// Deploy as a Web App (Execute as: Me, Who has access: Anyone) to get the URL.

const SHEETS = {
  STATE:     'app_state',
  SESSIONS:  'sessions',
  WEIGHTS:   'weights',
  NUTRITION: 'nutrition',
  LOGS:      'exercise_logs'
};

function sheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

// ─── GET — fetch all data ────────────────────────────────────────────────────
function doGet(e) {
  try {
    const stateVal = sheet(SHEETS.STATE).getRange(1, 1).getValue();
    let appState = null;
    try { if (stateVal) appState = JSON.parse(stateVal); } catch(_) {}

    const sessions = sheet(SHEETS.SESSIONS).getDataRange().getValues()
      .filter(r => r[0]).map(r => { try { return JSON.parse(r[0]); } catch(_) { return null; } }).filter(Boolean);

    const weights = sheet(SHEETS.WEIGHTS).getDataRange().getValues()
      .filter(r => r[0] && r[1]).map(r => ({ recorded_on: r[0], kg: Number(r[1]) }));

    const nutrition = sheet(SHEETS.NUTRITION).getDataRange().getValues()
      .filter(r => r[0] && r[1]).map(r => ({ recorded_on: r[0], rating: r[1], note: r[2] || '' }));

    const logs = sheet(SHEETS.LOGS).getDataRange().getValues()
      .filter(r => r[0]).map(r => ({ exercise_id: r[0], reps: r[1], weight: Number(r[2]), logged_at: r[3] }));

    return out({ appState, sessions, weights, nutrition, logs });
  } catch(err) {
    return out({ error: err.message });
  }
}

// ─── POST — write data ───────────────────────────────────────────────────────
function doPost(e) {
  try {
    const { action, payload } = JSON.parse(e.postData.contents);

    if (action === 'upsertAppState') {
      sheet(SHEETS.STATE).getRange(1, 1).setValue(JSON.stringify(payload));
    }

    else if (action === 'insertSession') {
      sheet(SHEETS.SESSIONS).appendRow([JSON.stringify(payload)]);
    }

    else if (action === 'upsertWeight') {
      const sh = sheet(SHEETS.WEIGHTS);
      const rows = sh.getDataRange().getValues();
      const idx = rows.findIndex(r => r[0] === payload.recorded_on);
      if (idx >= 0) sh.getRange(idx + 1, 2).setValue(payload.kg);
      else sh.appendRow([payload.recorded_on, payload.kg]);
    }

    else if (action === 'upsertNutrition') {
      const sh = sheet(SHEETS.NUTRITION);
      const rows = sh.getDataRange().getValues();
      const idx = rows.findIndex(r => r[0] === payload.recorded_on);
      if (idx >= 0) sh.getRange(idx + 1, 2, 1, 2).setValues([[payload.rating, payload.note || '']]);
      else sh.appendRow([payload.recorded_on, payload.rating, payload.note || '']);
    }

    else if (action === 'insertLog') {
      sheet(SHEETS.LOGS).appendRow([payload.exercise_id, payload.reps, payload.weight, payload.logged_at]);
    }

    return out({ ok: true });
  } catch(err) {
    return out({ error: err.message });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
