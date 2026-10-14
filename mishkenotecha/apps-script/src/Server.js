/*
 * Server.js - Google Apps Script backend of "משכנותיך".
 *
 * A separate Apps Script project with its own private Google Sheet, its own
 * users and its own secrets - nothing is shared with any other system.
 *
 * Security model
 *  - Every user signs in with their own e-mail + password. Passwords are kept
 *    only as salted, iterated SHA-256 hashes in hidden "_" columns.
 *  - Login returns a signed (HMAC-SHA256) token bound to the user and to a
 *    password "version": changing a password or disabling a user revokes it.
 *  - Repeated failed logins lock that e-mail for a while.
 *  - Every request is POST with a JSON body (tokens never travel in URLs).
 *  - Hidden "_" columns are never returned to a browser.
 *  - All business rules (chaining etc.) live in MK (core.js) - the same code
 *    the tests run. Each write runs under a script lock: read → MK.run() →
 *    write every changed table, and is recorded in the "audit" sheet.
 *  - Case data is never written to logs (only ids and action names).
 *  - Documents are stored in Google Drive, one folder per case, under the
 *    system's private folder. Only links/ids are kept in the sheet.
 */

var TOKEN_TTL_H = 12;
var HASH_ROUNDS = 2000;
var MAX_FAILS = 5, LOCK_MIN = 15;
var TZ_IL = "Asia/Jerusalem";
// Roles that may work with cases and tasks. INSTRUCTOR gets no access to cases.
var CASE_ROLES = { ADMIN: true, STAFF: true };

// ======================================================================= HTTP
function doGet() {
  return json({ ok: true, service: "mishkenotecha", note: "POST only" });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: "bad_request" }); }
  var action = String(req.action || "");
  try {
    if (PUBLIC_ACTIONS.hasOwnProperty(action)) return json(PUBLIC_ACTIONS[action](req));
    if (USER_ACTIONS.hasOwnProperty(action)) {
      var user = verifyToken(req.token);
      if (!user) return json({ ok: false, error: "auth" });
      return json(USER_ACTIONS[action](req, user));
    }
    return json({ ok: false, error: "unknown_action" });
  } catch (err) {
    audit("", "error", action + " | " + String(err && err.message || err).slice(0, 200));
    return json({ ok: false, error: "server", message: "שגיאת שרת. נסו שוב בעוד רגע." });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ======================================================================= setup
/**
 * Run once from the Apps Script editor (select "setup" and press Run).
 * Creates the private database sheet, the Drive folders, the signing secret and a
 * daily backup, and prints a one-time SETUP CODE for creating the first admin.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("TOKEN_SECRET")) props.setProperty("TOKEN_SECRET", randomHex(48));
  var root;
  if (props.getProperty("ROOT_FOLDER_ID")) {
    root = DriveApp.getFolderById(props.getProperty("ROOT_FOLDER_ID"));
  } else {
    root = DriveApp.createFolder("משכנותיך - מערכת ניהול (פרטי)");
    props.setProperty("ROOT_FOLDER_ID", root.getId());
  }
  if (!props.getProperty("DB_ID")) {
    var ss = SpreadsheetApp.create("משכנותיך - מסד נתונים (פרטי)");
    DriveApp.getFileById(ss.getId()).moveTo(root);
    props.setProperty("DB_ID", ss.getId());
  }
  subFolder(root, "גיבויים");
  subFolder(root, "תיקים - מסמכים");
  var d = db();
  MK.TABLES.concat(["audit"]).forEach(function (t) { sheetOf(t); });
  var first = d.getSheetByName("Sheet1") || d.getSheetByName("גיליון1");
  if (first && d.getSheets().length > 1) d.deleteSheet(first);

  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("dailyJob").timeBased().everyDays(1).atHour(3).create();

  var code = props.getProperty("SETUP_CODE");
  if (!readTable("users").length) {
    code = randomHex(4).toUpperCase();
    props.setProperty("SETUP_CODE", code);
  }
  Logger.log("✔ ההתקנה הושלמה.");
  Logger.log("תיקיית המערכת בדרייב: " + root.getUrl());
  Logger.log("מסד הנתונים: " + d.getUrl());
  if (code) Logger.log("קוד הגדרה חד-פעמי ליצירת משתמש המנהל באתר: " + code);
}

/**
 * Run from the editor if the admin password is lost: prints a new one-time
 * code. In the site, the code + the admin e-mail set a new password.
 */
function resetAdminPassword() {
  var props = PropertiesService.getScriptProperties();
  var code = randomHex(4).toUpperCase();
  props.setProperty("SETUP_CODE", code);
  Logger.log("קוד איפוס חד-פעמי: " + code + " (במסך הכניסה: 'שכחתי סיסמה / קוד הגדרה')");
}



// ======================================================================= storage
var _dbCache = null, _tableCache = {};
function db() {
  if (_dbCache) return _dbCache;
  var id = PropertiesService.getScriptProperties().getProperty("DB_ID");
  if (!id) throw new Error("not_installed");
  _dbCache = SpreadsheetApp.openById(id);
  return _dbCache;
}
function sheetOf(name) {
  var s = db().getSheetByName(name);
  if (!s) {
    s = db().insertSheet(name);
    s.getRange(1, 1).setValue("id");
    s.setFrozenRows(1);
  }
  return s;
}
function readTable(name) {
  if (_tableCache[name]) return _tableCache[name];
  var v = sheetOf(name).getDataRange().getValues();
  var hdr = v[0] || ["id"];
  var rows = [];
  for (var i = 1; i < v.length; i++) {
    if (v[i][0] === "" || v[i][0] === null) continue;
    var o = {};
    for (var j = 0; j < hdr.length; j++) {
      if (!hdr[j]) continue;
      var val = v[i][j];
      if (val instanceof Date) val = Utilities.formatDate(val, TZ_IL, "yyyy-MM-dd");
      o[hdr[j]] = val === null || val === undefined ? "" : String(val);
    }
    rows.push(o);
  }
  _tableCache[name] = rows;
  return rows;
}
function writeTable(name, rows) {
  var s = sheetOf(name);
  var hdr = ["id"];
  rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (hdr.indexOf(k) === -1) hdr.push(k); }); });
  var data = [hdr].concat(rows.map(function (r) {
    return hdr.map(function (k) {
      var v = r[k];
      if (v === undefined || v === null) return "";
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    });
  }));
  s.clearContents();
  var rng = s.getRange(1, 1, data.length, hdr.length);
  rng.setNumberFormat("@");   // keep dates/ids as plain text
  rng.setValues(data);
  _tableCache[name] = rows;
}
function loadDb() {
  var out = {};
  MK.TABLES.forEach(function (t) { out[t] = readTable(t); });
  return out;
}
function publicRow(r) {
  var o = {};
  Object.keys(r).forEach(function (k) { if (k.charAt(0) !== "_") o[k] = r[k]; });
  return o;
}
function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { _tableCache = {}; return fn(); } finally { lock.releaseLock(); }
}
/** Write a result of MK.run: changed rows are merged, removed rows deleted. Secret "_" columns are never overwritten. */
function persist(changes, removed) {
  Object.keys(removed || {}).forEach(function (t) {
    if (MK.TABLES.indexOf(t) === -1 || t === "users") throw new Error("table");
    var ids = removed[t];
    writeTable(t, readTable(t).filter(function (r) { return ids.indexOf(r.id) === -1; }));
  });
  Object.keys(changes || {}).forEach(function (t) {
    if (MK.TABLES.indexOf(t) === -1 || t === "users") throw new Error("table");
    var rows = readTable(t).slice();
    var idx = {};
    rows.forEach(function (r, i) { idx[r.id] = i; });
    changes[t].forEach(function (r) {
      var clean = {};
      Object.keys(r).forEach(function (k) { if (k.charAt(0) !== "_") clean[k] = r[k]; });
      if (idx[r.id] !== undefined) {
        var cur = rows[idx[r.id]];
        Object.keys(clean).forEach(function (k) { cur[k] = clean[k]; });
      } else {
        idx[r.id] = rows.length;
        rows.push(clean);
      }
    });
    writeTable(t, rows);
  });
}
function upsertUser(row) {
  var rows = readTable("users").slice();
  for (var i = 0; i < rows.length; i++) if (rows[i].id === row.id) {
    Object.keys(row).forEach(function (k) { rows[i][k] = row[k]; });
    writeTable("users", rows);
    return rows[i];
  }
  rows.push(row);
  writeTable("users", rows);
  return row;
}
function audit(userId, action, detail) {
  try {
    var s = sheetOf("audit");
    if (s.getLastRow() < 1 || s.getRange(1, 2).getValue() !== "ts") s.getRange(1, 1, 1, 4).setValues([["id", "ts", "user", "action"]]);
    s.appendRow([MK.uid("au"), new Date().toISOString(), userId || "", action + (detail ? " | " + String(detail).slice(0, 300) : "")]);
  } catch (e) { /* never block on logging */ }
}

// ======================================================================= crypto / tokens
function randomHex(bytes) {
  var s = "";
  while (s.length < bytes * 2) s += Utilities.getUuid().replace(/-/g, "");
  return s.slice(0, bytes * 2);
}
function hex(bytes) {
  return bytes.map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
}
function hashPassword(password, salt) {
  var h = salt + "|" + password;
  for (var i = 0; i < HASH_ROUNDS; i++) {
    h = hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + "|" + salt, Utilities.Charset.UTF_8));
  }
  return h;
}
function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function sign(payload) {
  var secret = PropertiesService.getScriptProperties().getProperty("TOKEN_SECRET");
  var body = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8).replace(/=+$/, "");
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, secret)).replace(/=+$/, "");
  return body + "." + sig;
}
function unsign(token) {
  if (!token || String(token).indexOf(".") === -1) return null;
  var parts = String(token).split(".");
  var secret = PropertiesService.getScriptProperties().getProperty("TOKEN_SECRET");
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], secret)).replace(/=+$/, "");
  if (!safeEqual(sig, parts[1])) return null;
  try {
    var p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0] + "==".slice(0, (4 - parts[0].length % 4) % 4))).getDataAsString("UTF-8"));
    if (!p.exp || Date.now() > p.exp) return null;
    return p;
  } catch (e) { return null; }
}
function tokenFor(u) {
  return sign({ u: u.id, v: String(u._passVer || "0"), exp: Date.now() + TOKEN_TTL_H * 3600e3 });
}
function verifyToken(token) {
  var p = unsign(token);
  if (!p || !p.u) return null;
  var u = MK.byId(readTable("users"), p.u);
  if (!u || !MK.bool(u.isActive) || String(u._passVer || "0") !== String(p.v)) return null;
  return u;
}
function tooManyFails(key) { return +(CacheService.getScriptCache().get("fail_" + key) || 0) >= MAX_FAILS; }
function noteFail(key) {
  var cache = CacheService.getScriptCache();
  cache.put("fail_" + key, String(+(cache.get("fail_" + key) || 0) + 1), LOCK_MIN * 60);
}
function clearFails(key) { CacheService.getScriptCache().remove("fail_" + key); }
function userByEmail(email) {
  email = MK.normEmail(email);
  return readTable("users").filter(function (u) { return MK.normEmail(u.email) === email; })[0] || null;
}
function publicUser(u) { return { id: u.id, name: u.name, email: u.email, role: u.role, isActive: u.isActive }; }

// ======================================================================= public actions
var PUBLIC_ACTIONS = {
  status: function () {
    var p = PropertiesService.getScriptProperties();
    var installed = !!p.getProperty("DB_ID");
    return { ok: true, installed: installed, hasUsers: installed && readTable("users").length > 0 };
  },

  /**
   * With the one-time code from the editor log:
   *  - no users yet → creates the first ADMIN;
   *  - after resetAdminPassword() → sets a new password for that admin e-mail.
   */
  setupAdmin: function (req) {
    var p = PropertiesService.getScriptProperties();
    if (tooManyFails("setup")) return { ok: false, error: "locked" };
    var code = p.getProperty("SETUP_CODE");
    if (!code || !safeEqual(String(req.code || "").trim().toUpperCase(), code)) {
      noteFail("setup"); Utilities.sleep(700);
      return { ok: false, error: "bad_code", message: "הקוד שגוי או שכבר נעשה בו שימוש" };
    }
    var email = MK.normEmail(req.email);
    if (!MK.isEmail(email)) return { ok: false, error: "validation", message: "כתובת המייל לא תקינה" };
    var weak = MK.passwordProblem(req.password);
    if (weak) return { ok: false, error: "weak", message: weak };
    return withLock(function () {
      var users = readTable("users");
      var existing = userByEmail(email);
      var salt = randomHex(16), u;
      if (!users.length) {
        var name = MK.str(req.name);
        if (!name) return { ok: false, error: "validation", message: "יש למלא שם" };
        u = upsertUser({ id: MK.uid("us"), name: name, email: email, role: "ADMIN", isActive: "true", createdAt: new Date().toISOString(),
          _salt: salt, _passHash: hashPassword(req.password, salt), _passVer: "1" });
      } else if (existing && existing.role === "ADMIN") {
        u = upsertUser({ id: existing.id, isActive: "true", _salt: salt, _passHash: hashPassword(req.password, salt), _passVer: String((+existing._passVer || 0) + 1) });
      } else {
        return { ok: false, error: "validation", message: "המייל לא שייך למנהל קיים" };
      }
      p.deleteProperty("SETUP_CODE");
      clearFails("setup");
      audit(u.id, "setupAdmin");
      return { ok: true, token: tokenFor(u), user: publicUser(u) };
    });
  },

  login: function (req) {
    var email = MK.normEmail(req.email);
    if (!email) return { ok: false, error: "bad_login" };
    if (tooManyFails("u_" + email)) return { ok: false, error: "locked" };
    var u = userByEmail(email);
    if (!u || !MK.bool(u.isActive) || !u._passHash || !safeEqual(hashPassword(String(req.password || ""), u._salt), u._passHash)) {
      noteFail("u_" + email); Utilities.sleep(700);
      audit(u ? u.id : "", "login_failed");
      return { ok: false, error: "bad_login" };
    }
    clearFails("u_" + email);
    audit(u.id, "login");
    return { ok: true, token: tokenFor(u), user: publicUser(u) };
  }
};

// ======================================================================= signed-in actions
var USER_ACTIONS = {
  bootstrap: function (req, user) {
    if (!CASE_ROLES[user.role]) return { ok: false, error: "forbidden" };
    var d = loadDb();
    var out = {};
    MK.TABLES.forEach(function (t) { out[t] = d[t].map(publicRow); });
    out.users = d.users.map(publicUser);
    var props = PropertiesService.getScriptProperties();
    return {
      ok: true, db: out, me: publicUser(user),
      meta: {
        today: Utilities.formatDate(new Date(), TZ_IL, "yyyy-MM-dd"),
        dbUrl: user.role === "ADMIN" && props.getProperty("DB_ID") ? "https://docs.google.com/spreadsheets/d/" + props.getProperty("DB_ID") : "",
        driveUrl: props.getProperty("ROOT_FOLDER_ID") ? "https://drive.google.com/drive/folders/" + props.getProperty("ROOT_FOLDER_ID") : "",
        maxUploadMb: MK.MAX_UPLOAD_MB
      }
    };
  },

  /** Every business write: { op: "<MK action>", ...fields } */
  mutate: function (req, user) {
    if (!CASE_ROLES[user.role]) return { ok: false, error: "forbidden" };
    var op = String(req.op || "");
    // addDocument is server-only: it is created by uploadDocument after the file is in Drive.
    if (MK.OPS.indexOf(op) === -1 || op === "addDocument") return { ok: false, error: "unknown_action" };
    var input = req.input || {};
    return withLock(function () {
      var data = loadDb();
      var res = MK.run(op, data, input, runCtx(user));
      if (!res.ok) return res;
      persist(res.changes, res.removed);
      if (op === "removeDocument" && res.fileId) { try { DriveApp.getFileById(res.fileId).setTrashed(true); } catch (e) { /* already gone */ } }
      audit(user.id, op, changedIds(res));
      return res;
    });
  },

  /** Upload a document to the case's Drive folder: { caseId, name, mime, data (base64), note } */
  uploadDocument: function (req, user) {
    if (!CASE_ROLES[user.role]) return { ok: false, error: "forbidden" };
    var bytes;
    try { bytes = Utilities.base64Decode(String(req.data || "")); } catch (e) { return { ok: false, error: "validation", message: "הקובץ לא נקרא כראוי. נסו שוב." }; }
    if (!bytes.length) return { ok: false, error: "validation", message: "הקובץ ריק" };
    if (bytes.length > MK.MAX_UPLOAD_MB * 1024 * 1024) return { ok: false, error: "validation", message: "הקובץ גדול מדי (עד " + MK.MAX_UPLOAD_MB + "MB)" };
    var name = MK.str(req.name).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 200) || "מסמך";
    return withLock(function () {
      var data = loadDb();
      var c = MK.byId(data.cases, req.caseId);
      if (!c) return { ok: false, error: "not_found", message: "התיק לא נמצא" };
      var folder = caseFolder(c);
      var file = folder.createFile(Utilities.newBlob(bytes, MK.str(req.mime) || "application/octet-stream", name));
      if (req.note) file.setDescription(MK.str(req.note).slice(0, 500));
      var res = MK.run("addDocument", data, { caseId: c.id, name: name, note: req.note, mime: file.getMimeType(), size: bytes.length,
        fileId: file.getId(), url: file.getUrl(), folderId: folder.getId() }, runCtx(user));
      if (!res.ok) { file.setTrashed(true); return res; }
      persist(res.changes, res.removed);
      audit(user.id, "uploadDocument", changedIds(res));
      return res;
    });
  },

  /** Link to the case's folder in Drive (created on first use). */
  caseFolder: function (req, user) {
    if (!CASE_ROLES[user.role]) return { ok: false, error: "forbidden" };
    return withLock(function () {
      var c = MK.byId(readTable("cases"), req.caseId);
      if (!c) return { ok: false, error: "not_found", message: "התיק לא נמצא" };
      var f = caseFolder(c);
      return { ok: true, url: f.getUrl(), changes: { cases: [publicRow(MK.byId(readTable("cases"), c.id))] } };
    });
  },

  changePassword: function (req, user) {
    if (!safeEqual(hashPassword(String(req.current || ""), user._salt), user._passHash)) {
      Utilities.sleep(700);
      return { ok: false, error: "bad_password", message: "הסיסמה הנוכחית שגויה" };
    }
    var weak = MK.passwordProblem(req.password);
    if (weak) return { ok: false, error: "weak", message: weak };
    return withLock(function () {
      var salt = randomHex(16);
      var u = upsertUser({ id: user.id, _salt: salt, _passHash: hashPassword(req.password, salt), _passVer: String((+user._passVer || 0) + 1) });
      audit(user.id, "changePassword");
      return { ok: true, token: tokenFor(u) };
    });
  }
};

function runCtx(user) {
  return {
    now: new Date().toISOString(),
    today: Utilities.formatDate(new Date(), TZ_IL, "yyyy-MM-dd"),
    userId: user.id,
    uid: function (p) { return p + "_" + Utilities.getUuid().replace(/-/g, "").slice(0, 16); }
  };
}
function changedIds(res) {
  var ids = [];
  Object.keys(res.changes || {}).forEach(function (t) { res.changes[t].forEach(function (r) { ids.push(t + ":" + r.id); }); });
  Object.keys(res.removed || {}).forEach(function (t) { res.removed[t].forEach(function (id) { ids.push("-" + t + ":" + id); }); });
  return ids.join(",");
}
/** The case's own Drive folder (named after the case), created on first use. Call under the lock. */
function caseFolder(c) {
  if (c.folderId) { try { var f = DriveApp.getFolderById(c.folderId); if (!f.isTrashed()) return f; } catch (e) { /* recreate */ } }
  var parent = subFolder(rootFolder(), "תיקים - מסמכים");
  var folder = parent.createFolder(MK.str(c.name).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 100) || "תיק");
  var row = {}; Object.keys(c).forEach(function (k) { row[k] = c[k]; }); row.folderId = folder.getId();
  persist({ cases: [row] });
  return folder;
}

// ======================================================================= jobs
function rootFolder() { return DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty("ROOT_FOLDER_ID")); }
function subFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** Daily: full backup copy of the database (keeps the last 30) + invariant check. */
function dailyJob() {
  var folder = subFolder(rootFolder(), "גיבויים");
  DriveApp.getFileById(db().getId()).makeCopy("גיבוי " + Utilities.formatDate(new Date(), TZ_IL, "yyyy-MM-dd"), folder);
  var files = [], it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(30).forEach(function (f) { f.setTrashed(true); });
  var d = loadDb();
  var stale = d.cases.filter(function (c) { return c.status === "open" && !MK.nextOfCase(d, c.id); }).length;
  if (stale) {
    audit("", "cases_without_next_step", String(stale));
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), "משכנותיך: יש תיקים פתוחים בלי צעד הבא",
      "בבדיקה הלילית נמצאו " + stale + " תיקים פתוחים שאין להם משימה פתוחה. היכנסו למערכת ובדקו אותם ברשימת התיקים.");
  }
}
