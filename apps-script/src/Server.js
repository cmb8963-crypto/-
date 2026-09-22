/*
 * Server.js - Google Apps Script backend for the private management system.
 *
 * Runs inside YOUR Google account. All data is stored in a private Google
 * Sheet in your Drive (created by setup()). Nothing personal lives in the
 * public website code.
 *
 * Security model
 *  - Admin password: stored only as a salted, iterated SHA-256 hash in Script
 *    Properties. Login returns a signed (HMAC-SHA256) token that expires.
 *  - Clients: own password (salted hash), signed tokens bound to their id and
 *    to a password "version" - changing the password revokes old links/tokens.
 *  - Brute-force protection: repeated failed logins lock the account for a while.
 *  - Every request is POST with a JSON body (tokens never travel in URLs).
 *  - Clients can only ever read the filtered "portal view" of their own record.
 *  - Secret columns (prefixed "_") are never returned to any browser.
 *  - Every login and every write is recorded in the "audit" sheet.
 */

var TABLES = ["clients", "packages", "sessions", "charges", "payments", "summaries", "tasks", "expenses",
  "settings", "messages", "bookings", "family_tx", "family_categories", "family_rules", "loans", "email_log", "audit"];
// Tables the admin UI may write through the generic upsert/remove actions.
var WRITABLE = ["clients", "packages", "sessions", "charges", "payments", "summaries", "tasks", "expenses",
  "settings", "messages", "bookings", "family_tx", "family_categories", "family_rules", "loans"];

var ADMIN_TTL_H = 12, CLIENT_TTL_H = 24 * 7, SETUP_TTL_H = 24 * 7, RESET_TTL_H = 1;
var HASH_ROUNDS = 2000;
var MAX_FAILS = 5, LOCK_MIN = 15;
var MAX_UPLOAD_MB = 40;

// ======================================================================= HTTP
function doGet() {
  return json({ ok: true, service: "crm", note: "POST only" });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: "bad_request" }); }
  var action = String(req.action || "");
  try {
    if (PUBLIC_ACTIONS[action]) return json(PUBLIC_ACTIONS[action](req));
    if (CLIENT_ACTIONS[action]) {
      var who = verifyToken(req.token, "client");
      if (!who) return json({ ok: false, error: "auth" });
      return json(CLIENT_ACTIONS[action](req, who));
    }
    if (ADMIN_ACTIONS[action]) {
      if (!verifyToken(req.token, "admin")) return json({ ok: false, error: "auth" });
      return json(ADMIN_ACTIONS[action](req));
    }
    return json({ ok: false, error: "unknown_action" });
  } catch (err) {
    audit("error", action, String(err && err.message || err));
    return json({ ok: false, error: "server", message: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ======================================================================= setup
/**
 * Run once from the Apps Script editor (select "setup" and press Run).
 * Creates the private database sheet, the Drive folders, the signing secret,
 * the calendar-sync trigger, and prints a one-time SETUP CODE to the log.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("TOKEN_SECRET")) props.setProperty("TOKEN_SECRET", randomHex(48));
  var root;
  if (props.getProperty("ROOT_FOLDER_ID")) {
    root = DriveApp.getFolderById(props.getProperty("ROOT_FOLDER_ID"));
  } else {
    root = DriveApp.createFolder("מערכת ניהול - קליניקה ומשפחה (פרטי)");
    props.setProperty("ROOT_FOLDER_ID", root.getId());
  }
  if (!props.getProperty("DB_ID")) {
    var ss = SpreadsheetApp.create("מערכת ניהול - מסד נתונים (פרטי)");
    DriveApp.getFileById(ss.getId()).moveTo(root);
    props.setProperty("DB_ID", ss.getId());
  }
  subFolder(root, "לקוחות");
  subFolder(root, "גיבויים");
  var d = db();
  TABLES.forEach(function (t) { sheetOf(t); });
  var first = d.getSheetByName("Sheet1") || d.getSheetByName("גיליון1");
  if (first && d.getSheets().length > 1) d.deleteSheet(first);
  seedDefaults();

  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("syncCalendarJob").timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger("dailyJob").timeBased().everyDays(1).atHour(6).create();

  var code = props.getProperty("SETUP_CODE");
  if (!props.getProperty("ADMIN_HASH")) {
    code = randomHex(4).toUpperCase();
    props.setProperty("SETUP_CODE", code);
  }
  Logger.log("✔ ההתקנה הושלמה.");
  Logger.log("תיקיית המערכת בדרייב: " + root.getUrl());
  Logger.log("מסד הנתונים: " + d.getUrl());
  if (code) Logger.log("קוד הגדרה חד-פעמי לבחירת סיסמת המנהל באתר: " + code);
}

/** Run from the editor if you forget the admin password: clears it and prints a new setup code. */
function resetAdminPassword() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty("ADMIN_HASH");
  props.deleteProperty("ADMIN_SALT");
  props.setProperty("TOKEN_SECRET", randomHex(48)); // signs out every open session
  var code = randomHex(4).toUpperCase();
  props.setProperty("SETUP_CODE", code);
  Logger.log("קוד הגדרה חדש: " + code);
}

function seedDefaults() {
  var cats = readTable("family_categories");
  if (!cats.length) {
    writeTable("family_categories", Core.DEFAULT_FAMILY_CATEGORIES.map(function (c, i) {
      return { id: "fc" + i, name: c[0], group: c[1], budget: "" };
    }));
  }
  var rules = readTable("family_rules");
  if (!rules.length) {
    writeTable("family_rules", Core.DEFAULT_FAMILY_RULES.map(function (r, i) {
      return { id: "fr" + i, pattern: r[0], category: r[1] };
    }));
  }
}

// ======================================================================= storage
var _dbCache = null, _tableCache = {};
function db() {
  if (_dbCache) return _dbCache;
  var id = PropertiesService.getScriptProperties().getProperty("DB_ID");
  if (!id) throw new Error("המערכת עוד לא הותקנה - יש להריץ setup() בעורך.");
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
  var s = sheetOf(name);
  var v = s.getDataRange().getValues();
  var hdr = v[0] || ["id"];
  var rows = [];
  for (var i = 1; i < v.length; i++) {
    if (v[i][0] === "" || v[i][0] === null) continue;
    var o = {};
    for (var j = 0; j < hdr.length; j++) {
      if (!hdr[j]) continue;
      var val = v[i][j];
      if (val instanceof Date) val = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm").replace("T00:00", "");
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
  rng.setNumberFormat("@");
  rng.setValues(data);
  _tableCache[name] = rows;
}
function loadDb() {
  var out = {};
  TABLES.forEach(function (t) { if (t !== "audit" && t !== "email_log") out[t] = readTable(t); });
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
function cleanIncoming(row) {
  var o = {};
  Object.keys(row || {}).forEach(function (k) {
    if (k.charAt(0) === "_") return;          // secret columns can never be set from a browser
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) return;
    var v = row[k];
    if (/Url$/.test(k) && v && !/^https?:\/\//i.test(String(v))) v = "";   // links must be http(s)
    o[k] = (v !== null && typeof v === "object") ? JSON.stringify(v) : v;
  });
  return o;
}
function upsertRows(name, incoming) {
  var rows = readTable(name).slice();
  var idx = {};
  rows.forEach(function (r, i) { idx[r.id] = i; });
  var saved = [];
  incoming.forEach(function (raw) {
    var r = cleanIncoming(raw);
    if (!r.id) r.id = Core.uid(name.slice(0, 2));
    if (idx[r.id] !== undefined) {
      var cur = rows[idx[r.id]], merged = {};
      Object.keys(cur).forEach(function (k) { merged[k] = cur[k]; });
      Object.keys(r).forEach(function (k) { merged[k] = r[k]; });
      rows[idx[r.id]] = merged;
      saved.push(merged);
    } else {
      idx[r.id] = rows.length;
      rows.push(r);
      saved.push(r);
    }
  });
  writeTable(name, rows);
  return saved;
}
function removeRows(name, ids) {
  var set = {};
  ids.forEach(function (i) { set[i] = true; });
  writeTable(name, readTable(name).filter(function (r) { return !set[r.id]; }));
}
function audit(who, action, detail) {
  try {
    var s = sheetOf("audit");
    if (s.getLastRow() < 1 || s.getRange(1, 2).getValue() !== "ts") s.getRange(1, 1, 1, 4).setValues([["id", "ts", "who", "action"]]);
    s.appendRow([Core.uid("au"), new Date().toISOString(), who, action + (detail ? " | " + String(detail).slice(0, 300) : "")]);
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
function verifyToken(token, role) {
  var p = unsign(token);
  if (!p || p.r !== role) return null;
  if (role === "client") {
    var c = Core.byId(readTable("clients"), p.c);
    if (!c || c.status === "inactive" || String(c._passVer || "0") !== String(p.v)) return null;
    return c;
  }
  return p;
}
function tooManyFails(key) {
  var n = +(CacheService.getScriptCache().get("fail_" + key) || 0);
  return n >= MAX_FAILS;
}
function noteFail(key) {
  var cache = CacheService.getScriptCache();
  var n = +(cache.get("fail_" + key) || 0) + 1;
  cache.put("fail_" + key, String(n), LOCK_MIN * 60);
}
function clearFails(key) { CacheService.getScriptCache().remove("fail_" + key); }

// ======================================================================= public actions
var PUBLIC_ACTIONS = {
  status: function () {
    var p = PropertiesService.getScriptProperties();
    return { ok: true, installed: !!p.getProperty("DB_ID"), hasAdmin: !!p.getProperty("ADMIN_HASH") };
  },

  // First-time admin password, protected by the one-time code printed by setup().
  adminInit: function (req) {
    var p = PropertiesService.getScriptProperties();
    if (p.getProperty("ADMIN_HASH")) return { ok: false, error: "already_set" };
    if (tooManyFails("init")) return { ok: false, error: "locked" };
    if (!safeEqual(String(req.code || "").trim().toUpperCase(), p.getProperty("SETUP_CODE") || "~")) {
      noteFail("init"); return { ok: false, error: "bad_code" };
    }
    var err = passwordProblem(req.password, 10);
    if (err) return { ok: false, error: "weak", message: err };
    var salt = randomHex(16);
    p.setProperty("ADMIN_SALT", salt);
    p.setProperty("ADMIN_HASH", hashPassword(req.password, salt));
    p.deleteProperty("SETUP_CODE");
    audit("admin", "adminInit");
    return { ok: true, token: sign({ r: "admin", exp: Date.now() + ADMIN_TTL_H * 3600e3 }) };
  },

  adminLogin: function (req) {
    var p = PropertiesService.getScriptProperties();
    if (tooManyFails("admin")) { audit("admin", "login_locked"); return { ok: false, error: "locked" }; }
    var hash = p.getProperty("ADMIN_HASH");
    if (!hash) return { ok: false, error: "not_initialized" };
    if (!safeEqual(hashPassword(String(req.password || ""), p.getProperty("ADMIN_SALT")), hash)) {
      noteFail("admin"); audit("admin", "login_failed");
      Utilities.sleep(700);
      return { ok: false, error: "bad_password" };
    }
    clearFails("admin");
    audit("admin", "login");
    return { ok: true, token: sign({ r: "admin", exp: Date.now() + ADMIN_TTL_H * 3600e3 }) };
  },

  portalLogin: function (req) {
    var email = String(req.email || "").trim().toLowerCase();
    if (!email) return { ok: false, error: "bad_login" };
    if (tooManyFails("c_" + email)) return { ok: false, error: "locked" };
    var c = readTable("clients").filter(function (x) { return String(x.email || "").trim().toLowerCase() === email && x.status !== "inactive"; })[0];
    if (!c || !c._passHash || !safeEqual(hashPassword(String(req.password || ""), c._salt), c._passHash)) {
      noteFail("c_" + email); Utilities.sleep(700);
      return { ok: false, error: "bad_login" };
    }
    clearFails("c_" + email);
    audit("client:" + c.id, "portal_login");
    return { ok: true, token: sign({ r: "client", c: c.id, v: String(c._passVer || "0"), exp: Date.now() + CLIENT_TTL_H * 3600e3 }) };
  },

  // Uses the signed link from the welcome / password e-mail.
  portalSetPassword: function (req) {
    var p = unsign(req.setupToken);
    if (!p || p.r !== "setup") return { ok: false, error: "link_expired" };
    var err = passwordProblem(req.password, 8);
    if (err) return { ok: false, error: "weak", message: err };
    return withLock(function () {
      var c = Core.byId(readTable("clients"), p.c);
      if (!c || String(c._passVer || "0") !== String(p.v)) return { ok: false, error: "link_expired" };
      var salt = randomHex(16);
      var ver = String((+c._passVer || 0) + 1);
      upsertRowsRaw("clients", [{ id: c.id, _salt: salt, _passHash: hashPassword(req.password, salt), _passVer: ver, portalActive: "true" }]);
      audit("client:" + c.id, "set_password");
      return { ok: true, email: c.email, token: sign({ r: "client", c: c.id, v: ver, exp: Date.now() + CLIENT_TTL_H * 3600e3 }) };
    });
  },

  // Always answers "ok" so it can't be used to discover who is a client.
  portalForgot: function (req) {
    var email = String(req.email || "").trim().toLowerCase();
    if (!email || tooManyFails("forgot_" + email)) return { ok: true };
    noteFail("forgot_" + email);
    var c = readTable("clients").filter(function (x) { return String(x.email || "").trim().toLowerCase() === email && x.status !== "inactive"; })[0];
    if (c) sendTemplate("password", c.id, { ttlHours: RESET_TTL_H, validity: "שעה" });
    return { ok: true };
  }
};

function passwordProblem(pw, min) {
  pw = String(pw || "");
  if (pw.length < min) return "הסיסמה צריכה לכלול לפחות " + min + " תווים";
  if (!/[0-9]/.test(pw) || !/[^0-9]/.test(pw)) return "הסיסמה צריכה לכלול גם ספרות וגם אותיות";
  return "";
}
// Like upsertRows but allows secret "_" columns - server-internal use only.
function upsertRowsRaw(name, incoming) {
  var rows = readTable(name).slice();
  incoming.forEach(function (r) {
    for (var i = 0; i < rows.length; i++) if (rows[i].id === r.id) {
      Object.keys(r).forEach(function (k) { rows[i][k] = r[k]; });
      return;
    }
    rows.push(r);
  });
  writeTable(name, rows);
}

// ======================================================================= client (portal) actions
var CLIENT_ACTIONS = {
  portalView: function (req, c) {
    var d = loadDb();
    var view = Core.portalView(d, c.id, new Date());
    var msgs = (d.messages || []).filter(function (m) { return m.clientId === c.id; }).slice(-30).map(function (m) {
      return { date: m.date, text: m.text, fromClient: Core.bool(m.fromClient), attachmentName: m.attachmentName || "" };
    });
    var reqs = (d.bookings || []).filter(function (b) { return b.clientId === c.id && b.status === "pending"; }).map(function (b) {
      return { start: b.start, location: b.location, status: b.status };
    });
    view.messages = msgs;
    view.pendingBookings = reqs;
    return { ok: true, view: view };
  },

  portalSlots: function (req, c) {
    var st = Core.settingsOf(loadDb());
    var days = Math.min(90, Core.num(st.bookingDaysAhead) || 45);
    var from = new Date();
    var to = new Date(from.getTime() + (days + 1) * 864e5);
    var busy = busyIntervals(from, to);
    return { ok: true, slots: Core.freeSlots(st, busy, from, days) };
  },

  portalBook: function (req, c) {
    var start = String(req.start || "");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)) return { ok: false, error: "bad_slot" };
    var note = String(req.note || "").slice(0, 2000);
    return withLock(function () {
      var pending = readTable("bookings").filter(function (b) { return b.clientId === c.id && b.status === "pending"; });
      if (pending.length >= 3) return { ok: false, error: "too_many" };
      var st = Core.settingsOf(loadDb());
      var row = { id: Core.uid("bk"), clientId: c.id, start: start, location: String(req.location || "").slice(0, 60),
        durationMin: Core.num(st.slotMinutes) || 60, note: note, status: "pending", createdAt: Core.ymdhm(new Date()) };
      upsertRows("bookings", [row]);
      audit("client:" + c.id, "booking_request", start);
      notifyAdmin("בקשה לפגישה - " + c.name, c.name + " ביקש/ה פגישה ב-" + Core.fmtDate(start) + " " + Core.fmtTime(start) +
        (row.location ? " (" + row.location + ")" : "") + (note ? "\nהערה: " + note : ""));
      return { ok: true };
    });
  },

  portalMessage: function (req, c) {
    var text = String(req.text || "").slice(0, 5000);
    var kind = req.kind === "details" ? "details" : "message";
    if (!text && !req.file) return { ok: false, error: "empty" };
    return withLock(function () {
      var row = { id: Core.uid("ms"), clientId: c.id, date: Core.ymdhm(new Date()), text: text, kind: kind, fromClient: "true", read: "false" };
      if (req.file && req.file.data) {
        var f = saveUpload(c.id, req.file, "הודעות מהלקוח", false);
        row.attachmentUrl = f.url; row.attachmentId = f.id; row.attachmentName = f.name;
      }
      upsertRows("messages", [row]);
      audit("client:" + c.id, "message", kind);
      notifyAdmin((kind === "details" ? "בקשה לשינוי פרטים - " : "הודעה חדשה - ") + c.name, text || "(קובץ מצורף)");
      return { ok: true };
    });
  },

  portalTaskDone: function (req, c) {
    return withLock(function () {
      var t = Core.byId(readTable("tasks"), req.id);
      if (!t || t.clientId !== c.id || !Core.bool(t.shared)) return { ok: false, error: "not_found" };
      upsertRows("tasks", [{ id: t.id, done: req.done ? "true" : "false" }]);
      return { ok: true };
    });
  }
};

// ======================================================================= admin actions
var ADMIN_ACTIONS = {
  bootstrap: function () {
    var d = loadDb();
    var out = {};
    Object.keys(d).forEach(function (t) { out[t] = d[t].map(publicRow); });
    out.clients = d.clients.map(function (c) {
      var p = publicRow(c);
      p.hasPassword = c._passHash ? "true" : "false";
      return p;
    });
    var log = readTable("email_log");
    out.email_log = log.slice(-300);
    var props = PropertiesService.getScriptProperties();
    out.meta = {
      rootFolderUrl: props.getProperty("ROOT_FOLDER_ID") ? "https://drive.google.com/drive/folders/" + props.getProperty("ROOT_FOLDER_ID") : "",
      dbUrl: props.getProperty("DB_ID") ? "https://docs.google.com/spreadsheets/d/" + props.getProperty("DB_ID") : "",
      account: Session.getEffectiveUser().getEmail(),
      lastSync: props.getProperty("LAST_SYNC") || ""
    };
    return { ok: true, db: out };
  },

  upsert: function (req) {
    if (WRITABLE.indexOf(req.table) === -1) return { ok: false, error: "table" };
    var rows = Array.isArray(req.rows) ? req.rows : [req.row];
    return withLock(function () {
      var saved = upsertRows(req.table, rows).map(publicRow);
      audit("admin", "upsert " + req.table, rows.length + " rows");
      if (req.table === "sessions") afterSessionsSaved(saved, req);
      if (req.table === "summaries") saved = saved.map(function (s) { return publicRow(archiveSummary(s)); });
      return { ok: true, rows: saved };
    });
  },

  remove: function (req) {
    if (WRITABLE.indexOf(req.table) === -1) return { ok: false, error: "table" };
    var ids = Array.isArray(req.ids) ? req.ids : [req.id];
    return withLock(function () {
      if (req.table === "sessions") {
        readTable("sessions").forEach(function (s) {
          if (ids.indexOf(s.id) !== -1 && s.calendarEventId && req.deleteEvent) {
            try { var ev = findEvent(s.calendarEventId); if (ev) ev.deleteEvent(); } catch (e) {}
          }
        });
      }
      removeRows(req.table, ids);
      audit("admin", "remove " + req.table, ids.join(","));
      return { ok: true };
    });
  },

  syncCalendar: function () {
    return withLock(function () { return syncCalendar(); });
  },

  uploadFile: function (req) {
    var f = saveUpload(req.clientId, req.file, req.folder || "הקלטות וסיכומים", !!req.shareWithClient);
    audit("admin", "upload", f.name);
    return { ok: true, file: f };
  },

  previewEmail: function (req) {
    var r = buildEmail(req.template, req.clientId, req);
    return { ok: true, subject: r.subject, html: r.html, to: r.to };
  },

  sendEmail: function (req) {
    return withLock(function () { return sendTemplate(req.template, req.clientId, req); });
  },

  approveBooking: function (req) {
    return withLock(function () {
      var b = Core.byId(readTable("bookings"), req.id);
      if (!b) return { ok: false, error: "not_found" };
      if (req.decline) {
        upsertRows("bookings", [{ id: b.id, status: "declined" }]);
        audit("admin", "booking_declined", b.id);
        return { ok: true };
      }
      var s = { id: Core.uid("se"), clientId: b.clientId, date: req.start || b.start, durationMin: b.durationMin || 60,
        location: b.location, status: "planned", source: "booking", notes: b.note ? "הערת הלקוח: " + b.note : "" };
      upsertRows("sessions", [s]);
      afterSessionsSaved([s], { createEvents: true });
      upsertRows("bookings", [{ id: b.id, status: "approved", sessionId: s.id }]);
      if (req.notify !== false) sendTemplate("invite", b.clientId, { sessionId: s.id });
      audit("admin", "booking_approved", b.id);
      return { ok: true, session: s };
    });
  },

  // Rotate a client's portal access (logs them out everywhere, kills old links).
  revokePortal: function (req) {
    return withLock(function () {
      var c = Core.byId(readTable("clients"), req.clientId);
      if (!c) return { ok: false };
      upsertRowsRaw("clients", [{ id: c.id, _passVer: String((+c._passVer || 0) + 1), _passHash: "", portalActive: "false" }]);
      audit("admin", "revoke_portal", c.id);
      return { ok: true };
    });
  },

  changeAdminPassword: function (req) {
    var p = PropertiesService.getScriptProperties();
    if (!safeEqual(hashPassword(String(req.current || ""), p.getProperty("ADMIN_SALT")), p.getProperty("ADMIN_HASH"))) {
      noteFail("admin"); return { ok: false, error: "bad_password" };
    }
    var err = passwordProblem(req.password, 10);
    if (err) return { ok: false, error: "weak", message: err };
    var salt = randomHex(16);
    p.setProperty("ADMIN_SALT", salt);
    p.setProperty("ADMIN_HASH", hashPassword(req.password, salt));
    p.setProperty("TOKEN_SECRET", randomHex(48)); // sign out all other sessions (and client sessions)
    audit("admin", "change_password");
    return { ok: true, token: sign({ r: "admin", exp: Date.now() + ADMIN_TTL_H * 3600e3 }) };
  },

  importLegacy: function (req) {
    return withLock(function () { return importLegacy(String(req.spreadsheetId || ""), !!req.force); });
  },

  backupNow: function () {
    return { ok: true, url: backup() };
  },

  auditLog: function () {
    return { ok: true, rows: readTable("audit").slice(-200).reverse() };
  }
};

// ======================================================================= calendar
function calendar() {
  var st = Core.settingsOf(loadDb());
  var id = st.calendarId || "primary";
  var cal = id === "primary" ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id);
  return cal || CalendarApp.getDefaultCalendar();
}
function eventKey(ev) {
  return ev.isRecurringEvent() ? ev.getId() + "@" + ev.getStartTime().getTime() : ev.getId();
}
function findEvent(key) {
  var cal = calendar();
  var parts = String(key).split("@");
  if (parts.length === 2) {
    var t = new Date(+parts[1]);
    var evs = cal.getEvents(new Date(t.getTime() - 60e3), new Date(t.getTime() + 60e3));
    for (var i = 0; i < evs.length; i++) if (evs[i].getId() === parts[0]) return evs[i];
    return null;
  }
  try { return cal.getEventById(parts[0]); } catch (e) { return null; }
}
function busyIntervals(from, to) {
  var out = [];
  try {
    calendar().getEvents(from, to).forEach(function (ev) {
      if (ev.isAllDayEvent()) return;
      out.push({ start: Core.ymdhm(ev.getStartTime()), end: Core.ymdhm(ev.getEndTime()) });
    });
  } catch (e) {}
  readTable("sessions").forEach(function (s) {
    if (s.status !== "planned" || !s.date) return;
    var d = Core.toDate(s.date);
    out.push({ start: s.date, end: Core.ymdhm(new Date(d.getTime() + (Core.num(s.durationMin) || 60) * 60e3)) });
  });
  readTable("bookings").forEach(function (b) {
    if (b.status !== "pending" || !b.start) return;
    var d = Core.toDate(b.start);
    out.push({ start: b.start, end: Core.ymdhm(new Date(d.getTime() + (Core.num(b.durationMin) || 60) * 60e3)) });
  });
  return out;
}

function syncCalendarJob() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try { _tableCache = {}; syncCalendar(); } finally { lock.releaseLock(); }
}

// Google Calendar -> system. (System -> Calendar happens when sessions are saved.)
function syncCalendar() {
  var d = loadDb();
  var st = Core.settingsOf(d);
  var cal = calendar();
  var now = new Date();
  var from = new Date(now.getTime() - 45 * 864e5), to = new Date(now.getTime() + 120 * 864e5);
  var events = cal.getEvents(from, to);
  var sessions = d.sessions.slice();
  var byEvent = {};
  sessions.forEach(function (s) { if (s.calendarEventId) byEvent[s.calendarEventId] = s; });
  var seen = {}, added = 0, updated = 0, cancelled = 0, unmatched = 0;
  var keyword = String(st.calendarKeyword || "").trim();
  var changes = [];

  events.forEach(function (ev) {
    if (ev.isAllDayEvent()) return;
    var title = ev.getTitle() || "";
    var desc = ev.getDescription() || "";
    var key = eventKey(ev);
    var tag = desc.match(/\[crm:([A-Za-z0-9_]+)\]/);
    var s = byEvent[key] || (tag ? Core.byId(sessions, tag[1]) : null);
    if (!s && keyword && title.indexOf(keyword) === -1) return;
    seen[key] = true;
    var start = Core.ymdhm(ev.getStartTime());
    var dur = Math.round((ev.getEndTime().getTime() - ev.getStartTime().getTime()) / 60e3);
    var loc = ev.getLocation() || "";
    if (s) {
      if (s.status === "planned" || s.status === "unassigned") {
        if (s.date !== start || String(s.durationMin) !== String(dur) || (loc && s.location !== loc) || s.calendarEventId !== key) {
          changes.push({ id: s.id, date: start, durationMin: dur, location: loc || s.location, calendarEventId: key, calendarTitle: title });
          updated++;
        }
      }
      return;
    }
    var c = Core.matchClient(d.clients, title);
    if (!c) unmatched++;
    changes.push({ id: Core.uid("se"), clientId: c ? c.id : "", date: start, durationMin: dur, location: loc,
      status: c ? "planned" : "unassigned", source: "calendar", calendarEventId: key, calendarTitle: title });
    added++;
  });

  // Events removed from the calendar -> future/planned sessions are marked cancelled.
  var fromStr = Core.ymdhm(from), toStr = Core.ymdhm(to);
  sessions.forEach(function (s) {
    if (!s.calendarEventId || seen[s.calendarEventId]) return;
    if (!s.date || s.date < fromStr || s.date > toStr) return;
    if (s.status === "planned") { changes.push({ id: s.id, status: "cancel_ontime", notes: (s.notes ? s.notes + " | " : "") + "האירוע נמחק מהיומן" }); cancelled++; }
    if (s.status === "unassigned") changes.push({ id: s.id, status: "ignored" });
  });

  if (changes.length) upsertRows("sessions", changes);
  PropertiesService.getScriptProperties().setProperty("LAST_SYNC", Core.ymdhm(new Date()));
  return { ok: true, added: added, updated: updated, cancelled: cancelled, unmatched: unmatched };
}

var STATUS_COLOR = { held: "10", cancel_ontime: "8", cancel_late: "11", planned: "" }; // green, gray, red

// System -> Google Calendar: create events for new sessions, reflect status/date changes.
function afterSessionsSaved(saved, req) {
  var clients = readTable("clients");
  var updates = [];
  saved.forEach(function (s) {
    if (!s.clientId || s.status === "unassigned" || s.status === "ignored") return;
    try {
      var ev = s.calendarEventId ? findEvent(s.calendarEventId) : null;
      var c = Core.byId(clients, s.clientId) || {};
      if (!ev && !s.calendarEventId && (req.createEvents || s.addToCalendar === "true" || s.addToCalendar === true) && s.status === "planned" && s.date) {
        var start = Core.toDate(s.date);
        var end = new Date(start.getTime() + (Core.num(s.durationMin) || 60) * 60e3);
        ev = calendar().createEvent("פגישה - " + c.name, start, end, { location: s.location || "", description: "[crm:" + s.id + "]" });
        updates.push({ id: s.id, calendarEventId: eventKey(ev), addToCalendar: "" });
      } else if (ev) {
        if (s.status === "planned" && s.date) {
          var st2 = Core.toDate(s.date);
          var en2 = new Date(st2.getTime() + (Core.num(s.durationMin) || 60) * 60e3);
          if (ev.getStartTime().getTime() !== st2.getTime() || ev.getEndTime().getTime() !== en2.getTime()) {
            if (!ev.isRecurringEvent()) ev.setTime(st2, en2);
          }
        }
        var color = STATUS_COLOR[s.status];
        if (color) ev.setColor(color);
      }
    } catch (e) { audit("system", "calendar_error", String(e.message || e)); }
  });
  if (updates.length) upsertRows("sessions", updates);
}

// ======================================================================= drive
function rootFolder() {
  return DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty("ROOT_FOLDER_ID"));
}
function subFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function clientFolder(clientId) {
  var c = Core.byId(readTable("clients"), clientId);
  if (c && c.driveFolderId) { try { return DriveApp.getFolderById(c.driveFolderId); } catch (e) {} }
  var name = c ? (c.code ? c.code + " - " : "") + c.name : "ללא לקוח";
  var f = subFolder(subFolder(rootFolder(), "לקוחות"), name);
  if (c) upsertRows("clients", [{ id: c.id, driveFolderId: f.getId() }]);
  return f;
}
function saveUpload(clientId, file, folderName, shareWithClient) {
  if (!file || !file.data) throw new Error("no file");
  var bytes = Utilities.base64Decode(String(file.data).replace(/^data:[^,]*,/, ""));
  if (bytes.length > MAX_UPLOAD_MB * 1024 * 1024) throw new Error("הקובץ גדול מדי");
  var safeName = String(file.name || "file").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
  var blob = Utilities.newBlob(bytes, file.mimeType || "application/octet-stream", safeName);
  var folder = subFolder(clientFolder(clientId), folderName);
  var f = folder.createFile(blob);
  f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  if (shareWithClient) shareWith(f, clientId);
  return { id: f.getId(), url: f.getUrl(), name: safeName };
}
// Share a Drive file only with the client's own e-mail (never "anyone with the link").
function shareWith(file, clientId) {
  var c = Core.byId(readTable("clients"), clientId);
  if (!c || !c.email) return false;
  try { file.addViewer(String(c.email).trim()); return true; } catch (e) { return false; }
}
// Keep a Google Doc copy of every summary inside the client's Drive folder.
function archiveSummary(s) {
  try {
    var c = Core.byId(readTable("clients"), s.clientId) || { name: "" };
    var sess = Core.byId(readTable("sessions"), s.sessionId);
    var title = "סיכום פגישה - " + c.name + " - " + Core.fmtDate(sess ? sess.date : s.date);
    var doc;
    if (s.docId) { try { doc = DocumentApp.openById(s.docId); } catch (e) { doc = null; } }
    if (!doc) {
      doc = DocumentApp.create(title);
      DriveApp.getFileById(doc.getId()).moveTo(subFolder(clientFolder(s.clientId), "הקלטות וסיכומים"));
    }
    var body = doc.getBody();
    body.clear();
    body.setAttributes({});
    body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING1);
    [["נקודות שעלו בפגישה", s.points], ["סיכום (Notebook)", s.text], ["החלטות שהתקבלו", s.decisions], ["שיעורי בית", s.homework], ["הערות פנימיות", s.internalNotes]]
      .forEach(function (sec) {
        if (!sec[1]) return;
        body.appendParagraph(sec[0]).setHeading(DocumentApp.ParagraphHeading.HEADING2);
        String(sec[1]).split(/\r?\n/).forEach(function (l) { body.appendParagraph(l); });
      });
    if (s.recordingUrl) body.appendParagraph("הקלטה: " + s.recordingUrl);
    doc.saveAndClose();
    if (s.recordingFileId && Core.bool(s.shared)) {
      var st = Core.settingsOf(loadDb());
      if (Core.bool(st.shareRecordingsWithClient)) { try { shareWith(DriveApp.getFileById(s.recordingFileId), s.clientId); } catch (e) {} }
    }
    if (s.docId !== doc.getId()) { upsertRows("summaries", [{ id: s.id, docId: doc.getId(), docUrl: doc.getUrl() }]); s.docId = doc.getId(); s.docUrl = doc.getUrl(); }
  } catch (e) { audit("system", "archive_error", String(e.message || e)); }
  return s;
}
function backup() {
  var f = DriveApp.getFileById(PropertiesService.getScriptProperties().getProperty("DB_ID"));
  var copy = f.makeCopy("גיבוי " + Core.ymd(new Date()) + " - " + f.getName(), subFolder(rootFolder(), "גיבויים"));
  // keep the latest 30 backups
  var files = [], it = subFolder(rootFolder(), "גיבויים").getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(30).forEach(function (x) { x.setTrashed(true); });
  return copy.getUrl();
}

// ======================================================================= email
function portalBase() {
  var st = Core.settingsOf(loadDb());
  return String(st.siteUrl || "").replace(/\/$/, "") + "/portal/";
}
function buildEmail(template, clientId, opts) {
  var d = loadDb();
  var st = Core.settingsOf(d);
  var c = Core.byId(d.clients, clientId);
  if (!c) throw new Error("לקוח לא נמצא");
  var acc = Core.clientAccount(d, clientId, new Date());
  var base = portalBase();
  var ctx = { st: st, client: c, account: acc, portalUrl: base, bookingUrl: base + "#book", validity: opts.validity };
  if (template === "welcome" || template === "password") {
    var hours = opts.ttlHours || SETUP_TTL_H;
    ctx.setupUrl = base + "?setup=" + encodeURIComponent(sign({ r: "setup", c: c.id, v: String(c._passVer || "0"), exp: Date.now() + hours * 3600e3 }));
    ctx.validity = opts.validity || (hours >= 48 ? Math.round(hours / 24) + " ימים" : hours + " שעות");
  }
  if (opts.sessionId) ctx.session = Core.byId(d.sessions, opts.sessionId);
  if (template === "summary") {
    ctx.summary = (d.summaries || []).filter(function (s) { return s.sessionId === opts.sessionId || s.id === opts.summaryId; })[0] || {};
    if (!ctx.session && ctx.summary.sessionId) ctx.session = Core.byId(d.sessions, ctx.summary.sessionId);
  }
  var r = EmailTemplates.render(template, ctx);
  r.to = c.email || "";
  return r;
}
function sendTemplate(template, clientId, opts) {
  opts = opts || {};
  var r = buildEmail(template, clientId, opts);
  if (!r.to) return { ok: false, error: "no_email" };
  var st = Core.settingsOf(loadDb());
  MailApp.sendEmail({ to: r.to, subject: opts.subject || r.subject, htmlBody: r.html, name: st.coachName || "",
    body: "לצפייה בהודעה יש לפתוח אותה בתצוגת HTML." });
  upsertRows("email_log", [{ id: Core.uid("em"), clientId: clientId, template: template, to: r.to, subject: r.subject, date: Core.ymdhm(new Date()) }]);
  if (template === "summary" && opts.sessionId) {
    var sm = readTable("summaries").filter(function (s) { return s.sessionId === opts.sessionId; })[0];
    if (sm) upsertRows("summaries", [{ id: sm.id, sentAt: Core.ymdhm(new Date()), shared: "true" }]);
  }
  audit("admin", "email " + template, clientId);
  return { ok: true, to: r.to };
}
function notifyAdmin(subject, text) {
  try { MailApp.sendEmail(Session.getEffectiveUser().getEmail(), "[מערכת] " + subject, text); } catch (e) {}
}

// ======================================================================= daily job
function dailyJob() {
  _tableCache = {};
  try { backup(); } catch (e) { audit("system", "backup_error", String(e.message || e)); }
  var d = loadDb();
  var st = Core.settingsOf(d);
  var now = new Date();
  var digest = [];
  var accs = Core.allAccounts(d, now);
  var awaiting = 0;
  accs.forEach(function (a) { awaiting += a.awaiting.length; });
  if (awaiting) digest.push("• " + awaiting + " פגישות ממתינות לאישור סטטוס");
  var renew = accs.filter(function (a) { return a.renewalAlert; });
  if (renew.length) digest.push("• חידוש סל: " + renew.map(function (a) { return a.client.name; }).join(", "));
  // Automatic "let's book the next session" reminders (off by default).
  if (Core.bool(st.autoReminders)) {
    var days = Core.num(st.reminderAfterDays) || 10;
    var log = readTable("email_log");
    accs.forEach(function (a) {
      if (a.client.status === "inactive" || !a.client.email || a.nextSession || !a.lastHeld) return;
      var since = (now - Core.toDate(a.lastHeld.date)) / 864e5;
      if (since < days || since > 60) return;
      var already = log.some(function (l) { return l.clientId === a.client.id && l.template === "reminder" && l.date > a.lastHeld.date; });
      if (!already) { try { sendTemplate("reminder", a.client.id, {}); digest.push("• נשלחה תזכורת ל-" + a.client.name); } catch (e) {} }
    });
  }
  if (digest.length) notifyAdmin("סיכום יומי", digest.join("\n") + "\n\n" + st.siteUrl + "/app/");
}

// ======================================================================= legacy import
/*
 * Imports the existing "ניהול יומן" workbook (clients, sessions log, payments
 * log and the monthly expense table). Tables are found by their header text,
 * so tab names and order don't matter. Runs server-side: the data never
 * leaves your Google account.
 */
function importLegacy(spreadsheetId, force) {
  if (!spreadsheetId) return { ok: false, error: "missing_id" };
  var st = Core.settingsOf(loadDb());
  if (Core.bool(st.legacyImported) && !force) return { ok: false, error: "already_imported" };
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var clients = [], sessions = [], payments = [], charges = [], expenses = [];
  var codeToId = {}, nameToId = {};

  function n(v) { return Core.num(String(v).replace(/[^\d.\-]/g, "")); }
  function parseDmy(v) {
    var m = String(v || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return "";
    var a = +m[1], b = +m[2];
    var day = a, mon = b;
    if (b > 12 && a <= 12) { day = b; mon = a; } // US-style m/d/yyyy rows
    return m[3] + "-" + Core.pad(mon) + "-" + Core.pad(day);
  }
  var methodMap = { "מזומן": "cash", "העברה": "transfer", "אשראי": "credit", "צ'ק": "check", "ביט": "bit" };

  ss.getSheets().forEach(function (sh) {
    var v = sh.getDataRange().getDisplayValues();
    for (var r = 0; r < v.length; r++) {
      var row = v[r].map(function (x) { return String(x).trim(); });
      var joined = row.join("|");
      // --- clients table
      if (row.indexOf("מספר קוד לקוח") !== -1 && joined.indexOf("גורם מפנה") !== -1) {
        var ci = row.indexOf("מספר קוד לקוח");
        for (var i = r + 1; i < v.length; i++) {
          var x = v[i];
          var code = String(x[ci]).trim(), name = String(x[ci + 1] || "").trim();
          if (!code || !name) continue;
          var id = "cl" + code;
          codeToId[code] = id; nameToId[name] = id;
          var notes = [x[ci + 5], x[ci + 6]].map(function (s) { return String(s || "").trim(); }).filter(Boolean).join(" | ");
          clients.push({ id: id, code: code, name: name, referrer: String(x[ci + 2] || "").trim(), pricingModel: "single",
            unitType: "hour", rate: n(x[ci + 4]) || "", status: "active", notes: notes, source: "legacy", createdAt: Core.ymd(new Date()) });
          var once = n(x[ci + 3]);
          if (once) charges.push({ id: "chl" + code, clientId: id, date: "", amount: once,
            reason: once < 0 ? "הנחה / פגישת מתנה (מהגיליון הקודם)" : "תשלום חד-פעמי (מהגיליון הקודם)" });
        }
      }
      // --- sessions log + payments log (side by side)
      if (row.indexOf("משך פגישה") !== -1 && row.indexOf("מספר לקוח") !== -1) {
        var si = row.indexOf("מספר לקוח");
        var pi = row.indexOf("מספר לקוח", si + 1);
        for (var k = r + 1; k < v.length; k++) {
          var y = v[k];
          var sc = String(y[si]).trim();
          if (sc && n(y[si + 3])) {
            var units = n(y[si + 3]);
            sessions.push({ id: "sel" + k + "_" + sh.getIndex(), clientCode: sc, clientName: String(y[si + 1]).trim(), date: parseDmy(y[si + 2]),
              units: units, durationMin: Math.round(Math.min(units, 3) * 60), status: "held", source: "legacy" });
          }
          if (pi !== -1) {
            var pc = String(y[pi]).trim();
            if (pc && n(y[pi + 2])) {
              var method = String(y[pi + 4] || "").trim();
              payments.push({ id: "pal" + k + "_" + sh.getIndex(), clientCode: pc, clientName: String(y[pi + 1]).trim(), amount: n(y[pi + 2]),
                date: parseDmy(y[pi + 3]), method: methodMap[method] || (method ? "other" : "cash"), methodNote: methodMap[method] ? "" : method, source: "legacy" });
            }
          }
        }
      }
      // --- monthly business expenses
      if (row.indexOf("קליניקה") !== -1 && (row.indexOf("זילברטסט") !== -1 || row.indexOf("קורס עסקי") !== -1)) {
        var catCols = {};
        var catMap = { "קליניקה": "שכירות חדר / קליניקה", "קורס עסקי": "קורסים והכשרות", "זילברטסט": "מבדקים (זילבר וכד')",
          "נטסטיק": "אינטרנט / שרת / אתר", "פגישות עם מנטור": "מנטורינג" };
        row.forEach(function (h, idx) { if (catMap[h]) catCols[idx] = catMap[h]; });
        var cur = Core.thisMonth(new Date());
        for (var m2 = r + 1; m2 < v.length; m2++) {
          var z = v[m2];
          for (var col = 0; col < 4; col++) {
            var mm = String(z[col]).trim().match(/^(\d{2})\/(\d{4})$/);
            if (!mm) continue;
            var mk = mm[2] + "-" + mm[1];
            if (mk > cur) break;
            Object.keys(catCols).forEach(function (cc) {
              var amt = n(z[cc]);
              if (amt) expenses.push({ id: "exl" + mk + "_" + cc, date: mk + "-01", category: catCols[cc], amount: amt, recurring: "none", notes: "מהגיליון הקודם" });
            });
            break;
          }
        }
      }
    }
  });

  function resolve(list) {
    return list.map(function (x) {
      x.clientId = codeToId[x.clientCode] || nameToId[x.clientName] || "";
      delete x.clientCode; delete x.clientName;
      return x;
    }).filter(function (x) { return x.clientId; });
  }
  sessions = resolve(sessions);
  payments = resolve(payments);

  // Package deals written as free-text notes ("3000 ש"ח ל 10 שעות", "1500 עבור 5 פגישות",
  // "5 פגישות ב 1500", "1500 * 5") become real packages, flagged for review.
  var packages = [];
  clients.forEach(function (c) {
    var t = String(c.notes || "");
    if (!t || /(^|\|\s)אם |הצאתי/.test(t)) return;
    var m, price, units, type = "session";
    if ((m = t.match(/(\d{3,5})\s*(?:ש"ח|₪)?\s*(?:ל|עבור)\s*-?\s*(\d{1,2})\s*(שעות|פגישות)/))) { price = +m[1]; units = +m[2]; type = m[3] === "שעות" ? "hour" : "session"; }
    else if ((m = t.match(/(\d{1,2})\s*(פגישות|שעות)\s*ב\s*-?\s*(\d{3,5})/))) { units = +m[1]; price = +m[3]; type = m[2] === "שעות" ? "hour" : "session"; }
    else if ((m = t.match(/(\d{3,5})\s*\*\s*(\d{1,2})(?!\d)/))) { price = +m[1]; units = +m[2]; }
    if (!price || !units) return;
    var first = sessions.filter(function (x) { return x.clientId === c.id && x.date; }).map(function (x) { return x.date; }).sort()[0] || Core.ymd(new Date());
    packages.push({ id: "pkl" + c.code, clientId: c.id, name: "סל " + units + " " + (type === "hour" ? "שעות" : "פגישות"), units: units, unitType: type,
      price: price, startDate: first, notes: "נוצר אוטומטית מהערה בגיליון - לבדיקה", source: "legacy" });
    c.pricingModel = "package";
  });

  if (force) {
    ["clients", "sessions", "payments", "charges", "expenses", "packages"].forEach(function (t) {
      writeTable(t, readTable(t).filter(function (r) { return r.source !== "legacy" && !/^(chl|exl|pkl)/.test(r.id); }));
    });
  }
  upsertRows("clients", clients);
  upsertRows("sessions", sessions);
  upsertRows("payments", payments);
  upsertRows("charges", charges);
  upsertRows("packages", packages);
  upsertRows("expenses", expenses);
  upsertRows("settings", [{ id: "legacyImported", value: "true" }, { id: "legacySheetId", value: spreadsheetId }]);
  audit("admin", "import_legacy", clients.length + "/" + sessions.length + "/" + payments.length);
  return { ok: true, clients: clients.length, sessions: sessions.length, payments: payments.length, charges: charges.length, expenses: expenses.length, packages: packages.length };
}
