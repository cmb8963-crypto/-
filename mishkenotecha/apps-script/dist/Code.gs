// ==== נוצר אוטומטית על ידי apps-script/build.sh - לא לערוך ידנית ====

/*
 * core.js - all business rules of "משכנותיך": labels, dates, validation and
 * every write operation (tasks, cases, case updates, documents).
 *
 * Pure functions only: no DOM, no network, no storage. The same file runs in
 * the browser (demo mode), in Google Apps Script (copied by build.sh) and in
 * the Vitest tests, so the rules are enforced identically everywhere.
 *
 * Every write goes through MK.run(op, db, input, ctx). It never mutates the db
 * it receives: it returns { ok, changes: { table: [rows] }, removed: { table: [ids] } }
 * and the caller persists all of it together.
 *
 * Contains NO real data.
 */
(function (root, factory) {
  var MK = factory();
  if (typeof module === "object" && module.exports) module.exports = MK;
  else root.MK = MK;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ================================================================ labels
  var KINDS = {
    mine:   { label: "שלי",             short: "שלי",             icon: "user" },
    people: { label: "מעקב אחרי אנשים", short: "מעקב אחרי מישהו", icon: "eye" },
    "case": { label: "מעקב תיקים",      short: "משימה בתיק",      icon: "folder" },
    org:    { label: "ניהול ארגוני",     short: "ניהול ארגוני",     icon: "briefcase" }
  };
  var KIND_ORDER = ["mine", "people", "case", "org"];
  var CASE_STATUS = { open: "פתוח", waiting: "בהמתנה", closed: "סגור" };
  var CASE_STATUS_ORDER = ["open", "waiting", "closed"];
  var DEPTS = ["אסטרטגיה", "דירקטוריון ובעלים", "מנכ\"ל", "מוצר", "כספים", "שיווק ומכירות", "אדמיניסטרציה ולוגיסטיקה", "פיתוח עסקי", "מדריכי חתנים"];
  var ROLES = { ADMIN: "מנהל מערכת", STAFF: "צוות", INSTRUCTOR: "מדריך" };
  var TABLES = ["users", "cases", "tasks", "logs", "documents"];
  var MAX_UPLOAD_MB = 25;

  // ================================================================ small utils
  function bool(v) { return v === true || v === "true" || v === "TRUE" || v === 1 || v === "1"; }
  function str(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function byId(list, id) {
    if (!id) return null;
    for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function uid(prefix) { return (prefix || "id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function copy(o) { var r = {}; Object.keys(o || {}).forEach(function (k) { r[k] = o[k]; }); return r; }
  function escapeHtml(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function normEmail(e) { return str(e).toLowerCase(); }
  function isEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(e)); }
  function passwordProblem(pw) {
    pw = String(pw || "");
    if (pw.length < 10) return "הסיסמה צריכה לכלול לפחות 10 תווים";
    if (!/[0-9]/.test(pw) || !/[^0-9]/.test(pw)) return "הסיסמה צריכה לכלול גם ספרות וגם אותיות";
    return "";
  }

  // ================================================================ dates (calendar days are "yyyy-MM-dd"; "today" is Israel time)
  var TZ = "Asia/Jerusalem";
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isYmd(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str(s))) return false;
    var p = s.split("-").map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function todayYmd(now) {
    var o = {};
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now ? new Date(now) : new Date()).forEach(function (p) { o[p.type] = p.value; });
    return o.year + "-" + o.month + "-" + o.day;
  }
  function hourIL(now) { return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(now ? new Date(now) : new Date())) || 0; }
  function timeIL(iso) { return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)); }
  function utc(ymd) { var p = ymd.split("-").map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function addDays(ymd, n) { var d = new Date(utc(ymd) + n * 864e5); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function diffDays(a, b) { return Math.round((utc(b) - utc(a)) / 864e5); }
  function fmtDate(ymd) { ymd = str(ymd).slice(0, 10); if (!isYmd(ymd)) return ""; var p = ymd.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
  var WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  function weekday(ymd) { return WEEKDAYS[new Date(utc(ymd)).getUTCDay()]; }
  function relDay(ymd, today) {
    var n = diffDays(today, ymd);
    if (n === 0) return "היום"; if (n === 1) return "מחר"; if (n === -1) return "אתמול"; if (n === 2) return "מחרתיים";
    if (n < 0) return "לפני " + (-n) + " ימים";
    if (n < 7) return "יום " + weekday(ymd);
    return "בעוד " + n + " ימים";
  }
  function ago(ymd, today) { var n = diffDays(ymd, today); return n <= 0 ? "היום" : n === 1 ? "אתמול" : "לפני " + n + " ימים"; }
  function quickDates(today) {
    return [{ key: "today", label: "היום", date: today }, { key: "tomorrow", label: "מחר", date: addDays(today, 1) },
      { key: "3days", label: "עוד 3 ימים", date: addDays(today, 3) }, { key: "week", label: "שבוע הבא", date: addDays(today, 7) }];
  }

  // ================================================================ queries
  function kindOf(t) { return KINDS[t.kind] ? t.kind : "mine"; }
  function isDone(t) { return bool(t.done); }
  function openTasks(db) { return (db.tasks || []).filter(function (t) { return !isDone(t); }); }
  function caseTasks(db, caseId) { return (db.tasks || []).filter(function (t) { return t.caseId === caseId; }); }
  function nextOfCase(db, caseId) {
    return caseTasks(db, caseId).filter(function (t) { return !isDone(t); }).sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : 0; })[0] || null;
  }
  function people(db) {
    var s = {};
    (db.tasks || []).forEach(function (t) { if (t.who) s[t.who] = true; if (t.owner) s[t.owner] = true; });
    return Object.keys(s).sort();
  }
  function byDue(a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : str(a.createdAt) < str(b.createdAt) ? -1 : 1; }

  /** Home screen groups. filter: { kind, caseId } */
  function diary(db, today, filter) {
    filter = filter || {};
    var out = { overdue: [], today: [], upcoming: [] };
    openTasks(db).forEach(function (t) {
      if (filter.kind && kindOf(t) !== filter.kind) return;
      if (filter.caseId && t.caseId !== filter.caseId) return;
      if (t.caseId) { var c = byId(db.cases, t.caseId); if (c && c.status === "closed") return; }
      (t.due < today ? out.overdue : t.due === today ? out.today : out.upcoming).push(t);
    });
    out.overdue.sort(byDue); out.today.sort(byDue); out.upcoming.sort(byDue);
    return out;
  }
  function doneTasks(db) {
    return (db.tasks || []).filter(isDone).sort(function (a, b) { return str(a.completedAt) < str(b.completedAt) ? 1 : -1; });
  }
  function counts(db, today) {
    var open = openTasks(db), c = { overdue: 0, today: 0, done: doneTasks(db).length, all: open.length };
    KIND_ORDER.forEach(function (k) { c[k] = 0; });
    open.forEach(function (t) { c[kindOf(t)]++; if (t.due < today) c.overdue++; else if (t.due === today) c.today++; });
    c.openCases = (db.cases || []).filter(function (x) { return x.status !== "closed"; }).length;
    return c;
  }
  /** Case list with search; filter: { q, status: "open" (= not closed) | "closed" | "all" } */
  function casesList(db, filter) {
    filter = filter || {};
    var q = str(filter.q).toLowerCase(), st = filter.status || "open";
    return (db.cases || []).filter(function (c) {
      if (st === "open" && c.status === "closed") return false;
      if (st === "closed" && c.status !== "closed") return false;
      if (q && [c.name, c.city, c.info, c.referredBy, c.knownBy, c.phone].join(" ").toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).map(function (c) { return { "case": c, next: nextOfCase(db, c.id) }; }).sort(function (a, b) {
      var da = a.next ? a.next.due : "9999", dbb = b.next ? b.next.due : "9999";
      return da < dbb ? -1 : da > dbb ? 1 : str(a["case"].name) < str(b["case"].name) ? -1 : 1;
    });
  }
  /** Case history, newest first: updates, finished tasks and documents. */
  function caseTimeline(db, caseId) {
    var ev = [];
    (db.logs || []).forEach(function (l) { if (l.caseId === caseId) ev.push({ type: "log", at: l.createdAt, item: l }); });
    caseTasks(db, caseId).forEach(function (t) { if (isDone(t)) ev.push({ type: "task", at: t.completedAt, item: t }); });
    (db.documents || []).forEach(function (d) { if (d.caseId === caseId) ev.push({ type: "doc", at: d.createdAt, item: d }); });
    return ev.sort(function (a, b) { return str(a.at) < str(b.at) ? 1 : -1; });
  }
  function caseDocuments(db, caseId) {
    return (db.documents || []).filter(function (d) { return d.caseId === caseId; }).sort(function (a, b) { return str(a.createdAt) < str(b.createdAt) ? 1 : -1; });
  }

  // ================================================================ validation
  function V() { this.errors = {}; }
  V.prototype.text = function (key, label, val, opts) {
    opts = opts || {};
    var v = str(val), max = opts.max || 300;
    if (opts.required && !v) this.errors[key] = (opts.msg || "יש למלא " + label);
    else if (v.length > max) this.errors[key] = label + " ארוך מדי (עד " + max + " תווים)";
    return v;
  };
  V.prototype.date = function (key, label, val, opts) {
    opts = opts || {};
    var v = str(val);
    if (!v) { if (opts.required) this.errors[key] = "יש לבחור " + label; return ""; }
    if (!isYmd(v)) { this.errors[key] = label + ": תאריך לא תקין"; return ""; }
    if (opts.min && v < opts.min) { this.errors[key] = "בחרו תאריך מהיום והלאה"; return ""; }
    if (opts.max && v > opts.max) { this.errors[key] = label + " לא יכול להיות בעתיד"; return ""; }
    return v;
  };
  V.prototype.fail = function () {
    var keys = Object.keys(this.errors);
    return keys.length ? { ok: false, error: "validation", message: this.errors[keys[0]], fields: this.errors } : null;
  };
  function err(message, code) { return { ok: false, error: code || "rule", message: message }; }
  var NOT_FOUND = "הרשומה לא נמצאה. ייתכן שהנתונים לא מעודכנים, נסו לרענן.";

  function Changes() { this.rows = {}; this.gone = {}; }
  Changes.prototype.put = function (table, row) {
    var list = this.rows[table] = this.rows[table] || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === row.id) { list[i] = row; return row; }
    list.push(row);
    return row;
  };
  Changes.prototype.remove = function (table, id) { (this.gone[table] = this.gone[table] || []).push(id); };
  Changes.prototype.result = function (extra) {
    var r = { ok: true, changes: this.rows, removed: this.gone };
    Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
    return r;
  };

  /** Validates the kind-specific links of a task. */
  function taskLinks(db, v, kind, input) {
    var o = { who: "", what: "", caseId: "", owner: "", dept: "" };
    if (kind === "people") {
      o.who = v.text("who", "אחרי מי עוקבים", input.who, { required: true, max: 80, msg: "כתבו אחרי מי עוקבים" });
      o.what = v.text("what", "מה הוא אמור לעשות", input.what, { max: 200 });
    } else if (kind === "case") {
      o.caseId = str(input.caseId);
      var c = byId(db.cases, o.caseId);
      if (!c) v.errors.caseId = "בחרו את התיק מהרשימה";
      else if (c.status === "closed") v.errors.caseId = "התיק סגור. אפשר לפתוח אותו מחדש מכרטיס התיק";
      o.owner = v.text("owner", "מי מטפל", input.owner, { max: 80 });
    } else if (kind === "org") {
      o.dept = str(input.dept);
      if (o.dept && DEPTS.indexOf(o.dept) === -1) v.errors.dept = "מחלקה לא מוכרת";
    }
    return o;
  }
  function newTask(ctx, kind, title, due, links, extra) {
    var t = { id: ctx.uid("tk"), kind: kind, title: title, due: due, original: due, moved: 0, who: links.who || "", what: links.what || "",
      caseId: links.caseId || "", owner: links.owner || "", dept: links.dept || "", done: false, result: "", completedAt: "", note: "",
      createdAt: ctx.now, createdBy: ctx.userId, openedAt: ctx.today, steps: 1, prevId: "" };
    Object.keys(extra || {}).forEach(function (k) { t[k] = extra[k]; });
    return t;
  }
  function logRow(ctx, caseId, text, auto) {
    return { id: ctx.uid("lg"), caseId: caseId, text: text, auto: !!auto, createdAt: ctx.now, by: ctx.userId };
  }
  var CASE_FIELDS = [["name", "שם התיק", 120, true], ["phone", "טלפון", 40], ["city", "עיר", 80], ["info", "נתונים חשובים", 300],
    ["referredBy", "מפנה", 200], ["knownBy", "מכיר את התיק / ראש חבורה", 200], ["notes", "הערות חשובות", 3000], ["story", "סיפור התיק", 20000]];
  function caseFields(v, input, today, cur) {
    var o = {};
    CASE_FIELDS.forEach(function (f) {
      var val = input[f[0]] === undefined && cur ? cur[f[0]] : input[f[0]];
      o[f[0]] = v.text(f[0], f[1], val, { required: f[3], max: f[2], msg: f[3] ? "כתבו את שם התיק" : "" });
    });
    var fc = input.firstContact === undefined && cur ? cur.firstContact : input.firstContact;
    o.firstContact = v.date("firstContact", "תאריך פנייה ראשונה", fc, { max: today });
    return o;
  }

  // ================================================================ operations
  var OPS = {
    addTask: function (db, input, ctx) {
      var v = new V(), kind = KINDS[input.kind] ? input.kind : "mine";
      var title = v.text("title", "מה צריך לעשות", input.title, { required: true, msg: "כתבו מה צריך לעשות" });
      var due = v.date("due", "תאריך", input.due, { required: true, min: ctx.today });
      var links = taskLinks(db, v, kind, input);
      var bad = v.fail(); if (bad) return bad;
      var ch = new Changes();
      var t = ch.put("tasks", newTask(ctx, kind, title, due, links));
      return ch.result({ id: t.id });
    },

    /**
     * Close a task: { id, result: "done"|"notdone", note, next?: { title, due, owner } }.
     * "next" opens the follow-up in the same thread (same kind and links, opening date
     * and round count carried over) - e.g. "check again with him on Thursday".
     */
    completeTask: function (db, input, ctx) {
      var t = byId(db.tasks, input.id);
      if (!t) return err(NOT_FOUND, "not_found");
      if (isDone(t)) return err("המשימה כבר סומנה", "already_done");
      var v = new V();
      var result = input.result === "notdone" ? "notdone" : "done";
      var note = v.text("note", "הפירוט", input.note, { max: 5000 });
      var next = null;
      if (input.next) {
        next = {
          title: v.text("nextTitle", "הצעד הבא", input.next.title || t.title, { required: true, msg: "כתבו מה הצעד הבא" }),
          due: v.date("nextDue", "תאריך", input.next.due, { required: true, min: ctx.today }),
          owner: v.text("nextOwner", "מי מטפל", input.next.owner === undefined ? t.owner : input.next.owner, { max: 80 })
        };
      }
      var bad = v.fail(); if (bad) return bad;
      var ch = new Changes();
      var d = copy(t);
      d.done = true; d.result = result; d.note = note; d.completedAt = ctx.now; d.completedBy = ctx.userId;
      ch.put("tasks", d);
      var extra = { id: d.id };
      if (next) {
        var n = ch.put("tasks", newTask(ctx, kindOf(t), next.title, next.due,
          { who: t.who, what: t.what, caseId: t.caseId, owner: kindOf(t) === "case" ? next.owner : "", dept: t.dept },
          { openedAt: t.openedAt || ctx.today, steps: num(t.steps || 1) + 1, prevId: t.id }));
        extra.nextId = n.id;
      }
      if (t.caseId) { var c = byId(db.cases, t.caseId); if (c) { var cc = copy(c); cc.updatedAt = ctx.now; ch.put("cases", cc); } }
      return ch.result(extra);
    },

    /** Re-open a task that was marked by mistake (and drop a follow-up it created, if untouched). */
    undoTask: function (db, input, ctx) {
      var t = byId(db.tasks, input.id);
      if (!t) return err(NOT_FOUND, "not_found");
      if (!isDone(t)) return err("המשימה עדיין פתוחה", "not_done");
      var ch = new Changes();
      var r = copy(t);
      r.done = false; r.result = ""; r.note = ""; r.completedAt = ""; r.completedBy = "";
      ch.put("tasks", r);
      (db.tasks || []).forEach(function (x) { if (x.prevId === t.id && !isDone(x) && num(x.moved) === 0) ch.remove("tasks", x.id); });
      return ch.result({ id: r.id });
    },

    postponeTask: function (db, input, ctx) {
      var t = byId(db.tasks, input.id);
      if (!t) return err(NOT_FOUND, "not_found");
      if (isDone(t)) return err("המשימה כבר סומנה", "already_done");
      var v = new V();
      var due = v.date("due", "התאריך החדש", input.due, { required: true, min: ctx.today });
      var bad = v.fail(); if (bad) return bad;
      if (due === t.due) return err("זה התאריך הנוכחי", "same_date");
      var r = copy(t);
      if (!isYmd(r.original)) r.original = t.due;
      r.due = due; r.moved = num(t.moved) + 1; r.lastMovedAt = ctx.now;
      var ch = new Changes();
      ch.put("tasks", r);
      return ch.result({ id: r.id });
    },

    updateTask: function (db, input, ctx) {
      var t = byId(db.tasks, input.id);
      if (!t) return err(NOT_FOUND, "not_found");
      var v = new V(), kind = KINDS[input.kind] ? input.kind : kindOf(t);
      var title = v.text("title", "מה צריך לעשות", input.title === undefined ? t.title : input.title, { required: true, msg: "כתבו מה צריך לעשות" });
      var links = taskLinks(db, v, kind, input.kind === undefined ? t : input);
      var bad = v.fail(); if (bad) return bad;
      var r = copy(t);
      r.kind = kind; r.title = title;
      Object.keys(links).forEach(function (k) { r[k] = links[k]; });
      var ch = new Changes();
      ch.put("tasks", r);
      return ch.result({ id: r.id });
    },

    deleteTask: function (db, input) {
      var t = byId(db.tasks, input.id);
      if (!t) return err(NOT_FOUND, "not_found");
      var ch = new Changes();
      ch.remove("tasks", t.id);
      return ch.result({ id: t.id });
    },

    /** New case + its first task (what, who, when). */
    createCase: function (db, input, ctx) {
      var v = new V();
      var f = caseFields(v, input["case"] || {}, ctx.today);
      var ft = input.firstTask || {};
      var title = v.text("ftTitle", "המשימה הראשונה", ft.title, { required: true, msg: "כתבו מה המשימה הראשונה" });
      var due = v.date("ftDue", "תאריך", ft.due, { required: true, min: ctx.today });
      var owner = v.text("ftOwner", "מי מטפל", ft.owner, { max: 80 });
      var bad = v.fail(); if (bad) return bad;
      var ch = new Changes();
      var c = copy(f);
      c.id = ctx.uid("cs"); c.status = "open"; c.closeReason = ""; c.createdAt = ctx.now; c.updatedAt = ctx.now; c.createdBy = ctx.userId; c.folderId = "";
      if (!c.firstContact) c.firstContact = ctx.today;
      ch.put("cases", c);
      var t = ch.put("tasks", newTask(ctx, "case", title, due, { caseId: c.id, owner: owner }));
      return ch.result({ id: c.id, taskId: t.id });
    },

    updateCase: function (db, input, ctx) {
      var cur = byId(db.cases, input.id);
      if (!cur) return err(NOT_FOUND, "not_found");
      var v = new V();
      var f = caseFields(v, input["case"] || {}, ctx.today, cur);
      var bad = v.fail(); if (bad) return bad;
      var c = copy(cur);
      Object.keys(f).forEach(function (k) { c[k] = f[k]; });
      c.updatedAt = ctx.now;
      var ch = new Changes();
      ch.put("cases", c);
      return ch.result({ id: c.id });
    },

    /** open / waiting / closed. Closing needs a reason and closes the case's open tasks. */
    setCaseStatus: function (db, input, ctx) {
      var cur = byId(db.cases, input.id);
      if (!cur) return err(NOT_FOUND, "not_found");
      var status = input.status;
      if (!CASE_STATUS[status]) return err("מצב לא מוכר", "validation");
      if (status === cur.status) return err("התיק כבר במצב הזה", "same");
      var v = new V();
      var reason = status === "closed" ? v.text("reason", "סיבת הסגירה", input.reason, { required: true, max: 300, msg: "כתבו סיבת סגירה" }) : "";
      var bad = v.fail(); if (bad) return bad;
      var ch = new Changes();
      var c = copy(cur);
      c.status = status; c.closeReason = reason; c.updatedAt = ctx.now;
      if (status === "closed") {
        c.closedAt = ctx.now;
        caseTasks(db, c.id).forEach(function (t) {
          if (isDone(t)) return;
          var d = copy(t); d.done = true; d.result = "notdone"; d.note = "נסגר עם סגירת התיק"; d.completedAt = ctx.now; d.completedBy = ctx.userId;
          ch.put("tasks", d);
        });
      }
      ch.put("cases", c);
      ch.put("logs", logRow(ctx, c.id, status === "closed" ? "התיק נסגר. סיבה: " + reason : "מצב התיק שונה ל: " + CASE_STATUS[status], true));
      return ch.result({ id: c.id });
    },

    addLog: function (db, input, ctx) {
      var c = byId(db.cases, input.caseId);
      if (!c) return err(NOT_FOUND, "not_found");
      var v = new V();
      var text = v.text("text", "העדכון", input.text, { required: true, max: 10000, msg: "כתבו את העדכון" });
      var bad = v.fail(); if (bad) return bad;
      var ch = new Changes();
      var l = ch.put("logs", logRow(ctx, c.id, text));
      var cc = copy(c); cc.updatedAt = ctx.now; ch.put("cases", cc);
      return ch.result({ id: l.id });
    },

    /** Called by the server after the file is stored in Drive (or by the demo backend). */
    addDocument: function (db, input, ctx) {
      var c = byId(db.cases, input.caseId);
      if (!c) return err(NOT_FOUND, "not_found");
      var v = new V();
      var name = v.text("name", "שם הקובץ", input.name, { required: true, max: 200 });
      var note = v.text("note", "תיאור", input.note, { max: 500 });
      if (num(input.size) > MAX_UPLOAD_MB * 1024 * 1024) v.errors.size = "הקובץ גדול מדי (עד " + MAX_UPLOAD_MB + "MB)";
      var bad = v.fail(); if (bad) return bad;
      var ch = new Changes();
      var d = ch.put("documents", { id: ctx.uid("dc"), caseId: c.id, name: name, note: note, mime: str(input.mime), size: num(input.size),
        fileId: str(input.fileId), url: /^https:\/\//.test(str(input.url)) ? str(input.url) : "", createdAt: ctx.now, by: ctx.userId });
      var cc = copy(c); cc.updatedAt = ctx.now; if (input.folderId) cc.folderId = str(input.folderId); ch.put("cases", cc);
      return ch.result({ id: d.id });
    },

    removeDocument: function (db, input) {
      var d = byId(db.documents, input.id);
      if (!d) return err(NOT_FOUND, "not_found");
      var ch = new Changes();
      ch.remove("documents", d.id);
      return ch.result({ id: d.id, fileId: d.fileId });
    }
  };

  /** Single entry point for every write. ctx: { now, today, userId, uid } */
  function run(op, db, input, ctx) {
    if (!Object.prototype.hasOwnProperty.call(OPS, op)) return { ok: false, error: "unknown_action" };
    ctx = ctx || {};
    var full = { now: ctx.now || new Date().toISOString(), today: ctx.today || todayYmd(), userId: ctx.userId || "", uid: ctx.uid || uid };
    return OPS[op](db || {}, copy(input || {}), full);
  }

  /** Apply a result to an in-memory db (client cache / demo). */
  function apply(db, res) {
    Object.keys(res.changes || {}).forEach(function (t) {
      var list = db[t] = db[t] || [];
      res.changes[t].forEach(function (r) {
        for (var i = 0; i < list.length; i++) if (list[i].id === r.id) { list[i] = r; return; }
        list.push(r);
      });
    });
    Object.keys(res.removed || {}).forEach(function (t) {
      var ids = res.removed[t];
      db[t] = (db[t] || []).filter(function (r) { return ids.indexOf(r.id) === -1; });
    });
    return db;
  }

  function fileSize(n) {
    n = num(n);
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  return {
    KINDS: KINDS, KIND_ORDER: KIND_ORDER, CASE_STATUS: CASE_STATUS, CASE_STATUS_ORDER: CASE_STATUS_ORDER, DEPTS: DEPTS, ROLES: ROLES,
    TABLES: TABLES, MAX_UPLOAD_MB: MAX_UPLOAD_MB, OPS: Object.keys(OPS),
    bool: bool, str: str, num: num, byId: byId, uid: uid, escapeHtml: escapeHtml, normEmail: normEmail, isEmail: isEmail, passwordProblem: passwordProblem,
    isYmd: isYmd, todayYmd: todayYmd, hourIL: hourIL, timeIL: timeIL, addDays: addDays, diffDays: diffDays, fmtDate: fmtDate, weekday: weekday,
    relDay: relDay, ago: ago, quickDates: quickDates, fileSize: fileSize,
    kindOf: kindOf, isDone: isDone, openTasks: openTasks, caseTasks: caseTasks, nextOfCase: nextOfCase, people: people,
    diary: diary, doneTasks: doneTasks, counts: counts, casesList: casesList, caseTimeline: caseTimeline, caseDocuments: caseDocuments,
    run: run, apply: apply
  };
});

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
