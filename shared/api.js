/*
 * api.js - talks to the Apps Script backend, or to an in-browser demo backend.
 *
 * Real mode: every call is a POST with a JSON body (sent as text/plain so the
 * browser doesn't need a CORS preflight). Tokens travel in the body only.
 *
 * Demo mode (?demo=1): a local, fictional data set in this browser only - used
 * for trying the system out before the backend is connected. No real data.
 */
var Api = (function () {
  "use strict";
  var demo = /[?&]demo=1\b/.test(location.search) || sessionStorage.getItem("crm_demo") === "1";
  if (demo) sessionStorage.setItem("crm_demo", "1");
  var url = (window.CRM_CONFIG && window.CRM_CONFIG.apiUrl) || "";

  async function call(action, payload) {
    var body = Object.assign({ action: action }, payload || {});
    if (demo) return DemoBackend.handle(body);
    if (!url) return { ok: false, error: "not_configured" };
    var res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow", credentials: "omit" });
    if (!res.ok) return { ok: false, error: "http_" + res.status };
    return res.json();
  }

  function exitDemo() { sessionStorage.removeItem("crm_demo"); }

  return { call: call, isDemo: function () { return demo; }, isConfigured: function () { return !!url || demo; }, exitDemo: exitDemo };
})();

// ------------------------------------------------------------------ demo backend
var DemoBackend = (function () {
  "use strict";
  var KEY = "crm_demo_db_v1";
  var C = Core;

  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    var d = seed(); save(d); return d;
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  function reset() { try { localStorage.removeItem(KEY); } catch (e) {} }

  // Fictional demo data, dated relative to today.
  function seed() {
    var now = new Date();
    function day(off, h, m) { var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off, h || 0, m || 0); return h === undefined ? C.ymd(d) : C.ymdhm(d); }
    var names = [
      ["דוגמה ישראל", "שיווק עצמי", "package", "session", 350, "israel@example.com"],
      ["לקוח משה (דוגמה)", "קו המרכזי", "single", "session", 350, "moshe@example.com"],
      ["כהן אברהם (דוגמה)", "המלצה", "package", "hour", 300, "avraham@example.com"],
      ["לוי יעקב (דוגמה)", "חבר", "single", "hour", 250, "yaakov@example.com"],
      ["פרידמן דוד (דוגמה)", "קו המרכזי", "package", "session", 350, "david@example.com"],
      ["גולד שמואל (דוגמה)", "עצמי", "monthly", "session", 0, "shmuel@example.com"],
      ["רוזן מנחם (דוגמה)", "המלצה", "single", "session", 350, ""],
      ["שטרן יוסף (דוגמה)", "פרסום", "package", "session", 350, "yosef@example.com"]
    ];
    var d = { clients: [], packages: [], sessions: [], charges: [], payments: [], summaries: [], tasks: [], expenses: [],
      settings: [], messages: [], bookings: [], family_tx: [], family_categories: [], family_rules: [], loans: [], email_log: [] };
    names.forEach(function (n, i) {
      var id = "demo_c" + (i + 1);
      d.clients.push({ id: id, code: String(i + 1), name: n[0], referrer: n[1], pricingModel: n[2], unitType: n[3], rate: n[4],
        monthlyFee: n[2] === "monthly" ? 1200 : "", email: n[5], phone: "050-000000" + i, status: "active",
        processName: n[2] === "package" ? "תהליך אישי ועסקי" : "", notes: "לקוח לדוגמה בלבד", createdAt: day(-100) });
    });
    d.packages.push({ id: "demo_p1", clientId: "demo_c1", name: "סל 10 פגישות", units: 10, unitType: "session", price: 3000, startDate: day(-80) });
    d.packages.push({ id: "demo_p3", clientId: "demo_c3", name: "סל 10 שעות", units: 10, unitType: "hour", price: 3000, startDate: day(-70) });
    d.packages.push({ id: "demo_p5", clientId: "demo_c5", name: "סל 5 פגישות", units: 5, unitType: "session", price: 1500, startDate: day(-40) });
    d.packages.push({ id: "demo_p8", clientId: "demo_c8", name: "סל 5 פגישות", units: 5, unitType: "session", price: 1500, startDate: day(-20) });
    var sid = 0;
    function sess(c, off, h, status, dur, loc) {
      sid++;
      d.sessions.push({ id: "demo_s" + sid, clientId: c, date: day(off, h, 0), durationMin: dur || 60, location: loc || "בית שמש", status: status, source: "demo" });
      return "demo_s" + sid;
    }
    var locs = ["בית שמש", "בני ברק", "זום"];
    for (var k = 0; k < 9; k++) sess("demo_c1", -78 + k * 8, 10, "held", 60, locs[k % 3]);
    sess("demo_c1", 3, 11, "planned");
    for (k = 0; k < 7; k++) sess("demo_c3", -65 + k * 9, 16, "held", 75, "בני ברק");
    sess("demo_c3", -2, 16, "planned", 60, "בני ברק");
    for (k = 0; k < 4; k++) sess("demo_c5", -38 + k * 9, 12, k === 2 ? "cancel_late" : "held", 60, "זום");
    for (k = 0; k < 3; k++) sess("demo_c2", -30 + k * 10, 18, "held");
    sess("demo_c2", -1, 18, "planned");
    for (k = 0; k < 5; k++) sess("demo_c4", -50 + k * 10, 20, "held", 90, "זום");
    for (k = 0; k < 6; k++) sess("demo_c6", -55 + k * 9, 9, "held");
    sess("demo_c6", 5, 9, "planned");
    sess("demo_c7", -12, 13, "held"); sess("demo_c7", -5, 13, "cancel_ontime");
    for (k = 0; k < 2; k++) sess("demo_c8", -15 + k * 7, 15, "held");
    sess("demo_c8", 1, 15, "planned", 60, "בני ברק");
    sess("", 2, 19, "unassigned");
    d.sessions[d.sessions.length - 1].calendarTitle = "פגישת היכרות - מתעניין חדש";
    // extra monthly volume
    for (k = 0; k < 14; k++) sess("demo_c" + (1 + (k % 8)), -(k % 20) - 1, 8 + (k % 10), "held");

    function pay(c, off, amt, m) { d.payments.push({ id: "demo_pay" + d.payments.length, clientId: c, date: day(off), amount: amt, method: m || "cash" }); }
    pay("demo_c1", -80, 3000, "transfer"); pay("demo_c3", -70, 2000, "transfer"); pay("demo_c5", -40, 1500, "credit");
    pay("demo_c2", -30, 350); pay("demo_c2", -20, 350); pay("demo_c4", -45, 750); pay("demo_c4", -20, 500, "transfer");
    pay("demo_c6", -50, 1200, "transfer"); pay("demo_c6", -20, 1200, "transfer"); pay("demo_c7", -12, 350);
    pay("demo_c8", -20, 1500, "credit");
    for (k = 0; k < 10; k++) pay("demo_c" + (1 + (k % 8)), -(k * 2) - 1, 350 + (k % 3) * 100, k % 2 ? "cash" : "transfer");
    d.charges.push({ id: "demo_ch1", clientId: "demo_c2", date: day(-30), amount: 100, reason: "דמי פתיחת תיק" });

    d.summaries.push({ id: "demo_sm1", clientId: "demo_c1", sessionId: "demo_s9", date: d.sessions[8].date, shared: "true",
      points: "מיפוי מצב העסק\n- זיהינו שני לקוחות עוגן\n- הכנסות לא יציבות בחודשי החגים\nסדר עדיפויות\n- להתמקד בשיווק ממוקד", decisions: "- להקדיש שעתיים בשבוע לשיווק\n- לבנות מחירון חדש", homework: "- לכתוב רשימת 20 לקוחות פוטנציאליים\n- לנסח הצעת ערך במשפט אחד", recordingUrl: "" });
    d.tasks.push({ id: "demo_t1", clientId: "demo_c1", text: "לבדוק את המחירון החדש", done: "false", shared: "true", createdAt: day(-3) });
    d.tasks.push({ id: "demo_t2", clientId: "demo_c1", text: "להכין סיכום חודשי להשוואה", done: "false", shared: "false", createdAt: day(-3) });

    var mk0 = C.thisMonth(now);
    d.expenses.push({ id: "demo_e1", date: C.addMonths(mk0, -6) + "-01", category: "שכירות חדר / קליניקה", amount: 1000, recurring: "monthly", notes: "" });
    d.expenses.push({ id: "demo_e2", date: C.addMonths(mk0, -6) + "-01", category: "אינטרנט / שרת / אתר", amount: 59, recurring: "monthly", notes: "" });
    d.expenses.push({ id: "demo_e3", date: C.addMonths(mk0, -2) + "-05", category: "מנטורינג", amount: 920, recurring: "monthly", notes: "" });
    d.expenses.push({ id: "demo_e4", date: C.addMonths(mk0, -1) + "-10", category: "קורסים והכשרות", amount: 1546, recurring: "none", notes: "" });

    d.settings.push({ id: "availability", value: JSON.stringify([
      { day: 0, from: "09:00", to: "13:00", location: "בית שמש" }, { day: 1, from: "16:00", to: "20:00", location: "בני ברק" },
      { day: 2, from: "09:00", to: "12:00", location: "זום" }, { day: 3, from: "10:00", to: "14:00", location: "בית שמש" },
      { day: 4, from: "19:00", to: "22:00", location: "זום" }]) });

    d.messages.push({ id: "demo_m1", clientId: "demo_c1", date: day(-1, 21, 5), text: "שלום, רציתי לשאול אם אפשר להקדים את הפגישה הבאה בשעה.", fromClient: "true", read: "false", kind: "message" });
    d.bookings.push({ id: "demo_b1", clientId: "demo_c5", start: day(4, 10, 0), location: "בית שמש", durationMin: 60, note: "אשמח להתחיל בנושא התמחור", status: "pending", createdAt: day(-1) });

    C.DEFAULT_FAMILY_CATEGORIES.forEach(function (c, i) {
      var budgets = { "קניות מרוכזות - סופר": 2300, "מכולת": 400, "דלק לרכב": 500, "חשמל": 500, "תקשורת": 200, "אוכל בחוץ": 150, "ביגוד והנעלה": 500, "בשר ודגים": 600 };
      d.family_categories.push({ id: "fc" + i, name: c[0], group: c[1], budget: budgets[c[0]] || "" });
    });
    C.DEFAULT_FAMILY_RULES.forEach(function (r, i) { d.family_rules.push({ id: "fr" + i, pattern: r[0], category: r[1] }); });
    var vendors = [["רמי לוי שיווק השקמה", 612], ["אושר עד", 455], ["שופרסל דיל", 310], ["פז חברת נפט", 240], ["סונול", 180],
      ["חברת החשמל לישראל", 520], ["בזק", 89], ["פלאפון", 120], ["מכולת השכונה", 95], ["פיצה בדוגמה", 110], ["קניון - ביגוד", 380]];
    for (var mo = -2; mo <= 0; mo++) {
      var mk = C.addMonths(mk0, mo);
      vendors.forEach(function (v, i) {
        var dd = Math.min(28, 2 + i * 2);
        if (mo === 0 && dd > now.getDate()) return;
        var amt = Math.round(v[1] * (0.8 + ((i * 7 + mo * 3 + 30) % 10) / 20));
        var acct = i % 3 === 0 ? C.ACCOUNTS[2] : i % 3 === 1 ? C.ACCOUNTS[3] : C.ACCOUNTS[0];
        d.family_tx.push({ id: "demo_ft" + mo + "_" + i, date: mk + "-" + C.pad(dd), account: acct, description: v[0], amount: amt, type: "expense",
          category: C.categorize(v[0], d.family_rules), source: "demo" });
      });
      d.family_tx.push({ id: "demo_fi" + mo, date: mk + "-10", account: C.ACCOUNTS[0], description: "משכורת - דוגמה", amount: 6100, type: "income", category: "משכורת - בעל", source: "demo" });
      d.family_tx.push({ id: "demo_fi2" + mo, date: mk + "-09", account: C.ACCOUNTS[1], description: "משכורת - דוגמה", amount: 4200, type: "income", category: "משכורת - אשה", source: "demo" });
    }
    d.loans.push({ id: "demo_l1", name: "משכנתא א' (דוגמה)", lender: "בנק לדוגמה", type: "mortgage", originalAmount: 500000, monthlyPayment: 2500, paymentsLeft: 300, balance: 450000, notes: "" });
    d.loans.push({ id: "demo_l2", name: "משכנתא ב' (דוגמה)", lender: "בנק לדוגמה ב'", type: "mortgage", originalAmount: 300000, monthlyPayment: 1500, paymentsLeft: 280, balance: 260000, notes: "" });
    d.loans.push({ id: "demo_l3", name: "הלוואה (דוגמה)", lender: "בנק לדוגמה", type: "loan", originalAmount: 50000, monthlyPayment: 900, paymentsLeft: 40, balance: 34000, notes: "" });
    return d;
  }

  function ok(x) { return Promise.resolve(Object.assign({ ok: true }, x || {})); }
  function upsert(d, table, rows) {
    d[table] = d[table] || [];
    return rows.map(function (r) {
      r = Object.assign({}, r);
      if (!r.id) r.id = C.uid("d" + table.slice(0, 2));
      var cur = C.byId(d[table], r.id);
      if (cur) { Object.assign(cur, r); return cur; }
      d[table].push(r); return r;
    });
  }
  var DEMO_CLIENT = "demo_c1";

  function handle(req) {
    var d = load();
    var a = req.action;
    switch (a) {
      case "status": return ok({ installed: true, hasAdmin: true, demo: true });
      case "adminLogin": case "adminInit": return ok({ token: "demo" });
      case "bootstrap":
        var out = JSON.parse(JSON.stringify(d));
        out.meta = { rootFolderUrl: "", dbUrl: "", account: "מצב הדגמה", lastSync: "" };
        return ok({ db: out });
      case "upsert":
        var rows = upsert(d, req.table, Array.isArray(req.rows) ? req.rows : [req.row]);
        if (req.table === "sessions") rows.forEach(function (s) { if ((s.addToCalendar === true || s.addToCalendar === "true") && !s.calendarEventId) { s.calendarEventId = "demo_ev_" + s.id; s.addToCalendar = ""; } });
        save(d); return ok({ rows: rows });
      case "remove":
        var ids = Array.isArray(req.ids) ? req.ids : [req.id];
        d[req.table] = (d[req.table] || []).filter(function (r) { return ids.indexOf(r.id) === -1; });
        save(d); return ok();
      case "syncCalendar": return ok({ added: 0, updated: 0, cancelled: 0, unmatched: 0, demo: true });
      case "uploadFile":
        return ok({ file: { id: "demo_file", url: "#demo-file", name: req.file && req.file.name } });
      case "previewEmail": case "sendEmail":
        var c = C.byId(d.clients, req.clientId);
        var ctx = { st: C.settingsOf(d), client: c, account: C.clientAccount(d, req.clientId, new Date()),
          portalUrl: location.origin + "/portal/?demo=1", bookingUrl: location.origin + "/portal/?demo=1#book", setupUrl: location.origin + "/portal/?demo=1", validity: req.validity };
        if (req.sessionId) ctx.session = C.byId(d.sessions, req.sessionId);
        if (req.template === "summary") ctx.summary = d.summaries.filter(function (s) { return s.sessionId === req.sessionId; })[0] || {};
        var r = EmailTemplates.render(req.template, ctx);
        if (a === "sendEmail") {
          d.email_log.push({ id: C.uid("em"), clientId: req.clientId, template: req.template, to: c.email, subject: r.subject, date: C.ymdhm(new Date()) });
          if (req.template === "summary") d.summaries.forEach(function (s) { if (s.sessionId === req.sessionId) { s.sentAt = C.ymdhm(new Date()); s.shared = "true"; } });
          save(d); return ok({ to: c.email, demo: true });
        }
        return ok({ subject: r.subject, html: r.html, to: c.email });
      case "approveBooking":
        var b = C.byId(d.bookings, req.id);
        if (req.decline) { b.status = "declined"; save(d); return ok(); }
        var s = { id: C.uid("se"), clientId: b.clientId, date: req.start || b.start, durationMin: b.durationMin, location: b.location, status: "planned", source: "booking", notes: b.note ? "הערת הלקוח: " + b.note : "" };
        d.sessions.push(s); b.status = "approved"; b.sessionId = s.id; save(d); return ok({ session: s });
      case "revokePortal": case "changeAdminPassword": case "backupNow": return ok({ token: "demo", url: "" });
      case "auditLog": return ok({ rows: [{ ts: new Date().toISOString(), who: "admin", action: "מצב הדגמה - אין יומן אמיתי" }] });
      case "importLegacy": return Promise.resolve({ ok: false, error: "demo" });
      // ---- portal
      case "portalLogin": case "portalSetPassword": return ok({ token: "demo-client" });
      case "portalForgot": return ok();
      case "portalView":
        var v = C.portalView(d, DEMO_CLIENT, new Date());
        v.messages = d.messages.filter(function (m) { return m.clientId === DEMO_CLIENT; }).map(function (m) { return { date: m.date, text: m.text, fromClient: C.bool(m.fromClient) }; });
        v.pendingBookings = d.bookings.filter(function (x) { return x.clientId === DEMO_CLIENT && x.status === "pending"; });
        return ok({ view: v });
      case "portalSlots":
        var st = C.settingsOf(d);
        var busy = d.sessions.filter(function (x) { return x.status === "planned"; }).map(function (x) {
          var t = C.toDate(x.date); return { start: x.date, end: C.ymdhm(new Date(t.getTime() + (C.num(x.durationMin) || 60) * 60e3)) };
        });
        return ok({ slots: C.freeSlots(st, busy, new Date(), C.num(st.bookingDaysAhead) || 45) });
      case "portalBook":
        d.bookings.push({ id: C.uid("bk"), clientId: DEMO_CLIENT, start: req.start, location: req.location, durationMin: 60, note: req.note, status: "pending", createdAt: C.ymdhm(new Date()) });
        save(d); return ok();
      case "portalMessage":
        d.messages.push({ id: C.uid("ms"), clientId: DEMO_CLIENT, date: C.ymdhm(new Date()), text: req.text, kind: req.kind || "message", fromClient: "true", read: "false", attachmentName: req.file ? req.file.name : "" });
        save(d); return ok();
      case "portalTaskDone":
        var t = C.byId(d.tasks, req.id); if (t) t.done = req.done ? "true" : "false"; save(d); return ok();
    }
    return Promise.resolve({ ok: false, error: "unknown_action" });
  }
  return { handle: handle, reset: reset };
})();
