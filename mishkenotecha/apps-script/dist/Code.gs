// ==== נוצר אוטומטית על ידי apps-script/build.sh - לא לערוך ידנית ====

/*
 * core.js - all business logic of "משכנותיך": labels, dates, validation,
 * case/task operations and the task-chaining rules.
 *
 * Pure functions only: no DOM, no network, no storage. The same file runs in
 * the browser (demo mode), in Google Apps Script (copied by build.sh) and in
 * the Vitest tests, so the rules are enforced identically everywhere.
 *
 * Every write goes through MK.run(action, db, req, ctx). It never mutates the
 * db it receives: it returns { ok, changes: { table: [rows...] } } and the
 * caller persists all the changes together. Before returning, it re-checks the
 * chain invariant on the resulting data, so a bad change is never written.
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
  var CASE_STATUS = { ACTIVE: "פעיל", WAITING: "בהמתנה", CLOSED: "סגור" };
  var OPEN_STATUSES = { ACTIVE: true, WAITING: true };

  var DEPARTMENTS = {
    STRATEGY: "אסטרטגיה",
    BOARD: "דירקטוריון ובעלים",
    CEO: "מנכ\"ל",
    PRODUCT: "מוצר",
    FINANCE: "כספים",
    MARKETING_SALES: "שיווק ומכירות",
    ADMIN_LOGISTICS: "אדמיניסטרציה ולוגיסטיקה",
    BUSINESS_DEV: "פיתוח עסקי",
    GROOM_INSTRUCTORS: "מדריכי חתנים"
  };

  var ROLES = { ADMIN: "מנהל מערכת", STAFF: "צוות", INSTRUCTOR: "מדריך" };

  var DEFAULT_TAGS = [
    "ליווי ומעקב תיקים",
    "ניהול תיקים מורכבים",
    "מתווה לבית בפנים",
    "קשר עם מטפלים",
    "שאלות לקודש",
    "שאלות הלכתיות לרבנים",
    "פוריות",
    "קביעת תורים לגורמי מקצוע"
  ];

  var TABLES = ["users", "cases", "tags", "contacts", "tasks"];

  var MSG = {
    required: function (f) { return "יש למלא " + f; },
    badDate: function (f) { return f + ": תאריך לא תקין"; },
    pastDate: function (f) { return f + " לא יכול להיות בעבר"; },
    notFound: "הרשומה לא נמצאה. ייתכן שנמחקה או שהנתונים לא מעודכנים - נסו לרענן.",
    taskDone: "המשימה כבר סומנה כבוצעה",
    caseClosed: "התיק סגור",
    tooLong: function (f, n) { return f + " ארוך מדי (עד " + n + " תווים)"; }
  };

  // ================================================================ small utils
  function bool(v) { return v === true || v === "true" || v === "TRUE" || v === 1 || v === "1"; }
  function str(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function byId(list, id) {
    if (!id) return null;
    for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function uid(prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function copy(o) { var r = {}; Object.keys(o || {}).forEach(function (k) { r[k] = o[k]; }); return r; }
  function splitIds(v) {
    if (Array.isArray(v)) return v.filter(Boolean).map(String);
    return str(v) ? str(v).split(",").map(function (s) { return s.trim(); }).filter(Boolean) : [];
  }
  function escapeHtml(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function normEmail(e) { return str(e).toLowerCase(); }
  function isEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(e)); }

  // ================================================================ dates
  // Calendar days are "yyyy-MM-dd" strings. "Today" is always Israel time.
  var TZ = "Asia/Jerusalem";
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isYmd(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str(s))) return false;
    var p = s.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  /** The calendar day in Jerusalem for a given instant (default: now). */
  function todayYmd(now) {
    var d = now ? new Date(now) : new Date();
    var parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    var o = {};
    parts.forEach(function (p) { o[p.type] = p.value; });
    return o.year + "-" + o.month + "-" + o.day;
  }
  /** Hour of day (0-23) in Jerusalem. */
  function hourIL(now) {
    var h = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(now ? new Date(now) : new Date());
    return Number(h) || 0;
  }
  function ymdToUtc(ymd) { var p = ymd.split("-").map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function addDays(ymd, n) {
    var d = new Date(ymdToUtc(ymd) + n * 86400000);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function diffDays(a, b) { return Math.round((ymdToUtc(b) - ymdToUtc(a)) / 86400000); } // b - a
  function fmtDate(ymd) {
    ymd = str(ymd).slice(0, 10);
    if (!isYmd(ymd)) return "";
    var p = ymd.split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }
  function fmtDateTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return fmtDate(iso);
    var t = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    return fmtDate(todayYmd(d)) + " " + t;
  }
  var WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  function weekday(ymd) { return WEEKDAYS[new Date(ymdToUtc(ymd)).getUTCDay()]; }
  /** Short relative label: "היום", "מחר", "לפני 3 ימים", "בעוד 5 ימים". */
  function relDay(ymd, today) {
    var n = diffDays(today, ymd);
    if (n === 0) return "היום";
    if (n === 1) return "מחר";
    if (n === -1) return "אתמול";
    if (n === 2) return "מחרתיים";
    if (n < 0) return "לפני " + (-n) + " ימים";
    return "בעוד " + n + " ימים";
  }
  /** Quick picks for the next task's due date. */
  function quickDates(today) {
    return [
      { key: "tomorrow", label: "מחר", date: addDays(today, 1) },
      { key: "3days", label: "עוד 3 ימים", date: addDays(today, 3) },
      { key: "week", label: "שבוע הבא", date: addDays(today, 7) }
    ];
  }

  // ================================================================ queries
  function caseTasks(db, caseId) {
    return (db.tasks || []).filter(function (t) { return t.caseId === caseId; });
  }
  function openTasksOfCase(db, caseId) {
    return caseTasks(db, caseId).filter(function (t) { return !bool(t.isDone); });
  }
  function openTaskOfCase(db, caseId) { return openTasksOfCase(db, caseId)[0] || null; }

  /** Tasks of a case in chain order (first → last), stray tasks appended by date. */
  function chainOf(db, caseId) {
    var list = caseTasks(db, caseId);
    var byPrev = {}, ids = {};
    list.forEach(function (t) { ids[t.id] = true; });
    list.forEach(function (t) { if (t.previousTaskId) byPrev[t.previousTaskId] = t; });
    var heads = list.filter(function (t) { return !t.previousTaskId || !ids[t.previousTaskId]; });
    heads.sort(function (a, b) { return str(a.createdAt) < str(b.createdAt) ? -1 : 1; });
    var out = [], seen = {};
    heads.forEach(function (h) {
      var t = h;
      while (t && !seen[t.id]) { out.push(t); seen[t.id] = true; t = byPrev[t.id]; }
    });
    list.forEach(function (t) { if (!seen[t.id]) out.push(t); });
    return out;
  }
  function lastTaskOfCase(db, caseId) {
    var c = chainOf(db, caseId);
    return c.length ? c[c.length - 1] : null;
  }

  /** Every place where the chain rule is broken. Empty array = all good. */
  function checkInvariant(db, onlyCaseId) {
    var problems = [];
    (db.cases || []).forEach(function (c) {
      if (onlyCaseId && c.id !== onlyCaseId) return;
      var open = openTasksOfCase(db, c.id).length;
      if (OPEN_STATUSES[c.status] && open !== 1) problems.push({ caseId: c.id, status: c.status, openTasks: open });
      if (c.status === "CLOSED" && open !== 0) problems.push({ caseId: c.id, status: c.status, openTasks: open });
      if (!OPEN_STATUSES[c.status] && c.status !== "CLOSED") problems.push({ caseId: c.id, status: c.status, openTasks: open });
    });
    var prevSeen = {};
    (db.tasks || []).forEach(function (t) {
      if (!t.previousTaskId) return;
      if (prevSeen[t.previousTaskId]) problems.push({ taskId: t.id, duplicatePrevious: t.previousTaskId });
      prevSeen[t.previousTaskId] = true;
    });
    return problems;
  }

  function tagMap(db) { var m = {}; (db.tags || []).forEach(function (t) { m[t.id] = t; }); return m; }
  function tagsOfCase(db, c) {
    var m = tagMap(db);
    return splitIds(c && c.tagIds).map(function (id) { return m[id]; }).filter(Boolean);
  }
  function activeTags(db) {
    return (db.tags || []).filter(function (t) { return t.isActive === undefined || t.isActive === "" || bool(t.isActive); })
      .sort(function (a, b) { return num(a.sortOrder) - num(b.sortOrder) || (a.name < b.name ? -1 : 1); });
  }

  function taskSort(db) {
    return function (a, b) {
      var ca = byId(db.cases, a.caseId), cb = byId(db.cases, b.caseId);
      var ua = ca && bool(ca.isUrgent) ? 0 : 1, ub = cb && bool(cb.isUrgent) ? 0 : 1;
      if (ua !== ub) return ua - ub;
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return str(a.createdAt) < str(b.createdAt) ? -1 : 1;
    };
  }

  /**
   * The daily diary (home screen): open tasks in three groups.
   * filters: { tagId, department, from, to, q }
   */
  function diary(db, today, filters) {
    filters = filters || {};
    var horizon = addDays(today, 7);
    if (filters.to && isYmd(filters.to) && filters.to > horizon) horizon = filters.to;
    var q = str(filters.q).toLowerCase();
    var out = { overdue: [], today: [], upcoming: [] };
    (db.tasks || []).forEach(function (t) {
      if (bool(t.isDone) || !isYmd(t.dueDate)) return;
      var c = t.caseId ? byId(db.cases, t.caseId) : null;
      if (t.caseId && (!c || c.status === "CLOSED")) return;
      if (filters.tagId && (!c || splitIds(c.tagIds).indexOf(filters.tagId) === -1)) return;
      if (filters.department && t.department !== filters.department) return;
      if (filters.from && isYmd(filters.from) && t.dueDate < filters.from) return;
      if (filters.to && isYmd(filters.to) && t.dueDate > filters.to) return;
      if (q && (str(t.title) + " " + str(c && c.fullName) + " " + str(t.project)).toLowerCase().indexOf(q) === -1) return;
      if (t.dueDate < today) out.overdue.push(t);
      else if (t.dueDate === today) out.today.push(t);
      else if (t.dueDate <= horizon) out.upcoming.push(t);
    });
    var s = taskSort(db);
    out.overdue.sort(s); out.today.sort(s); out.upcoming.sort(s);
    return out;
  }

  /** Case list with search and filters; each row carries its open task. */
  function casesList(db, filters) {
    filters = filters || {};
    var q = str(filters.q).toLowerCase();
    var rows = (db.cases || []).filter(function (c) {
      if (filters.status && c.status !== filters.status) return false;
      if (filters.tagId && splitIds(c.tagIds).indexOf(filters.tagId) === -1) return false;
      if (q && (str(c.fullName) + " " + str(c.city) + " " + str(c.phone)).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).map(function (c) { return { case: c, next: openTaskOfCase(db, c.id) }; });
    var rank = { ACTIVE: 0, WAITING: 1, CLOSED: 2 };
    rows.sort(function (a, b) {
      var r = (rank[a.case.status] || 0) - (rank[b.case.status] || 0);
      if (r) return r;
      var u = (bool(a.case.isUrgent) ? 0 : 1) - (bool(b.case.isUrgent) ? 0 : 1);
      if (u) return u;
      var da = a.next ? a.next.dueDate : "9999", dbb = b.next ? b.next.dueDate : "9999";
      if (da !== dbb) return da < dbb ? -1 : 1;
      return str(a.case.fullName) < str(b.case.fullName) ? -1 : 1;
    });
    return rows;
  }

  /** Done tasks of a case, newest first, for the timeline. */
  function timeline(db, caseId) {
    return chainOf(db, caseId).filter(function (t) { return bool(t.isDone); }).reverse();
  }

  function counts(db, today) {
    var d = diary(db, today, {});
    var open = (db.cases || []).filter(function (c) { return OPEN_STATUSES[c.status]; });
    return {
      overdue: d.overdue.length, today: d.today.length, upcoming: d.upcoming.length,
      activeCases: open.filter(function (c) { return c.status === "ACTIVE"; }).length,
      waitingCases: open.filter(function (c) { return c.status === "WAITING"; }).length,
      urgentCases: open.filter(function (c) { return bool(c.isUrgent); }).length
    };
  }

  // ================================================================ validation helpers
  function V() { this.errors = {}; }
  V.prototype.text = function (key, label, val, opts) {
    opts = opts || {};
    var v = str(val);
    if (opts.required && !v) this.errors[key] = MSG.required(label);
    else if (v.length > (opts.max || 500)) this.errors[key] = MSG.tooLong(label, opts.max || 500);
    return v;
  };
  V.prototype.date = function (key, label, val, opts) {
    opts = opts || {};
    var v = str(val);
    if (!v) { if (opts.required) this.errors[key] = MSG.required(label); return ""; }
    if (!isYmd(v)) { this.errors[key] = MSG.badDate(label); return ""; }
    if (opts.min && v < opts.min) { this.errors[key] = MSG.pastDate(label); return ""; }
    return v;
  };
  V.prototype.fail = function () {
    var keys = Object.keys(this.errors);
    if (!keys.length) return null;
    return { ok: false, error: "validation", message: this.errors[keys[0]], fields: this.errors };
  };
  function err(message, code) { return { ok: false, error: code || "rule", message: message }; }

  // ================================================================ change set
  // Collects row updates per table and can produce the "after" db for checks.
  function Changes(db) { this.db = db; this.rows = {}; }
  Changes.prototype.put = function (table, row) {
    this.rows[table] = this.rows[table] || [];
    var list = this.rows[table];
    for (var i = 0; i < list.length; i++) if (list[i].id === row.id) { list[i] = row; return row; }
    list.push(row);
    return row;
  };
  Changes.prototype.after = function () {
    var self = this, out = {};
    Object.keys(this.db).forEach(function (t) { out[t] = (self.db[t] || []).slice(); });
    Object.keys(this.rows).forEach(function (t) {
      var list = out[t] = out[t] || [];
      self.rows[t].forEach(function (r) {
        for (var i = 0; i < list.length; i++) if (list[i].id === r.id) { list[i] = r; return; }
        list.push(r);
      });
    });
    return out;
  };
  /** Final gate: refuse the whole change if any touched case breaks the chain rule. */
  Changes.prototype.result = function (extra) {
    var after = this.after();
    var touched = {};
    (this.rows.cases || []).forEach(function (c) { touched[c.id] = true; });
    (this.rows.tasks || []).forEach(function (t) { if (t.caseId) touched[t.caseId] = true; });
    var problems = [];
    Object.keys(touched).forEach(function (id) { problems = problems.concat(checkInvariant(after, id)); });
    var prev = {};
    (after.tasks || []).forEach(function (t) {
      if (!t.previousTaskId) return;
      if (prev[t.previousTaskId]) problems.push({ duplicatePrevious: t.previousTaskId });
      prev[t.previousTaskId] = true;
    });
    if (problems.length) return { ok: false, error: "invariant", message: "הפעולה נעצרה: היא הייתה משאירה תיק בלי משימה פתוחה אחת בדיוק.", problems: problems };
    var res = { ok: true, changes: this.rows };
    Object.keys(extra || {}).forEach(function (k) { res[k] = extra[k]; });
    return res;
  };

  function newTask(ctx, fields) {
    var t = {
      id: ctx.uid("tk"), title: fields.title, dueDate: fields.dueDate, originalDueDate: fields.dueDate,
      postponeCount: 0, isDone: false, completedAt: "", completionNotes: "",
      department: fields.department || "", project: fields.project || "", createdAt: ctx.now,
      caseId: fields.caseId || "", assigneeId: fields.assigneeId || ctx.userId || "",
      contactId: fields.contactId || "", previousTaskId: fields.previousTaskId || "", lastPostponedAt: ""
    };
    return t;
  }

  function cleanTagIds(db, ids) {
    var m = tagMap(db);
    var seen = {};
    return splitIds(ids).filter(function (id) { if (!m[id] || seen[id]) return false; seen[id] = true; return true; }).join(",");
  }
  function cleanDept(d) { d = str(d); return DEPARTMENTS[d] ? d : ""; }

  function caseFields(db, v, input, today) {
    return {
      fullName: v.text("fullName", "שם התיק", input.fullName, { required: true, max: 120 }),
      phone: v.text("phone", "טלפון", input.phone, { max: 40 }),
      city: v.text("city", "עיר", input.city, { max: 80 }),
      referredBy: v.text("referredBy", "גורם מפנה", input.referredBy, { max: 200 }),
      knownBy: v.text("knownBy", "מי מכיר את התיק", input.knownBy, { max: 200 }),
      firstContactDate: v.date("firstContactDate", "תאריך פנייה ראשונה", input.firstContactDate) || (input.firstContactDate === undefined ? today : ""),
      story: v.text("story", "סיפור התיק", input.story, { max: 20000 }),
      tagIds: cleanTagIds(db, input.tagIds),
      isUrgent: bool(input.isUrgent)
    };
  }

  // ================================================================ actions
  var ACTIONS = {
    /** New case + its mandatory first task. */
    createCase: function (db, req, ctx) {
      var v = new V();
      var f = caseFields(db, v, req.case || {}, ctx.today);
      var status = str((req.case || {}).status) || "ACTIVE";
      if (!OPEN_STATUSES[status]) v.errors.status = "תיק חדש יכול להיות פעיל או בהמתנה";
      var ft = req.firstTask || {};
      var title = v.text("taskTitle", "המשימה הראשונה", ft.title, { required: true, max: 300 });
      var due = v.date("taskDue", "תאריך היעד", ft.dueDate, { required: true, min: ctx.today });
      var bad = v.fail(); if (bad) return bad;
      var ch = new Changes(db);
      var c = copy(f);
      c.id = ctx.uid("cs"); c.status = status; c.closedAt = ""; c.closeReason = "";
      c.createdAt = ctx.now; c.updatedAt = ctx.now;
      ch.put("cases", c);
      var t = ch.put("tasks", newTask(ctx, { title: title, dueDate: due, caseId: c.id, department: cleanDept(ft.department) }));
      return ch.result({ caseId: c.id, taskId: t.id });
    },

    /** Edit case details. Status may move between ACTIVE and WAITING only. */
    updateCase: function (db, req, ctx) {
      var cur = byId(db.cases, req.id);
      if (!cur) return err(MSG.notFound, "not_found");
      var input = req.case || {};
      var v = new V();
      var merged = copy(cur);
      ["fullName", "phone", "city", "referredBy", "knownBy", "firstContactDate", "story", "tagIds", "isUrgent"].forEach(function (k) {
        if (input[k] === undefined) input[k] = cur[k];
      });
      var f = caseFields(db, v, input, ctx.today);
      if (input.status !== undefined && input.status !== cur.status) {
        if (cur.status === "CLOSED") v.errors.status = "תיק סגור נפתח מחדש רק עם משימה חדשה";
        else if (!OPEN_STATUSES[input.status]) v.errors.status = "סגירת תיק נעשית רק דרך סגירת המשימה הפתוחה";
        else merged.status = input.status;
      }
      var bad = v.fail(); if (bad) return bad;
      Object.keys(f).forEach(function (k) { merged[k] = f[k]; });
      merged.updatedAt = ctx.now;
      var ch = new Changes(db);
      ch.put("cases", merged);
      return ch.result({ caseId: merged.id });
    },

    /**
     * Close a task. For case tasks this is the two-step chaining flow:
     *   { taskId, notes, contactId?, next: { title, dueDate } }   → next task
     *   { taskId, notes, contactId?, closeCase: { reason } }       → case closed
     * General tasks: { taskId, notes? } only.
     */
    completeTask: function (db, req, ctx) {
      var task = byId(db.tasks, req.taskId);
      if (!task) return err(MSG.notFound, "not_found");
      if (bool(task.isDone)) return err(MSG.taskDone, "already_done");
      var v = new V();
      var isCase = !!task.caseId;
      var notes = v.text("notes", "דיווח ביצוע", req.notes, { required: isCase, max: 5000 });
      var contactId = str(req.contactId);
      if (contactId && !byId(db.contacts, contactId)) v.errors.contactId = "איש הקשר לא נמצא";
      var ch = new Changes(db);
      var done = copy(task);
      done.isDone = true; done.completedAt = ctx.now; done.completionNotes = notes;
      if (contactId) done.contactId = contactId;

      if (!isCase) {
        if (req.next || req.closeCase) v.errors.next = "למשימה כללית אין שרשור";
        var b0 = v.fail(); if (b0) return b0;
        ch.put("tasks", done);
        return ch.result({ taskId: done.id });
      }

      var c = byId(db.cases, task.caseId);
      if (!c) return err(MSG.notFound, "not_found");
      if (c.status === "CLOSED") return err(MSG.caseClosed, "case_closed");
      var hasNext = !!req.next, hasClose = !!req.closeCase;
      if (hasNext === hasClose) v.errors.what = "יש לבחור מה הלאה: משימה הבאה או סגירת התיק";
      var nextTitle = "", nextDue = "", reason = "";
      if (hasNext && !hasClose) {
        nextTitle = v.text("nextTitle", "המשימה הבאה", req.next.title, { required: true, max: 300 });
        nextDue = v.date("nextDue", "תאריך היעד", req.next.dueDate, { required: true, min: ctx.today });
      }
      if (hasClose && !hasNext) reason = v.text("closeReason", "סיבת הסגירה", req.closeCase.reason, { required: true, max: 500 });
      var bad = v.fail(); if (bad) return bad;

      ch.put("tasks", done);
      var cc = copy(c);
      cc.updatedAt = ctx.now;
      var extra = { taskId: done.id, caseId: c.id };
      if (hasNext) {
        var nt = ch.put("tasks", newTask(ctx, {
          title: nextTitle, dueDate: nextDue, caseId: c.id, previousTaskId: done.id,
          department: task.department, assigneeId: task.assigneeId
        }));
        extra.nextTaskId = nt.id;
      } else {
        cc.status = "CLOSED"; cc.closedAt = ctx.now; cc.closeReason = reason;
      }
      ch.put("cases", cc);
      return ch.result(extra);
    },

    /** Move a task's due date without closing it. Every move is counted. */
    postponeTask: function (db, req, ctx) {
      var task = byId(db.tasks, req.taskId);
      if (!task) return err(MSG.notFound, "not_found");
      if (bool(task.isDone)) return err(MSG.taskDone, "already_done");
      var v = new V();
      var due = v.date("dueDate", "התאריך החדש", req.dueDate, { required: true, min: ctx.today });
      var bad = v.fail(); if (bad) return bad;
      if (due === task.dueDate) return err("התאריך החדש זהה לתאריך הנוכחי", "same_date");
      var t = copy(task);
      if (!isYmd(t.originalDueDate)) t.originalDueDate = task.dueDate;
      t.dueDate = due;
      t.postponeCount = num(task.postponeCount) + 1;
      t.lastPostponedAt = ctx.now;
      var ch = new Changes(db);
      ch.put("tasks", t);
      return ch.result({ taskId: t.id });
    },

    /** Fix a typo in an open task's description (and general-task fields). */
    updateTask: function (db, req, ctx) {
      var task = byId(db.tasks, req.taskId);
      if (!task) return err(MSG.notFound, "not_found");
      if (bool(task.isDone)) return err(MSG.taskDone, "already_done");
      var v = new V();
      var t = copy(task);
      t.title = v.text("title", "תיאור המשימה", req.title === undefined ? task.title : req.title, { required: true, max: 300 });
      if (req.department !== undefined) t.department = cleanDept(req.department);
      if (!task.caseId && req.project !== undefined) t.project = v.text("project", "פרויקט", req.project, { max: 120 });
      var bad = v.fail(); if (bad) return bad;
      var ch = new Changes(db);
      ch.put("tasks", t);
      return ch.result({ taskId: t.id });
    },

    /** A task that does not belong to any case. No chaining rules. */
    createGeneralTask: function (db, req, ctx) {
      var v = new V();
      var title = v.text("title", "תיאור המשימה", req.title, { required: true, max: 300 });
      var due = v.date("dueDate", "תאריך היעד", req.dueDate, { required: true, min: ctx.today });
      var project = v.text("project", "פרויקט", req.project, { max: 120 });
      var bad = v.fail(); if (bad) return bad;
      var ch = new Changes(db);
      var t = ch.put("tasks", newTask(ctx, { title: title, dueDate: due, department: cleanDept(req.department), project: project }));
      return ch.result({ taskId: t.id });
    },

    /** Re-open a closed case: requires the new open task right away. */
    reopenCase: function (db, req, ctx) {
      var c = byId(db.cases, req.caseId);
      if (!c) return err(MSG.notFound, "not_found");
      if (c.status !== "CLOSED") return err("התיק כבר פתוח", "not_closed");
      var v = new V();
      var title = v.text("title", "המשימה הבאה", req.title, { required: true, max: 300 });
      var due = v.date("dueDate", "תאריך היעד", req.dueDate, { required: true, min: ctx.today });
      var bad = v.fail(); if (bad) return bad;
      var last = lastTaskOfCase(db, c.id);
      var ch = new Changes(db);
      var cc = copy(c);
      cc.status = "ACTIVE"; cc.closedAt = ""; cc.closeReason = ""; cc.updatedAt = ctx.now;
      ch.put("cases", cc);
      var t = ch.put("tasks", newTask(ctx, { title: title, dueDate: due, caseId: c.id, previousTaskId: last ? last.id : "" }));
      return ch.result({ caseId: c.id, taskId: t.id });
    },

    saveTag: function (db, req, ctx) {
      var v = new V();
      var name = v.text("name", "שם התגית", req.name, { required: true, max: 60 });
      var bad = v.fail(); if (bad) return bad;
      var clash = (db.tags || []).filter(function (t) { return t.id !== req.id && str(t.name) === name; })[0];
      if (clash) return err("כבר קיימת תגית בשם הזה", "duplicate");
      var cur = req.id ? byId(db.tags, req.id) : null;
      if (req.id && !cur) return err(MSG.notFound, "not_found");
      var t = cur ? copy(cur) : { id: ctx.uid("tg"), sortOrder: (db.tags || []).length, isActive: true };
      t.name = name;
      if (req.isActive !== undefined) t.isActive = bool(req.isActive);
      if (req.sortOrder !== undefined) t.sortOrder = num(req.sortOrder);
      var ch = new Changes(db);
      ch.put("tags", t);
      return ch.result({ tagId: t.id });
    },

    saveContact: function (db, req, ctx) {
      var v = new V();
      var cur = req.id ? byId(db.contacts, req.id) : null;
      if (req.id && !cur) return err(MSG.notFound, "not_found");
      var c = cur ? copy(cur) : { id: ctx.uid("ct") };
      c.fullName = v.text("fullName", "שם איש הקשר", req.fullName, { required: true, max: 120 });
      c.profession = v.text("profession", "תחום", req.profession, { max: 120 });
      c.phone = v.text("phone", "טלפון", req.phone, { max: 40 });
      c.notes = v.text("notes", "הערות", req.notes, { max: 2000 });
      var bad = v.fail(); if (bad) return bad;
      var ch = new Changes(db);
      ch.put("contacts", c);
      return ch.result({ contactId: c.id });
    }
  };

  /** Single entry point for every write. ctx: { now, today, userId, uid } */
  function run(action, db, req, ctx) {
    var fn = ACTIONS[action];
    if (!fn) return { ok: false, error: "unknown_action" };
    ctx = ctx || {};
    var full = {
      now: ctx.now || new Date().toISOString(),
      today: ctx.today || todayYmd(),
      userId: ctx.userId || "",
      uid: ctx.uid || uid
    };
    return fn(db || {}, copy(req || {}), full);
  }

  /** Apply a change set to an in-memory db (demo mode / client cache). */
  function applyChanges(db, changes) {
    Object.keys(changes || {}).forEach(function (t) {
      var list = db[t] = db[t] || [];
      changes[t].forEach(function (r) {
        for (var i = 0; i < list.length; i++) if (list[i].id === r.id) { list[i] = r; return; }
        list.push(r);
      });
    });
    return db;
  }

  function passwordProblem(pw) {
    pw = String(pw || "");
    if (pw.length < 10) return "הסיסמה צריכה לכלול לפחות 10 תווים";
    if (!/[0-9]/.test(pw) || !/[^0-9]/.test(pw)) return "הסיסמה צריכה לכלול גם ספרות וגם אותיות";
    return "";
  }

  return {
    CASE_STATUS: CASE_STATUS, DEPARTMENTS: DEPARTMENTS, ROLES: ROLES, DEFAULT_TAGS: DEFAULT_TAGS, TABLES: TABLES,
    bool: bool, str: str, num: num, byId: byId, uid: uid, splitIds: splitIds, escapeHtml: escapeHtml,
    normEmail: normEmail, isEmail: isEmail, passwordProblem: passwordProblem,
    isYmd: isYmd, todayYmd: todayYmd, hourIL: hourIL, addDays: addDays, diffDays: diffDays, fmtDate: fmtDate,
    fmtDateTime: fmtDateTime, weekday: weekday, relDay: relDay, quickDates: quickDates,
    caseTasks: caseTasks, openTaskOfCase: openTaskOfCase, openTasksOfCase: openTasksOfCase, chainOf: chainOf,
    lastTaskOfCase: lastTaskOfCase, checkInvariant: checkInvariant, tagsOfCase: tagsOfCase, activeTags: activeTags,
    diary: diary, casesList: casesList, timeline: timeline, counts: counts,
    ACTIONS: Object.keys(ACTIONS), run: run, applyChanges: applyChanges
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
 * Creates the private database sheet, the signing secret, default tags and a
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
  var d = db();
  MK.TABLES.concat(["audit"]).forEach(function (t) { sheetOf(t); });
  var first = d.getSheetByName("Sheet1") || d.getSheetByName("גיליון1");
  if (first && d.getSheets().length > 1) d.deleteSheet(first);
  seedDefaults();

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

function seedDefaults() {
  if (!readTable("tags").length) {
    writeTable("tags", MK.DEFAULT_TAGS.map(function (name, i) {
      return { id: "tg" + (i + 1), name: name, sortOrder: i, isActive: "true" };
    }));
  }
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
/** Merge changed rows into their tables. Secret "_" columns are preserved, never overwritten. */
function persist(changes) {
  Object.keys(changes).forEach(function (t) {
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
        dbUrl: user.role === "ADMIN" && props.getProperty("DB_ID") ? "https://docs.google.com/spreadsheets/d/" + props.getProperty("DB_ID") : ""
      }
    };
  },

  /** Every business write: { op: "<MK action>", ...fields } */
  mutate: function (req, user) {
    if (!CASE_ROLES[user.role]) return { ok: false, error: "forbidden" };
    var op = String(req.op || "");
    if (MK.ACTIONS.indexOf(op) === -1) return { ok: false, error: "unknown_action" };
    var input = req.input || {};
    return withLock(function () {
      var data = loadDb();
      var res = MK.run(op, data, input, {
        now: new Date().toISOString(),
        today: Utilities.formatDate(new Date(), TZ_IL, "yyyy-MM-dd"),
        userId: user.id,
        uid: function (p) { return p + "_" + Utilities.getUuid().replace(/-/g, "").slice(0, 16); }
      });
      if (!res.ok) return res;
      persist(res.changes);
      var ids = [];
      Object.keys(res.changes).forEach(function (t) { res.changes[t].forEach(function (r) { ids.push(t + ":" + r.id); }); });
      audit(user.id, op, ids.join(","));
      return res;
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
  var problems = MK.checkInvariant(loadDb());
  if (problems.length) {
    audit("", "invariant_problems", problems.length + " cases");
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), "משכנותיך: נמצאו תיקים בלי משימה פתוחה",
      "בבדיקה הלילית נמצאו " + problems.length + " תיקים שלא עומדים בכלל 'משימה פתוחה אחת בדיוק'. היכנסו למערכת ובדקו את התיקים המסומנים.");
  }
}
