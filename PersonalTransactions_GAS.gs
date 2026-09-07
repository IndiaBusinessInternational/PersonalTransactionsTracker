// TSM Personal Transactions Tracker — GAS Backend v6.4  (same version number as the web app)
// Sheet ID: 1NAGUMsMjvsAGrTa_o0jt1NTD2uJOZPCSw3Qqbg68pVw
// All requests via GET (URL params) — avoids CORS/redirect issues
// Deploy → Web App → Execute as Me → Access: Anyone
//
// ⚠ UPDATING FROM v3.1
// After pasting this file: Deploy → Manage deployments → ✏ edit → Version:
// NEW VERSION → Deploy. Use "New version", NOT "New deployment" — a new
// deployment issues a different /exec URL, and this app has that URL compiled
// into its page, so it would stop talking to the Sheet until the page is
// rebuilt and redeployed too.
//
// What v4.0 adds, and why it needs new storage:
//   • Commitments — the standing list: savings schemes, recurring deposits,
//     loans and EMIs, insurance, term fees, monthly bills. Each one carries
//     its own instalment counter (2 of 60), its running total paid, and for a
//     loan its outstanding balance.
//   • Plans — the month planned ahead of time: one row per item per month,
//     proposed against actual, so a month can be budgeted before it is spent
//     and reported against afterwards.
//   • PaidBy / Mode on a transaction — who settled it and how. Both were
//     being written into the free-text note, where nothing could total them.
// The two sheets and the two columns are created automatically the first time
// this version runs. Columns are only ever APPENDED, so every existing column
// stays exactly where it is and any formula or filter set up by hand in the
// Sheet keeps pointing at the same thing.

const SHEET_NAME = "Transactions";
const HEADERS    = ["ID","Date","Type","Description","Party","Amount","Note","CreatedAt",
                    "PaidBy","Mode"];

const COMMIT_SHEET = "Commitments";
const COMMIT_HDRS  = ["ID","Name","Kind","Category","Party","Amount","DueDay","Freq",
                      "StartMonth","TotalInst","OpeningInst","OpeningPaid","Principal",
                      "Outstanding","Unit","UnitPerInst","OpeningUnits","PayMode",
                      "Active","Note","CreatedAt"];

const PLAN_SHEET = "Plans";
const PLAN_HDRS  = ["ID","Month","Side","CommitmentId","Item","Category","Party",
                    "Proposed","Actual","DueDate","PaidDate","Status","PayMode",
                    "PaidBy","TxId","Note","Sort","CreatedAt"];

const APP_VERSION = "6.4";   // kept in step with the web app's badge (7 Sep 2026)
// Lets a page newer than this deployment detect what it can do, and say
// "update your Apps Script" instead of failing oddly at Save.
const FEATURES    = ["plans", "commitments", "paidby"];

/* ── SHEET PLUMBING ─────────────────────────────────────────────────────────
   One helper builds every data sheet, so a sheet added in a later version
   gets the same frozen, styled header row and — the part that matters on an
   upgrade — the same "append any header this version added" migration. */
function getNamedSheet(name, headers, widths) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    styleHeader_(sh, headers.length);
    if (widths) widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    return sh;
  }
  const have = sh.getLastColumn();
  if (have < headers.length) {
    sh.getRange(1, have + 1, 1, headers.length - have).setValues([headers.slice(have)]);
    styleHeader_(sh, headers.length);
  }
  return sh;
}

function styleHeader_(sh, n) {
  sh.getRange(1, 1, 1, n)
    .setFontWeight("bold")
    .setBackground("#000000")
    .setFontColor("#00c5ff");
}

function getSheet() {
  return getNamedSheet(SHEET_NAME, HEADERS, [130, 100, 80, 240, 170, 100, 210, 150, 110, 100]);
}

function sheetTZ_() {
  try { return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'Asia/Kolkata'; }
  catch (e) { return 'Asia/Kolkata'; }
}

function stamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
}

/* A date cell can come back as a Date object (Sheets parsed it) or as the
   plain 'yyyy-MM-dd' text we wrote. Formatting a Date in a timezone that is
   not the Sheet's own shifts it by a day, so always format in the Sheet's
   timezone; ISO text is unambiguous everywhere and passes straight through. */
function toISO_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

/* A month cell is 'yyyy-MM'. Sheets loves to read that as a date and hand back
   a Date, which would come out as '2026-08-01' and stop matching the month key
   the app wrote. */
function toMonth_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM');
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})/);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) : s;
}

function num_(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function str_(v) { return v == null ? '' : String(v); }
function bool_(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return !(s === 'false' || s === 'no' || s === '0' || s === '');
}

/* ── ROUTER ─────────────────────────────────────────────────────────────── */
function doGet(e) {
  const p      = e.parameter || {};
  const action = p.action || '';
  let result;

  try {
    switch (action) {
      case 'ping':
        result = { status:'ok', message:'PTT GAS v' + APP_VERSION + ' is live!',
                   version: APP_VERSION, features: FEATURES };
        break;
      case 'getAll':           result = getAllData();                              break;
      case 'add':              result = addTransaction(p);                         break;
      case 'update':           result = updateTransaction(p);                      break;
      case 'delete':           result = deleteRowById(SHEET_NAME, HEADERS, p.id);  break;

      case 'saveCommitment':   result = saveCommitment(p);                                 break;
      case 'deleteCommitment': result = deleteRowById(COMMIT_SHEET, COMMIT_HDRS, p.id);    break;

      case 'savePlan':         result = savePlan(p);                                       break;
      case 'savePlans':        result = savePlans(p);                                      break;
      case 'deletePlan':       result = deleteRowById(PLAN_SHEET, PLAN_HDRS, p.id);        break;

      default:
        result = { status:'error', message:'Unknown action: ' + action };
    }
  } catch(err) {
    result = { status:'error', message: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// Keep doPost as fallback (same handler)
function doPost(e) { return doGet(e); }

/* ── READ EVERYTHING ────────────────────────────────────────────────────────
   One call returns the ledger, the standing commitments and every planned
   month. Three separate round trips would each pay the Apps Script cold-start
   cost, and on a phone that is the whole of the wait. */
function getAllData() {
  const tz = sheetTZ_();
  return {
    status: 'ok',
    transactions: readTransactions_(tz),
    commitments:  readCommitments_(tz),
    plans:        readPlans_(tz),
    version:      APP_VERSION,
    features:     FEATURES
  };
}

function readTransactions_(tz) {
  const sh   = getSheet();
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return [];

  return data.slice(1)
    .filter(function (r) { return String(r[0] || '').trim() !== ''; })   // ignore blank rows
    .map(function (r) {
      return {
        id:          String(r[0]),
        date:        toISO_(r[1], tz),
        type:        r[2],
        description: r[3],
        party:       r[4],
        amount:      num_(r[5]),
        note:        r[6] || '',
        createdAt:   r[7] || '',
        paidBy:      str_(r[8]),
        mode:        str_(r[9])
      };
    });
}

function readCommitments_(tz) {
  const sh = getNamedSheet(COMMIT_SHEET, COMMIT_HDRS,
    [130,220,100,160,150,100,70,100,100,90,100,110,110,110,80,100,100,100,70,220,150]);
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return [];
  return data.slice(1)
    .filter(function (r) { return String(r[0] || '').trim() !== ''; })
    .map(function (r) {
      return {
        id:           String(r[0]),
        name:         str_(r[1]),
        kind:         str_(r[2]) || 'bill',
        category:     str_(r[3]),
        party:        str_(r[4]),
        amount:       num_(r[5]),
        dueDay:       num_(r[6]),
        freq:         str_(r[7]) || 'monthly',
        startMonth:   toMonth_(r[8], tz),
        totalInst:    num_(r[9]),
        openingInst:  num_(r[10]),
        openingPaid:  num_(r[11]),
        principal:    num_(r[12]),
        outstanding:  num_(r[13]),
        unit:         str_(r[14]),
        unitPerInst:  num_(r[15]),
        openingUnits: num_(r[16]),
        payMode:      str_(r[17]),
        active:       bool_(r[18]),
        note:         str_(r[19]),
        createdAt:    str_(r[20])
      };
    });
}

function readPlans_(tz) {
  const sh = getNamedSheet(PLAN_SHEET, PLAN_HDRS,
    [130,90,70,130,220,160,150,100,100,110,110,90,100,110,130,220,70,150]);
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return [];
  return data.slice(1)
    .filter(function (r) { return String(r[0] || '').trim() !== ''; })
    .map(function (r) {
      return {
        id:           String(r[0]),
        month:        toMonth_(r[1], tz),
        side:         str_(r[2]) || 'out',
        commitmentId: str_(r[3]),
        item:         str_(r[4]),
        category:     str_(r[5]),
        party:        str_(r[6]),
        proposed:     num_(r[7]),
        actual:       num_(r[8]),
        dueDate:      toISO_(r[9], tz),
        paidDate:     toISO_(r[10], tz),
        status:       str_(r[11]) || 'planned',
        payMode:      str_(r[12]),
        paidBy:       str_(r[13]),
        txId:         str_(r[14]),
        note:         str_(r[15]),
        sort:         num_(r[16]),
        createdAt:    str_(r[17])
      };
    });
}

/* ── TRANSACTIONS ───────────────────────────────────────────────────────── */

function addTransaction(p) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return { status:'error', message:'Busy — please try again in a moment.' };
  }
  try {
    const sh = getSheet();
    const id = 'TX' + Date.now();

    sh.appendRow([
      id,
      p.date   || '',
      p.type   || 'income',
      p.description || '',
      p.party  || '',
      num_(p.amount),
      p.note   || '',
      stamp_(),
      p.paidBy || '',
      p.mode   || ''
    ]);
    SpreadsheetApp.flush();
    return { status:'ok', id: id, message:'Added successfully.' };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function updateTransaction(p) {
  if (!p.id) return { status:'error', message:'No ID provided.' };

  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return { status:'error', message:'Busy — please try again in a moment.' };
  }
  try {
    const sh   = getSheet();
    const rows = sh.getDataRange().getValues();

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(p.id)) {
        // Two ranges rather than one: column 8 is CreatedAt, which records when
        // the row was first written and must survive every later edit. One
        // setValues per range — six single-cell writes were six round trips.
        sh.getRange(i + 1, 2, 1, 6).setValues([[
          p.date        || '',
          p.type        || 'income',
          p.description || '',
          p.party       || '',
          num_(p.amount),
          p.note        || ''
        ]]);
        sh.getRange(i + 1, 9, 1, 2).setValues([[p.paidBy || '', p.mode || '']]);
        SpreadsheetApp.flush();
        return { status:'ok', message:'Updated: ' + p.id };
      }
    }
    return { status:'error', message:'ID not found: ' + p.id };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* One deleter for every sheet. Row order carries no meaning in any of them —
   each row is found by its ID — so a plain deleteRow is safe throughout. */
function deleteRowById(name, headers, id) {
  if (!id) return { status:'error', message:'No ID provided.' };
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return { status:'error', message:'Busy — please try again in a moment.' };
  }
  try {
    const sh   = getNamedSheet(name, headers);
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(id)) {
        sh.deleteRow(i + 1);
        SpreadsheetApp.flush();
        return { status:'ok', message:'Deleted: ' + id };
      }
    }
    return { status:'error', message:'ID not found: ' + id };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* ── COMMITMENTS ────────────────────────────────────────────────────────────
   A commitment is the standing thing — "HDFC RD, ₹5,000 on the 20th, 60
   instalments, 2 already done". The month-by-month record of actually paying
   it lives in Plans; nothing here is rewritten when a payment is made, so the
   instalment count and the running total are always derived from the plan
   rows rather than being a second copy that can drift out of step. */
function commitmentRow_(id, p, createdAt) {
  return [
    id,
    str_(p.name).slice(0, 160),
    str_(p.kind) || 'bill',
    str_(p.category).slice(0, 80),
    str_(p.party).slice(0, 120),
    num_(p.amount),
    num_(p.dueDay),
    str_(p.freq) || 'monthly',
    str_(p.startMonth),
    num_(p.totalInst),
    num_(p.openingInst),
    num_(p.openingPaid),
    num_(p.principal),
    num_(p.outstanding),
    str_(p.unit).slice(0, 20),
    num_(p.unitPerInst),
    num_(p.openingUnits),
    str_(p.payMode).slice(0, 30),
    bool_(p.active) ? 'TRUE' : 'FALSE',
    str_(p.note).slice(0, 400),
    createdAt
  ];
}

function saveCommitment(p) {
  if (!String(p.name || '').trim()) {
    return { status:'error', message:'A commitment needs a name.' };
  }
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return { status:'error', message:'Busy — please try again in a moment.' };
  }
  try {
    const sh   = getNamedSheet(COMMIT_SHEET, COMMIT_HDRS);
    const rows = sh.getDataRange().getValues();
    if (p.id) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(p.id)) {
          const created = rows[i][COMMIT_HDRS.length - 1] || stamp_();
          sh.getRange(i + 1, 1, 1, COMMIT_HDRS.length)
            .setValues([commitmentRow_(String(p.id), p, created)]);
          SpreadsheetApp.flush();
          return { status:'ok', id:String(p.id), message:'Commitment updated.' };
        }
      }
      return { status:'error', message:'Commitment not found: ' + p.id };
    }
    const id = 'CM' + Date.now();
    sh.appendRow(commitmentRow_(id, p, stamp_()));
    SpreadsheetApp.flush();
    return { status:'ok', id:id, message:'Commitment saved.' };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* ── PLAN ROWS ──────────────────────────────────────────────────────────────
   One row per item per month: what was proposed, what was actually paid, and
   when. This is the month planned on paper, kept as data. */
function planRow_(id, p, createdAt) {
  return [
    id,
    str_(p.month),
    str_(p.side) || 'out',
    str_(p.commitmentId),
    str_(p.item).slice(0, 160),
    str_(p.category).slice(0, 80),
    str_(p.party).slice(0, 120),
    num_(p.proposed),
    num_(p.actual),
    str_(p.dueDate),
    str_(p.paidDate),
    str_(p.status) || 'planned',
    str_(p.payMode).slice(0, 30),
    str_(p.paidBy).slice(0, 80),
    str_(p.txId),
    str_(p.note).slice(0, 400),
    num_(p.sort),
    createdAt
  ];
}

function savePlan(p) {
  if (!String(p.month || '').trim()) return { status:'error', message:'A plan row needs a month.' };
  if (!String(p.item  || '').trim()) return { status:'error', message:'A plan row needs an item name.' };

  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return { status:'error', message:'Busy — please try again in a moment.' };
  }
  try {
    const sh   = getNamedSheet(PLAN_SHEET, PLAN_HDRS);
    const rows = sh.getDataRange().getValues();
    if (p.id) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(p.id)) {
          const created = rows[i][PLAN_HDRS.length - 1] || stamp_();
          sh.getRange(i + 1, 1, 1, PLAN_HDRS.length)
            .setValues([planRow_(String(p.id), p, created)]);
          SpreadsheetApp.flush();
          return { status:'ok', id:String(p.id), message:'Plan updated.' };
        }
      }
      return { status:'error', message:'Plan row not found: ' + p.id };
    }
    const id = 'PL' + Date.now();
    sh.appendRow(planRow_(id, p, stamp_()));
    SpreadsheetApp.flush();
    return { status:'ok', id:id, message:'Plan row saved.' };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* Building a month writes twenty-odd rows at once. Sent one at a time that is
   twenty round trips against a quota shared with every other script on the
   account; here it is one call and one setValues. */
function savePlans(p) {
  let list;
  try { list = JSON.parse(String(p.rows || '[]')); }
  catch (e) { return { status:'error', message:'Plan rows were not valid JSON.' }; }
  if (!list || !list.length) return { status:'ok', ids:[], message:'Nothing to add.' };
  if (list.length > 120) return { status:'error', message:'Too many rows in one go.' };

  const lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (e) {
    return { status:'error', message:'Busy — please try again in a moment.' };
  }
  try {
    const sh = getNamedSheet(PLAN_SHEET, PLAN_HDRS);
    const now = stamp_(), base = Date.now(), ids = [];
    const values = list.map(function (row, i) {
      const id = 'PL' + (base + i);        // +i so a batch cannot collide with itself
      ids.push(id);
      return planRow_(id, row, now);
    });
    sh.getRange(sh.getLastRow() + 1, 1, values.length, PLAN_HDRS.length).setValues(values);
    SpreadsheetApp.flush();
    return { status:'ok', ids:ids, message: values.length + ' rows added.' };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* Run by hand from the editor to see what this deployment is holding. */
function checkSetup() {
  Logger.log('Backend      : v' + APP_VERSION);
  Logger.log('Transactions : ' + Math.max(0, getSheet().getLastRow() - 1));
  Logger.log('Commitments  : ' + Math.max(0, getNamedSheet(COMMIT_SHEET, COMMIT_HDRS).getLastRow() - 1));
  Logger.log('Plan rows    : ' + Math.max(0, getNamedSheet(PLAN_SHEET, PLAN_HDRS).getLastRow() - 1));
}
