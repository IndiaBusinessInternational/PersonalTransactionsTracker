// TSM Finance Tracker — GAS Backend v6.21  (same version number as the web app)
// v6.18 (4 Oct 2026): SIGN-IN. Every write needs a signed-in token; anonymous reads get no rows.
//   Script Properties: TSM_PASSWORD_NEW (temporary, then run setStaffPassword),
//   TSM_PASSWORD_HASH + TSM_TOKEN_SECRET (written by the script), TSM_ENFORCE_AUTH,
//   optional TSM_USER. Check with checkAuthSetup(). Deploy as a NEW VERSION of the SAME deployment.
// Sheet ID: 1NAGUMsMjvsAGrTa_o0jt1NTD2uJOZPCSw3Qqbg68pVw
// All requests via GET (URL params) — avoids CORS/redirect issues
// Deploy → Web App → Execute as Me → Access: Anyone (the script itself checks the sign-in)
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
                    "PaidBy","Mode","Category"];   // Category appended, same append-only rule

const COMMIT_SHEET = "Commitments";
const COMMIT_HDRS  = ["ID","Name","Kind","Category","Party","Amount","DueDay","Freq",
                      "StartMonth","TotalInst","OpeningInst","OpeningPaid","Principal",
                      "Outstanding","Unit","UnitPerInst","OpeningUnits","PayMode",
                      "Active","Note","CreatedAt"];

const PLAN_SHEET = "Plans";
const PLAN_HDRS  = ["ID","Month","Side","CommitmentId","Item","Category","Party",
                    "Proposed","Actual","DueDate","PaidDate","Status","PayMode",
                    "PaidBy","TxId","Note","Sort","CreatedAt"];

const APP_VERSION = "6.21";   // kept in step with the web app's badge (7 Sep 2026)
// Lets a page newer than this deployment detect what it can do, and say
// "update your Apps Script" instead of failing oddly at Save.
const FEATURES    = ["plans", "commitments", "paidby", "category", "rid", "balances", "profile", "auth", "serviceKey"];   // category: Category column on Transactions

/* Per-app names for the shared SIGN-IN block below. */
const AUTH_PREFIX       = 'TSM';                // Script Property names: TSM_PASSWORD_HASH, …
const AUTH_USER_DEFAULT = 'TSM-Finance';        // the username typed at sign-in (TSM_USER overrides)
const AUTH_APP_LABEL    = 'TSM Finance Tracker';

/* ══ SIGN-IN — shared by the IBI and TSM finance scripts (IBI v5.18 / TSM v6.18) ══
   Until v5.17 / v6.17 anyone holding the /exec address could READ the whole
   ledger and ADD, CHANGE or DELETE rows — no password at all (found 1 Oct 2026,
   security audit 4 Oct 2026). This is the Mini Finance Tracker's model —
   action=login → a 30-day token, every other action checks it, a refusal says
   status:'auth' — hardened the way Order Processing v15.0 / Package Tracker
   v14.0 were:
     • the password is kept only as a salted, stretched hash
       (<PREFIX>_PASSWORD_HASH), written by setStaffPassword() from a temporary
       <PREFIX>_PASSWORD_NEW property that it deletes again;
     • tokens are HMAC-signed (no session list to grow), tied to the current
       password — change it and every device signs in again;
     • 10 wrong passwords in 15 minutes pause sign-in for everyone;
     • sign-in is accepted only as a POST, so a password never sits in a URL;
     • EVERY write needs a signed-in token. A service key (optional,
       <PREFIX>_SERVICE_KEY, 32+ characters) may READ the ledger (getAll) for a
       server-side reader such as Staff Supervision — it can never write.
   Reads: an anonymous read gets NO rows, whatever the flag says — a ledger has
   no safe subset. <PREFIX>_ENFORCE_AUTH = true only makes the refusal (and the
   ping) say less: off = the refusal still carries version/features and the
   ping reports which setup pieces are in place, to help the roll-out.
   Per-app names come from AUTH_PREFIX / AUTH_USER_DEFAULT / AUTH_APP_LABEL
   above this block; the block itself is byte-identical in both scripts. */
const AUTH_TTL_MS          = 30 * 24 * 60 * 60 * 1000;   // signed in for 30 days
const AUTH_PW_ROUNDS       = 1000;
const AUTH_FAIL_LIMIT      = 10;                         // wrong passwords per window, then a pause
const AUTH_FAIL_WINDOW_SEC = 15 * 60;
const AUTH_OPEN_ACTIONS    = ['ping', 'login', 'logout'];
const AUTH_SERVICE_ACTIONS = ['getAll'];                 // what a service key may do: read, never write

function authProps_() { return PropertiesService.getScriptProperties(); }
function authProp_(name) { return String(authProps_().getProperty(AUTH_PREFIX + '_' + name) || ''); }
function authEnforced_() { return authProp_('ENFORCE_AUTH').trim().toLowerCase() === 'true'; }
function authUser_() { return authProp_('USER').trim() || AUTH_USER_DEFAULT; }

/* Constant-time compare: a plain === leaks through its timing how many
   leading characters matched. */
function authSafeEqual_(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= ((a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0));
  return diff === 0;
}

/* "v1$<rounds>$<salt>$<hash>" — salted, stretched SHA-256. */
function authHashPw_(pw, salt, rounds) {
  const pwBytes = Utilities.newBlob(String(salt) + '|' + String(pw)).getBytes();
  let d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pwBytes);
  for (let i = 1; i < rounds; i++) {
    d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d.concat(pwBytes));
  }
  return Utilities.base64EncodeWebSafe(d);
}
function authCheckPw_(pw) {
  const parts = authProp_('PASSWORD_HASH').split('$');
  if (parts.length !== 4 || parts[0] !== 'v1' || !pw) return false;
  const rounds = parseInt(parts[1], 10) || AUTH_PW_ROUNDS;
  return authSafeEqual_(authHashPw_(pw, parts[2], rounds), parts[3]);
}

function authSecret_() {
  let s = authProp_('TOKEN_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    authProps_().setProperty(AUTH_PREFIX + '_TOKEN_SECRET', s);
  }
  return s;
}
/* The token is tied to the CURRENT password: change it and every device's
   token stops working at once. No password = no token is ever valid. */
function authFingerprint_() { return authProp_('PASSWORD_HASH').slice(-16); }
function authSig_(exp) {
  const raw = Utilities.computeHmacSha256Signature('user|' + exp + '|' + authFingerprint_(), authSecret_());
  return Utilities.base64EncodeWebSafe(raw);
}
function authMakeToken_(exp) { return 't1.' + exp + '.' + authSig_(String(exp)); }
function authCheckToken_(token) {
  const m = String(token == null ? '' : token).trim().match(/^t1\.(\d{10,16})\.([A-Za-z0-9_\-=]+)$/);
  if (!m) return false;
  if (Date.now() > parseInt(m[1], 10)) return false;              // expired
  if (!authFingerprint_()) return false;                           // no password set = nobody
  return authSafeEqual_(m[2], authSig_(m[1]));
}
function authCheckServiceKey_(key) {
  const real = authProp_('SERVICE_KEY');
  if (real.length < 32 || !key) return false;                      // unset = refused, never open
  return authSafeEqual_(String(key), real);
}
/* Who is calling? 'user' | 'service' | '' (anonymous). */
function authWho_(p) {
  try {
    if (p && p.token && authCheckToken_(p.token)) return 'user';
    if (p && p.serviceKey && authCheckServiceKey_(p.serviceKey)) return 'service';
  } catch (e) {}
  return '';
}

function authRefusal_() {
  const r = { status: 'auth', code: 'auth', ok: false,
              message: 'Please sign in to ' + AUTH_APP_LABEL + '.' };
  if (!authEnforced_()) { r.redacted = true; r.version = APP_VERSION; r.features = FEATURES; }
  return r;
}
/* null = go ahead; otherwise the refusal to send back. */
function authGate_(action, p) {
  if (AUTH_OPEN_ACTIONS.indexOf(action) >= 0) return null;
  const who = authWho_(p);
  if (who === 'user') return null;
  if (who === 'service' && AUTH_SERVICE_ACTIONS.indexOf(action) >= 0) return null;
  return authRefusal_();
}

/* Extra ping fields. Whether each piece is SET — never its value. */
function authPingInfo_(r) {
  r.authEnforced = authEnforced_();
  if (!r.authEnforced) {
    r.setup = { password: !!authProp_('PASSWORD_HASH'),
                serviceKey: authProp_('SERVICE_KEY').length >= 32 };
  }
  return r;
}

function authFailCount_() {
  try { return parseInt(CacheService.getScriptCache().get(AUTH_PREFIX + '_login_fails') || '0', 10) || 0; }
  catch (e) { return 0; }
}
function authFailBump_() {
  try { CacheService.getScriptCache().put(AUTH_PREFIX + '_login_fails', String(authFailCount_() + 1), AUTH_FAIL_WINDOW_SEC); }
  catch (e) {}
}
function authFailClear_() {
  try { CacheService.getScriptCache().remove(AUTH_PREFIX + '_login_fails'); } catch (e) {}
}

/* action=login, POST body {user, pw} — the same fields the Mini app sends. */
function authLogin_(p, viaPost) {
  if (!viaPost) {
    return { status: 'error', code: 'post-only',
             message: 'Sign-in must be sent as a POST — update the page (reload it).' };
  }
  if (!authProp_('PASSWORD_HASH')) {
    return { status: 'error', code: 'unconfigured',
             message: 'Sign-in is not set up yet — run setStaffPassword in the Apps Script editor.' };
  }
  if (authFailCount_() >= AUTH_FAIL_LIMIT) {
    return { status: 'error', code: 'locked',
             message: 'Too many wrong passwords. Wait 15 minutes, then try again.' };
  }
  const want = authUser_().toLowerCase();
  const user = String((p && p.user) || '').trim().toLowerCase();
  const pw   = String((p && p.pw) || '');
  if (user !== want || !authCheckPw_(pw)) {
    authFailBump_();
    Utilities.sleep(600);                                    // blunt the speed of guessing
    return { status: 'error', code: 'bad-login', message: 'Wrong username or password.' };
  }
  authFailClear_();
  const exp = Date.now() + AUTH_TTL_MS;
  return { status: 'ok', token: authMakeToken_(exp), expires: exp, user: authUser_(),
           version: APP_VERSION, features: FEATURES };
}

/** RUN FROM THE EDITOR. Hashes <PREFIX>_PASSWORD_NEW into <PREFIX>_PASSWORD_HASH
    and deletes the plain copy. The password is never written in this file and
    never logged. Every device then signs in again. */
function setStaffPassword() {
  const p = authProps_(), newKey = AUTH_PREFIX + '_PASSWORD_NEW';
  const pw = String(p.getProperty(newKey) || '');
  if (!pw) {
    Logger.log('Nothing to do: add the Script Property ' + newKey + ' (the new password) first, then run this again.');
    return 'missing ' + newKey;
  }
  if (pw.length < 8) {
    p.deleteProperty(newKey);
    Logger.log('Too short: use at least 8 characters. ' + newKey + ' was deleted — add it again with a longer password.');
    return 'too short';
  }
  const salt = Utilities.getUuid().replace(/-/g, '');
  p.setProperty(AUTH_PREFIX + '_PASSWORD_HASH', 'v1$' + AUTH_PW_ROUNDS + '$' + salt + '$' + authHashPw_(pw, salt, AUTH_PW_ROUNDS));
  p.deleteProperty(newKey);
  authSecret_();
  authFailClear_();
  Logger.log('Password saved (hashed). ' + newKey + ' was deleted. Sign in with username ' +
             authUser_() + ' and the new password.');
  return 'ok';
}

/** RUN FROM THE EDITOR. Says which pieces are in place — never a value. */
function checkAuthSetup() {
  const p = authProps_();
  const lines = [
    AUTH_APP_LABEL + ' backend v' + APP_VERSION,
    'Username: ' + authUser_(),
    'Password: ' + (authProp_('PASSWORD_HASH') ? 'OK (hashed)' : 'MISSING — run setStaffPassword'),
    'Temporary password left behind: ' + (p.getProperty(AUTH_PREFIX + '_PASSWORD_NEW') ? 'YES — run setStaffPassword now' : 'none (OK)'),
    'Token secret: ' + (authSecret_() ? 'OK' : 'MISSING'),
    'Service key (read-only, optional): ' + (authProp_('SERVICE_KEY').length >= 32 ? 'OK'
        : (authProp_('SERVICE_KEY') ? 'TOO SHORT — needs 32+ characters' : 'not set')),
    'Enforce: ' + (authEnforced_() ? 'ON — refusals say nothing more' : 'off — anonymous reads still get NO rows; refusals carry the version')
  ];
  Logger.log(lines.join('\n'));
  return lines.join('\n');
}

/** RUN FROM THE EDITOR if a device is lost or a token may have leaked: every
    device must sign in again (the password itself does not change). */
function signOutAllDevices() {
  authProps_().setProperty(AUTH_PREFIX + '_TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  Logger.log('Every device is signed out and must sign in again.');
  return 'ok';
}
/* ══ end SIGN-IN ══ */

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
  return getNamedSheet(SHEET_NAME, HEADERS, [130, 100, 80, 240, 170, 100, 210, 150, 110, 100, 170]);
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

/* ── ROUTER (v6.18) ─────────────────────────────────────────────────────────
   Every action except ping / login / logout passes authGate_() first — a
   write needs a signed-in token, a read needs a token or the read-only
   service key. GET and POST reach the same route; a POST's JSON body (the
   profile photo, the sign-in) joins the URL's parameters. */
function doGet(e)  { return respond_(route_((e && e.parameter) || {}, false)); }
function doPost(e) {
  const p = {}, q = (e && e.parameter) || {};
  Object.keys(q).forEach(function (k) { p[k] = q[k]; });
  try {
    if (e && e.postData && e.postData.contents) {
      const body = JSON.parse(e.postData.contents);
      if (body && typeof body === 'object') Object.keys(body).forEach(function (k) { p[k] = body[k]; });
    }
  } catch (err) { /* not JSON — the query parameters stand on their own */ }
  return respond_(route_(p, true));
}
function respond_(result) {
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function route_(p, viaPost) {
  const action = String(p.action || '');
  try {
    const refused = authGate_(action, p);
    if (refused) return refused;
    switch (action) {
      case 'ping':
        return authPingInfo_({ status:'ok', message:'TSM Finance Tracker GAS v' + APP_VERSION + ' is live!',
                               version: APP_VERSION, features: FEATURES });
      case 'login':            return authLogin_(p, viaPost);
      case 'logout':           return { status:'ok', message:'Signed out on this device.' };
      case 'getAll':           return getAllData();
      case 'add':              return addTransaction(p);
      case 'update':           return updateTransaction(p);
      case 'delete':           return deleteRowById(SHEET_NAME, HEADERS, p.id);
      case 'saveCommitment':   return saveCommitment(p);
      case 'deleteCommitment': return deleteRowById(COMMIT_SHEET, COMMIT_HDRS, p.id);
      case 'savePlan':         return savePlan(p);
      case 'savePlans':        return savePlans(p);
      case 'deletePlan':       return deleteRowById(PLAN_SHEET, PLAN_HDRS, p.id);
      case 'saveBalance':      return saveBalance(p);
      case 'deleteBalance':    return deleteRowById(BAL_SHEET, BAL_HDRS, p.id);
      case 'moveToBalances':   return moveToBalances(p);
      case 'getProfile':       return getProfile_();
      case 'saveProfile':      return saveProfile_(p);
      default:                 return { status:'error', message:'Unknown action: ' + action };
    }
  } catch (err) {
    return { status:'error', message: err.toString() };
  }
}

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
    balances:       readBalances_(),
    profileAt:      Number(readSetting_('profileAt') || 0),
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
        mode:        str_(r[9]),
        category:    str_(r[10])
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
    const again = ridSeen_(p);
    if (again) return again;
    const id  = 'TX' + Date.now();

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
      p.mode   || '',
      p.category || ''
    ]);
    SpreadsheetApp.flush();
    return ridKeep_(p, { status:'ok', id: id, message:'Added successfully.' });
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
        sh.getRange(i + 1, 9, 1, 3).setValues([[p.paidBy || '', p.mode || '', p.category || '']]);
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
    const again = ridSeen_(p);
    if (again) return again;
    const id = 'CM' + Date.now();
    sh.appendRow(commitmentRow_(id, p, stamp_()));
    SpreadsheetApp.flush();
    return ridKeep_(p, { status:'ok', id:id, message:'Commitment saved.' });
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
    const again = ridSeen_(p);
    if (again) return again;
    const id = 'PL' + Date.now();
    sh.appendRow(planRow_(id, p, stamp_()));
    SpreadsheetApp.flush();
    return ridKeep_(p, { status:'ok', id:id, message:'Plan row saved.' });
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
  checkAuthSetup();
  Logger.log('Backend      : v' + APP_VERSION);
  Logger.log('Transactions : ' + Math.max(0, getSheet().getLastRow() - 1));
  Logger.log('Commitments  : ' + Math.max(0, getNamedSheet(COMMIT_SHEET, COMMIT_HDRS).getLastRow() - 1));
  Logger.log('Plan rows    : ' + Math.max(0, getNamedSheet(PLAN_SHEET, PLAN_HDRS).getLastRow() - 1));
}

/* ── NO REPEATS — idempotency key (pairs with the web app's NO REPEATS block) ──
   Every create the app sends (ledger entry, plan line, commitment) carries a
   request id, `rid`. A repeat of the same rid — a retry after a lost reply, a
   Save tapped again — gets the FIRST answer back instead of a second row.
   Checked INSIDE the script lock, so a slow first request and its repeat can
   never both write. Six hours is the CacheService maximum. */
function ridSeen_(p) {
  const rid = String((p && p.rid) || '').trim();
  if (!rid) return null;
  const hit = CacheService.getScriptCache().get('rid_' + rid.slice(0, 200));
  if (!hit) return null;
  const first = JSON.parse(hit);
  first.duplicate = true;
  first.message = 'Already saved — not added twice.';
  return first;
}
function ridKeep_(p, result) {
  const rid = String((p && p.rid) || '').trim();
  if (rid && result && result.status === 'ok') {
    CacheService.getScriptCache().put('rid_' + rid.slice(0, 200), JSON.stringify(result), 21600);
  }
  return result;
}

/* ── BANK & CASH BALANCES (shared by all three finance trackers' scripts) ────
   A balance is a READING of an account, not a transaction, so it lives in its
   own sheet and never reaches the ledger or any total. One row per reading.
   The Date column is plain TEXT (yyyy-MM-dd) and is read back with
   getDisplayValues(), so Sheets can never re-read 01-10-2026 as 10 January. */
const BAL_SHEET = 'Balances';
const BAL_HDRS  = ['ID', 'Account', 'Date', 'Balance', 'Note', 'CreatedAt'];
const BAL_WIDTHS = [150, 220, 110, 130, 300, 160];

function balSheet_() {
  const sh = getNamedSheet(BAL_SHEET, BAL_HDRS, BAL_WIDTHS);
  sh.getRange('C:C').setNumberFormat('@');
  return sh;
}
function balNum_(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
/* yyyy-MM-dd as written; a date typed into the sheet by hand as DD-MM-YYYY
   (the Indian order) is read that way too. */
function balIso_(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s;
}
function balStamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
}

function readBalances_() {
  const sh = getNamedSheet(BAL_SHEET, BAL_HDRS, BAL_WIDTHS);
  const data = sh.getDataRange().getDisplayValues();
  if (data.length <= 1) return [];
  return data.slice(1)
    .filter(function (r) { return String(r[0] || '').trim() !== ''; })
    .map(function (r) {
      return { id: String(r[0]), account: String(r[1] || '').trim(), date: balIso_(r[2]),
               balance: balNum_(r[3]), note: String(r[4] || ''), createdAt: String(r[5] || '') };
    });
}

function saveBalance(p) {
  const account = String(p.account || '').trim().slice(0, 80);
  const date = balIso_(p.date);
  const bal = parseFloat(p.balance);
  if (!account) return { status:'error', message:'Name the account.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status:'error', message:'A balance needs a date.' };
  if (isNaN(bal)) return { status:'error', message:'Enter the balance.' };
  const note = String(p.note || '').slice(0, 400);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return { status:'error', message:'Busy — please try again in a moment.' };
  }
  try {
    const sh = balSheet_();
    if (p.id) {
      const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
      for (let i = 1; i < ids.length; i++) {
        if (String(ids[i][0]) === String(p.id)) {
          sh.getRange(i + 1, 2, 1, 4).setValues([[account, date, bal, note]]);
          SpreadsheetApp.flush();
          return { status:'ok', id:String(p.id), message:'Balance updated.' };
        }
      }
      return { status:'error', message:'Balance reading not found: ' + p.id };
    }
    const again = ridSeen_(p);
    if (again) return again;
    const id = 'BL' + Date.now();
    sh.appendRow([id, account, date, bal, note, balStamp_()]);
    SpreadsheetApp.flush();
    return ridKeep_(p, { status:'ok', id:id, message:'Balance saved.' });
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

/* The one-time move of the old ₹1 / ₹0 balance rows out of the ledger. Each
   reading's ID is 'BL' + the ledger row's ID, so a repeat of the same request
   finds it already there and only finishes the delete — nothing is doubled. */
function moveToBalances(p) {
  let items;
  try { items = JSON.parse(p.items || '[]'); } catch (e) { return { status:'error', message:'Bad list.' }; }
  if (!Array.isArray(items) || !items.length) return { status:'error', message:'Nothing to move.' };
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) {
    return { status:'error', message:'Busy — please try again in a moment.' };
  }
  try {
    const bs = balSheet_();
    const have = {};
    bs.getRange(1, 1, Math.max(bs.getLastRow(), 1), 1).getValues()
      .forEach(function (r) { have[String(r[0])] = true; });
    const tx = getSheet();
    const txIds = tx.getRange(1, 1, Math.max(tx.getLastRow(), 1), 1).getValues()
      .map(function (r) { return String(r[0]); });
    const add = [], del = [];
    let ok = 0;
    items.forEach(function (it) {
      const txId = String(it.txId || '').trim();
      const account = String(it.account || '').trim().slice(0, 80);
      const date = balIso_(it.date);
      const bal = parseFloat(it.balance);
      if (!txId || !account || isNaN(bal) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      ok++;
      const id = 'BL' + txId;
      if (!have[id]) { add.push([id, account, date, bal, String(it.note || '').slice(0, 400), balStamp_()]); have[id] = true; }
      const row = txIds.indexOf(txId);
      if (row > 0) del.push(row + 1);
    });
    if (add.length) bs.getRange(bs.getLastRow() + 1, 1, add.length, BAL_HDRS.length).setValues(add);
    del.sort(function (a, b) { return b - a; }).forEach(function (r) { tx.deleteRow(r); });
    SpreadsheetApp.flush();
    return { status:'ok', moved: ok, added: add.length, removed: del.length,
             message: 'Moved ' + add.length + ' into Balances; removed ' + del.length + ' ledger rows.' };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

/* ── PROFILE — name, subtitle and photo, shared by every device (v6.15) ──────
   Ported from Mini Finance Tracker. A hidden 'Settings' sheet holds key/value
   pairs; 'profileAt' is the version stamp the app compares on each sync, so
   the (comparatively heavy) photo travels only when it has changed. */
const SETTINGS_SHEET = 'Settings';
const PROFILE_MAX = 45000;                     // a Sheet cell holds 50,000 characters

function settingsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SETTINGS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SETTINGS_SHEET);
    sh.appendRow(['Key', 'Value', 'UpdatedAt']);
    sh.setFrozenRows(1);
    styleHeader_(sh, 3);
    sh.setColumnWidth(1, 140); sh.setColumnWidth(2, 420); sh.setColumnWidth(3, 170);
    sh.hideSheet();
  }
  return sh;
}
function readSetting_(key) {
  const rows = settingsSheet_().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === key) return String(rows[i][1] == null ? '' : rows[i][1]);
  return '';
}
function writeSetting_(key, value) {
  const sh = settingsSheet_();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === key) { sh.getRange(i + 1, 2, 1, 2).setValues([[value, stamp_()]]); return; }
  }
  sh.appendRow([key, value, stamp_()]);
}
function getProfile_() {
  const raw = readSetting_('profile');
  let profile = null;
  if (raw) { try { profile = JSON.parse(raw); } catch (e) { profile = null; } }
  return { status:'ok', profile: profile, profileAt: Number(readSetting_('profileAt') || 0) };
}
function saveProfile_(p) {
  const raw = String(p.profile == null ? '' : p.profile);
  if (!raw) return { status:'error', message:'No profile supplied.' };
  if (raw.length > PROFILE_MAX) return { status:'error', message:'That photo is too large to sync. Please choose a smaller picture.' };
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { return { status:'error', message:'Profile was not valid JSON.' }; }
  const clean = JSON.stringify({ name: String(obj.name || '').slice(0, 120), sub: String(obj.sub || '').slice(0, 160), photo: String(obj.photo || '') });
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { status:'error', message:'Busy — please try again in a moment.' }; }
  try {
    const at = Date.now();
    writeSetting_('profile', clean);
    writeSetting_('profileAt', String(at));
    SpreadsheetApp.flush();
    return { status:'ok', profileAt: at, message:'Profile saved.' };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}
