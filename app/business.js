/* business.js - "ניהול העסק": KPIs, CRM, packages, sessions, payments, P&L, e-mails. */
(function () {
  "use strict";
  var C = Core, h = UI.h, raw = UI.raw;
  var Pages = window.Pages = window.Pages || {};
  var Actions = window.Actions = window.Actions || {};
  var ui = { clientFilter: "active", clientSearch: "", clientSort: "name", sessMonth: "", sessStatus: "", payMonth: "", payMethod: "", paySearch: "", pnlYear: "", pnlMonth: "" };

  function unitLabel(t) { return t === "hour" ? "שעות" : "פגישות"; }
  function r2(n) { return C.round2(n); }
  function initials(name) { return String(name || "?").trim().charAt(0); }

  // ================================================================ dashboard
  Pages["biz/dashboard"] = function () {
    var db = App.db, now = new Date();
    var k = C.kpi(db, now);
    var accs = App.accounts();
    var list = Object.keys(accs).map(function (id) { return accs[id]; });
    var awaiting = [];
    list.forEach(function (a) { a.awaiting.forEach(function (s) { awaiting.push(s); }); });
    awaiting.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    var renew = list.filter(function (a) { return a.renewalAlert; });
    var debts = list.filter(function (a) { return a.balance > 0.5 && a.client.status !== "inactive"; }).sort(function (a, b) { return b.balance - a.balance; });
    var pendingB = (db.bookings || []).filter(function (b) { return b.status === "pending"; });
    var unread = (db.messages || []).filter(function (m) { return C.bool(m.fromClient) && !C.bool(m.read); });
    var unassigned = (db.sessions || []).filter(function (s) { return s.status === "unassigned"; });
    var nowStr = C.ymdhm(now), weekEnd = C.ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
    var upcoming = (db.sessions || []).filter(function (s) { return s.clientId && s.status === "planned" && s.date >= nowStr && s.date <= weekEnd + "T23:59"; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });
    var paceTxt = { done: "היעד הושג!", good: "בקצב טוב", warn: "קצת מאחור", behind: "מאחורי הקצב" };

    // 12-month chart
    var months = [], mk = C.addMonths(k.month, -11);
    for (var i = 0; i < 12; i++) { months.push(mk); mk = C.addMonths(mk, 1); }
    var bms = months.map(function (m) { return C.businessMonth(db, m); });

    return h`<div class="page-head"><div><h1>ניהול העסק</h1><div class="sub">${C.monthLabel(k.month)} · נותרו ${k.daysLeft} ימים בחודש</div></div>
      <div class="row"><button class="btn btn-outline btn-sm" data-act="syncCal">⟳ סנכרון יומן</button><button class="btn btn-primary btn-sm" data-act="newSession">+ פגישה</button><button class="btn btn-outline btn-sm" data-act="newPayment">+ תשלום</button></div></div>

    <div class="kpi-hero">
      <div class="kpi ${k.sessionsPace}">
        <div class="kpi-top"><div><div class="kpi-lbl">פגישות שהתקיימו החודש</div>
          <div class="kpi-big">${k.sessionsHeld}<small> / ${k.sessionTarget}</small></div></div>${UI.ring(k.sessionsPct)}</div>
        ${UI.bar(k.sessionsPct, k.sessionsPace === "behind" ? "bad" : k.sessionsPace === "warn" ? "warn" : "good")}
        <div class="kpi-meta"><span class="pace ${k.sessionsPace}"><i></i>${paceTxt[k.sessionsPace]}</span>
          <span>נותרו ליעד: <b>${k.sessionsLeft}</b></span><span>צפוי עד היום: <b>${k.expectedSessionsByNow}</b></span>
          <span>השבוע: <b>${k.weekHeld}</b> התקיימו · <b>${k.weekPlanned}</b> מתוכננות (יעד ${k.weeklyTarget})</span></div>
      </div>
      <div class="kpi ${k.incomePace}">
        <div class="kpi-top"><div><div class="kpi-lbl">הכנסה נטו החודש (גבייה בפועל פחות הוצאות)</div>
          <div class="kpi-big">${C.fmtMoney(k.incomeNet)}<small> / ${C.fmtMoney(k.incomeTarget)}</small></div></div>${UI.ring(Math.max(0, k.incomePct))}</div>
        ${UI.bar(Math.max(0, k.incomePct), k.incomePace === "behind" ? "bad" : k.incomePace === "warn" ? "warn" : "good")}
        <div class="kpi-meta"><span class="pace ${k.incomePace}"><i></i>${paceTxt[k.incomePace]}</span>
          <span>נגבה: <b>${C.fmtMoney(k.incomeCollected)}</b></span><span>הוצאות: <b>${C.fmtMoney(k.bm.expenseTotal)}</b></span>
          <span>חסר ליעד: <b>${C.fmtMoney(k.incomeLeft)}</b></span></div>
      </div>
    </div>

    <div class="grid grid-2 section">
      <div class="card"><div class="card-title"><h3>דורש טיפול</h3><span class="sub">${awaiting.length + renew.length + pendingB.length + unread.length + unassigned.length} פריטים</span></div>
        <div class="alist">
          ${awaiting.slice(0, 12).map(function (s) { return awaitingItem(s); })}
          ${awaiting.length > 12 ? h`<a href="#biz/sessions" class="small">ועוד ${awaiting.length - 12} פגישות ממתינות לאישור ←</a>` : ""}
          ${renew.map(function (a) { return h`<div class="aitem warn"><span>🔔</span><span class="who">${a.client.name}</span><span class="when">נותרו ${r2(a.unitsRemaining)} ${unitLabel(a.currentPackage && a.currentPackage.unitType)} בסל - זמן לחידוש</span>
            <span class="acts"><button class="btn btn-outline btn-xs" data-act="newPackage" data-client="${a.client.id}">+ סל חדש</button><a class="btn btn-ghost btn-xs" href="#biz/client/${a.client.id}">לכרטיס</a></span></div>`; })}
          ${pendingB.length ? h`<div class="aitem"><span>📅</span><span class="who">${pendingB.length} בקשות לפגישה ממתינות</span><span class="acts"><a class="btn btn-outline btn-xs" href="#biz/inbox">לטיפול</a></span></div>` : ""}
          ${unread.length ? h`<div class="aitem"><span>✉️</span><span class="who">${unread.length} הודעות חדשות מלקוחות</span><span class="acts"><a class="btn btn-outline btn-xs" href="#biz/inbox">לקריאה</a></span></div>` : ""}
          ${unassigned.length ? h`<div class="aitem"><span>❓</span><span class="who">${unassigned.length} אירועי יומן לא שויכו ללקוח</span><span class="acts"><a class="btn btn-outline btn-xs" href="#biz/sessions">לשיוך</a></span></div>` : ""}
          ${!awaiting.length && !renew.length && !pendingB.length && !unread.length && !unassigned.length ? h`<div class="empty">הכל מטופל ✓</div>` : ""}
        </div></div>
      <div class="card"><div class="card-title"><h3>השבוע הקרוב</h3><a class="small" href="#biz/sessions">ליומן ←</a></div>
        ${upcoming.length ? h`<div class="alist">${upcoming.map(function (s) {
          return h`<div class="aitem"><span class="who"><a href="#biz/client/${s.clientId}">${App.clientName(s.clientId)}</a></span><span class="when">${UI.when(s.date)} · ${s.location || ""}</span></div>`;
        })}</div>` : h`<div class="empty">אין פגישות מתוכננות לשבוע הקרוב</div>`}
        <div class="card-title" style="margin-top:18px"><h3>יתרות חוב פתוחות</h3><a class="small" href="#biz/clients" data-act="clientFilter" data-f="debt">לכולם ←</a></div>
        ${debts.length ? h`<div class="table-wrap"><table class="t"><tbody>${debts.slice(0, 6).map(function (a) {
          return h`<tr class="click" data-href="#biz/client/${a.client.id}/finance"><td>${a.client.name}</td><td class="n">${UI.money(a.balance, true)}</td></tr>`;
        })}</tbody><tfoot><tr><td>סה"כ חובות</td><td class="n">${C.fmtMoney(debts.reduce(function (s, a) { return s + a.balance; }, 0))}</td></tr></tfoot></table></div>` : h`<div class="empty">אין חובות פתוחים</div>`}
      </div>
    </div>

    <div class="card section"><div class="card-title"><h3>גבייה מול הוצאות - 12 חודשים</h3><a class="small" href="#biz/pnl">לדוח רווח והפסד ←</a></div>
      ${UI.barChart({ title: "גבייה מול הוצאות", labels: months.map(function (m) { return C.HE_MONTHS[+m.slice(5) - 1].slice(0, 3) + "׳"; }), fullLabels: months.map(C.monthLabel),
        series: [{ name: "גבייה בפועל", color: "var(--series-1)", values: bms.map(function (b) { return b.collected; }) },
          { name: "הוצאות", color: "var(--series-2)", values: bms.map(function (b) { return b.expenseTotal; }) }], format: C.fmtMoney })}
    </div>`;
  };

  function awaitingItem(s) {
    return h`<div class="aitem"><span>⏳</span><span class="who"><a href="#biz/client/${s.clientId}">${App.clientName(s.clientId)}</a></span>
      <span class="when">${UI.when(s.date)}</span>
      <span class="acts status-btns">
        <button class="btn btn-good btn-xs" data-act="setStatus" data-id="${s.id}" data-status="held">✓ התקיימה</button>
        <button class="btn btn-outline btn-xs" data-act="setStatus" data-id="${s.id}" data-status="cancel_ontime">בוטלה בזמן</button>
        <button class="btn btn-bad btn-xs" data-act="setStatus" data-id="${s.id}" data-status="cancel_late">בוטלה באיחור (חיוב)</button>
      </span></div>`;
  }

  Actions.setStatus = async function (t) {
    var s = C.byId(App.db.sessions, t.dataset.id);
    if (!s) return;
    var st = t.dataset.status;
    await App.save("sessions", [{ id: s.id, status: st, confirmedAt: C.ymdhm(new Date()) }], { msg: C.SESSION_STATUS[st] + " ✓" });
  };
  Actions.statusSelect = function (t) {
    App.save("sessions", [{ id: t.dataset.id, status: t.value, confirmedAt: C.ymdhm(new Date()) }], { msg: "הסטטוס עודכן" });
  };

  // ================================================================ clients directory
  Pages["biz/clients"] = function () {
    var accs = App.accounts();
    var q = ui.clientSearch.trim().toLowerCase();
    var rows = Object.keys(accs).map(function (id) { return accs[id]; }).filter(function (a) {
      var c = a.client;
      if (ui.clientFilter === "active" && c.status === "inactive") return false;
      if (ui.clientFilter === "inactive" && c.status !== "inactive") return false;
      if (ui.clientFilter === "debt" && !(a.balance > 0.5)) return false;
      if (ui.clientFilter === "credit" && !(a.balance < -0.5)) return false;
      if (ui.clientFilter === "renew" && !a.renewalAlert) return false;
      if (q && [c.name, c.phone, c.email, c.referrer, c.code].join(" ").toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var sorters = {
      name: function (a, b) { return String(a.client.name).localeCompare(String(b.client.name), "he"); },
      balance: function (a, b) { return b.balance - a.balance; },
      recent: function (a, b) { return String((b.lastHeld || {}).date || "").localeCompare(String((a.lastHeld || {}).date || "")); },
      code: function (a, b) { return C.num(a.client.code) - C.num(b.client.code); }
    };
    rows.sort(sorters[ui.clientSort] || sorters.name);
    var tot = { units: 0, used: 0, charges: 0, paid: 0, bal: 0 };
    rows.forEach(function (a) { tot.units += a.consumedUnits; tot.charges += a.totalCharges; tot.paid += a.totalPaid; tot.bal += a.balance; });
    var filters = [["active", "פעילים"], ["debt", "עם חוב"], ["renew", "לחידוש סל"], ["credit", "ביתרת זכות"], ["inactive", "לא פעילים"], ["all", "הכל"]];
    return h`<div class="page-head"><div><h1>לקוחות</h1><div class="sub">${rows.length} לקוחות מוצגים</div></div>
      <div class="row"><button class="btn btn-outline btn-sm" data-act="exportClients">ייצוא ל-Excel</button><button class="btn btn-primary btn-sm" data-act="newClient">+ לקוח חדש</button></div></div>
    <div class="toolbar">
      <input type="search" placeholder="חיפוש לפי שם, טלפון, מייל, גורם מפנה..." value="${ui.clientSearch}" data-input="clientSearch" aria-label="חיפוש לקוחות" id="clientSearch">
      <div class="chips">${filters.map(function (f) { return h`<button class="chip ${ui.clientFilter === f[0] ? "active" : ""}" data-act="clientFilter" data-f="${f[0]}">${f[1]}</button>`; })}</div>
      <select data-change="clientSort" aria-label="מיון">${UI.options([["name", "מיון: שם"], ["balance", "מיון: יתרת חוב"], ["recent", "מיון: פגישה אחרונה"], ["code", "מיון: מספר לקוח"]], ui.clientSort)}</select>
    </div>
    <div class="table-wrap"><table class="t">
      <thead><tr><th>שם</th><th>גורם מפנה</th><th>הסדר</th><th class="n">נרכש</th><th class="n">נוצל</th><th class="n">נותר</th><th class="n">לתשלום</th><th class="n">שולם</th><th class="n">יתרה</th><th>פגישה הבאה</th></tr></thead>
      <tbody>${rows.length ? rows.map(function (a) {
        var c = a.client, pkg = a.currentPackage;
        var flag = a.renewalAlert ? "flag" : a.balance > 0.5 ? "flag-bad" : "";
        return h`<tr class="click ${flag}" data-href="#biz/client/${c.id}">
          <td><b>${c.name}</b>${c.status === "inactive" ? h` <span class="badge">לא פעיל</span>` : ""}${a.renewalAlert ? h` <span class="badge warn">חידוש סל</span>` : ""}${a.awaiting.length ? h` <span class="badge info">${a.awaiting.length} לאישור</span>` : ""}</td>
          <td>${c.referrer || ""}</td>
          <td class="small">${pkg ? pkg.name : C.PRICING_MODELS[a.model] ? (a.model === "single" ? C.fmtMoney(c.rate) + (c.unitType === "hour" ? " לשעה" : " לפגישה") : C.PRICING_MODELS[a.model]) : ""}</td>
          <td class="n">${a.packages.length ? r2(a.unitsPurchased) : "—"}</td>
          <td class="n">${r2(a.consumedUnits)}</td>
          <td class="n">${a.packages.length ? h`<b class="${a.renewalAlert ? "t-bad" : ""}">${r2(a.unitsRemaining)}</b>` : "—"}</td>
          <td class="n">${C.fmtMoney(a.totalCharges)}</td><td class="n">${C.fmtMoney(a.totalPaid)}</td>
          <td class="n">${UI.money(a.balance, true)}</td>
          <td class="small nowrap">${a.nextSession ? UI.when(a.nextSession.date) : h`<span class="muted">—</span>`}</td></tr>`;
      }) : h`<tr><td colspan="10" class="empty">לא נמצאו לקוחות</td></tr>`}</tbody>
      <tfoot><tr><td colspan="4">סה"כ</td><td class="n">${r2(tot.units)}</td><td></td><td class="n">${C.fmtMoney(tot.charges)}</td><td class="n">${C.fmtMoney(tot.paid)}</td><td class="n">${C.fmtMoney(tot.bal)}</td><td></td></tr></tfoot>
    </table></div>`;
  };
  Pages["biz/clients"].after = function () {
    var s = UI.$("#clientSearch");
    if (s && ui.focusSearch) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); ui.focusSearch = false; }
  };
  Actions.clientSearch = function (t) { ui.clientSearch = t.value; ui.focusSearch = true; App.render(); };
  Actions.clientFilter = function (t) { ui.clientFilter = t.dataset.f; if (location.hash !== "#biz/clients") location.hash = "#biz/clients"; else App.render(); };
  Actions.clientSort = function (t) { ui.clientSort = t.value; App.render(); };
  Actions.exportClients = function () {
    var accs = App.accounts();
    var rows = [["מספר", "שם", "טלפון", "מייל", "גורם מפנה", "נרכש", "נוצל", "נותר", "לתשלום", "שולם", "יתרה"]];
    Object.keys(accs).forEach(function (id) {
      var a = accs[id], c = a.client;
      rows.push([c.code, c.name, c.phone, c.email, c.referrer, a.unitsPurchased, a.consumedUnits, a.unitsRemaining, a.totalCharges, a.totalPaid, a.balance]);
    });
    UI.download("clients-" + C.ymd(new Date()) + ".csv", UI.toCsv(rows));
  };

  // ================================================================ client form
  function clientForm(c) {
    var st = App.settings();
    c = c || { pricingModel: "single", unitType: "session", rate: st.defaultRate, status: "active" };
    var maxCode = (App.db.clients || []).reduce(function (m, x) { return Math.max(m, C.num(x.code)); }, 0);
    var m = UI.modal({
      title: c.id ? "עריכת פרטי לקוח" : "לקוח חדש", wide: true,
      body: h`<div class="form-grid" id="clientFormBox">
        <label class="field"><span>שם מלא *</span><input type="text" name="name" value="${c.name}" required></label>
        <label class="field"><span>מספר לקוח</span><input type="text" name="code" value="${c.code || (c.id ? "" : maxCode + 1)}"></label>
        <label class="field"><span>טלפון</span><input type="tel" name="phone" value="${c.phone}" class="ltr"></label>
        <label class="field"><span>אימייל</span><input type="email" name="email" value="${c.email}" class="ltr"></label>
        <label class="field"><span>גורם מפנה</span><input type="text" name="referrer" value="${c.referrer}" list="refList"></label>
        <label class="field"><span>סטטוס</span><select name="status">${UI.options([["active", "פעיל"], ["lead", "מתעניין"], ["inactive", "לא פעיל"]], c.status)}</select></label>
        <label class="field"><span>הסדר תשלום</span><select name="pricingModel">${UI.options(Object.keys(C.PRICING_MODELS).map(function (k) { return [k, C.PRICING_MODELS[k]]; }), c.pricingModel)}</select></label>
        <label class="field"><span>יחידת חיוב</span><select name="unitType">${UI.options([["session", "לפי פגישה"], ["hour", "לפי שעה"]], c.unitType)}</select></label>
        <label class="field"><span>מחיר ליחידה (מעבר לסל) ₪</span><input type="number" name="rate" value="${c.rate}" min="0"></label>
        <label class="field"><span>תשלום חודשי (בליווי חודשי) ₪</span><input type="number" name="monthlyFee" value="${c.monthlyFee}" min="0"></label>
        <label class="field"><span>שם התהליך (מוצג ללקוח)</span><input type="text" name="processName" value="${c.processName}" placeholder="למשל: תהליך אישי ועסקי"></label>
        <label class="field"><span>מילת זיהוי ביומן (אופציונלי)</span><input type="text" name="calendarKeyword" value="${c.calendarKeyword}" placeholder="אם השם ביומן שונה"></label>
        <label class="field span-2"><span>הערות פנימיות (לא מוצגות ללקוח)</span><textarea name="notes">${c.notes}</textarea></label>
        <datalist id="refList">${Array.from(new Set((App.db.clients || []).map(function (x) { return x.referrer; }).filter(Boolean))).map(function (r) { return h`<option value="${r}">`; })}</datalist>
      </div>`,
      foot: h`<button class="btn btn-primary" data-save>שמירה</button><button class="btn btn-outline" data-close>ביטול</button>`
    });
    m.$("[data-save]").addEventListener("click", async function () {
      var d = UI.formData(m.$("#clientFormBox"));
      if (!d.name) { UI.toast("יש להזין שם", true); return; }
      if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) { UI.toast("כתובת המייל אינה תקינה", true); return; }
      d.id = c.id || C.uid("cl");
      if (!c.id) d.createdAt = C.ymd(new Date());
      m.close();
      await App.save("clients", [d]);
      if (!c.id) location.hash = "#biz/client/" + d.id;
    });
  }
  Actions.newClient = function () { clientForm(null); };
  Actions.editClient = function (t) { clientForm(App.client(t.dataset.client)); };

  // ================================================================ client profile
  var TABS = [["sessions", "פגישות"], ["finance", "פיננסים ותשלומים"], ["summaries", "סיכומי פגישות"], ["tasks", "משימות"], ["details", "פרטים"], ["messages", "הודעות ומיילים"]];
  Pages["biz/client"] = function (params) {
    var id = params[0], tab = params[1] || "sessions";
    var c = App.client(id);
    if (!c) return h`<div class="card empty">הלקוח לא נמצא. <a href="#biz/clients">חזרה לרשימה</a></div>`;
    var a = App.accounts()[id];
    var pkg = a.currentPackage;
    var unread = (App.db.messages || []).filter(function (m) { return m.clientId === id && C.bool(m.fromClient) && !C.bool(m.read); }).length;
    var body = ({ sessions: tabSessions, finance: tabFinance, summaries: tabSummaries, tasks: tabTasks, details: tabDetails, messages: tabMessages }[tab] || tabSessions)(c, a);
    return h`<div class="small" style="margin-bottom:8px"><a href="#biz/clients">← כל הלקוחות</a></div>
    <div class="card ${a.renewalAlert ? "renew" : ""}">
      <div class="profile-head">
        <div class="avatar">${initials(c.name)}</div>
        <div><h1>${c.name}</h1>
          <div class="row small muted" style="margin-top:4px">
            ${c.code ? h`<span>#${c.code}</span>` : ""}${c.phone ? h`<a class="ltr" href="tel:${c.phone}">${c.phone}</a>` : ""}${c.email ? h`<a class="ltr" href="mailto:${c.email}">${c.email}</a>` : h`<span class="badge warn">אין מייל</span>`}
            ${c.referrer ? h`<span>הופנה ע"י ${c.referrer}</span>` : ""}
            ${c.status === "inactive" ? h`<span class="badge">לא פעיל</span>` : c.status === "lead" ? h`<span class="badge info">מתעניין</span>` : h`<span class="badge good">פעיל</span>`}
            ${C.bool(c.hasPassword) ? h`<span class="badge gold">מחובר לאזור האישי</span>` : ""}
          </div></div>
        <div class="qa">
          <button class="btn btn-outline btn-sm" data-act="emailPick" data-client="${id}" data-template="summary">✉ סיכום פגישה</button>
          <button class="btn btn-outline btn-sm" data-act="email" data-client="${id}" data-template="invite">📅 זימון</button>
          <button class="btn btn-outline btn-sm" data-act="email" data-client="${id}" data-template="account">💳 מצב חשבון</button>
          <button class="btn btn-outline btn-sm" data-act="email" data-client="${id}" data-template="reminder">⏰ תזכורת</button>
          <button class="btn btn-outline btn-sm" data-act="email" data-client="${id}" data-template="welcome">🔑 הזמנה לאזור האישי</button>
        </div>
      </div>
      <div class="grid grid-4" style="margin-top:16px">
        <div class="tile ${a.renewalAlert ? "warn" : ""}"><div class="lbl">${pkg ? "נותרו בסל (" + pkg.name + ")" : "הסדר"}</div>
          <div class="val">${pkg ? h`${r2(pkg.remaining)} <small class="muted" style="font-size:14px">/ ${r2(pkg.units)} ${unitLabel(pkg.unitType)}</small>` : h`<span style="font-size:17px">${C.PRICING_MODELS[a.model]}</span>`}</div>
          ${pkg ? UI.bar(pkg.units ? pkg.used / pkg.units : 0, a.renewalAlert ? "warn" : "") : h`<div class="hint">${a.model === "monthly" ? C.fmtMoney(c.monthlyFee) + " לחודש" : C.fmtMoney(c.rate) + (c.unitType === "hour" ? " לשעה" : " לפגישה")}</div>`}</div>
        <div class="tile ${a.balance > 0.5 ? "bad" : a.balance < -0.5 ? "good" : ""}"><div class="lbl">${a.balance < -0.5 ? "יתרת זכות" : "יתרת חוב"}</div><div class="val">${C.fmtMoney(Math.abs(a.balance))}</div>
          <div class="hint">לתשלום ${C.fmtMoney(a.totalCharges)} · שולם ${C.fmtMoney(a.totalPaid)}</div></div>
        <div class="tile"><div class="lbl">פגישות שהתקיימו</div><div class="val">${a.heldCount}</div><div class="hint">${a.hoursTotal} שעות · ${r2(a.consumedUnits)} יח' חיוב</div></div>
        <div class="tile"><div class="lbl">הפגישה הבאה</div><div class="val" style="font-size:17px">${a.nextSession ? UI.when(a.nextSession.date) : "לא נקבעה"}</div>
          <div class="hint">${a.lastHeld ? "אחרונה: " + C.fmtDate(a.lastHeld.date) : ""}</div></div>
      </div>
    </div>
    <div class="tabs" role="tablist">${TABS.map(function (t) {
      return h`<a class="tab ${tab === t[0] ? "active" : ""}" role="tab" href="#biz/client/${id}/${t[0]}">${t[1]}${t[0] === "messages" && unread ? h` <span class="badge bad">${unread}</span>` : ""}${t[0] === "sessions" && a.awaiting.length ? h` <span class="badge info">${a.awaiting.length}</span>` : ""}</a>`;
    })}</div>
    ${body}`;
  };

  function sessionRow(s, showClient) {
    var nowStr = C.ymdhm(new Date());
    var past = s.date && s.date < nowStr;
    var sm = (App.db.summaries || []).filter(function (x) { return x.sessionId === s.id; })[0];
    return h`<tr class="${s.status === "planned" && past ? "flag" : ""}">
      <td class="nowrap">${UI.when(s.date)}<div class="small muted">${s.date ? UI.hebDate(s.date) : ""}</div></td>
      ${showClient ? h`<td>${s.clientId ? h`<a href="#biz/client/${s.clientId}">${App.clientName(s.clientId)}</a>` : h`<span class="muted">${s.calendarTitle || "—"}</span>`}</td>` : ""}
      <td class="n">${s.durationMin ? s.durationMin + " דק'" : ""}${s.units !== undefined && s.units !== "" ? h`<div class="small muted">${s.units} יח'</div>` : ""}</td>
      <td>${s.location || ""}</td>
      <td>${s.status === "planned" && past ? h`<div class="status-btns">
          <button class="btn btn-good btn-xs" data-act="setStatus" data-id="${s.id}" data-status="held">✓ התקיימה</button>
          <button class="btn btn-outline btn-xs" data-act="setStatus" data-id="${s.id}" data-status="cancel_ontime">בוטלה בזמן</button>
          <button class="btn btn-bad btn-xs" data-act="setStatus" data-id="${s.id}" data-status="cancel_late">באיחור</button></div>`
        : h`<select data-change="statusSelect" data-id="${s.id}" aria-label="סטטוס" style="min-height:32px;padding:4px 8px;font-size:13px;width:auto">${UI.options(["planned", "held", "cancel_ontime", "cancel_late"].map(function (k) { return [k, C.SESSION_STATUS[k]]; }), s.status)}</select>`}</td>
      <td class="nowrap">${s.calendarEventId ? h`<span title="מסונכרן ליומן Google">📅</span> ` : ""}
        ${s.clientId && s.status !== "cancel_ontime" ? h`<button class="btn btn-ghost btn-xs" data-act="summary" data-session="${s.id}">${sm ? (sm.sentAt ? "✉ סיכום נשלח" : "📝 סיכום") : "+ סיכום"}</button>` : ""}
        <button class="btn btn-ghost btn-xs" data-act="editSession" data-id="${s.id}" aria-label="עריכה">✎</button></td></tr>`;
  }

  function tabSessions(c, a) {
    var list = a.sessions.filter(function (s) { return s.status !== "ignored"; }).slice().reverse();
    return h`<div class="card"><div class="card-title"><h3>היסטוריית פגישות</h3><button class="btn btn-primary btn-sm" data-act="newSession" data-client="${c.id}">+ פגישה</button></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>מועד</th><th class="n">משך</th><th>מיקום</th><th>סטטוס</th><th></th></tr></thead>
      <tbody>${list.length ? list.map(function (s) { return sessionRow(s, false); }) : h`<tr><td colspan="5" class="empty">עוד אין פגישות</td></tr>`}</tbody></table></div></div>`;
  }

  function tabFinance(c, a) {
    return h`<div class="grid grid-2">
      <div class="card"><div class="card-title"><h3>סלי פגישות</h3><button class="btn btn-primary btn-sm" data-act="newPackage" data-client="${c.id}">+ סל חדש</button></div>
        ${a.packages.length ? a.packages.map(function (p) {
          return h`<div class="pkg ${p.remaining <= 0 ? "done" : ""}"><div class="row between"><b>${p.name}</b><span class="small muted">${C.fmtDate(p.startDate)} · ${C.fmtMoney(p.price)}</span></div>
            <div class="row between small" style="margin:6px 0"><span>נוצלו <b>${r2(p.used)}</b> מתוך ${r2(p.units)} ${unitLabel(p.unitType)}</span><span>נותרו <b class="${p.remaining <= C.num(App.settings().renewalThreshold) ? "t-bad" : ""}">${r2(p.remaining)}</b></span></div>
            ${UI.bar(p.units ? p.used / p.units : 0)}
            <div class="row" style="margin-top:6px"><button class="btn btn-ghost btn-xs" data-act="editPackage" data-id="${p.id}">עריכה</button><button class="btn btn-ghost btn-xs" data-act="delRow" data-table="packages" data-id="${p.id}">מחיקה</button></div></div>`;
        }) : h`<div class="empty">אין סלים. ${a.model === "single" ? "הלקוח מחויב לפי פגישה." : ""}</div>`}
        ${a.overflowUnits > 0 && a.packages.length ? h`<p class="small muted" style="margin-top:8px">${r2(a.overflowUnits)} יח' מעבר לסלים חויבו לפי ${C.fmtMoney(c.rate)} ליחידה.</p>` : ""}
        <div class="card-title" style="margin-top:18px"><h3>חיובים חד-פעמיים</h3><button class="btn btn-outline btn-sm" data-act="newCharge" data-client="${c.id}">+ חיוב חד-פעמי</button></div>
        ${(App.db.charges || []).filter(function (x) { return x.clientId === c.id; }).map(function (x) {
          return h`<div class="aitem"><span class="who">${C.fmtMoney(x.amount)}</span><span class="when">${x.reason} ${x.date ? "· " + C.fmtDate(x.date) : ""}</span>
            <span class="acts"><button class="btn btn-ghost btn-xs" data-act="delRow" data-table="charges" data-id="${x.id}">מחיקה</button></span></div>`;
        })}
      </div>
      <div class="card"><div class="card-title"><h3>תשלומים</h3><button class="btn btn-primary btn-sm" data-act="newPayment" data-client="${c.id}">+ תשלום</button></div>
        <div class="table-wrap"><table class="t"><thead><tr><th>תאריך</th><th class="n">סכום</th><th>אמצעי</th><th></th></tr></thead><tbody>
          ${a.payments.length ? a.payments.slice().reverse().map(function (p) {
            return h`<tr><td>${C.fmtDate(p.date) || "—"}</td><td class="n">${C.fmtMoney(p.amount)}</td><td>${C.PAY_METHODS[p.method] || p.method}${p.methodNote ? " - " + p.methodNote : ""}</td>
              <td class="nowrap"><button class="btn btn-ghost btn-xs" data-act="editPayment" data-id="${p.id}">✎</button></td></tr>`;
          }) : h`<tr><td colspan="4" class="empty">אין תשלומים</td></tr>`}</tbody>
          <tfoot><tr><td>סה"כ שולם</td><td class="n">${C.fmtMoney(a.totalPaid)}</td><td colspan="2"></td></tr></tfoot></table></div>
      </div>
    </div>
    <div class="card section"><div class="card-title"><h3>כרטסת - חיובים מול תשלומים</h3><span class="sub">כל חיוב נוצר אוטומטית מסטטוס הפגישות, הסלים והחיובים החד-פעמיים</span></div>
      <div class="table-wrap"><table class="t ledger"><thead><tr><th>תאריך</th><th>פירוט</th><th class="n">חיוב</th><th class="n">תשלום</th></tr></thead><tbody>
      ${a.chargeLines.map(function (l) { return { d: l.date, t: l.label, c: l.amount }; }).concat(a.payments.map(function (p) { return { d: p.date, t: "תשלום - " + (C.PAY_METHODS[p.method] || ""), p: C.num(p.amount) }; }))
        .sort(function (x, y) { return String(x.d || "").localeCompare(String(y.d || "")); })
        .map(function (l) { return h`<tr><td>${C.fmtDate(l.d) || "—"}</td><td>${l.t}</td><td class="n">${l.c !== undefined ? C.fmtMoney(l.c) : ""}</td><td class="n neg">${l.p !== undefined ? C.fmtMoney(l.p) : ""}</td></tr>`; })}
      </tbody><tfoot><tr><td colspan="2">${a.balance > 0.5 ? "יתרת חוב" : a.balance < -0.5 ? "יתרת זכות" : "מאוזן"}</td><td class="n">${C.fmtMoney(a.totalCharges)}</td><td class="n">${C.fmtMoney(a.totalPaid)}</td></tr></tfoot></table></div></div>`;
  }

  function tabSummaries(c, a) {
    var sums = (App.db.summaries || []).filter(function (s) { return s.clientId === c.id; })
      .sort(function (x, y) { return String(y.date || "").localeCompare(String(x.date || "")); });
    var heldNoSum = a.sessions.filter(function (s) { return s.status === "held" && !sums.some(function (x) { return x.sessionId === s.id; }); }).slice(-5).reverse();
    return h`${heldNoSum.length ? h`<div class="card"><div class="card-title"><h3>פגישות ללא סיכום</h3></div><div class="alist">${heldNoSum.map(function (s) {
        return h`<div class="aitem"><span class="who">${UI.when(s.date)}</span><span class="acts"><button class="btn btn-primary btn-xs" data-act="summary" data-session="${s.id}">+ כתיבת סיכום</button></span></div>`;
      })}</div></div>` : ""}
    <div class="section">${sums.length ? sums.map(function (sm) {
      var s = C.byId(App.db.sessions, sm.sessionId) || {};
      return h`<div class="card" style="margin-bottom:12px"><div class="card-title"><h3>${UI.when(s.date || sm.date)}</h3>
        <div class="row">${C.bool(sm.shared) ? h`<span class="badge good">משותף עם הלקוח</span>` : h`<span class="badge">פרטי</span>`}${sm.sentAt ? h`<span class="badge info">נשלח ${C.fmtDate(sm.sentAt)}</span>` : ""}
        ${UI.safeUrl(sm.docUrl) ? h`<a class="btn btn-ghost btn-xs" href="${UI.safeUrl(sm.docUrl)}" target="_blank" rel="noopener">מסמך ב-Drive</a>` : ""}
        ${UI.safeUrl(sm.recordingUrl) ? h`<a class="btn btn-ghost btn-xs" href="${UI.safeUrl(sm.recordingUrl)}" target="_blank" rel="noopener">🎧 הקלטה</a>` : ""}
        <button class="btn btn-outline btn-xs" data-act="summary" data-session="${sm.sessionId}">עריכה</button>
        <button class="btn btn-primary btn-xs" data-act="email" data-client="${c.id}" data-template="summary" data-session="${sm.sessionId}">✉ שליחה ללקוח</button></div></div>
        <div class="grid grid-3">
          ${sm.points ? h`<div><h4 class="small muted">נקודות שעלו</h4><div class="pre small">${sm.points}</div></div>` : ""}
          ${sm.decisions ? h`<div><h4 class="small muted">החלטות</h4><div class="pre small">${sm.decisions}</div></div>` : ""}
          ${sm.homework ? h`<div><h4 class="small muted">שיעורי בית</h4><div class="pre small">${sm.homework}</div></div>` : ""}
        </div>${sm.text ? h`<details style="margin-top:10px"><summary class="small">סיכום מלא (Notebook)</summary><div class="pre small" style="margin-top:6px">${sm.text}</div></details>` : ""}
        ${sm.internalNotes ? h`<div class="small muted" style="margin-top:8px">🔒 ${sm.internalNotes}</div>` : ""}</div>`;
    }) : h`<div class="card empty">עוד אין סיכומי פגישות</div>`}</div>`;
  }

  function tabTasks(c) {
    var tasks = (App.db.tasks || []).filter(function (t) { return t.clientId === c.id; })
      .sort(function (x, y) { return (C.bool(x.done) - C.bool(y.done)) || String(x.createdAt || "").localeCompare(String(y.createdAt || "")); });
    return h`<div class="card"><div class="card-title"><h3>משימות ומעקב לפגישה הבאה</h3></div>
      <div class="row" id="taskAdd" style="margin-bottom:12px"><input type="text" name="text" placeholder="משימה חדשה..." class="grow" style="flex:1;min-width:200px">
        <input type="date" name="dueDate" style="width:auto"><label class="check"><input type="checkbox" name="shared"> גלוי ללקוח</label>
        <button class="btn btn-primary btn-sm" data-act="addTask" data-client="${c.id}">הוספה</button></div>
      ${tasks.length ? h`<div class="alist">${tasks.map(function (t) {
        return h`<div class="aitem"><label class="check"><input type="checkbox" data-change="toggleTask" data-id="${t.id}" ${C.bool(t.done) ? raw("checked") : ""}>
          <span style="${C.bool(t.done) ? "text-decoration:line-through;color:var(--muted)" : ""}">${t.text}</span></label>
          <span class="when">${t.dueDate ? "עד " + C.fmtDate(t.dueDate) : ""}</span>
          <span class="acts"><button class="btn btn-ghost btn-xs" data-act="shareTask" data-id="${t.id}">${C.bool(t.shared) ? "👁 גלוי ללקוח" : "🔒 פרטי"}</button>
          <button class="btn btn-ghost btn-xs" data-act="delRow" data-table="tasks" data-id="${t.id}" aria-label="מחיקה">✕</button></span></div>`;
      })}</div>` : h`<div class="empty">אין משימות</div>`}</div>`;
  }
  Actions.addTask = function (t) {
    var d = UI.formData(UI.$("#taskAdd"));
    if (!d.text) return;
    App.save("tasks", [{ clientId: t.dataset.client, text: d.text, dueDate: d.dueDate, shared: d.shared, done: "false", createdAt: C.ymdhm(new Date()) }], { toast: false });
  };
  Actions.toggleTask = function (t) { App.save("tasks", [{ id: t.dataset.id, done: t.checked ? "true" : "false" }], { toast: false }); };
  Actions.shareTask = function (t) {
    var x = C.byId(App.db.tasks, t.dataset.id);
    App.save("tasks", [{ id: x.id, shared: C.bool(x.shared) ? "false" : "true" }], { toast: false });
  };

  function tabDetails(c) {
    var portal = App.settings().siteUrl.replace(/\/$/, "") + "/portal/";
    return h`<div class="grid grid-2"><div class="card"><div class="card-title"><h3>פרטי לקוח</h3><button class="btn btn-primary btn-sm" data-act="editClient" data-client="${c.id}">עריכה</button></div>
      <dl class="kv">
        <dt>שם</dt><dd>${c.name}</dd><dt>מספר לקוח</dt><dd>${c.code || "—"}</dd><dt>טלפון</dt><dd class="ltr">${c.phone || "—"}</dd><dt>אימייל</dt><dd class="ltr">${c.email || "—"}</dd>
        <dt>גורם מפנה</dt><dd>${c.referrer || "—"}</dd><dt>הסדר תשלום</dt><dd>${C.PRICING_MODELS[c.pricingModel || "single"]}</dd>
        <dt>מחיר ליחידה</dt><dd>${C.fmtMoney(c.rate)} ${c.unitType === "hour" ? "לשעה" : "לפגישה"}</dd>
        ${c.pricingModel === "monthly" ? h`<dt>תשלום חודשי</dt><dd>${C.fmtMoney(c.monthlyFee)}</dd>` : ""}
        <dt>שם התהליך</dt><dd>${c.processName || "—"}</dd><dt>מילת זיהוי ביומן</dt><dd>${c.calendarKeyword || "—"}</dd>
        <dt>נוצר</dt><dd>${C.fmtDate(c.createdAt) || "—"}</dd>
      </dl>${c.notes ? h`<div class="small pre" style="margin-top:12px;padding:10px;background:var(--cream);border-radius:10px">🔒 ${c.notes}</div>` : ""}</div>
      <div class="card"><div class="card-title"><h3>אזור אישי ללקוח</h3></div>
        <p class="small muted">הלקוח נכנס עם המייל שלו וסיסמה שהוא בוחר בעצמו (מקבל קישור בחירת סיסמה במייל "הזמנה לאזור האישי"). הוא רואה רק את ההתקדמות, התשלומים, הפגישות, הסיכומים והמשימות שסימנת כגלויים.</p>
        <div class="row" style="margin-top:12px">
          <button class="btn btn-primary btn-sm" data-act="email" data-client="${c.id}" data-template="welcome">שליחת הזמנה / קישור סיסמה</button>
          <button class="btn btn-outline btn-sm" data-act="copyLink" data-url="${portal}">העתקת כתובת האזור האישי</button>
          ${C.bool(c.hasPassword) ? h`<button class="btn btn-bad btn-sm" data-act="revokePortal" data-client="${c.id}">ניתוק גישה</button>` : ""}
        </div>
        ${c.driveFolderId ? h`<div style="margin-top:14px"><a href="https://drive.google.com/drive/folders/${c.driveFolderId}" target="_blank" rel="noopener">📁 תיקיית הלקוח ב-Drive</a></div>` : ""}
      </div></div>`;
  }
  Actions.revokePortal = async function (t) {
    if (!(await UI.confirm("ניתוק גישה", "הלקוח יתנתק מהאזור האישי והקישורים הקודמים יבוטלו. אפשר לשלוח הזמנה חדשה בהמשך.", "ניתוק", true))) return;
    var r = await App.call("revokePortal", { clientId: t.dataset.client });
    if (r.ok) { UI.toast("הגישה נותקה"); App.reload(); }
  };

  function tabMessages(c) {
    var msgs = (App.db.messages || []).filter(function (m) { return m.clientId === c.id; }).sort(function (x, y) { return String(y.date).localeCompare(String(x.date)); });
    var log = (App.db.email_log || []).filter(function (m) { return m.clientId === c.id; }).sort(function (x, y) { return String(y.date).localeCompare(String(x.date)); });
    return h`<div class="grid grid-2"><div class="card"><div class="card-title"><h3>הודעות מהלקוח</h3></div>
      ${msgs.length ? h`<div class="alist">${msgs.map(messageItem)}</div>` : h`<div class="empty">אין הודעות</div>`}</div>
      <div class="card"><div class="card-title"><h3>מיילים שנשלחו</h3></div>
      ${log.length ? h`<div class="table-wrap"><table class="t"><tbody>${log.map(function (l) {
        return h`<tr><td class="nowrap">${C.fmtDate(l.date)} ${C.fmtTime(l.date)}</td><td>${EmailTemplates.TYPES[l.template] || l.template}</td></tr>`;
      })}</tbody></table></div>` : h`<div class="empty">עוד לא נשלחו מיילים</div>`}</div></div>`;
  }
  function messageItem(m) {
    var c = App.client(m.clientId) || {};
    return h`<div class="aitem ${C.bool(m.read) ? "" : "warn"}" style="align-items:flex-start;flex-direction:column">
      <div class="row" style="width:100%"><b>${c.name}</b>${m.kind === "details" ? h`<span class="badge info">בקשה לשינוי פרטים</span>` : ""}<span class="when">${C.fmtDate(m.date)} ${C.fmtTime(m.date)}</span>
        <span class="acts">${!C.bool(m.read) ? h`<button class="btn btn-outline btn-xs" data-act="markRead" data-id="${m.id}">✓ נקרא</button>` : ""}
        ${c.email ? h`<a class="btn btn-ghost btn-xs" href="mailto:${c.email}?subject=${encodeURIComponent("בהמשך להודעתך")}">השבה במייל</a>` : ""}</span></div>
      <div class="pre small">${m.text}</div>
      ${UI.safeUrl(m.attachmentUrl) ? h`<a class="small" href="${UI.safeUrl(m.attachmentUrl)}" target="_blank" rel="noopener">📎 ${m.attachmentName || "קובץ מצורף"}</a>` : m.attachmentName ? h`<span class="small muted">📎 ${m.attachmentName}</span>` : ""}</div>`;
  }
  Actions.markRead = function (t) { App.save("messages", [{ id: t.dataset.id, read: "true" }], { toast: false }); };

  // ================================================================ packages / charges / payments
  function packageForm(clientId, p) {
    var c = App.client(clientId);
    p = p || { unitType: c.unitType || "session", startDate: C.ymd(new Date()) };
    var m = UI.modal({
      title: p.id ? "עריכת סל" : "סל פגישות חדש - " + c.name,
      body: h`${p.id ? "" : h`<div class="chips" style="margin-bottom:14px">${C.PACKAGE_PRESETS.map(function (x, i) {
          return h`<button class="chip" data-preset="${i}">${x.name} · ${C.fmtMoney(x.price)}</button>`; })}<button class="chip" data-preset="custom">סל מותאם</button></div>`}
        <div class="form-grid" id="pkgBox">
          <label class="field span-2"><span>שם הסל</span><input type="text" name="name" value="${p.name}"></label>
          <label class="field"><span>כמות</span><input type="number" name="units" value="${p.units}" min="0" step="0.5"></label>
          <label class="field"><span>יחידה</span><select name="unitType">${UI.options([["session", "פגישות"], ["hour", "שעות"]], p.unitType)}</select></label>
          <label class="field"><span>מחיר הסל ₪</span><input type="number" name="price" value="${p.price}" min="0"></label>
          <label class="field"><span>תאריך רכישה</span><input type="date" name="startDate" value="${p.startDate}"></label>
          <label class="field span-2"><span>הערות</span><input type="text" name="notes" value="${p.notes}"></label>
        </div>`,
      foot: h`<button class="btn btn-primary" data-save>שמירה</button><button class="btn btn-outline" data-close>ביטול</button>`
    });
    UI.$$("[data-preset]", m.el).forEach(function (b) {
      b.addEventListener("click", function () {
        UI.$$("[data-preset]", m.el).forEach(function (x) { x.classList.toggle("active", x === b); });
        if (b.dataset.preset === "custom") { m.$("[name=name]").value = "סל מותאם"; m.$("[name=units]").focus(); return; }
        var x = C.PACKAGE_PRESETS[+b.dataset.preset];
        m.$("[name=name]").value = x.name; m.$("[name=units]").value = x.units; m.$("[name=unitType]").value = x.unitType; m.$("[name=price]").value = x.price;
      });
    });
    m.$("[data-save]").addEventListener("click", async function () {
      var d = UI.formData(m.$("#pkgBox"));
      if (!(C.num(d.units) > 0)) { UI.toast("יש להזין כמות", true); return; }
      if (!d.name) d.name = "סל " + d.units + " " + unitLabel(d.unitType);
      d.id = p.id; d.clientId = clientId;
      m.close();
      await App.save("packages", [d]);
      if (!p.id && c.pricingModel !== "package") App.save("clients", [{ id: clientId, pricingModel: "package" }], { toast: false });
    });
  }
  Actions.newPackage = function (t) { packageForm(t.dataset.client); };
  Actions.editPackage = function (t) { var p = C.byId(App.db.packages, t.dataset.id); packageForm(p.clientId, p); };

  Actions.newCharge = function (t) {
    var cid = t.dataset.client;
    var m = UI.modal({
      title: "תשלום / חיוב חד-פעמי",
      body: h`<div class="form-grid" id="chBox">
        <label class="field"><span>סכום ₪ (שלילי = הנחה)</span><input type="number" name="amount" required></label>
        <label class="field"><span>תאריך</span><input type="date" name="date" value="${C.ymd(new Date())}"></label>
        <label class="field span-2"><span>סיבת החיוב *</span><input type="text" name="reason" required placeholder="למשל: אבחון, סדנה, דמי פתיחת תיק"></label></div>`,
      foot: h`<button class="btn btn-primary" data-save>שמירה</button><button class="btn btn-outline" data-close>ביטול</button>`
    });
    m.$("[data-save]").addEventListener("click", function () {
      var d = UI.formData(m.$("#chBox"));
      if (!C.num(d.amount)) { UI.toast("יש להזין סכום", true); return; }
      if (!d.reason) { UI.toast("חובה לציין את סיבת התשלום", true); m.$("[name=reason]").focus(); return; }
      d.clientId = cid;
      m.close();
      App.save("charges", [d]);
    });
  };

  function paymentForm(p) {
    p = p || { date: C.ymd(new Date()), method: "transfer" };
    var clients = (App.db.clients || []).filter(function (c) { return c.status !== "inactive" || c.id === p.clientId; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), "he"); });
    var m = UI.modal({
      title: p.id ? "עריכת תשלום" : "רישום תשלום",
      body: h`<div class="form-grid" id="payBox">
        <label class="field span-2"><span>לקוח *</span><select name="clientId">${UI.options(clients.map(function (c) { return [c.id, c.name]; }), p.clientId, "בחירת לקוח...")}</select></label>
        <div class="span-2 small" id="payDue"></div>
        <label class="field"><span>סכום ששולם ₪ *</span><input type="number" name="amount" value="${p.amount}" min="0" step="0.01"></label>
        <label class="field"><span>תאריך התשלום</span><input type="date" name="date" value="${p.date}"></label>
        <label class="field"><span>אמצעי תשלום</span><select name="method">${UI.options(Object.keys(C.PAY_METHODS).map(function (k) { return [k, C.PAY_METHODS[k]]; }), p.method)}</select></label>
        <label class="field"><span>פירוט (חובה באמצעי "אחר")</span><input type="text" name="methodNote" value="${p.methodNote}"></label>
        <label class="field span-2"><span>הערות</span><input type="text" name="notes" value="${p.notes}"></label></div>`,
      foot: h`<button class="btn btn-primary" data-save>שמירה</button>${p.id ? h`<button class="btn btn-bad" data-del>מחיקה</button>` : ""}<button class="btn btn-outline" data-close>ביטול</button>`
    });
    function showDue() {
      var cid = m.$("[name=clientId]").value;
      if (!cid) { m.$("#payDue").textContent = ""; return; }
      var a = App.accounts()[cid];
      UI.setHtml(m.$("#payDue"), h`<div class="aitem ${a.balance > 0.5 ? "warn" : ""}">סכום לתשלום: <b>${C.fmtMoney(a.totalCharges)}</b> · שולם: <b>${C.fmtMoney(a.totalPaid)}</b> · יתרה: <b>${C.fmtMoney(a.balance)}</b>
        ${a.balance > 0.5 && !p.id ? h`<button class="btn btn-outline btn-xs" data-fill="${a.balance}">מילוי היתרה</button>` : ""}</div>`);
      var f = m.$("[data-fill]");
      if (f) f.addEventListener("click", function () { m.$("[name=amount]").value = f.dataset.fill; });
    }
    m.$("[name=clientId]").addEventListener("change", showDue);
    showDue();
    m.$("[data-save]").addEventListener("click", function () {
      var d = UI.formData(m.$("#payBox"));
      if (!d.clientId) { UI.toast("יש לבחור לקוח", true); return; }
      if (!(C.num(d.amount) > 0)) { UI.toast("יש להזין סכום", true); return; }
      if (d.method === "other" && !d.methodNote) { UI.toast("יש לפרט את אמצעי התשלום", true); return; }
      d.id = p.id;
      m.close();
      App.save("payments", [d], { msg: "התשלום נרשם" });
    });
    var del = m.$("[data-del]");
    if (del) del.addEventListener("click", async function () {
      if (!(await UI.confirm("מחיקת תשלום", "למחוק את התשלום?", "מחיקה", true))) return;
      m.close(); App.remove("payments", p.id);
    });
  }
  Actions.newPayment = function (t) { paymentForm({ clientId: t.dataset.client, date: C.ymd(new Date()), method: "transfer" }); };
  Actions.editPayment = function (t) { paymentForm(C.byId(App.db.payments, t.dataset.id)); };

  Actions.delRow = async function (t) {
    if (!(await UI.confirm("מחיקה", "למחוק את הפריט?", "מחיקה", true))) return;
    App.remove(t.dataset.table, t.dataset.id);
  };

  // ================================================================ sessions
  function sessionForm(s) {
    var st = App.settings();
    var isNew = !s.id;
    var clients = (App.db.clients || []).filter(function (c) { return c.status !== "inactive" || c.id === s.clientId; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), "he"); });
    var locs = Array.isArray(st.locations) ? st.locations : [];
    var def = new Date(); def.setMinutes(0); def.setHours(def.getHours() + 1);
    var m = UI.modal({
      title: isNew ? "פגישה חדשה" : "עריכת פגישה",
      body: h`<div class="form-grid" id="sessBox">
        <label class="field span-2"><span>לקוח *</span><select name="clientId">${UI.options(clients.map(function (c) { return [c.id, c.name]; }), s.clientId, "בחירת לקוח...")}</select></label>
        <label class="field"><span>מועד</span><input type="datetime-local" name="date" value="${s.date || C.ymdhm(def)}"></label>
        <label class="field"><span>משך (דקות)</span><input type="number" name="durationMin" value="${s.durationMin || st.defaultSessionMinutes}" min="5" step="5"></label>
        <label class="field"><span>מיקום</span><input type="text" name="location" value="${s.location || locs[0] || ""}" list="locList"><datalist id="locList">${locs.map(function (l) { return h`<option value="${l}">`; })}</datalist></label>
        <label class="field"><span>סטטוס</span><select name="status">${UI.options(["planned", "held", "cancel_ontime", "cancel_late"].map(function (k) { return [k, C.SESSION_STATUS[k]]; }), s.status || "planned")}</select></label>
        <label class="field"><span>יחידות חיוב (ריק = אוטומטי)</span><input type="number" name="units" value="${s.units}" min="0" step="0.25" placeholder="אוטומטי"></label>
        ${isNew || !s.calendarEventId ? h`<label class="check span-2"><input type="checkbox" name="addToCalendar" checked> להוסיף ליומן Google</label>` : h`<div class="span-2 small muted">📅 מסונכרן ליומן Google - שינוי מועד יעודכן גם ביומן</div>`}
        <label class="field span-2"><span>הערות</span><input type="text" name="notes" value="${s.notes}"></label></div>`,
      foot: h`<button class="btn btn-primary" data-save>שמירה</button>${!isNew ? h`<button class="btn btn-bad" data-del>מחיקה</button>` : ""}<button class="btn btn-outline" data-close>ביטול</button>`
    });
    m.$("[data-save]").addEventListener("click", function () {
      var d = UI.formData(m.$("#sessBox"));
      if (!d.clientId) { UI.toast("יש לבחור לקוח", true); return; }
      if (!d.date) { UI.toast("יש לבחור מועד", true); return; }
      d.id = s.id;
      if (isNew) d.source = "manual";
      var createEvents = d.addToCalendar === "true";
      if (!createEvents) delete d.addToCalendar;
      m.close();
      App.save("sessions", [d], { createEvents: createEvents, msg: createEvents ? "נשמר ונוסף ליומן" : "נשמר" });
    });
    var del = m.$("[data-del]");
    if (del) del.addEventListener("click", async function () {
      var alsoCal = !!s.calendarEventId;
      if (!(await UI.confirm("מחיקת פגישה", alsoCal ? "הפגישה תימחק גם מיומן Google. אם היא בוטלה - עדיף לסמן 'בוטלה' במקום למחוק." : "למחוק את הפגישה?", "מחיקה", true))) return;
      m.close(); App.remove("sessions", s.id, { deleteEvent: alsoCal });
    });
  }
  Actions.newSession = function (t) { sessionForm({ clientId: t.dataset.client || "" }); };
  Actions.editSession = function (t) { sessionForm(C.byId(App.db.sessions, t.dataset.id)); };

  Pages["biz/sessions"] = function () {
    var db = App.db;
    if (!ui.sessMonth) ui.sessMonth = C.thisMonth();
    var nowStr = C.ymdhm(new Date());
    var awaiting = (db.sessions || []).filter(function (s) { return s.clientId && s.status === "planned" && s.date && s.date < nowStr; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });
    var unassigned = (db.sessions || []).filter(function (s) { return s.status === "unassigned"; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    var list = (db.sessions || []).filter(function (s) {
      if (!s.clientId || s.status === "ignored") return false;
      if (ui.sessMonth !== "all" && C.monthKey(s.date) !== ui.sessMonth) return false;
      if (ui.sessStatus && s.status !== ui.sessStatus) return false;
      return true;
    }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var bm = ui.sessMonth !== "all" ? C.businessMonth(db, ui.sessMonth) : null;
    var clients = (db.clients || []).filter(function (c) { return c.status !== "inactive"; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), "he"); });
    return h`<div class="page-head"><div><h1>יומן פגישות</h1><div class="sub">מסונכרן עם Google Calendar${App.meta.lastSync ? " · עודכן " + C.fmtDate(App.meta.lastSync) + " " + C.fmtTime(App.meta.lastSync) : ""}</div></div>
      <div class="row"><button class="btn btn-outline btn-sm" data-act="syncCal">⟳ סנכרון עכשיו</button><button class="btn btn-primary btn-sm" data-act="newSession">+ פגישה</button></div></div>
    ${awaiting.length ? h`<div class="card"><div class="card-title"><h3>ממתינות לאישור סטטוס (${awaiting.length})</h3><span class="sub">אחרי שהפגישה עברה - לסמן מה קרה. "התקיימה" ו"בוטלה באיחור" מורידות יחידה מהסל או מוסיפות חיוב.</span></div>
      <div class="alist">${awaiting.map(awaitingItem)}</div></div>` : ""}
    ${unassigned.length ? h`<div class="card section"><div class="card-title"><h3>אירועי יומן שלא זוהו (${unassigned.length})</h3><span class="sub">בחרו לקוח לשיוך, או הסתירו אירוע שאינו פגישה</span></div>
      <div class="alist">${unassigned.map(function (s) {
        return h`<div class="aitem"><span class="who">${s.calendarTitle || "(ללא כותרת)"}</span><span class="when">${UI.when(s.date)}</span>
          <span class="acts"><select data-change="assignSession" data-id="${s.id}" style="width:auto;min-height:32px;padding:4px 8px;font-size:13px">${UI.options(clients.map(function (c) { return [c.id, c.name]; }), "", "שיוך ללקוח...")}</select>
          <button class="btn btn-ghost btn-xs" data-act="ignoreSession" data-id="${s.id}">הסתרה</button></span></div>`;
      })}</div></div>` : ""}
    <div class="card section">
      <div class="toolbar">${monthNav("sessMonth", ui.sessMonth, true)}
        <select data-change="sessStatus" aria-label="סינון סטטוס">${UI.options([["", "כל הסטטוסים"]].concat(["planned", "held", "cancel_ontime", "cancel_late"].map(function (k) { return [k, C.SESSION_STATUS[k]]; })), ui.sessStatus)}</select>
        ${bm ? h`<span class="small muted">התקיימו <b>${bm.heldCount}</b> · בוטלו באיחור <b>${bm.lateCancelCount}</b> · מתוכננות <b>${bm.plannedCount}</b> · ${bm.heldHours} שעות</span>` : ""}</div>
      <div class="table-wrap"><table class="t"><thead><tr><th>מועד</th><th>לקוח</th><th class="n">משך</th><th>מיקום</th><th>סטטוס</th><th></th></tr></thead>
        <tbody>${list.length ? list.map(function (s) { return sessionRow(s, true); }) : h`<tr><td colspan="6" class="empty">אין פגישות בתקופה</td></tr>`}</tbody></table></div></div>`;
  };
  Actions.sessStatus = function (t) { ui.sessStatus = t.value; App.render(); };
  Actions.assignSession = function (t) {
    if (!t.value) return;
    var s = C.byId(App.db.sessions, t.dataset.id);
    var nowStr = C.ymdhm(new Date());
    App.save("sessions", [{ id: s.id, clientId: t.value, status: "planned" }], { msg: "שויך" + (s.date < nowStr ? " - כעת אפשר לאשר את הסטטוס" : "") });
  };
  Actions.ignoreSession = function (t) { App.save("sessions", [{ id: t.dataset.id, status: "ignored" }], { toast: false }); };

  function monthNav(key, value, allowAll) {
    return h`<div class="month-nav"><button data-act="monthStep" data-key="${key}" data-d="1" aria-label="חודש הבא">›</button>
      <span>${value === "all" ? "כל התקופה" : C.monthLabel(value)}</span><button data-act="monthStep" data-key="${key}" data-d="-1" aria-label="חודש קודם">‹</button></div>
      ${allowAll ? h`<button class="chip ${value === "all" ? "active" : ""}" data-act="monthAll" data-key="${key}">הכל</button>` : ""}`;
  }
  Actions.monthStep = function (t) {
    var k = t.dataset.key, cur = ui[k] === "all" || !ui[k] ? C.thisMonth() : ui[k];
    ui[k] = C.addMonths(cur, +t.dataset.d);
    App.render();
  };
  Actions.monthAll = function (t) { var k = t.dataset.key; ui[k] = ui[k] === "all" ? C.thisMonth() : "all"; App.render(); };

  // ================================================================ payments log
  Pages["biz/payments"] = function () {
    if (!ui.payMonth) ui.payMonth = "all";
    var q = ui.paySearch.trim();
    var list = (App.db.payments || []).filter(function (p) {
      if (ui.payMonth !== "all" && C.monthKey(p.date) !== ui.payMonth) return false;
      if (ui.payMethod && p.method !== ui.payMethod) return false;
      if (q && App.clientName(p.clientId).indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); });
    var total = list.reduce(function (s, p) { return s + C.num(p.amount); }, 0);
    var byMethod = {};
    list.forEach(function (p) { byMethod[p.method] = (byMethod[p.method] || 0) + C.num(p.amount); });
    var accs = App.accounts();
    return h`<div class="page-head"><div><h1>יומן תשלומים</h1><div class="sub">${list.length} תשלומים · ${C.fmtMoney(total)}</div></div>
      <div class="row"><button class="btn btn-outline btn-sm" data-act="exportPayments">ייצוא</button><button class="btn btn-primary btn-sm" data-act="newPayment">+ תשלום</button></div></div>
    <div class="grid grid-4">${Object.keys(byMethod).map(function (k) { return h`<div class="tile"><div class="lbl">${C.PAY_METHODS[k] || k}</div><div class="val" style="font-size:21px">${C.fmtMoney(byMethod[k])}</div></div>`; })}</div>
    <div class="card section"><div class="toolbar">${monthNav("payMonth", ui.payMonth, true)}
      <select data-change="payMethod" aria-label="אמצעי תשלום">${UI.options([["", "כל האמצעים"]].concat(Object.keys(C.PAY_METHODS).map(function (k) { return [k, C.PAY_METHODS[k]]; })), ui.payMethod)}</select>
      <input type="search" placeholder="חיפוש לקוח" value="${ui.paySearch}" data-change="paySearch" aria-label="חיפוש"></div>
    <div class="table-wrap"><table class="t"><thead><tr><th>תאריך</th><th>לקוח</th><th class="n">סכום ששולם</th><th>אמצעי</th><th class="n">יתרת הלקוח כעת</th><th></th></tr></thead><tbody>
      ${list.length ? list.map(function (p) {
        var a = accs[p.clientId];
        return h`<tr><td>${C.fmtDate(p.date) || "—"}</td><td><a href="#biz/client/${p.clientId}/finance">${App.clientName(p.clientId)}</a></td><td class="n">${C.fmtMoney(p.amount)}</td>
          <td>${C.PAY_METHODS[p.method] || p.method}${p.methodNote ? " - " + p.methodNote : ""}</td><td class="n">${a ? UI.money(a.balance, true) : ""}</td>
          <td><button class="btn btn-ghost btn-xs" data-act="editPayment" data-id="${p.id}">✎</button></td></tr>`;
      }) : h`<tr><td colspan="6" class="empty">אין תשלומים</td></tr>`}</tbody>
      <tfoot><tr><td colspan="2">סה"כ</td><td class="n">${C.fmtMoney(total)}</td><td colspan="3"></td></tr></tfoot></table></div></div>`;
  };
  Actions.payMethod = function (t) { ui.payMethod = t.value; App.render(); };
  Actions.paySearch = function (t) { ui.paySearch = t.value; App.render(); };
  Actions.exportPayments = function () {
    var rows = [["תאריך", "לקוח", "סכום", "אמצעי", "פירוט"]];
    (App.db.payments || []).forEach(function (p) { rows.push([p.date, App.clientName(p.clientId), p.amount, C.PAY_METHODS[p.method] || p.method, p.methodNote]); });
    UI.download("payments-" + C.ymd(new Date()) + ".csv", UI.toCsv(rows));
  };

  // ================================================================ P&L
  Pages["biz/pnl"] = function () {
    var db = App.db, st = App.settings();
    if (!ui.pnlYear) ui.pnlYear = String(new Date().getFullYear());
    if (!ui.pnlMonth) ui.pnlMonth = C.thisMonth();
    var months = [];
    for (var i = 1; i <= 12; i++) months.push(ui.pnlYear + "-" + C.pad(i));
    var bms = months.map(function (m) { return C.businessMonth(db, m); });
    var cats = {};
    bms.forEach(function (b) { Object.keys(b.expensesByCategory).forEach(function (k) { cats[k] = true; }); });
    cats = Object.keys(cats);
    var target = C.num(st.monthlyIncomeTarget);
    var sessT = C.monthlySessionTarget(st);
    // Year totals count months up to today; later months are a forecast of recurring costs.
    var nowMk = C.thisMonth();
    var tot = { held: 0, col: 0, exp: 0, net: 0 };
    bms.forEach(function (b) { if (b.month > nowMk) return; tot.held += b.heldCount; tot.col += b.collected; tot.exp += b.expenseTotal; tot.net += b.net; });
    var cur = C.businessMonth(db, ui.pnlMonth);
    var yearOpts = [];
    for (var y = new Date().getFullYear() + 1; y >= 2024; y--) yearOpts.push(String(y));
    return h`<div class="page-head"><div><h1>רווח והפסד - הקליניקה</h1><div class="sub">גבייה בפועל פחות הוצאות העסק = רווח נקי${C.bool(st.familyIncludeBusiness) ? " · הרווח הנקי מוזרם אוטומטית לכלכלת המשפחה" : ""}</div></div>
      <div class="row"><select data-change="pnlYear" aria-label="שנה" style="width:auto">${UI.options(yearOpts, ui.pnlYear)}</select><button class="btn btn-primary btn-sm" data-act="newExpense">+ הוצאה</button></div></div>
    <div class="grid grid-4"><div class="tile"><div class="lbl">גבייה ${ui.pnlYear} (עד היום)</div><div class="val">${C.fmtMoney(tot.col)}</div></div>
      <div class="tile"><div class="lbl">הוצאות ${ui.pnlYear}</div><div class="val">${C.fmtMoney(tot.exp)}</div></div>
      <div class="tile ${tot.net >= 0 ? "good" : "bad"}"><div class="lbl">רווח נקי ${ui.pnlYear}</div><div class="val">${C.fmtMoney(tot.net)}</div><div class="hint">יעד שנתי ${C.fmtMoney(target * 12)} · ${target ? Math.round(tot.net / (target * 12) * 100) : 0}% מהיעד השנתי</div></div>
      <div class="tile"><div class="lbl">פגישות שהתקיימו</div><div class="val">${tot.held}</div><div class="hint">יעד שנתי ${sessT * 12}</div></div></div>
    <div class="card section">${UI.barChart({ title: "רווח נקי חודשי", labels: months.map(function (m) { return C.HE_MONTHS[+m.slice(5) - 1].slice(0, 3) + "׳"; }), fullLabels: months.map(C.monthLabel),
        series: [{ name: "גבייה בפועל", color: "var(--series-1)", values: bms.map(function (b) { return b.collected; }) }, { name: "הוצאות", color: "var(--series-2)", values: bms.map(function (b) { return b.expenseTotal; }) }], format: C.fmtMoney })}</div>
    <div class="card section"><div class="card-title"><h3>טבלה חודשית</h3><button class="btn btn-outline btn-sm" data-act="exportPnl">ייצוא</button></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>חודש</th><th class="n">פגישות</th><th class="n">גבייה בפועל</th>${cats.map(function (k) { return h`<th class="n">${k}</th>`; })}<th class="n">סה"כ הוצאות</th><th class="n">רווח נקי</th><th class="n">% מהיעד</th></tr></thead>
      <tbody>${bms.map(function (b, i) {
        var pct = target ? b.net / target : 0;
        return h`<tr class="click" data-act="pnlMonth" data-m="${months[i]}" style="${months[i] > nowMk ? "opacity:.55" : ""}"><td class="nowrap">${C.monthLabel(months[i])}${months[i] > nowMk ? h` <span class="badge">צפי</span>` : ""}</td><td class="n">${b.heldCount}</td><td class="n">${C.fmtMoney(b.collected)}</td>
          ${cats.map(function (k) { return h`<td class="n">${b.expensesByCategory[k] ? C.fmtMoney(b.expensesByCategory[k]) : ""}</td>`; })}
          <td class="n">${C.fmtMoney(b.expenseTotal)}</td><td class="n"><b class="${b.net < 0 ? "t-bad" : ""}">${C.fmtMoney(b.net)}</b></td>
          <td class="n"><span class="badge ${pct >= 1 ? "good" : pct >= .8 ? "warn" : b.collected || b.expenseTotal ? "bad" : ""}">${Math.round(pct * 100)}%</span></td></tr>`;
      })}</tbody><tfoot><tr><td>סה"כ</td><td class="n">${tot.held}</td><td class="n">${C.fmtMoney(tot.col)}</td>${cats.map(function () { return h`<td></td>`; })}<td class="n">${C.fmtMoney(tot.exp)}</td><td class="n">${C.fmtMoney(tot.net)}</td><td></td></tr></tfoot></table></div></div>
    <div class="card section"><div class="card-title"><h3>הוצאות ${C.monthLabel(ui.pnlMonth)}</h3>${monthNav("pnlMonth", ui.pnlMonth, false)}</div>
      <div class="table-wrap"><table class="t"><thead><tr><th>קטגוריה</th><th class="n">סכום</th><th>סוג</th><th>הערות</th><th></th></tr></thead><tbody>
      ${cur.expenses.length ? cur.expenses.map(function (e) {
        return h`<tr><td>${e.category}</td><td class="n">${C.fmtMoney(e.amount)}</td><td>${e.recurring ? h`<span class="badge info">קבועה</span>` : "חד-פעמית"}</td><td>${e.notes || ""}</td>
          <td><button class="btn btn-ghost btn-xs" data-act="editExpense" data-id="${e.id}">✎</button></td></tr>`;
      }) : h`<tr><td colspan="5" class="empty">אין הוצאות בחודש זה</td></tr>`}</tbody>
      <tfoot><tr><td>סה"כ</td><td class="n">${C.fmtMoney(cur.expenseTotal)}</td><td colspan="3">גבייה ${C.fmtMoney(cur.collected)} · רווח נקי <b>${C.fmtMoney(cur.net)}</b></td></tr></tfoot></table></div></div>`;
  };
  Actions.pnlYear = function (t) { ui.pnlYear = t.value; App.render(); };
  Actions.pnlMonth = function (t) { ui.pnlMonth = t.dataset.m; App.render(); };
  Actions.exportPnl = function () {
    var rows = [["חודש", "פגישות", "גבייה", "הוצאות", "רווח נקי"]];
    for (var i = 1; i <= 12; i++) { var m = ui.pnlYear + "-" + C.pad(i), b = C.businessMonth(App.db, m); rows.push([m, b.heldCount, b.collected, b.expenseTotal, b.net]); }
    UI.download("pnl-" + ui.pnlYear + ".csv", UI.toCsv(rows));
  };

  function expenseForm(e) {
    e = e || { date: C.ymd(new Date()), recurring: "none", category: C.BUSINESS_EXPENSE_CATS[0] };
    var m = UI.modal({
      title: e.id ? "עריכת הוצאה" : "הוצאה עסקית חדשה",
      body: h`<div class="form-grid" id="expBox">
        <label class="field"><span>קטגוריה</span><input type="text" name="category" value="${e.category}" list="expCats"><datalist id="expCats">${C.BUSINESS_EXPENSE_CATS.map(function (c) { return h`<option value="${c}">`; })}</datalist></label>
        <label class="field"><span>סכום ₪</span><input type="number" name="amount" value="${e.amount}" min="0" step="0.01"></label>
        <label class="field"><span>תאריך / חודש התחלה</span><input type="date" name="date" value="${e.date}"></label>
        <label class="field"><span>חזרה</span><select name="recurring">${UI.options([["none", "חד-פעמית"], ["monthly", "כל חודש"], ["yearly", "כל שנה"]], e.recurring)}</select></label>
        <label class="field"><span>עד תאריך (להוצאה חוזרת, אופציונלי)</span><input type="date" name="endDate" value="${e.endDate}"></label>
        <label class="field"><span>הערות</span><input type="text" name="notes" value="${e.notes}"></label></div>`,
      foot: h`<button class="btn btn-primary" data-save>שמירה</button>${e.id ? h`<button class="btn btn-bad" data-del>מחיקה</button>` : ""}<button class="btn btn-outline" data-close>ביטול</button>`
    });
    m.$("[data-save]").addEventListener("click", function () {
      var d = UI.formData(m.$("#expBox"));
      if (!(C.num(d.amount) > 0) || !d.category) { UI.toast("יש למלא קטגוריה וסכום", true); return; }
      d.id = e.id; m.close(); App.save("expenses", [d]);
    });
    var del = m.$("[data-del]");
    if (del) del.addEventListener("click", async function () {
      if (!(await UI.confirm("מחיקת הוצאה", e.recurring !== "none" ? "זו הוצאה חוזרת - היא תימחק מכל החודשים. כדי להפסיק אותה מעכשיו, עדיף להגדיר 'עד תאריך'." : "למחוק את ההוצאה?", "מחיקה", true))) return;
      m.close(); App.remove("expenses", e.id);
    });
  }
  Actions.newExpense = function () { expenseForm(null); };
  Actions.editExpense = function (t) { expenseForm(C.byId(App.db.expenses, t.dataset.id)); };

  // ================================================================ inbox
  Pages["biz/inbox"] = function () {
    var db = App.db;
    var pending = (db.bookings || []).filter(function (b) { return b.status === "pending"; }).sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); });
    var past = (db.bookings || []).filter(function (b) { return b.status !== "pending"; }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 10);
    var msgs = (db.messages || []).filter(function (m) { return C.bool(m.fromClient); }).sort(function (a, b) { return (C.bool(a.read) - C.bool(b.read)) || String(b.date).localeCompare(String(a.date)); });
    return h`<div class="page-head"><div><h1>בקשות והודעות</h1><div class="sub">בקשות לפגישה והודעות שהגיעו מהאזור האישי של הלקוחות</div></div></div>
    <div class="grid grid-2">
      <div class="card"><div class="card-title"><h3>בקשות לפגישה</h3></div>
        ${pending.length ? h`<div class="alist">${pending.map(function (b) {
          return h`<div class="aitem" style="flex-direction:column;align-items:stretch"><div class="row"><b><a href="#biz/client/${b.clientId}">${App.clientName(b.clientId)}</a></b>
            <span class="when">${UI.when(b.start)} · ${b.location}</span></div>
            ${b.note ? h`<div class="small pre">"${b.note}"</div>` : ""}
            <div class="row"><input type="datetime-local" value="${b.start}" id="bk_${b.id}" style="width:auto;min-height:34px" aria-label="מועד">
              <button class="btn btn-good btn-sm" data-act="approveBooking" data-id="${b.id}">אישור + זימון במייל</button>
              <button class="btn btn-bad btn-sm" data-act="declineBooking" data-id="${b.id}">דחייה</button></div></div>`;
        })}</div>` : h`<div class="empty">אין בקשות ממתינות</div>`}
        ${past.length ? h`<details style="margin-top:12px"><summary class="small">בקשות קודמות</summary><div class="alist" style="margin-top:8px">${past.map(function (b) {
          return h`<div class="aitem"><span>${App.clientName(b.clientId)}</span><span class="when">${UI.when(b.start)}</span><span class="badge ${b.status === "approved" ? "good" : ""}">${b.status === "approved" ? "אושרה" : "נדחתה"}</span></div>`;
        })}</div></details>` : ""}</div>
      <div class="card"><div class="card-title"><h3>הודעות מלקוחות</h3></div>
        ${msgs.length ? h`<div class="alist">${msgs.slice(0, 40).map(messageItem)}</div>` : h`<div class="empty">אין הודעות</div>`}</div>
    </div>`;
  };
  Actions.approveBooking = async function (t) {
    var start = (UI.$("#bk_" + t.dataset.id) || {}).value;
    t.disabled = true;
    var r = await App.call("approveBooking", { id: t.dataset.id, start: start });
    t.disabled = false;
    if (!r.ok) { UI.toast("האישור נכשל", true); return; }
    UI.toast("הפגישה נקבעה, נוספה ליומן ונשלח זימון");
    App.reload();
  };
  Actions.declineBooking = async function (t) {
    if (!(await UI.confirm("דחיית בקשה", "לדחות את הבקשה? מומלץ לעדכן את הלקוח במועד חלופי.", "דחייה", true))) return;
    var r = await App.call("approveBooking", { id: t.dataset.id, decline: true });
    if (r.ok) App.reload();
  };

  // ================================================================ summaries
  function summaryForm(sessionId) {
    var s = C.byId(App.db.sessions, sessionId);
    var c = App.client(s.clientId);
    var sm = (App.db.summaries || []).filter(function (x) { return x.sessionId === sessionId; })[0] || { sessionId: sessionId, clientId: s.clientId, date: s.date, shared: "true" };
    var m = UI.modal({
      title: "סיכום פגישה - " + c.name + " · " + C.fmtDate(s.date), wide: true,
      body: h`<div class="form-grid" id="sumBox">
        <label class="field span-2"><span>נקודות שעלו בפגישה - שורה רגילה = נושא מודגש, שורה שמתחילה ב"-" = תת-סעיף</span><textarea name="points" rows="6">${sm.points}</textarea></label>
        <label class="field"><span>החלטות שהתקבלו</span><textarea name="decisions" rows="4">${sm.decisions}</textarea></label>
        <label class="field"><span>שיעורי בית</span><textarea name="homework" rows="4">${sm.homework}</textarea></label>
        <label class="field span-2"><span>סיכום מלא מ-Notebook (הדבקה)</span><textarea name="text" rows="5">${sm.text}</textarea></label>
        <label class="field span-2"><span>🔒 הערות פנימיות (לעולם לא נשלחות ללקוח)</span><textarea name="internalNotes" rows="2">${sm.internalNotes}</textarea></label>
        <div class="field span-2"><span>הקלטת הפגישה</span>
          <div class="row"><input type="file" id="recFile" accept="audio/*,video/*,.m4a,.mp3,.wav,.ogg,.webm" style="flex:1">
          <input type="url" name="recordingUrl" value="${sm.recordingUrl}" placeholder="או קישור להקלטה" class="ltr" style="flex:1"></div>
          <span class="small muted">הקובץ נשמר בתיקיית הלקוח ב-Google Drive (עד 40MB) ונשאר פרטי.</span></div>
        <label class="check span-2"><input type="checkbox" name="shared" ${C.bool(sm.shared) ? raw("checked") : ""}> להציג את הסיכום (ללא ההערות הפנימיות) באזור האישי של הלקוח</label>
      </div>`,
      foot: h`<button class="btn btn-primary" data-save>שמירה</button><button class="btn btn-outline" data-save-send>שמירה ושליחה במייל</button><button class="btn btn-ghost" data-close>ביטול</button>`
    });
    async function doSave(send) {
      var d = UI.formData(m.$("#sumBox"));
      d.id = sm.id || C.uid("sm"); d.sessionId = sessionId; d.clientId = s.clientId; d.date = s.date;
      var f = m.$("#recFile").files[0];
      UI.$$("[data-save],[data-save-send]", m.el).forEach(function (b) { b.disabled = true; });
      if (f) {
        if (f.size > 40 * 1024 * 1024) { UI.toast("הקובץ גדול מ-40MB - העלו אותו ישירות ל-Drive והדביקו קישור", true); UI.$$("[data-save],[data-save-send]", m.el).forEach(function (b) { b.disabled = false; }); return; }
        UI.toast("מעלה את ההקלטה ל-Drive...");
        var b64 = await UI.fileToBase64(f);
        var up = await App.call("uploadFile", { clientId: s.clientId, file: { name: C.ymd(C.toDate(s.date) || new Date()) + " - " + f.name, mimeType: f.type, data: b64 }, folder: "הקלטות וסיכומים" });
        if (!up.ok) { UI.toast("העלאת ההקלטה נכשלה", true); UI.$$("[data-save],[data-save-send]", m.el).forEach(function (b) { b.disabled = false; }); return; }
        d.recordingUrl = up.file.url; d.recordingFileId = up.file.id;
      }
      m.close();
      var saved = await App.save("summaries", [d], { msg: "הסיכום נשמר ב-Drive" });
      if (saved && send) emailPreview("summary", s.clientId, sessionId);
    }
    m.$("[data-save]").addEventListener("click", function () { doSave(false); });
    m.$("[data-save-send]").addEventListener("click", function () { doSave(true); });
  }
  Actions.summary = function (t) { summaryForm(t.dataset.session); };

  // ================================================================ e-mails
  async function emailPreview(template, clientId, sessionId) {
    var c = App.client(clientId);
    if (!c.email) { UI.toast("ללקוח אין כתובת מייל - יש להוסיף בפרטי הלקוח", true); return; }
    var r = await App.call("previewEmail", { template: template, clientId: clientId, sessionId: sessionId });
    if (!r.ok) { UI.toast("לא ניתן להכין את המייל" + (r.message ? ": " + r.message : ""), true); return; }
    var m = UI.modal({
      title: EmailTemplates.TYPES[template] + " → " + c.name, wide: true,
      body: h`<div class="small muted" style="margin-bottom:8px">אל: <span class="ltr">${r.to}</span> · נושא: <b>${r.subject}</b></div>
        <iframe class="email-frame" sandbox="" title="תצוגה מקדימה"></iframe>
        ${template === "welcome" ? h`<p class="small muted" style="margin-top:8px">הקישור לבחירת סיסמה במייל האמיתי אישי, חתום ותקף לשבוע.</p>` : ""}`,
      foot: h`<button class="btn btn-primary" data-send>שליחה</button><button class="btn btn-outline" data-close>ביטול</button>`
    });
    m.$("iframe").srcdoc = r.html;
    m.$("[data-send]").addEventListener("click", async function () {
      this.disabled = true;
      var res = await App.call("sendEmail", { template: template, clientId: clientId, sessionId: sessionId });
      if (!res.ok) { this.disabled = false; UI.toast(res.error === "no_email" ? "אין כתובת מייל" : "השליחה נכשלה" + (res.message ? ": " + res.message : ""), true); return; }
      m.close();
      UI.toast(res.demo ? "במצב הדגמה המייל לא נשלח באמת" : "המייל נשלח ל-" + res.to);
      App.reload();
    });
  }
  Actions.email = function (t) { emailPreview(t.dataset.template, t.dataset.client, t.dataset.session); };
  Actions.emailPick = function (t) {
    var cid = t.dataset.client;
    var sums = (App.db.summaries || []).filter(function (s) { return s.clientId === cid; }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var held = C.sessionsOf(App.db, cid).filter(function (s) { return s.status === "held"; }).reverse().slice(0, 8);
    var m = UI.modal({
      title: "סיכום פגישה - בחירת פגישה",
      body: h`<div class="alist">${held.length ? held.map(function (s) {
        var sm = sums.filter(function (x) { return x.sessionId === s.id; })[0];
        return h`<div class="aitem"><span class="who">${UI.when(s.date)}</span>${sm ? h`<span class="badge ${sm.sentAt ? "info" : "good"}">${sm.sentAt ? "נשלח" : "יש סיכום"}</span>` : h`<span class="badge">אין סיכום</span>`}
          <span class="acts">${sm ? h`<button class="btn btn-primary btn-xs" data-pick-send="${s.id}">תצוגה ושליחה</button>` : ""}<button class="btn btn-outline btn-xs" data-pick-edit="${s.id}">${sm ? "עריכה" : "כתיבת סיכום"}</button></span></div>`;
      }) : h`<div class="empty">אין פגישות שהתקיימו</div>`}</div>`
    });
    UI.$$("[data-pick-send]", m.el).forEach(function (b) { b.addEventListener("click", function () { m.close(); emailPreview("summary", cid, b.dataset.pickSend); }); });
    UI.$$("[data-pick-edit]", m.el).forEach(function (b) { b.addEventListener("click", function () { m.close(); summaryForm(b.dataset.pickEdit); }); });
  };
})();
