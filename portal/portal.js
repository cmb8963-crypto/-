/* portal.js - the client's personal area. Shows only this client's own data,
   as returned by the backend's filtered "portalView". */
(function () {
  "use strict";
  var C = Core, h = UI.h, raw = UI.raw, $ = UI.$;
  var KEY = "crm_portal_token";
  var token = sessionStorage.getItem(KEY) || "";
  var view = null, slots = null, calMonth = null, selDay = null, selSlot = null, files = [], sessTab = "planned";

  // ------------------------------------------------------------ auth screens
  function showAuth(mode, msg) {
    $("#portal").hidden = true; $("#auth").hidden = false;
    $("#loginForm").hidden = mode !== "login"; $("#forgotForm").hidden = mode !== "forgot"; $("#setForm").hidden = mode !== "set";
    $("#authTitle").textContent = mode === "set" ? "בחירת סיסמה" : mode === "forgot" ? "שחזור סיסמה" : "האזור האישי";
    $("#authSub").textContent = mode === "set" ? "בחרו סיסמה אישית לכניסה לאזור האישי" : mode === "forgot" ? "נשלח אליך קישור לבחירת סיסמה חדשה" : "כניסה עם כתובת המייל והסיסמה שלך";
    $("#authErr").textContent = msg || "";
    UI.setHtml($("#authNote"), Api.isDemo() ? h`מצב הדגמה - כל פרטים יתקבלו.` : "");
  }
  var ERR = { bad_login: "המייל או הסיסמה שגויים", locked: "יותר מדי ניסיונות. אפשר לנסות שוב בעוד 15 דקות.", link_expired: "הקישור פג תוקף או כבר נוצל. אפשר לבקש קישור חדש דרך 'שכחתי סיסמה'.",
    weak: "הסיסמה חלשה מדי", network: "אין חיבור. בדקו את האינטרנט ונסו שוב.", not_configured: "האזור האישי עוד לא הופעל." };

  async function api(action, payload) {
    var r;
    try { r = await Api.call(action, Object.assign({ token: token }, payload || {})); } catch (e) { r = { ok: false, error: "network" }; }
    if (!r.ok && r.error === "auth") { logout("יש להתחבר מחדש"); }
    return r;
  }
  function setToken(t) { token = t; sessionStorage.setItem(KEY, t); }
  function logout(msg) { token = ""; sessionStorage.removeItem(KEY); view = null; showAuth("login", msg); }

  $("#loginForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    $("#authErr").textContent = "";
    var r = await api("portalLogin", { email: $("#email").value, password: $("#password").value });
    if (!r.ok) { $("#authErr").textContent = ERR[r.error] || "הכניסה נכשלה"; return; }
    $("#password").value = "";
    setToken(r.token); load();
  });
  $("#forgotForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    await api("portalForgot", { email: $("#femail").value });
    showAuth("login");
    $("#authErr").textContent = "";
    UI.setHtml($("#authNote"), h`<span class="t-good">אם הכתובת רשומה במערכת - נשלח אליה קישור לבחירת סיסמה (תקף לשעה).</span>`);
  });
  $("#setForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var p = $("#npw").value;
    if (p !== $("#npw2").value) { $("#authErr").textContent = "הסיסמאות אינן תואמות"; return; }
    var st = new URLSearchParams(location.search).get("setup");
    var r = await api("portalSetPassword", { setupToken: st, password: p });
    if (!r.ok) { $("#authErr").textContent = r.message || ERR[r.error] || "השמירה נכשלה"; return; }
    history.replaceState(null, "", location.pathname + (Api.isDemo() ? "?demo=1" : ""));
    setToken(r.token); load();
  });
  $("#toForgot").addEventListener("click", function () { showAuth("forgot"); });
  $("#toLogin").addEventListener("click", function () { showAuth("login"); });
  $("#logoutBtn").addEventListener("click", function () { logout(""); });

  // ------------------------------------------------------------ load + render
  async function load() {
    $("#auth").hidden = true; $("#portal").hidden = false;
    UI.setHtml($("#pmain"), h`<div class="loading"><span class="spinner"></span> טוען...</div>`);
    var r = await api("portalView");
    if (!r.ok) { if (r.error !== "auth") UI.setHtml($("#pmain"), h`<div class="block">לא ניתן לטעון כרגע. נסו לרענן בעוד רגע.</div>`); return; }
    view = r.view;
    $("#coachName").textContent = view.coachName || "";
    document.title = "האזור האישי · " + view.client.name;
    render();
    if (location.hash === "#book") setTimeout(function () { var b = $("#blk-book"); if (b) b.scrollIntoView({ behavior: "smooth" }); }, 200);
    loadSlots();
  }

  function unit(t) { return t === "hour" ? "שעות" : "פגישות"; }
  function when(s) { var d = C.toDate(s); return d ? "יום " + C.HE_DAYS[d.getDay()] + ", " + C.fmtDate(s) + (C.fmtTime(s) ? " · " + C.fmtTime(s) : "") : ""; }

  function render() {
    var v = view, p = v.progress, f = v.finance;
    var hasPkg = p.purchased > 0;
    var first = v.client.name.replace(/\s*-.*$/, "").trim().split(/\s+/);
    first = first.length > 1 ? first.slice(1).join(" ") : first[0];
    UI.setHtml($("#pmain"), h`
    <div class="hello"><h1>שלום ${first},</h1><p>איפה אנחנו בדרך, מה שולם, ומה הלאה</p></div>

    <section class="block" aria-labelledby="b1"><div class="block-h"><span class="n">1</span><h2 id="b1">איפה אני בדרך</h2></div>
      <div class="small muted">${v.client.processName}${p.packageName ? " · " + p.packageName : ""}</div>
      ${hasPkg ? h`<div class="prog-line" style="margin-top:10px"><span>${unit(p.unitType)}: <b>${C.round2(p.used)}</b> מתוך ${C.round2(p.purchased)}</span><span>נותרו: <b>${C.round2(p.remaining)}</b></span></div>
        ${UI.bar(p.purchased ? p.used / p.purchased : 0, "big")}` : h`<div class="prog-line" style="margin-top:10px"><span>פגישות שהתקיימו: <b>${p.heldCount}</b></span></div>`}
      <div class="row small muted" style="margin-top:8px"><span>סה"כ פגישות: ${p.heldCount}</span><span>·</span><span>שעות: ${p.hoursTotal}</span></div>
      <div class="next"><span>📅</span><span>הפגישה הבאה: <b>${v.nextSession ? when(v.nextSession.date) : "עדיין לא נקבעה"}</b>${v.nextSession && v.nextSession.location ? " · " + v.nextSession.location : ""}</span>
        ${!v.nextSession ? h`<a class="btn btn-outline btn-sm" href="#book" id="goBook">לקבוע פגישה</a>` : ""}</div>
      ${v.tasks.length ? h`<h4 style="margin:16px 0 4px;font-size:15px">משימות לפגישה הבאה</h4>${v.tasks.map(function (t) {
        return h`<label class="task"><input type="checkbox" data-task="${t.id}" ${t.done ? raw("checked") : ""} style="width:18px;height:18px;accent-color:var(--gold-deep)">
          <span style="${t.done ? "text-decoration:line-through;color:var(--muted)" : ""}">${t.text}</span>${t.dueDate ? h`<span class="small muted" style="margin-inline-start:auto">עד ${C.fmtDate(t.dueDate)}</span>` : ""}</label>`;
      })}` : ""}
    </section>

    <section class="block" aria-labelledby="b2"><div class="block-h"><span class="n">2</span><h2 id="b2">תשלומים</h2></div>
      <div class="money3"><div class="tile"><div class="lbl">סה"כ</div><div class="val">${C.fmtMoney(f.total)}</div></div>
        <div class="tile good"><div class="lbl">שולם</div><div class="val">${C.fmtMoney(f.paid)}</div></div>
        <div class="tile ${f.balance > 0.5 ? "warn" : "good"}"><div class="lbl">${f.balance < -0.5 ? "יתרת זכות" : "נשאר לתשלום"}</div><div class="val">${C.fmtMoney(Math.abs(f.balance))}</div></div></div>
      <div class="pay-status ${f.balance > 0.5 ? "warn" : "good"}">${f.balance > 0.5 ? "נשארה יתרה לתשלום. לכל שאלה אפשר לכתוב למטה." : "הכל מסודר. תודה!"}</div>
    </section>

    <section class="block" id="blk-book" aria-labelledby="b3"><div class="block-h"><span class="n">3</span><h2 id="b3">לקבוע פגישה</h2></div>
      <div id="bookArea"><div class="loading"><span class="spinner"></span> טוען מועדים פנויים...</div></div>
      ${v.pendingBookings && v.pendingBookings.length ? h`<div class="small" style="margin-top:12px">${v.pendingBookings.map(function (b) { return h`<div class="badge info" style="margin:2px">ממתין לאישור: ${when(b.start)}</div>`; })}</div>` : ""}
    </section>

    <section class="block" aria-labelledby="b4"><div class="block-h"><span class="n">4</span><h2 id="b4">לכתוב ל${v.coachName ? v.coachName.split(" ")[0] : "מאמן"}</h2></div>
      <div class="row small" style="justify-content:space-between;background:var(--cream);padding:10px 12px;border-radius:12px;margin-bottom:12px">
        <span><b>${v.client.name}</b> · <span class="ltr">${v.client.email}</span>${v.client.phone ? h` · <span class="ltr">${v.client.phone}</span>` : ""}</span>
        <button class="btn btn-outline btn-xs" id="detailsBtn">בקשה לשינוי פרטים</button></div>
      <div class="paste"><label class="sr" for="msgText">ההודעה</label>
        <textarea id="msgText" placeholder="אפשר לכתוב כאן כל דבר. אפשר גם להדביק צילום מסך (Ctrl+V)"></textarea></div>
      <div class="thumbs" id="thumbs"></div>
      <div class="row" style="margin-top:10px"><button class="btn btn-primary" id="sendMsg">שלח</button>
        <label class="btn btn-outline btn-sm" for="msgFile">📎 צירוף קובץ</label><input type="file" id="msgFile" hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"></div>
      ${v.messages && v.messages.length ? h`<div class="msg-list">${v.messages.slice().reverse().map(function (m) { return h`<div class="msg"><div class="d">${C.fmtDate(m.date)} ${C.fmtTime(m.date)}${m.attachmentName ? " · 📎 " + m.attachmentName : ""}</div><div class="pre">${m.text}</div></div>`; })}</div>` : ""}
    </section>

    <section class="block" aria-labelledby="b5"><div class="block-h"><span class="n">5</span><h2 id="b5">הפגישות שלי</h2></div>
      <div class="ptabs"><button class="chip ${sessTab === "planned" ? "active" : ""}" data-stab="planned">מתוכננות (${v.planned.length})</button><button class="chip ${sessTab === "past" ? "active" : ""}" data-stab="past">פגישות שהיו (${v.past.length})</button></div>
      <div id="sessList">${sessList()}</div>
    </section>`);
    bind();
    renderBooking();
  }

  function sessList() {
    var list = sessTab === "planned" ? view.planned : view.past;
    if (!list.length) return h`<div class="empty">${sessTab === "planned" ? "אין פגישות מתוכננות" : "עוד אין פגישות קודמות"}</div>`;
    return list.map(function (s, i) {
      var sm = s.summary;
      return h`<details class="sess" ${sessTab === "past" && i === 0 && sm ? raw("open") : ""}><summary><span class="dt">${when(s.date)}</span>
        <span class="meta">${s.location || ""}${s.durationMin ? " · " + s.durationMin + " דק'" : ""}</span>
        ${s.status !== "planned" && s.status !== "held" ? h`<span class="badge">${s.statusLabel}</span>` : ""}${sm ? h`<span class="badge gold">יש סיכום</span>` : ""}</summary>
        <div class="body">${sm ? h`
          ${sm.points ? h`<h4>נקודות שעלו בפגישה</h4>${raw(EmailTemplates.structured(sm.points))}` : ""}
          ${!sm.points && sm.text ? h`<h4>סיכום</h4>${raw(EmailTemplates.structured(sm.text))}` : ""}
          ${sm.decisions ? h`<h4>החלטות שהתקבלו</h4>${raw(EmailTemplates.structured(sm.decisions))}` : ""}
          ${sm.homework ? h`<h4>שיעורי בית</h4><div class="hw">${raw(EmailTemplates.structured(sm.homework))}</div>` : ""}
          ${UI.safeUrl(sm.recordingUrl) ? h`<div style="margin-top:14px"><a class="btn btn-primary btn-sm" href="${UI.safeUrl(sm.recordingUrl)}" target="_blank" rel="noopener noreferrer">🎧 להקלטת הפגישה</a></div>` : ""}`
          : h`<div class="small muted" style="padding-top:10px">${s.status === "planned" ? "הפגישה עוד לא התקיימה." : "אין סיכום לפגישה זו."}</div>`}</div></details>`;
    });
  }

  // ------------------------------------------------------------ booking
  async function loadSlots() {
    var r = await api("portalSlots");
    slots = r.ok ? r.slots : [];
    renderBooking();
  }
  function renderBooking() {
    var area = $("#bookArea");
    if (!area) return;
    if (!slots) return;
    if (!slots.length) { UI.setHtml(area, h`<div class="empty">כרגע אין מועדים פנויים להצגה. אפשר לכתוב לי בבלוק 4 ונתאם.</div>`); return; }
    var byDay = {};
    slots.forEach(function (s) { (byDay[s.start.slice(0, 10)] = byDay[s.start.slice(0, 10)] || []).push(s); });
    if (!calMonth) calMonth = slots[0].start.slice(0, 7);
    var y = +calMonth.slice(0, 4), m = +calMonth.slice(5, 7) - 1;
    var first = new Date(y, m, 1), days = C.daysInMonth(calMonth);
    var today = C.ymd(new Date());
    var cells = [];
    for (var i = 0; i < first.getDay(); i++) cells.push(h`<div></div>`);
    for (var d = 1; d <= days; d++) {
      var ds = calMonth + "-" + C.pad(d);
      var list = byDay[ds] || [];
      var byLoc = {};
      list.forEach(function (s) { byLoc[s.location || "פגישה"] = (byLoc[s.location || "פגישה"] || 0) + 1; });
      cells.push(h`<button type="button" class="day ${list.length ? "avail" : "off"} ${selDay === ds ? "sel" : ""} ${ds === today ? "today" : ""}" ${list.length ? raw('data-day="' + ds + '"') : raw("disabled")} aria-label="${C.fmtDate(ds)}${list.length ? " - " + list.length + " חלונות פנויים" : ""}">
        <span class="dn">${d}</span><span class="hd">${UI.hebDate(ds)}</span>
        ${Object.keys(byLoc).map(function (l) { return h`<span class="w">${byLoc[l]} חלונות - ${l}</span>`; })}</button>`);
    }
    var months = Object.keys(byDay).map(function (k) { return k.slice(0, 7); });
    var minM = months[0], maxM = months[months.length - 1];
    var hebMonth = "";
    try { hebMonth = new Intl.DateTimeFormat("he-IL-u-ca-hebrew", { month: "long", year: "numeric" }).format(new Date(y, m, 15)); } catch (e) {}
    var daySlots = selDay ? byDay[selDay] || [] : [];
    UI.setHtml(area, h`<div class="cal-head"><button class="btn btn-ghost btn-sm" data-cal="-1" ${calMonth <= minM ? raw("disabled") : ""} aria-label="חודש קודם">→</button>
        <b>${C.monthLabel(calMonth)} <span class="heb">${hebMonth}</span></b>
        <button class="btn btn-ghost btn-sm" data-cal="1" ${calMonth >= maxM ? raw("disabled") : ""} aria-label="חודש הבא">←</button></div>
      <div class="cal">${["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"].map(function (n) { return h`<div class="dow">${n}</div>`; })}${cells}</div>
      ${selDay ? h`<div style="margin-top:14px"><b>${when(selDay)}</b> · ${UI.hebDate(selDay)}</div>
        <div class="slots">${daySlots.map(function (s) { return h`<button type="button" class="slot ${selSlot && selSlot.start === s.start ? "sel" : ""}" data-slot="${s.start}" data-loc="${s.location}">${C.fmtTime(s.start)}<small>${s.location}</small></button>`; })}</div>
        <label class="field" style="margin-top:12px"><span>משהו שכדאי שאדע לפני הפגישה</span><textarea id="bookNote" rows="3"></textarea></label>
        <button class="btn btn-primary" id="bookBtn" style="margin-top:10px" ${selSlot ? "" : raw("disabled")}>לשלוח בקשה לפגישה</button>` : h`<p class="small muted" style="margin-top:10px">בחרו יום מסומן כדי לראות את השעות הפנויות.</p>`}`);
    UI.$$("[data-cal]", area).forEach(function (b) { b.addEventListener("click", function () { calMonth = C.addMonths(calMonth, +b.dataset.cal); selDay = null; selSlot = null; renderBooking(); }); });
    UI.$$("[data-day]", area).forEach(function (b) { b.addEventListener("click", function () { selDay = b.dataset.day; selSlot = null; renderBooking(); }); });
    UI.$$("[data-slot]", area).forEach(function (b) { b.addEventListener("click", function () { var note = ($("#bookNote") || {}).value; selSlot = { start: b.dataset.slot, location: b.dataset.loc }; renderBooking(); if (note) $("#bookNote").value = note; }); });
    var bb = $("#bookBtn");
    if (bb) bb.addEventListener("click", async function () {
      bb.disabled = true;
      var r = await api("portalBook", { start: selSlot.start, location: selSlot.location, note: $("#bookNote").value });
      if (!r.ok) { bb.disabled = false; UI.toast(r.error === "too_many" ? "יש כבר כמה בקשות ממתינות - נחזור אליך בהקדם" : "השליחה נכשלה", true); return; }
      UI.toast("הבקשה נשלחה! תקבלו אישור במייל.");
      selDay = null; selSlot = null; slots = null;
      load();
    });
  }

  // ------------------------------------------------------------ messages + tasks
  function bind() {
    UI.$$("[data-stab]").forEach(function (b) { b.addEventListener("click", function () { sessTab = b.dataset.stab; render(); }); });
    UI.$$("[data-task]").forEach(function (c) { c.addEventListener("change", function () { api("portalTaskDone", { id: c.dataset.task, done: c.checked }); var t = view.tasks.filter(function (x) { return x.id === c.dataset.task; })[0]; if (t) t.done = c.checked; }); });
    var gb = $("#goBook");
    if (gb) gb.addEventListener("click", function (e) { e.preventDefault(); $("#blk-book").scrollIntoView({ behavior: "smooth" }); });
    var ta = $("#msgText");
    ta.addEventListener("paste", function (e) {
      var items = (e.clipboardData || {}).items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === "file") { var f = items[i].getAsFile(); if (f) { addFile(f, true); e.preventDefault(); } }
      }
    });
    $("#msgFile").addEventListener("change", function () { if (this.files[0]) addFile(this.files[0]); this.value = ""; });
    $("#sendMsg").addEventListener("click", function () { sendMsg("message"); });
    $("#detailsBtn").addEventListener("click", function () {
      ta.value = "בקשה לעדכון פרטים:\n";
      ta.focus();
      ta.dataset.kind = "details";
    });
    drawThumbs();
  }
  function addFile(f, pasted) {
    if (f.size > 10 * 1024 * 1024) { UI.toast("הקובץ גדול מ-10MB", true); return; }
    if (files.length >= 1) files = [];
    files.push({ file: f, name: pasted ? "צילום מסך " + C.ymdhm(new Date()).replace("T", " ") + ".png" : f.name, url: /^image\//.test(f.type) ? URL.createObjectURL(f) : "" });
    drawThumbs();
  }
  function drawThumbs() {
    var box = $("#thumbs");
    if (!box) return;
    UI.setHtml(box, files.map(function (f, i) {
      return h`<div class="thumb">${f.url ? h`<img src="${f.url}" alt="${f.name}">` : h`<span>📎 ${f.name}</span>`}<button type="button" data-rm="${i}" aria-label="הסרה">✕</button></div>`;
    }));
    UI.$$("[data-rm]", box).forEach(function (b) { b.addEventListener("click", function () { files.splice(+b.dataset.rm, 1); drawThumbs(); }); });
  }
  async function sendMsg() {
    var ta = $("#msgText");
    var text = ta.value.trim();
    if (!text && !files.length) { UI.toast("ההודעה ריקה", true); return; }
    var btn = $("#sendMsg");
    btn.disabled = true;
    var payload = { text: text, kind: ta.dataset.kind || "message" };
    if (files.length) {
      var f = files[0];
      payload.file = { name: f.name, mimeType: f.file.type || "application/octet-stream", data: await UI.fileToBase64(f.file) };
    }
    var r = await api("portalMessage", payload);
    btn.disabled = false;
    if (!r.ok) { UI.toast("השליחה נכשלה, נסו שוב", true); return; }
    UI.toast("נשלח! אחזור אליך בהקדם.");
    files = []; ta.value = ""; delete ta.dataset.kind;
    load();
  }

  // ------------------------------------------------------------ boot
  var setup = new URLSearchParams(location.search).get("setup");
  if (!Api.isConfigured()) { showAuth("login", ERR.not_configured); }
  else if (setup) { showAuth("set"); }
  else if (token) { load(); }
  else if (Api.isDemo()) { api("portalLogin", {}).then(function (r) { setToken(r.token); load(); }); }
  else { showAuth("login"); }
})();
