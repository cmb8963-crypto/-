/* app.js - shell: sign-in, data store, routing (#/ diary, #/cases, #/case/<id>), header. */
var App = (function () {
  "use strict";
  var esc = UI.esc, icon = UI.icon, $ = UI.$;
  var TOKEN_KEY = "mk_token";
  var token = ssGet(TOKEN_KEY) || "";
  var state = {
    db: null, me: null, meta: {}, route: "diary", caseId: "",
    view: "all", caseFilter: "", upcomingOpen: false, casesQuery: "", casesStatus: "open", draft: null
  };

  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return ""; } }
  function ssSet(k, v) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function today() { return MK.todayYmd(); }

  // ------------------------------------------------------------ server
  async function call(action, payload) {
    var res = await Api.call(action, Object.assign({ token: token }, payload || {}));
    if (!res.ok && res.error === "auth") logout("פג תוקף הכניסה. יש להתחבר שוב.");
    return res;
  }
  /** Run a business operation (MK rule) on the server, merge the result and re-render. */
  async function act(op, input, okMsg, undo) {
    var res = await call("mutate", { op: op, input: input });
    if (!res.ok) {
      if (!res.fields && res.error !== "auth") UI.toast(res.message || "הפעולה נכשלה", null, true);
      return res;
    }
    MK.apply(state.db, res);
    render();
    if (okMsg) UI.toast(okMsg, undo);
    return res;
  }
  /** Merge a server result that is not a mutate (upload, folder). */
  function merge(res) { MK.apply(state.db, res); render(); }

  async function reload() {
    var res = await call("bootstrap");
    if (!res.ok) { if (res.error !== "auth") renderError(res.message || "לא ניתן לטעון את הנתונים"); return false; }
    state.db = res.db;
    MK.TABLES.forEach(function (t) { state.db[t] = state.db[t] || []; });
    state.me = res.me; state.meta = res.meta || {};
    return true;
  }

  // ------------------------------------------------------------ auth
  function logout(msg) { token = ""; ssSet(TOKEN_KEY, ""); state.db = null; renderGate("login", msg); }
  async function start() {
    if (Api.isDemo()) { token = "demo"; if (await reload()) route(); return; }
    if (token && await reload()) { route(); return; }
    var st = await Api.call("status");
    if (!st.ok) { renderGate("login", st.message || "השרת לא זמין כרגע"); return; }
    if (!st.installed) { renderGate("login", "השרת עוד לא הותקן. יש להריץ את setup() בעורך Apps Script."); return; }
    renderGate(st.hasUsers ? "login" : "setup");
  }
  function renderGate(mode, msg) {
    var setup = mode === "setup";
    $("#app").innerHTML = '<div class="gate"><div class="gate-card"><div class="mark" aria-hidden="true">מ</div><h1>משכנותיך</h1>' +
      '<p class="sub">' + (setup ? "הגדרת משתמש מנהל" : "ניהול תיקים ומשימות") + '</p>' +
      '<form id="gateForm" novalidate>' + (msg ? '<div class="gate-msg ' + (/הותקן|לא זמין|פג|יצאת/.test(msg) ? "info" : "bad") + '">' + esc(msg) + '</div>' : "") +
      (setup ? '<div class="gate-msg info">את הקוד החד-פעמי מקבלים ביומן הביצוע של Apps Script, אחרי הרצת setup() או resetAdminPassword().</div>' +
        '<div class="field"><label for="g_code">קוד הגדרה חד-פעמי</label><input id="g_code" name="code" type="text" autocomplete="off" spellcheck="false" dir="ltr" style="text-align:center;letter-spacing:.2em"></div>' +
        '<div class="field"><label for="g_name">שם מלא (רק במשתמש הראשון)</label><input id="g_name" name="name" type="text" autocomplete="name"></div>' : "") +
      '<div class="field"><label for="g_email">מייל</label><input id="g_email" name="email" type="email" autocomplete="username" dir="ltr"></div>' +
      '<div class="field"><label for="g_pw">' + (setup ? "סיסמה חדשה" : "סיסמה") + '</label><input id="g_pw" name="password" type="password" autocomplete="' + (setup ? "new-password" : "current-password") + '" dir="ltr"></div>' +
      (setup ? '<div class="field"><label for="g_pw2">אימות סיסמה</label><input id="g_pw2" name="password2" type="password" autocomplete="new-password" dir="ltr"></div>' : "") +
      '<button class="btn btn-primary" type="submit" style="min-height:46px">' + (setup ? "שמירה וכניסה" : "כניסה") + '</button></form>' +
      '<div class="alt"><button type="button" id="gateSwitch">' + (setup ? "חזרה לכניסה רגילה" : "יש לי קוד הגדרה / איפוס") + '</button></div></div></div>';
    var form = $("#gateForm");
    $("#gateSwitch").onclick = function () { renderGate(setup ? "login" : "setup"); };
    form.querySelector("input").focus();
    form.onsubmit = async function (e) {
      e.preventDefault();
      var v = function (n) { var el = form.querySelector('[name="' + n + '"]'); return el ? el.value : ""; };
      var err = function (m) { renderGate(mode, m); };
      if (!MK.isEmail(v("email"))) return err("כתובת המייל לא תקינה");
      if (setup) {
        if (!MK.str(v("code"))) return err("יש להזין את קוד ההגדרה");
        var weak = MK.passwordProblem(v("password")); if (weak) return err(weak);
        if (v("password") !== v("password2")) return err("הסיסמאות לא זהות");
      } else if (!v("password")) return err("יש להזין סיסמה");
      var btn = form.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "רגע…";
      var res = setup ? await Api.call("setupAdmin", { code: v("code"), name: v("name"), email: v("email"), password: v("password") })
        : await Api.call("login", { email: v("email"), password: v("password") });
      if (!res.ok) return err(res.error === "locked" ? "יותר מדי ניסיונות. נסו שוב בעוד 15 דקות." : res.error === "bad_login" ? "המייל או הסיסמה שגויים" : (res.message || "הכניסה נכשלה"));
      token = res.token; ssSet(TOKEN_KEY, token);
      if (await reload()) route();
    };
  }
  function renderError(msg) {
    $("#app").innerHTML = '<div class="gate"><div class="gate-card" style="text-align:center"><div class="mark">מ</div><h1>משהו השתבש</h1><p class="sub">' + esc(msg) + '</p>' +
      '<button class="btn btn-primary" id="retry">' + icon("refresh") + 'נסו שוב</button></div></div>';
    $("#retry").onclick = function () { location.reload(); };
  }

  // ------------------------------------------------------------ routing
  function route() {
    var parts = location.hash.replace(/^#\/?/, "").split("/").map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });
    state.route = parts[0] === "cases" ? "cases" : parts[0] === "case" && parts[1] ? "case" : "diary";
    state.caseId = state.route === "case" ? parts[1] : "";
    UI.close();
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", function () { if (state.db) route(); });
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  // ------------------------------------------------------------ layout
  function render() {
    if (!state.db) return;
    var t = today(), c = MK.counts(state.db, t), hr = MK.hourIL();
    var hello = hr < 5 ? "לילה טוב" : hr < 12 ? "בוקר טוב" : hr < 17 ? "צהריים טובים" : hr < 21 ? "ערב טוב" : "לילה טוב";
    var first = MK.str((state.me || {}).name).split(/\s+/)[0];
    var html = '<header class="top"><div class="who"><div class="mark" aria-hidden="true">מ</div><div>' +
        '<h1>' + esc(hello + (first && !Api.isDemo() ? ", " + first : "")) + '</h1><div class="date">יום ' + MK.weekday(t) + ' · ' + MK.fmtDate(t) + '</div></div></div>' +
        '<div class="top-acts">' + (Api.isDemo() ? '<span class="demo">הדגמה · נתונים בדויים</span>' :
          (state.meta.driveUrl ? '<a class="btn btn-ghost btn-sm" href="' + esc(state.meta.driveUrl) + '" target="_blank" rel="noopener">' + icon("folder") + 'הדרייב</a>' : "") +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="password" title="שינוי סיסמה" aria-label="שינוי סיסמה">' + icon("lock") + '</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="logout" title="יציאה" aria-label="יציאה">' + icon("logout") + '</button>') + '</div></header>' +
      '<nav class="screens" aria-label="מסכים">' +
        '<a href="#/" class="scr' + (state.route === "diary" ? " on" : "") + '">' + icon("calendar") + 'יומן המשימות' + (c.overdue + c.today ? ' <span class="n">' + (c.overdue + c.today) + '</span>' : "") + '</a>' +
        '<a href="#/cases" class="scr' + (state.route !== "diary" ? " on" : "") + '">' + icon("folder") + 'תיקים <span class="n">' + c.openCases + '</span></a>' +
      '</nav>';
    if (state.route === "cases") html += Pages.cases(t);
    else if (state.route === "case") html += Pages.casePage(t);
    else html += Pages.diary(t);
    html += Api.isDemo() ? '<p class="foot-note">ההדגמה נשמרת רק בדפדפן הזה. <button type="button" data-act="reset-demo">איפוס לדוגמאות</button></p>' : "";
    $("#app").innerHTML = html;
    Pages.wire(state.route);
    document.title = (state.route === "case" ? "כרטיס תיק" : state.route === "cases" ? "תיקים" : "יומן המשימות") + " · משכנותיך";
  }

  // Global clicks (the open dialog handles its own).
  document.addEventListener("click", function (e) {
    if (!state.db || e.target.closest("#dlg")) return;
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var a = b.dataset.act;
    if (a === "logout") return logout("יצאת מהמערכת");
    if (a === "password") return Dialogs.changePassword();
    if (a === "reset-demo") { Api.call("resetDemo").then(reload).then(function () { go("#/"); UI.toast("הדוגמאות אופסו"); }); return; }
    Pages.onAction(a, b, e);
  });

  // Keep "today" right when the app stays open past midnight.
  var lastDay = today();
  setInterval(function () { var t = today(); if (t !== lastDay && state.db && !UI.isOpen()) { lastDay = t; render(); } }, 60000);

  document.addEventListener("DOMContentLoaded", start);

  return { state: state, act: act, call: call, merge: merge, render: render, go: go, today: today, reload: reload,
    setToken: function (t) { token = t; ssSet(TOKEN_KEY, t); } };
})();
