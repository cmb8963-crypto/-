/* app.js - admin shell: login, data store, routing, settings and the diagnostic tab. */
var Pages = window.Pages || {};
var Actions = window.Actions || {};
var App = (function () {
  "use strict";
  var C = Core, h = UI.h, raw = UI.raw, $ = UI.$;
  var TOKEN_KEY = "crm_admin_token";
  var token = sessionStorage.getItem(TOKEN_KEY) || "";
  var state = { db: null, meta: {}, route: "", params: [], cache: {} };

  // ------------------------------------------------------------ API helpers
  async function call(action, payload) {
    var res;
    try { res = await Api.call(action, Object.assign({ token: token }, payload || {})); }
    catch (e) { UI.toast("אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.", true); return { ok: false, error: "network" }; }
    if (!res.ok && res.error === "auth") { logout("פג תוקף הכניסה - יש להתחבר שוב"); }
    return res;
  }

  function merge(table, rows) {
    var list = state.db[table] = state.db[table] || [];
    rows.forEach(function (r) {
      var cur = C.byId(list, r.id);
      if (cur) Object.assign(cur, r); else list.push(r);
    });
  }

  // Optimistic save: update locally, render, then persist.
  async function save(table, rows, opts) {
    opts = opts || {};
    rows = [].concat(rows).map(function (r) { r = Object.assign({}, r); if (!r.id) r.id = C.uid(table.slice(0, 2)); return r; });
    merge(table, rows);
    state.cache = {};
    if (!opts.silent) render();
    var res = await call("upsert", { table: table, rows: rows, createEvents: !!opts.createEvents });
    if (!res.ok) {
      UI.toast("השמירה נכשלה" + (res.message ? ": " + res.message : ""), true);
      await reload();
      return null;
    }
    merge(table, res.rows || []);
    state.cache = {};
    if (!opts.silent) render();
    if (opts.toast !== false) UI.toast(opts.msg || "נשמר");
    return res.rows;
  }
  async function remove(table, ids, extra) {
    ids = [].concat(ids);
    state.db[table] = (state.db[table] || []).filter(function (r) { return ids.indexOf(r.id) === -1; });
    state.cache = {};
    render();
    var res = await call("remove", Object.assign({ table: table, ids: ids }, extra || {}));
    if (!res.ok) { UI.toast("המחיקה נכשלה", true); await reload(); return false; }
    UI.toast("נמחק");
    return true;
  }

  async function reload() {
    var res = await call("bootstrap");
    if (!res.ok) return false;
    state.db = res.db;
    state.meta = res.db.meta || {};
    state.cache = {};
    render();
    return true;
  }

  function settings() { return state.cache.st || (state.cache.st = C.settingsOf(state.db)); }
  function accounts() {
    if (!state.cache.acc) {
      var now = new Date(), m = {};
      (state.db.clients || []).forEach(function (c) { m[c.id] = C.clientAccount(state.db, c.id, now); });
      state.cache.acc = m;
    }
    return state.cache.acc;
  }
  function client(id) { return C.byId(state.db.clients, id); }
  function clientName(id) { var c = client(id); return c ? c.name : "—"; }
  function setSetting(key, value) {
    return save("settings", [{ id: key, value: typeof value === "object" ? JSON.stringify(value) : value }], { toast: false });
  }

  // ------------------------------------------------------------ login
  function showGate() {
    $("#app").hidden = true;
    $("#gate").hidden = false;
    var note = $("#gateNote");
    if (!Api.isConfigured()) {
      $("#gateSub").textContent = "המערכת עוד לא חוברה לשרת";
      UI.setHtml(note, h`יש להשלים את ההתקנה לפי <b>docs/SETUP.md</b>. בינתיים אפשר <a href="?demo=1">לנסות במצב הדגמה</a> (נתונים בדויים בלבד).`);
      $("#loginForm").hidden = true;
      return;
    }
    UI.setHtml(note, Api.isDemo() ? h`מצב הדגמה - כל סיסמה תתקבל. <a href="./" data-act="exitDemo">יציאה ממצב הדגמה</a>` : h`<a href="?demo=1">לצפייה במצב הדגמה</a>`);
    Api.call("status").then(function (r) {
      if (r && r.ok && r.installed === false) { $("#gateSub").textContent = "יש להריץ את setup() בעורך Apps Script"; }
      if (r && r.ok && r.hasAdmin === false) {
        state.initMode = true;
        $("#gateSub").textContent = "הגדרה ראשונה - בחירת סיסמת מנהל";
        $("#codeField").hidden = false; $("#pw2Field").hidden = false;
        $("#pwLabel").textContent = "סיסמה חדשה (10 תווים לפחות, אותיות וספרות)";
        $("#pw").autocomplete = "new-password";
        $("#loginBtn").textContent = "שמירה וכניסה";
      }
    }).catch(function () {});
  }

  async function onLogin(e) {
    e.preventDefault();
    var err = $("#gateErr");
    var pw = $("#pw").value;
    err.textContent = "";
    $("#loginBtn").disabled = true;
    var res;
    try {
      if (state.initMode) {
        if (pw !== $("#pw2").value) { err.textContent = "הסיסמאות אינן תואמות"; return; }
        res = await Api.call("adminInit", { code: $("#setupCode").value, password: pw });
      } else {
        res = await Api.call("adminLogin", { password: pw });
      }
    } catch (x) { res = { ok: false, error: "network" }; }
    finally { $("#loginBtn").disabled = false; }
    if (!res.ok) {
      err.textContent = { bad_password: "סיסמה שגויה", locked: "יותר מדי ניסיונות. נסו שוב בעוד 15 דקות.", bad_code: "קוד הגדרה שגוי",
        weak: res.message || "סיסמה חלשה מדי", network: "אין חיבור לשרת", not_initialized: "יש להשלים את הגדרת הסיסמה" }[res.error] || "שגיאה בכניסה";
      return;
    }
    token = res.token;
    sessionStorage.setItem(TOKEN_KEY, token);
    $("#pw").value = ""; $("#pw2").value = "";
    start();
  }

  function logout(msg) {
    token = "";
    sessionStorage.removeItem(TOKEN_KEY);
    state.db = null;
    showGate();
    if (msg) $("#gateErr").textContent = msg;
  }

  // Auto sign-out after 30 minutes of inactivity.
  var idleTimer;
  function bumpIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { if (token) logout("התנתקת אוטומטית לאחר חוסר פעילות"); }, 30 * 60e3);
  }
  ["click", "keydown", "mousemove", "touchstart"].forEach(function (ev) { document.addEventListener(ev, bumpIdle, { passive: true }); });

  async function start() {
    $("#gate").hidden = true;
    $("#app").hidden = false;
    $("#demoBadge").hidden = !Api.isDemo();
    UI.setHtml($("#view"), h`<div class="loading"><span class="spinner"></span> טוען נתונים...</div>`);
    var ok = await reload();
    if (!ok) return;
    bumpIdle();
    if (!location.hash) location.hash = "#biz/dashboard";
    else render();
  }

  // ------------------------------------------------------------ routing
  var SUBTABS = {
    biz: [["biz/dashboard", "דשבורד"], ["biz/clients", "לקוחות"], ["biz/sessions", "יומן פגישות"], ["biz/payments", "תשלומים"],
      ["biz/pnl", "רווח והפסד"], ["biz/inbox", "בקשות והודעות"]],
    family: [["family/overview", "סקירה"], ["family/month", "חודש"], ["family/import", "ייבוא דוחות"], ["family/budget", "תקציב וקטגוריות"],
      ["family/rules", "חוקי סיווג"], ["family/loans", "משכנתאות והלוואות"]],
    diag: [],
    settings: [["settings", "הגדרות"], ["settings/security", "אבטחה ויומן פעולות"]]
  };

  function parseRoute() {
    var hsh = decodeURIComponent(location.hash.replace(/^#/, "")) || "biz/dashboard";
    var parts = hsh.split("/");
    var top = parts[0];
    var key = parts.slice(0, 2).join("/");
    if (!Pages[key]) key = Pages[top] ? top : "biz/dashboard";
    return { top: top, key: key, params: parts.slice(2) };
  }

  function render() {
    if (!state.db) return;
    var r = parseRoute();
    state.route = r.key; state.params = r.params;
    UI.$$("#mainTabs a").forEach(function (a) { a.classList.toggle("active", a.dataset.top === (r.top === "settings" ? "" : r.top)); });
    var inboxCount = (state.db.bookings || []).filter(function (b) { return b.status === "pending"; }).length +
      (state.db.messages || []).filter(function (m) { return C.bool(m.fromClient) && !C.bool(m.read); }).length;
    var subs = SUBTABS[r.top] || [];
    UI.setHtml($("#subTabs"), subs.map(function (s) {
      var active = r.key === s[0] || (s[0] === "biz/clients" && r.key === "biz/client");
      return h`<a href="#${s[0]}" class="${active ? "active" : ""}">${s[1]}${s[0] === "biz/inbox" && inboxCount ? h`<span class="dot">${inboxCount}</span>` : ""}</a>`;
    }));
    $("#subTabs").hidden = !subs.length;
    var view = $("#view");
    var scroll = window.scrollY;
    try { UI.setHtml(view, Pages[r.key](r.params)); }
    catch (e) { console.error(e); UI.setHtml(view, h`<div class="card"><b>שגיאה בהצגת המסך</b><div class="small muted ltr">${String(e.message || e)}</div></div>`); }
    if (state.lastKey === r.key + r.params.join("/")) window.scrollTo(0, scroll);
    else window.scrollTo(0, 0);
    state.lastKey = r.key + r.params.join("/");
    if (Pages[r.key].after) Pages[r.key].after(r.params);
    document.title = (($("#subTabs a.active") || {}).textContent || "מערכת ניהול") + " · מערכת ניהול";
  }
  window.addEventListener("hashchange", render);

  // ------------------------------------------------------------ event delegation
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-act]");
    if (!t) return;
    var fn = Actions[t.dataset.act];
    if (!fn) return;
    e.preventDefault();
    fn(t, e);
  });
  document.addEventListener("change", function (e) {
    var t = e.target.closest("[data-change]");
    if (t && Actions[t.dataset.change]) Actions[t.dataset.change](t, e);
  });
  document.addEventListener("input", function (e) {
    var t = e.target.closest("[data-input]");
    if (t && Actions[t.dataset.input]) Actions[t.dataset.input](t, e);
  });
  document.addEventListener("click", function (e) {
    var row = e.target.closest("tr[data-href]");
    if (row && !e.target.closest("button,a,input,select,label")) location.hash = row.dataset.href;
  });

  Actions.logout = function () { logout(""); };
  Actions.exitDemo = function () { Api.exitDemo(); location.href = "./"; };
  Actions.reload = async function () { await reload(); UI.toast("הנתונים עודכנו"); };

  // ------------------------------------------------------------ settings page
  var DAYS = C.HE_DAYS.map(function (d, i) { return [i, d]; });
  Pages["settings"] = function () {
    var st = settings();
    var avail = st.availability;
    if (typeof avail === "string") { try { avail = JSON.parse(avail); } catch (e) { avail = []; } }
    var locs = Array.isArray(st.locations) ? st.locations : String(st.locations || "").split(",");
    return h`<div class="page-head"><div><h1>הגדרות</h1><div class="sub">יעדים, יומן, זמינות לקביעת פגישות, חיבורים וייבוא</div></div></div>
    <div class="grid grid-2">
      <div class="card" id="setGoals"><div class="card-title"><h3>יעדים חודשיים</h3></div>
        <div class="form-grid">
          <label class="field"><span>יעד פגישות שבועי</span><input type="number" name="weeklySessionTarget" value="${st.weeklySessionTarget}" min="0"></label>
          <label class="field"><span>יעד פגישות חודשי (ריק = שבועי × 4.33)</span><input type="number" name="monthlySessionTarget" value="${st.monthlySessionTarget}" min="0" placeholder="${Math.round(C.num(st.weeklySessionTarget) * 4.33)}"></label>
          <label class="field span-2"><span>יעד הכנסה נטו חודשי (גבייה בפועל פחות הוצאות) ₪</span><input type="number" name="monthlyIncomeTarget" value="${st.monthlyIncomeTarget}" min="0"></label>
          <label class="field"><span>התראת חידוש סל כשנותרו</span><input type="number" name="renewalThreshold" value="${st.renewalThreshold}" min="0" step="0.5"></label>
        </div>
        <div class="row" style="margin-top:14px"><button class="btn btn-primary" data-act="saveSettings" data-box="setGoals">שמירה</button></div>
      </div>
      <div class="card" id="setGeneral"><div class="card-title"><h3>פרטים כלליים ומיילים</h3></div>
        <div class="form-grid">
          <label class="field"><span>שם המאמן (חתימה במיילים)</span><input type="text" name="coachName" value="${st.coachName}"></label>
          <label class="field"><span>שם העסק</span><input type="text" name="businessName" value="${st.businessName}"></label>
          <label class="field span-2"><span>כתובת האתר</span><input type="url" name="siteUrl" value="${st.siteUrl}" class="ltr"></label>
          <label class="field"><span>מחיר ברירת מחדל לפגישה ₪</span><input type="number" name="defaultRate" value="${st.defaultRate}"></label>
          <label class="field"><span>משך פגישה ברירת מחדל (דק')</span><input type="number" name="defaultSessionMinutes" value="${st.defaultSessionMinutes}"></label>
          <label class="check span-2"><input type="checkbox" name="autoReminders" ${C.bool(st.autoReminders) ? raw("checked") : ""}> לשלוח אוטומטית "תזכורת לקביעת פגישה" ללקוח שלא קבע פגישה</label>
          <label class="field"><span>אחרי כמה ימים ללא פגישה</span><input type="number" name="reminderAfterDays" value="${st.reminderAfterDays}"></label>
          <label class="check span-2"><input type="checkbox" name="shareRecordingsWithClient" ${C.bool(st.shareRecordingsWithClient) ? raw("checked") : ""}> לשתף הקלטות עם הלקוח (רק לכתובת המייל שלו) כשהסיכום משותף</label>
          <label class="check span-2"><input type="checkbox" name="familyIncludeBusiness" ${C.bool(st.familyIncludeBusiness) ? raw("checked") : ""}> להזרים את הרווח הנקי מהעסק לשורת ההכנסות בכלכלת המשפחה</label>
        </div>
        <div class="row" style="margin-top:14px"><button class="btn btn-primary" data-act="saveSettings" data-box="setGeneral">שמירה</button></div>
      </div>
      <div class="card" id="setCal"><div class="card-title"><h3>יומן Google</h3><span class="sub">סנכרון אוטומטי כל 15 דקות</span></div>
        <div class="form-grid">
          <label class="field span-2"><span>מזהה היומן (primary = היומן הראשי)</span><input type="text" name="calendarId" value="${st.calendarId}" class="ltr"></label>
          <label class="field span-2"><span>לסנכרן רק אירועים שהכותרת שלהם כוללת (אופציונלי)</span><input type="text" name="calendarKeyword" value="${st.calendarKeyword}" placeholder="למשל: פגישה"></label>
        </div>
        <p class="small muted" style="margin-top:8px">אירוע מזוהה ללקוח לפי שמו בכותרת האירוע (או לפי "מילת זיהוי ביומן" בכרטיס הלקוח). אירועים שלא זוהו מופיעים ב"יומן פגישות" לשיוך ידני.</p>
        <div class="row" style="margin-top:14px"><button class="btn btn-primary" data-act="saveSettings" data-box="setCal">שמירה</button>
          <button class="btn btn-outline" data-act="syncCal">סנכרון עכשיו</button>
          <span class="small muted">${state.meta.lastSync ? "סנכרון אחרון: " + C.fmtDate(state.meta.lastSync) + " " + C.fmtTime(state.meta.lastSync) : ""}</span></div>
      </div>
      <div class="card" id="setBooking"><div class="card-title"><h3>זמינות לקביעת פגישות (אזור הלקוח)</h3></div>
        <div class="form-grid">
          <label class="field span-2"><span>מיקומים (מופרדים בפסיק)</span><input type="text" name="locations" value="${locs.join(", ")}"></label>
          <label class="field"><span>אורך חלון (דק')</span><input type="number" name="slotMinutes" value="${st.slotMinutes}"></label>
          <label class="field"><span>כמה ימים קדימה</span><input type="number" name="bookingDaysAhead" value="${st.bookingDaysAhead}"></label>
        </div>
        <div style="margin-top:14px" id="availRows">${(avail || []).map(function (w) { return availRow(w, locs); })}</div>
        <div class="row" style="margin-top:8px"><button class="btn btn-outline btn-sm" data-act="addAvail">+ הוספת חלון זמינות</button></div>
        <p class="small muted" style="margin-top:8px">חלונות שכבר תפוסים ביומן Google לא יוצגו ללקוחות.</p>
        <div class="row" style="margin-top:14px"><button class="btn btn-primary" data-act="saveBooking">שמירה</button></div>
      </div>
      <div class="card"><div class="card-title"><h3>ייבוא מהגיליון הקיים ("ניהול יומן")</h3></div>
        <p class="small muted">מייבא לקוחות, יומן פגישות, יומן תשלומים והוצאות חודשיות. הייבוא רץ בתוך חשבון Google שלך - הנתונים לא עוברים דרך האתר.</p>
        <label class="field" style="margin-top:10px"><span>קישור לגיליון</span><input type="url" id="legacyUrl" class="ltr" placeholder="https://docs.google.com/spreadsheets/d/..." value="${st.legacySheetId ? "https://docs.google.com/spreadsheets/d/" + st.legacySheetId : ""}"></label>
        <div class="row" style="margin-top:12px"><button class="btn btn-primary" data-act="importLegacy">ייבוא</button>
          ${C.bool(st.legacyImported) ? h`<span class="badge good">יובא בעבר</span><button class="btn btn-ghost btn-sm" data-act="importLegacy" data-force="1">ייבוא מחדש (מחליף את הנתונים שיובאו)</button>` : ""}</div>
      </div>
      <div class="card"><div class="card-title"><h3>Google Drive וגיבוי</h3></div>
        <dl class="kv">
          <dt>חשבון</dt><dd class="ltr">${state.meta.account || "—"}</dd>
          <dt>תיקיית המערכת</dt><dd>${state.meta.rootFolderUrl ? h`<a href="${state.meta.rootFolderUrl}" target="_blank" rel="noopener">פתיחה ב-Drive</a>` : "—"}</dd>
          <dt>מסד הנתונים</dt><dd>${state.meta.dbUrl ? h`<a href="${state.meta.dbUrl}" target="_blank" rel="noopener">פתיחת הגיליון</a>` : "—"}</dd>
        </dl>
        <p class="small muted" style="margin-top:8px">הקלטות, סיכומים (כמסמך Google) וקבצים נשמרים אוטומטית בתיקייה של כל לקוח. גיבוי מלא של מסד הנתונים נשמר מדי יום (30 גיבויים אחרונים).</p>
        <div class="row" style="margin-top:12px"><button class="btn btn-outline" data-act="backupNow">גיבוי עכשיו</button>
          <button class="btn btn-outline" data-act="exportAll">ייצוא הכל (JSON)</button>
          ${Api.isDemo() ? h`<button class="btn btn-bad" data-act="resetDemo">איפוס נתוני ההדגמה</button>` : ""}</div>
      </div>
    </div>`;
  };
  function availRow(w, locs) {
    w = w || { day: 0, from: "09:00", to: "13:00", location: locs[0] || "" };
    return h`<div class="avail-row">
      <select name="day" aria-label="יום">${UI.options(DAYS, w.day)}</select>
      <select name="location" aria-label="מיקום">${UI.options(locs.map(function (l) { return l.trim(); }), w.location)}</select>
      <button class="btn btn-ghost btn-sm" data-act="delAvail" aria-label="הסרה">✕</button>
      <label class="field"><span>משעה</span><input type="time" name="from" value="${w.from}"></label>
      <label class="field"><span>עד שעה</span><input type="time" name="to" value="${w.to}"></label></div>`;
  }
  Actions.addAvail = function () {
    var st = settings();
    var locs = String(UI.$("#setBooking [name=locations]").value).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    UI.$("#availRows").insertAdjacentHTML("beforeend", UI.fmt(availRow(null, locs.length ? locs : st.locations)));
  };
  Actions.delAvail = function (t) { t.closest(".avail-row").remove(); };
  Actions.saveBooking = async function () {
    var box = UI.$("#setBooking");
    var locs = String(box.querySelector("[name=locations]").value).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var avail = UI.$$(".avail-row", box).map(function (r) {
      return { day: +r.querySelector("[name=day]").value, from: r.querySelector("[name=from]").value, to: r.querySelector("[name=to]").value, location: r.querySelector("[name=location]").value };
    });
    await save("settings", [
      { id: "locations", value: JSON.stringify(locs) }, { id: "availability", value: JSON.stringify(avail) },
      { id: "slotMinutes", value: box.querySelector("[name=slotMinutes]").value }, { id: "bookingDaysAhead", value: box.querySelector("[name=bookingDaysAhead]").value }
    ]);
  };
  Actions.saveSettings = async function (t) {
    var data = UI.formData(UI.$("#" + t.dataset.box));
    await save("settings", Object.keys(data).map(function (k) { return { id: k, value: data[k] }; }));
  };
  Actions.syncCal = async function (t) {
    t.disabled = true;
    var r = await call("syncCalendar");
    t.disabled = false;
    if (!r.ok) { UI.toast("הסנכרון נכשל" + (r.message ? ": " + r.message : ""), true); return; }
    UI.toast(r.demo ? "במצב הדגמה אין סנכרון אמיתי" : "סונכרן: " + r.added + " חדשות, " + r.updated + " עודכנו, " + r.cancelled + " בוטלו" + (r.unmatched ? ", " + r.unmatched + " לא משויכות" : ""));
    await reload();
  };
  Actions.importLegacy = async function (t) {
    var url = UI.$("#legacyUrl").value;
    var m = url.match(/\/d\/([A-Za-z0-9_-]{20,})/) || url.match(/^([A-Za-z0-9_-]{20,})$/);
    if (!m) { UI.toast("יש להדביק קישור לגיליון", true); return; }
    var force = t.dataset.force === "1";
    if (force && !(await UI.confirm("ייבוא מחדש", "הנתונים שיובאו בעבר מהגיליון יוחלפו (נתונים שהוזנו ידנית במערכת יישארו). להמשיך?", "ייבוא מחדש", true))) return;
    t.disabled = true;
    UI.toast("מייבא... זה יכול לקחת כחצי דקה");
    var r = await call("importLegacy", { spreadsheetId: m[1], force: force });
    t.disabled = false;
    if (!r.ok) { UI.toast({ already_imported: "כבר יובא - אפשר לבחור ייבוא מחדש", demo: "לא זמין במצב הדגמה" }[r.error] || "הייבוא נכשל: " + (r.message || r.error), true); return; }
    UI.toast("יובאו " + r.clients + " לקוחות, " + r.sessions + " פגישות, " + r.payments + " תשלומים, " + r.expenses + " הוצאות" + (r.packages ? ", " + r.packages + " סלים (מהערות - כדאי לבדוק)" : ""));
    await reload();
  };
  Actions.backupNow = async function () {
    var r = await call("backupNow");
    UI.toast(r.ok ? "גיבוי נשמר ב-Drive" : "הגיבוי נכשל", !r.ok);
  };
  Actions.exportAll = function () {
    UI.download("crm-export-" + C.ymd(new Date()) + ".json", JSON.stringify(state.db, null, 1), "application/json");
  };
  Actions.resetDemo = function () { DemoBackend.reset(); reload(); UI.toast("נתוני ההדגמה אופסו"); };

  Pages["settings/security"] = function () {
    return h`<div class="page-head"><div><h1>אבטחה</h1><div class="sub">סיסמה, יציאה מכל המכשירים ויומן פעולות</div></div></div>
    <div class="grid grid-2">
      <div class="card" id="pwBox"><div class="card-title"><h3>שינוי סיסמת מנהל</h3></div>
        <div class="stack">
          <label class="field"><span>סיסמה נוכחית</span><input type="password" name="current" autocomplete="current-password"></label>
          <label class="field"><span>סיסמה חדשה (10 תווים לפחות, אותיות וספרות)</span><input type="password" name="password" autocomplete="new-password"></label>
          <label class="field"><span>אימות</span><input type="password" name="password2" autocomplete="new-password"></label>
        </div>
        <p class="small muted" style="margin-top:8px">שינוי הסיסמה מנתק את כל שאר הכניסות הפתוחות (כולל כניסות של לקוחות, שיצטרכו להתחבר מחדש).</p>
        <div class="row" style="margin-top:12px"><button class="btn btn-primary" data-act="changePw">עדכון סיסמה</button></div>
      </div>
      <div class="card"><div class="card-title"><h3>מה מגן על המידע</h3></div>
        <ul class="small" style="padding-inline-start:18px;line-height:1.9">
          <li>כל הנתונים נשמרים רק בגיליון פרטי ב-Google Drive שלך - לא באתר ולא בקוד.</li>
          <li>הסיסמאות נשמרות כ-hash מומלח (לא ניתנות לשחזור), והכניסה מבוססת אסימון חתום שפג תוקפו.</li>
          <li>אחרי 5 ניסיונות כושלים הכניסה ננעלת ל-15 דקות. יציאה אוטומטית אחרי 30 דקות ללא פעילות.</li>
          <li>כל לקוח רואה רק את הנתונים שלו, ורק סיכומים ומשימות שסימנת כמשותפים.</li>
          <li>הקלטות משותפות רק לכתובת המייל של הלקוח עצמו, לא "לכל מי שיש לו קישור".</li>
          <li>כל כניסה ושינוי נרשמים ביומן הפעולות.</li>
        </ul>
      </div>
    </div>
    <div class="card section"><div class="card-title"><h3>יומן פעולות אחרונות</h3><button class="btn btn-outline btn-sm" data-act="loadAudit">טעינה</button></div><div id="auditBox" class="small muted">לחצו "טעינה" להצגת 200 הפעולות האחרונות.</div></div>`;
  };
  Actions.changePw = async function () {
    var d = UI.formData(UI.$("#pwBox"));
    if (d.password !== d.password2) { UI.toast("הסיסמאות אינן תואמות", true); return; }
    var r = await call("changeAdminPassword", { current: d.current, password: d.password });
    if (!r.ok) { UI.toast(r.message || (r.error === "bad_password" ? "הסיסמה הנוכחית שגויה" : "העדכון נכשל"), true); return; }
    token = r.token; sessionStorage.setItem(TOKEN_KEY, token);
    UI.$$("#pwBox input").forEach(function (i) { i.value = ""; });
    UI.toast("הסיסמה עודכנה");
  };
  Actions.loadAudit = async function () {
    var r = await call("auditLog");
    if (!r.ok) return;
    UI.setHtml(UI.$("#auditBox"), h`<div class="table-wrap"><table class="t"><thead><tr><th>זמן</th><th>מי</th><th>פעולה</th></tr></thead><tbody>
      ${r.rows.map(function (x) { return h`<tr><td class="nowrap">${String(x.ts || "").replace("T", " ").slice(0, 16)}</td><td>${x.who}</td><td>${x.action}</td></tr>`; })}</tbody></table></div>`);
  };

  // ------------------------------------------------------------ diagnostic tab
  Pages["diag"] = function () {
    return h`<div class="page-head"><div><h1>אבחון</h1><div class="sub">כלי האבחון "מי מנהל את מי?" והדשבורד שלו</div></div></div>
    <div class="grid grid-3">
      <div class="card diag-card"><div class="ic">🧭</div><h3>דף האבחון</h3>
        <p class="small muted">15 שאלות לזיהוי היכולות והחוזקות של בעל העסק, כולל תוצאה ו"חתירה למיקוד". זה הדף הציבורי שבכתובת הראשית של האתר.</p>
        <div class="row"><a class="btn btn-primary" href="../" target="_blank" rel="noopener">פתיחת האבחון</a><button class="btn btn-outline" data-act="copyLink" data-url="${settings().siteUrl}/">העתקת קישור</button></div></div>
      <div class="card diag-card"><div class="ic">📊</div><h3>דשבורד האבחון</h3>
        <p class="small muted">כניסות, התחלות וסיומים של האבחון, ופרטי המשיבים - מתוך הגיליון המחובר לאבחון.</p>
        <div class="row"><a class="btn btn-primary" href="../dashboard/" target="_blank" rel="noopener">פתיחת הדשבורד</a></div></div>
      <div class="card diag-card"><div class="ic">🛠</div><h3>הרחבות עתידיות</h3>
        <p class="small muted">האבחון והמערכת יושבים באותו אתר ובאותה תשתית, כך שאפשר בהמשך לחבר משיב שסיים אבחון ישירות לכרטיס לקוח חדש במערכת.</p></div>
    </div>
    <div class="card section"><div class="card-title"><h3>תצוגה מקדימה</h3></div>
      <iframe src="../" title="דף האבחון" style="width:100%;height:70vh;border:1px solid var(--border);border-radius:12px;background:#fff" loading="lazy" referrerpolicy="no-referrer"></iframe></div>`;
  };
  Actions.copyLink = function (t) {
    navigator.clipboard.writeText(t.dataset.url).then(function () { UI.toast("הקישור הועתק"); });
  };

  // ------------------------------------------------------------ boot
  document.addEventListener("DOMContentLoaded", function () {
    $("#loginForm").addEventListener("submit", onLogin);
    if (token && Api.isConfigured()) start(); else showGate();
  });

  return {
    get db() { return state.db; }, get meta() { return state.meta; }, get params() { return state.params; },
    call: call, save: save, remove: remove, reload: reload, render: render, settings: settings, accounts: accounts,
    client: client, clientName: clientName, setSetting: setSetting
  };
})();
