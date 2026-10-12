/* pages.js - the screens: daily diary (home), cases list, case card, settings. */
var Pages = (function () {
  "use strict";
  var h = UI.h, icon = UI.icon;

  function db() { return App.state.db; }
  function demoBar() {
    if (!Api.isDemo()) return "";
    return h`<div class="demo-bar">${icon("alert")}<span><b>מצב הדגמה:</b> נתונים בדויים שנשמרים רק בדפדפן הזה. ${Api.hasServer() ? "" : "השרת עוד לא חובר."}</span></div>`;
  }

  // ------------------------------------------------------------ shared pieces
  function dueLabel(task, today) {
    var late = task.dueDate < today, now = task.dueDate === today;
    var rel = MK.relDay(task.dueDate, today);
    return h`<span class="due ${late ? "late" : now ? "now" : ""}">${icon(late ? "alert" : "clock")}${MK.fmtDate(task.dueDate)}${rel !== "היום" ? h` · ${rel}` : now ? " · היום" : ""}</span>`;
  }
  function postponed(task) {
    var n = MK.num(task.postponeCount);
    return n ? h`<span class="postponed" title="תאריך מקורי: ${MK.fmtDate(task.originalDueDate)}">נדחתה ${n === 1 ? "פעם אחת" : n + " פעמים"}</span>` : "";
  }
  function tagList(c) {
    return MK.tagsOfCase(db(), c).map(function (t) { return h`<span class="tag">${t.name}</span>`; });
  }
  function taskActions(task) {
    return h`<div class="task-actions">
      <button type="button" class="btn btn-good btn-sm" data-act="done" data-id="${task.id}">${icon("check")} בוצע</button>
      <button type="button" class="btn btn-outline btn-sm" data-act="postpone" data-id="${task.id}">${icon("clock")} דחה</button></div>`;
  }
  function taskRow(task, today) {
    var c = task.caseId ? MK.byId(db().cases, task.caseId) : null;
    var urgent = c && MK.bool(c.isUrgent);
    return h`<div class="task">
      ${urgent ? h`<span class="urgent-mark" aria-hidden="true"></span>` : ""}
      <div class="task-main">
        <div class="task-top">
          ${c ? h`<a class="task-case" href="#/case/${encodeURIComponent(c.id)}">${c.fullName}</a>`
              : h`<span class="task-general">${icon("briefcase")}${task.project || MK.DEPARTMENTS[task.department] || "משימה כללית"}</span>`}
          ${urgent ? h`<span class="badge urgent">דחוף</span>` : ""}
          ${c && c.status === "WAITING" ? h`<span class="badge WAITING">בהמתנה</span>` : ""}
        </div>
        <div class="task-title">${task.title}</div>
        <div class="task-meta">${dueLabel(task, today)}${postponed(task)}${c ? tagList(c) : (task.project && task.department ? h`<span class="tag">${MK.DEPARTMENTS[task.department]}</span>` : "")}</div>
      </div>
      ${taskActions(task)}</div>`;
  }
  /** Handles the buttons inside a container (event delegation). */
  function wireTaskButtons(el) {
    el.onclick = function (e) {
      var b = e.target.closest("[data-act]");
      if (!b) return;
      var id = b.dataset.id, act = b.dataset.act;
      if (act === "done") Dialogs.completeTask(id);
      else if (act === "postpone") Dialogs.postponeTask(id);
      else if (act === "edit-task") Dialogs.editTask(id);
      else if (Actions[act]) Actions[act](b);
    };
  }
  var Actions = {};

  function tagOptions(selected) {
    return MK.activeTags(db()).map(function (t) { return h`<option value="${t.id}" ${selected === t.id ? "selected" : ""}>${t.name}</option>`; });
  }

  // ------------------------------------------------------------ diary (home)
  function greeting() {
    var hr = MK.hourIL();
    return hr < 5 ? "לילה טוב" : hr < 12 ? "בוקר טוב" : hr < 17 ? "צהריים טובים" : hr < 21 ? "ערב טוב" : "לילה טוב";
  }

  function diary(page, state) {
    var today = App.today();
    var f = state.ui.diary;
    var c = MK.counts(db(), today);
    var first = MK.str((state.me || {}).name).split(/\s+/)[0];
    UI.setHtml(page, h`
      ${demoBar()}
      <div class="page-head">
        <div><h1>${greeting()}${first ? ", " + first : ""}</h1>
          <div class="sub">יום ${MK.weekday(today)} · ${MK.fmtDate(today)}</div></div>
        <div class="head-actions row">
          <button type="button" class="btn btn-outline" id="addGeneral">${icon("list")} משימה כללית</button>
          <button type="button" class="btn btn-primary" id="addCase">${icon("plus")} תיק חדש</button></div>
      </div>
      <div class="stats">
        <a class="stat tone-bad" href="#overdue" data-scroll="overdue"><div class="stat-icon">${icon("alert")}</div><div><b>${c.overdue}</b><span>באיחור</span></div></a>
        <a class="stat tone-accent" href="#today" data-scroll="today"><div class="stat-icon">${icon("calendar")}</div><div><b>${c.today}</b><span>להיום</span></div></a>
        <a class="stat tone-good" href="#/cases" data-status="ACTIVE"><div class="stat-icon">${icon("folder")}</div><div><b>${c.activeCases}</b><span>תיקים פעילים</span></div></a>
        <a class="stat tone-warn" href="#/cases" data-status="WAITING"><div class="stat-icon">${icon("pause")}</div><div><b>${c.waitingCases}</b><span>בהמתנה</span></div></a>
      </div>
      <div class="filters" id="diaryFilters">
        <div class="search">${icon("search")}<input type="search" name="q" placeholder="חיפוש משימה או תיק" value="${f.q || ""}" aria-label="חיפוש"></div>
        <select name="tagId" aria-label="סינון לפי תגית"><option value="">כל התגיות</option>${tagOptions(f.tagId)}</select>
        <select name="department" aria-label="סינון לפי מחלקה"><option value="">כל המחלקות</option>${Object.keys(MK.DEPARTMENTS).map(function (k) {
          return h`<option value="${k}" ${f.department === k ? "selected" : ""}>${MK.DEPARTMENTS[k]}</option>`;
        })}</select>
        <div class="range"><span>מ-</span><input type="date" name="from" value="${f.from || ""}" aria-label="מתאריך"><span>עד</span><input type="date" name="to" value="${f.to || ""}" aria-label="עד תאריך"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="clearFilters" ${hasFilters(f) ? "" : "hidden"}>${icon("x")} ניקוי</button>
      </div>
      <div id="diaryGroups"></div>`);
    UI.$("#addCase", page).onclick = function () { Dialogs.newCase(); };
    UI.$("#addGeneral", page).onclick = function () { Dialogs.newGeneralTask(); };
    UI.$$("[data-status]", page).forEach(function (a) { a.onclick = function () { state.ui.cases = { status: a.dataset.status }; }; });
    UI.$$("[data-scroll]", page).forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        var g = document.getElementById("g-" + a.dataset.scroll);
        if (g) g.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    });
    var filters = UI.$("#diaryFilters", page);
    filters.addEventListener("input", function (e) {
      if (!e.target.name) return;
      f[e.target.name] = e.target.value;
      UI.$("#clearFilters", page).hidden = !hasFilters(f);
      groups();
    });
    UI.$("#clearFilters", page).onclick = function () { state.ui.diary = {}; diary(page, state); };
    var box = UI.$("#diaryGroups", page);
    wireTaskButtons(box);
    function groups() {
      var d = MK.diary(db(), today, f);
      var filtered = hasFilters(f);
      var openUp = state.ui.upcomingOpen || filtered;
      UI.setHtml(box, h`
        ${d.overdue.length ? group("overdue", "באיחור", d.overdue, true) : ""}
        ${group("today", "להיום", d.today, true,
          h`<div class="empty"><div class="empty-icon">${icon("check")}</div><h3>${filtered ? "אין משימות שמתאימות לסינון" : "אין עוד משימות להיום"}</h3>
            <div class="small">${d.upcoming.length && !filtered ? "אפשר להציץ במשימות הקרובות למטה" : ""}</div></div>`)}
        ${group("upcoming", f.to && f.to > MK.addDays(today, 7) ? "קרוב (עד " + MK.fmtDate(f.to) + ")" : "קרוב · 7 הימים הבאים", d.upcoming, openUp,
          h`<div class="empty small">אין משימות בימים הקרובים</div>`, true)}`);
      var up = UI.$("#g-upcoming .group-head", box);
      if (up && up.tagName === "BUTTON") up.onclick = function () { state.ui.upcomingOpen = !state.ui.upcomingOpen; groups(); };
    }
    function group(key, title, list, open, empty, collapsible) {
      var head = h`<span class="dot"></span><h2>${title}</h2><span class="n">${list.length}</span>${collapsible ? h`<span class="chev">${icon("chevron")}</span>` : ""}`;
      return h`<section class="card group ${key} ${open ? "" : "collapsed"}" id="g-${key}">
        ${collapsible ? h`<button type="button" class="group-head" aria-expanded="${open ? "true" : "false"}">${head}</button>` : h`<div class="group-head">${head}</div>`}
        ${open ? (list.length ? list.map(function (t) { return taskRow(t, today); }) : (empty || "")) : ""}
      </section>`;
    }
    groups();
  }
  function casesWord(n) { return !n ? "" : n === 1 ? "תיק אחד" : n + " תיקים"; }
  function hasFilters(f) { return !!(f.q || f.tagId || f.department || f.from || f.to); }

  // ------------------------------------------------------------ cases list
  function cases(page, state) {
    var f = state.ui.cases;
    var today = App.today();
    UI.setHtml(page, h`
      ${demoBar()}
      <div class="page-head">
        <div><h1>תיקים</h1><div class="sub" id="casesCount"></div></div>
        <div class="head-actions"><button type="button" class="btn btn-primary" id="addCase">${icon("plus")} תיק חדש</button></div>
      </div>
      <div class="filters" id="caseFilters">
        <div class="search">${icon("search")}<input type="search" name="q" placeholder="חיפוש לפי שם, עיר או טלפון" value="${f.q || ""}" aria-label="חיפוש"></div>
        <div class="seg" role="group" aria-label="סטטוס">${[["", "הכול"], ["ACTIVE", "פעיל"], ["WAITING", "בהמתנה"], ["CLOSED", "סגור"]].map(function (s) {
          return h`<button type="button" data-status="${s[0]}" class="${(f.status || "") === s[0] ? "on" : ""}">${s[1]}</button>`;
        })}</div>
        <select name="tagId" aria-label="סינון לפי תגית"><option value="">כל התגיות</option>${tagOptions(f.tagId)}</select>
      </div>
      <div class="card" id="casesBox"></div>`);
    UI.$("#addCase", page).onclick = function () { Dialogs.newCase(); };
    var filters = UI.$("#caseFilters", page);
    filters.addEventListener("input", function (e) { if (e.target.name) { f[e.target.name] = e.target.value; list(); } });
    UI.$$(".seg button", filters).forEach(function (b) {
      b.onclick = function () {
        f.status = b.dataset.status;
        UI.$$(".seg button", filters).forEach(function (x) { x.classList.toggle("on", x === b); });
        list();
      };
    });
    var box = UI.$("#casesBox", page);
    box.onclick = function (e) {
      if (e.target.closest("a")) return;
      var tr = e.target.closest("tr[data-id]");
      if (tr) App.go("#/case/" + encodeURIComponent(tr.dataset.id));
    };
    box.onkeydown = function (e) {
      var tr = e.target.closest("tr[data-id]");
      if (tr && e.key === "Enter") App.go("#/case/" + encodeURIComponent(tr.dataset.id));
    };
    function list() {
      var rows = MK.casesList(db(), f);
      var total = (db().cases || []).length;
      UI.$("#casesCount", page).textContent = rows.length === total ? casesWord(total) || "אין תיקים" : rows.length + " מתוך " + casesWord(total);
      if (!rows.length) {
        UI.setHtml(box, h`<div class="empty"><div class="empty-icon" style="background:var(--accent-wash);color:var(--accent)">${icon("folder")}</div>
          <h3>${total ? "לא נמצאו תיקים" : "עוד אין תיקים"}</h3><div class="small">${total ? "נסו לשנות את החיפוש או הסינון" : "לחצו על \"תיק חדש\" כדי להתחיל"}</div></div>`);
        return;
      }
      UI.setHtml(box, h`<table class="table"><thead><tr><th>שם</th><th>עיר</th><th>סטטוס</th><th>נושאים</th><th>המשימה הבאה</th><th>יעד</th></tr></thead><tbody>
        ${rows.map(function (r) {
          var c = r.case, n = r.next;
          return h`<tr data-id="${c.id}" tabindex="0">
            <td><span class="name">${c.fullName}</span> ${MK.bool(c.isUrgent) && c.status !== "CLOSED" ? h`<span class="badge urgent">דחוף</span>` : ""}</td>
            <td class="m-inline ${c.city ? "" : "faint"}">${c.city || "—"}</td>
            <td class="m-inline"><span class="badge ${c.status}">${MK.CASE_STATUS[c.status]}</span></td>
            <td><div class="chips">${tagList(c)}</div></td>
            <td data-label="${n ? "המשימה הבאה" : "סיבת סגירה"}" class="next-title">${n ? n.title : h`<span class="faint">${c.status === "CLOSED" ? c.closeReason || "סגור" : "—"}</span>`}</td>
            <td>${n ? dueLabel(n, today) : ""}</td></tr>`;
        })}</tbody></table>`);
    }
    list();
  }

  // ------------------------------------------------------------ case card
  function caseCard(page, state) {
    var id = state.params[0];
    var c = MK.byId(db().cases, id);
    var today = App.today();
    if (!c) {
      UI.setHtml(page, h`<a class="back" href="#/cases">${icon("arrowRight")} לכל התיקים</a>
        <div class="card empty"><h3>התיק לא נמצא</h3></div>`);
      return;
    }
    var open = MK.openTaskOfCase(db(), c.id);
    var tl = MK.timeline(db(), c.id);
    var tags = tagList(c);
    var closed = c.status === "CLOSED";
    UI.setHtml(page, h`
      ${demoBar()}
      <a class="back" href="#/cases">${icon("arrowRight")} לכל התיקים</a>
      <section class="card case-hero">
        <div class="grow">
          <h1>${c.fullName} <span class="badge ${c.status}">${MK.CASE_STATUS[c.status]}</span>${MK.bool(c.isUrgent) && !closed ? h`<span class="badge urgent">דחוף</span>` : ""}</h1>
          <div class="facts">
            ${c.phone ? h`<span>${icon("phone")}<a href="tel:${c.phone.replace(/[^0-9+]/g, "")}" class="ltr">${c.phone}</a></span>` : ""}
            ${c.city ? h`<span>${icon("pin")}${c.city}</span>` : ""}
            ${c.firstContactDate ? h`<span>${icon("calendar")}פנייה ראשונה ${MK.fmtDate(c.firstContactDate)}</span>` : ""}
          </div>
          ${tags.length ? h`<div class="chips" style="margin-top:12px">${tags}</div>` : ""}
        </div>
        <div class="row">
          ${closed ? "" : h`<button type="button" class="btn btn-outline btn-sm" data-act="urgent">${icon("flag")} ${MK.bool(c.isUrgent) ? "הסרת דחוף" : "סימון דחוף"}</button>
            <button type="button" class="btn btn-outline btn-sm" data-act="status">${icon(c.status === "ACTIVE" ? "pause" : "refresh")} ${c.status === "ACTIVE" ? "העברה להמתנה" : "החזרה לפעיל"}</button>`}
          <button type="button" class="btn btn-outline btn-sm" data-act="edit">${icon("edit")} עריכה</button>
        </div>
      </section>
      <div class="case-grid">
        <div>
          ${open ? h`<section class="next-card">
              <div class="label">${icon("flag")} המשימה הבאה</div>
              <div class="title">${open.title}</div>
              <div class="row between">
                <div class="row" style="gap:12px">${dueLabel(open, today)}${postponed(open)}</div>
                <div class="row">
                  <button type="button" class="btn btn-ghost btn-sm" data-act="edit-task" data-id="${open.id}">${icon("edit")} עריכה</button>
                  ${taskActions(open)}</div>
              </div></section>`
            : closed ? h`<section class="closed-card">
              <div class="row between"><div><b>התיק סגור</b>${c.closedAt ? h` <span class="muted small">מ-${MK.fmtDate(MK.todayYmd(c.closedAt))}</span>` : ""}
                <div class="muted" style="margin-top:4px">סיבת הסגירה: ${c.closeReason || "—"}</div></div>
                <button type="button" class="btn btn-outline btn-sm" data-act="reopen">${icon("refresh")} פתיחה מחדש</button></div></section>`
            : h`<section class="closed-card"><b style="color:var(--bad)">לתיק אין משימה פתוחה.</b> <span class="muted">זה לא אמור לקרות. רעננו את הדף, ואם זה חוזר פנו לתמיכה.</span></section>`}
          <section class="card">
            <div class="card-head"><h2>${icon("clock")} ציר זמן</h2><span class="muted small">${tl.length} משימות שבוצעו</span></div>
            <div class="card-pad">${tl.length ? h`<div class="timeline">
              ${closed ? h`<div class="tl-item"><span class="tl-dot closed">${icon("x")}</span>
                <div class="tl-head"><span class="tl-title">התיק נסגר</span><span class="tl-date">${MK.fmtDateTime(c.closedAt)}</span></div>
                ${c.closeReason ? h`<div class="tl-notes pre">${c.closeReason}</div>` : ""}</div>` : ""}
              ${tl.map(function (t) {
                var ct = t.contactId ? MK.byId(db().contacts, t.contactId) : null;
                return h`<div class="tl-item"><span class="tl-dot">${icon("check")}</span>
                  <div class="tl-head"><span class="tl-title">${t.title}</span><span class="tl-date">${MK.fmtDateTime(t.completedAt)}</span></div>
                  ${t.completionNotes ? h`<div class="tl-notes pre">${t.completionNotes}</div>` : ""}
                  <div class="tl-meta">
                    <span>יעד: ${MK.fmtDate(t.dueDate)}</span>
                    ${MK.num(t.postponeCount) ? h`<span>נדחתה ${t.postponeCount}× (במקור ${MK.fmtDate(t.originalDueDate)})</span>` : ""}
                    ${ct ? h`<span>${icon("user")} ${ct.fullName}${ct.profession ? " · " + ct.profession : ""}</span>` : ""}
                  </div></div>`;
              })}</div>` : h`<div class="empty small" style="padding:18px">עוד לא בוצעו משימות בתיק הזה. כשתסגרו משימה, הדיווח שלה יופיע כאן.</div>`}
            </div>
          </section>
        </div>
        <div class="stack" style="margin-top:0">
          <section class="card info"><div class="card-head"><h3>פרטי התיק</h3></div>
            <div class="card-pad"><dl>
              <dt>גורם מפנה</dt><dd>${c.referredBy || h`<span class="faint">—</span>`}</dd>
              <dt>מכיר את התיק</dt><dd>${c.knownBy || h`<span class="faint">—</span>`}</dd>
              <dt>פנייה ראשונה</dt><dd>${MK.fmtDate(c.firstContactDate) || h`<span class="faint">—</span>`}</dd>
              <dt>נפתח במערכת</dt><dd>${MK.fmtDate(MK.todayYmd(c.createdAt))}</dd>
            </dl></div></section>
          <section class="card"><div class="card-head"><h3>סיפור התיק</h3></div>
            <div class="card-pad">${c.story ? h`<div class="story pre">${c.story}</div>` : h`<div class="faint small">עוד לא נכתב. אפשר להוסיף דרך "עריכה".</div>`}</div></section>
        </div>
      </div>`);
    wireTaskButtons(page);
    Actions.edit = function () { Dialogs.editCase(c.id); };
    Actions.urgent = function () { Dialogs.toggleUrgent(c.id); };
    Actions.status = function () { Dialogs.setStatus(c.id, c.status === "ACTIVE" ? "WAITING" : "ACTIVE"); };
    Actions.reopen = function () { Dialogs.reopenCase(c.id); };
  }

  // ------------------------------------------------------------ settings
  function settings(page, state) {
    var me = state.me || {};
    var tags = (db().tags || []).slice().sort(function (a, b) { return MK.num(a.sortOrder) - MK.num(b.sortOrder); });
    var contacts = (db().contacts || []).slice().sort(function (a, b) { return a.fullName < b.fullName ? -1 : 1; });
    var usage = {};
    (db().cases || []).forEach(function (c) { MK.splitIds(c.tagIds).forEach(function (id) { usage[id] = (usage[id] || 0) + 1; }); });
    UI.setHtml(page, h`
      ${demoBar()}
      <div class="page-head"><div><h1>הגדרות</h1><div class="sub">תגיות, אנשי קשר וחשבון</div></div></div>
      <div class="settings-grid">
        <section class="card">
          <div class="card-head"><h2>${icon("tag")} נושאי טיפול (תגיות)</h2><button type="button" class="btn btn-outline btn-sm" data-act="add-tag">${icon("plus")} תגית</button></div>
          ${tags.map(function (t) {
            var on = t.isActive === undefined || t.isActive === "" || MK.bool(t.isActive);
            return h`<div class="list-row ${on ? "" : "off"}"><div class="grow"><b>${t.name}</b> <span class="muted small">${casesWord(usage[t.id])}${on ? "" : " · מושבתת"}</span></div>
              <button type="button" class="btn btn-ghost btn-sm" data-act="edit-tag" data-id="${t.id}">${icon("edit")}<span class="sr">עריכה</span></button>
              <button type="button" class="btn btn-ghost btn-sm" data-act="toggle-tag" data-id="${t.id}">${on ? "השבתה" : "הפעלה"}</button></div>`;
          })}
        </section>
        <div class="stack" style="margin-top:0">
          <section class="card">
            <div class="card-head"><h2>${icon("users")} אנשי קשר מקצועיים</h2><button type="button" class="btn btn-outline btn-sm" data-act="add-contact">${icon("plus")} איש קשר</button></div>
            ${contacts.length ? contacts.map(function (c) {
              return h`<div class="list-row"><div class="avatar" style="background:var(--accent-wash);color:var(--accent-deep)">${UI.initials(c.fullName)}</div>
                <div class="grow"><b>${c.fullName}</b><div class="muted small">${[c.profession, c.phone].filter(Boolean).join(" · ")}</div></div>
                <button type="button" class="btn btn-ghost btn-sm" data-act="edit-contact" data-id="${c.id}">${icon("edit")}<span class="sr">עריכה</span></button></div>`;
            }) : h`<div class="empty small" style="padding:20px">אין עדיין אנשי קשר. מטפלים, רבנים ויועצים נשמרים כאן, ואפשר לשייך אותם לדיווח על משימה.</div>`}
          </section>
          <section class="card">
            <div class="card-head"><h2>${icon("lock")} החשבון שלי</h2></div>
            <div class="card-pad stack">
              <div class="row"><div class="avatar">${UI.initials(me.name)}</div><div><b>${me.name}</b><div class="muted small" dir="ltr" style="text-align:right">${me.email}</div></div><span class="badge ACTIVE plain" style="margin-inline-start:auto">${MK.ROLES[me.role] || ""}</span></div>
              ${Api.isDemo() ? h`<button type="button" class="btn btn-outline btn-sm" data-act="reset-demo">${icon("refresh")} איפוס נתוני ההדגמה</button>`
                : h`<div class="row"><button type="button" class="btn btn-outline btn-sm" data-act="password">${icon("lock")} שינוי סיסמה</button>
                  ${App.state.meta.dbUrl ? h`<a class="btn btn-ghost btn-sm" href="${App.state.meta.dbUrl}" target="_blank" rel="noopener">${icon("file")} מסד הנתונים (Google Sheets)</a>` : ""}</div>`}
              <p class="small muted">ניהול משתמשים נוספים (לכל אחד מייל וסיסמה משלו) יתווסף בשלב 5.</p>
            </div>
          </section>
        </div>
      </div>`);
    wireTaskButtons(page);
    Actions["add-tag"] = function () { Dialogs.editTag(""); };
    Actions["edit-tag"] = function (b) { Dialogs.editTag(b.dataset.id); };
    Actions["toggle-tag"] = async function (b) {
      var t = MK.byId(db().tags, b.dataset.id);
      var on = t.isActive === undefined || t.isActive === "" || MK.bool(t.isActive);
      var res = await App.mutate("saveTag", { id: t.id, name: t.name, isActive: !on }, on ? "התגית הושבתה" : "התגית הופעלה");
      if (!res.ok) UI.toast(res.message || "השמירה נכשלה", true);
    };
    Actions["add-contact"] = function () { Dialogs.editContact(""); };
    Actions["edit-contact"] = function (b) { Dialogs.editContact(b.dataset.id); };
    Actions.password = function () { Dialogs.changePassword(); };
    Actions["reset-demo"] = async function () {
      await Api.call("resetDemo");
      await App.reload();
      App.go("#/");
      UI.toast("נתוני ההדגמה אופסו");
    };
  }

  var titles = {
    diary: function () { return "יומן משימות"; },
    cases: function () { return "תיקים"; },
    case: function () { return "כרטיס תיק"; },
    settings: function () { return "הגדרות"; }
  };

  return { diary: diary, cases: cases, case: caseCard, settings: settings, titles: titles };
})();
