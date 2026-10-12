/* app.js - shell: sign-in, data store, routing, layout (sidebar on desktop, tab bar on phone). */
var App = (function () {
  "use strict";
  var h = UI.h, icon = UI.icon, $ = UI.$;
  var TOKEN_KEY = "mk_token";
  var token = ssGet(TOKEN_KEY) || "";
  var state = { db: null, me: null, meta: {}, route: "", params: [], ui: { diary: {}, cases: {}, upcomingOpen: false } };

  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return ""; } }
  function ssSet(k, v) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) { /* ignore */ } }

  function today() { return MK.todayYmd(); }

  // ------------------------------------------------------------ server
  async function call(action, payload) {
    var res = await Api.call(action, Object.assign({ token: token }, payload || {}));
    if (!res.ok && res.error === "auth") logout("פג תוקף הכניסה. יש להתחבר שוב.");
    return res;
  }

  /** Run a business action (MK rule) on the server; merge the returned changes and re-render. */
  async function mutate(op, input, okMsg) {
    var res = await call("mutate", { op: op, input: input });
    if (!res.ok) {
      if (res.error === "network" || /^http_/.test(res.error || "") || res.error === "server") UI.toast(res.message || "הפעולה נכשלה", true);
      return res;
    }
    MK.applyChanges(state.db, res.changes);
    render();
    if (okMsg) UI.toast(okMsg);
    return res;
  }

  async function reload() {
    var res = await call("bootstrap");
    if (!res.ok) {
      if (res.error !== "auth") renderError(res.message || "לא ניתן לטעון את הנתונים");
      return false;
    }
    state.db = res.db;
    MK.TABLES.forEach(function (t) { state.db[t] = state.db[t] || []; });
    state.me = res.me;
    state.meta = res.meta || {};
    return true;
  }

  // ------------------------------------------------------------ auth
  function logout(msg) {
    token = ""; ssSet(TOKEN_KEY, "");
    state.db = null;
    renderGate("login", msg);
  }

  async function start() {
    if (Api.isDemo()) {
      token = "demo";
      if (await reload()) { route(); }
      return;
    }
    if (token && await reload()) { route(); return; }
    var st = await Api.call("status");
    if (!st.ok) { renderGate("login", st.message || "השרת לא זמין כרגע"); return; }
    if (!st.installed) { renderGate("login", "השרת עוד לא הותקן. יש להריץ את setup() בעורך Apps Script."); return; }
    renderGate(st.hasUsers ? "login" : "setup");
  }

  function renderGate(mode, msg) {
    var root = $("#root");
    var setup = mode === "setup";
    UI.setHtml(root, h`<div class="gate"><div class="gate-card">
      <div class="brand-mark">מ</div>
      <h1>משכנותיך</h1>
      <p class="sub">${setup ? "הגדרת משתמש מנהל" : "ניהול תיקים ומשימות"}</p>
      <form id="gateForm" novalidate>
        ${msg ? h`<div class="gate-msg ${/הותקן|לא זמין|פג/.test(msg) ? "info" : "bad"}">${msg}</div>` : ""}
        ${setup ? h`
          <div class="gate-msg info">את הקוד החד-פעמי מקבלים ביומן הביצוע של Apps Script, אחרי הרצת setup() או resetAdminPassword().</div>
          <div class="field"><label for="g_code">קוד הגדרה חד-פעמי</label><input id="g_code" name="code" type="text" autocomplete="off" spellcheck="false" class="ltr" style="text-align:center;letter-spacing:.2em" required></div>
          <div class="field"><label for="g_name">שם מלא <span class="hint">(רק במשתמש הראשון)</span></label><input id="g_name" name="name" type="text" autocomplete="name"></div>` : ""}
        <div class="field"><label for="g_email">מייל</label><input id="g_email" name="email" type="email" autocomplete="username" dir="ltr" required></div>
        <div class="field"><label for="g_pw">${setup ? "סיסמה חדשה" : "סיסמה"}</label><input id="g_pw" name="password" type="password" autocomplete="${setup ? "new-password" : "current-password"}" dir="ltr" required>
          ${setup ? h`<span class="hint">לפחות 10 תווים, גם אותיות וגם ספרות</span>` : ""}</div>
        ${setup ? h`<div class="field"><label for="g_pw2">אימות סיסמה</label><input id="g_pw2" name="password2" type="password" autocomplete="new-password" dir="ltr" required></div>` : ""}
        <button class="btn btn-primary btn-block" type="submit" style="min-height:46px">${setup ? "שמירה וכניסה" : "כניסה"}</button>
      </form>
      <div class="alt"><button type="button" id="gateSwitch">${setup ? "חזרה לכניסה רגילה" : "יש לי קוד הגדרה / איפוס"}</button></div>
    </div></div>`);
    var form = $("#gateForm");
    $("#gateSwitch").onclick = function () { renderGate(setup ? "login" : "setup"); };
    form.querySelector("input").focus();
    form.onsubmit = async function (e) {
      e.preventDefault();
      var btn = form.querySelector("button[type=submit]");
      var v = function (n) { return UI.val(form, n); };
      var err = function (m) { renderGate(mode, m); };
      if (!MK.isEmail(v("email"))) return err("כתובת המייל לא תקינה");
      if (setup) {
        if (!MK.str(v("code"))) return err("יש להזין את קוד ההגדרה");
        var weak = MK.passwordProblem(v("password"));
        if (weak) return err(weak);
        if (v("password") !== v("password2")) return err("הסיסמאות לא זהות");
      } else if (!v("password")) return err("יש להזין סיסמה");
      btn.disabled = true; btn.textContent = "רגע…";
      var res = setup
        ? await Api.call("setupAdmin", { code: v("code"), name: v("name"), email: v("email"), password: v("password") })
        : await Api.call("login", { email: v("email"), password: v("password") });
      if (!res.ok) {
        var m = res.error === "locked" ? "יותר מדי ניסיונות. נסו שוב בעוד 15 דקות."
          : res.error === "bad_login" ? "המייל או הסיסמה שגויים" : (res.message || "הכניסה נכשלה");
        return err(m);
      }
      token = res.token; ssSet(TOKEN_KEY, token);
      if (await reload()) route();
    };
  }

  function renderError(msg) {
    UI.setHtml($("#root"), h`<div class="gate"><div class="gate-card" style="text-align:center">
      <div class="brand-mark">מ</div><h1>משהו השתבש</h1><p class="sub">${msg}</p>
      <button class="btn btn-primary" id="retry">${icon("refresh")} נסו שוב</button></div></div>`);
    $("#retry").onclick = function () { location.reload(); };
  }

  // ------------------------------------------------------------ routing
  var ROUTES = { "": "diary", "cases": "cases", "case": "case", "settings": "settings" };
  function route() {
    var parts = (location.hash.replace(/^#\/?/, "") || "").split("/").map(decodeURIComponent);
    state.route = ROUTES[parts[0]] !== undefined ? ROUTES[parts[0]] : "diary";
    state.params = parts.slice(1);
    UI.closeMenu();
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", function () { if (state.db) route(); });
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  // ------------------------------------------------------------ layout
  function render() {
    if (!state.db) return;
    var root = $("#root");
    var shell = $(".shell", root);
    if (!shell) {
      UI.setHtml(root, h`<div class="shell">
        <aside class="side" aria-label="ניווט ראשי"></aside>
        <main class="main" id="main"><div class="page" id="page"></div></main>
        <nav class="tabbar" aria-label="ניווט"></nav>
        <button class="fab" type="button" aria-label="הוספה מהירה" id="fab">${icon("plus")}</button>
      </div>`);
      $("#fab").onclick = function (e) { quickAdd(e.currentTarget); };
    }
    var t = today();
    var c = MK.counts(state.db, t);
    var urgentCount = c.overdue + c.today;
    var nav = [
      { r: "diary", href: "#/", label: "יומן משימות", short: "יומן", icon: "calendar", count: urgentCount },
      { r: "cases", href: "#/cases", label: "תיקים", short: "תיקים", icon: "folder" },
      { r: "settings", href: "#/settings", label: "הגדרות", short: "הגדרות", icon: "settings" }
    ];
    var activeR = state.route === "case" ? "cases" : state.route;
    var me = state.me || {};
    UI.setHtml($(".side"), h`
      <div class="brand"><div class="brand-mark">מ</div><div><div class="brand-name">משכנותיך</div><div class="brand-sub">ניהול תיקים ומשימות</div></div></div>
      <nav class="nav">${nav.map(function (n) {
        return h`<a href="${n.href}" class="${activeR === n.r ? "on" : ""}" ${activeR === n.r ? UI.raw('aria-current="page"') : ""}>${icon(n.icon)}<span>${n.label}</span>${n.count ? h`<span class="count">${n.count}</span>` : ""}</a>`;
      })}</nav>
      <div class="side-add"><button class="btn" type="button" id="sideAdd">${icon("plus")} הוספה מהירה</button></div>
      <div class="side-foot"><div class="avatar">${UI.initials(me.name) || "?"}</div>
        <div class="who"><b>${me.name || ""}</b><span>${MK.ROLES[me.role] || ""}</span></div>
        ${Api.isDemo() ? "" : h`<button class="btn btn-ghost btn-icon" type="button" id="logoutBtn" title="יציאה" aria-label="יציאה">${icon("logout")}</button>`}</div>`);
    $("#sideAdd").onclick = function (e) { quickAdd(e.currentTarget); };
    var lo = $("#logoutBtn"); if (lo) lo.onclick = function () { logout("יצאת מהמערכת"); };
    UI.setHtml($(".tabbar"), [
      tab(nav[0], activeR), tab(nav[1], activeR), h`<span class="tab-spacer"></span>`, tab(nav[2], activeR),
      h`<span class="tab-ghost" aria-hidden="true"></span>`
    ]);
    var page = $("#page");
    var fn = Pages[state.route] || Pages.diary;
    page.onclick = null;
    fn(page, state);
    document.title = (Pages.titles[state.route] ? Pages.titles[state.route](state) + " · " : "") + "משכנותיך";
  }
  function tab(n, activeR) {
    return h`<a href="${n.href}" class="${activeR === n.r ? "on" : ""}">${icon(n.icon)}<span>${n.short}</span>${n.count ? h`<span class="count">${n.count}</span>` : ""}</a>`;
  }

  function quickAdd(anchor) {
    UI.menu(anchor, [
      { icon: "folder", label: "תיק חדש", sub: "פתיחת תיק עם המשימה הראשונה", run: function () { Dialogs.newCase(); } },
      { icon: "list", label: "משימה כללית", sub: "משימה שלא שייכת לתיק", run: function () { Dialogs.newGeneralTask(); } }
    ]);
  }

  // Keep "today" correct if the app stays open past midnight.
  var lastDay = today();
  setInterval(function () { var t = today(); if (t !== lastDay) { lastDay = t; render(); } }, 60000);

  document.addEventListener("DOMContentLoaded", start);

  return { state: state, mutate: mutate, call: call, render: render, go: go, today: today, reload: reload,
    setToken: function (t) { token = t; ssSet(TOKEN_KEY, t); } };
})();
