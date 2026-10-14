/* pages.js - the screens: task diary (home), case list, case card (details, tasks, history, documents). */
var Pages = (function () {
  "use strict";
  var esc = UI.esc, multiline = UI.multiline, icon = UI.icon, $ = UI.$, $$ = UI.$$;
  function S() { return App.state; }
  function db() { return App.state.db; }
  function freshDraft() {
    var s = S();
    return { title: "", due: App.today(), kind: s.view !== "all" && s.view !== "done" ? s.view : "mine", who: "", what: "", caseId: s.view === "case" ? s.caseFilter : "", owner: "", dept: "" };
  }
  function draft() { if (!S().draft) S().draft = freshDraft(); return S().draft; }
  function peopleList() { return '<datalist id="peopleList">' + MK.people(db()).map(function (p) { return '<option value="' + esc(p) + '">'; }).join("") + '</datalist>'; }
  function caseName(id) { var c = MK.byId(db().cases, id); return c ? c.name : ""; }
  function stPill(st) { return '<span class="st st-' + MK.CASE_STATUS_ORDER.indexOf(st) + '">' + esc(MK.CASE_STATUS[st] || st) + '</span>'; }
  function dayOf(iso) { return iso ? MK.todayYmd(iso) : ""; }

  // ================================================================ task row (shared by the diary and the case card)
  function doneLabel(t) { var k = MK.kindOf(t); return k === "people" || (k === "case" && t.owner) ? "בדקתי" : k === "case" ? "טיפלתי" : "בוצע"; }
  function kindTag(t, showCase) {
    var k = MK.kindOf(t);
    if (k === "people") return '<span class="who-tag" title="' + esc(t.what) + '">' + icon("eye") + 'מעקב · ' + esc(t.who) + '</span>';
    if (k === "case") return (showCase ? '<a class="who-tag k-case" href="#/case/' + encodeURIComponent(t.caseId) + '" title="לכרטיס התיק">' + icon("folder") + 'תיק · ' + esc(caseName(t.caseId) || "ללא תיק") + '</a>' : "") +
      (t.owner ? '<span class="who-tag k-owner">' + icon("user") + 'אחראי: ' + esc(t.owner) + '</span>' : "");
    if (k === "org") return '<span class="who-tag k-org">' + icon("briefcase") + 'ארגוני' + (t.dept ? " · " + esc(t.dept) : "") + '</span>';
    return "";
  }
  function opened(t, ref) {
    var o = t.openedAt || dayOf(t.createdAt);
    return '<span class="opened" title="תאריך הפתיחה הראשון">' + icon("flag") + 'נפתחה ' + MK.fmtDate(o) + ' · ' + MK.ago(o, ref) + (MK.num(t.steps) > 1 ? ' · סבב ' + MK.num(t.steps) : "") + '</span>';
  }
  function result(t) { return t.result === "notdone" ? '<span class="res no">' + icon("x") + 'לא בוצע</span>' : '<span class="res ok">' + icon("check") + 'בוצע</span>'; }
  function taskRow(t, today, showCase) {
    var k = MK.kindOf(t), late = !MK.isDone(t) && t.due < today, now = t.due === today;
    var follow = k === "people" || (k === "case" && t.owner);
    if (MK.isDone(t)) {
      var d = dayOf(t.completedAt);
      return '<div class="task done' + (follow ? " is-follow" : "") + '"><span class="check' + (t.result === "notdone" ? " no" : "") + '">' + icon(t.result === "notdone" ? "x" : "check") + '</span><div class="body">' +
        '<div class="title">' + esc(t.title) + '</div><div class="meta">' + result(t) + '<span class="due">' + MK.fmtDate(d) + '</span>' + kindTag(t, showCase) + opened(t, d) + '</div>' +
        (t.note ? '<div class="note">' + multiline(t.note) + '</div>' : "") + '</div>' +
        '<div class="acts"><button type="button" class="btn btn-ghost btn-sm" data-act="undo" data-id="' + esc(t.id) + '">החזרה</button></div></div>';
    }
    return '<div class="task' + (follow ? " is-follow" : "") + '">' +
      '<button type="button" class="check" data-act="done" data-id="' + esc(t.id) + '" aria-label="סימון: ' + esc(t.title) + '">' + icon("check") + '</button>' +
      '<div class="body"><div class="title">' + esc(t.title) + '</div><div class="meta">' +
        '<span class="due ' + (late ? "late" : now ? "now" : "") + '">' + icon(late ? "alert" : "clock") + MK.fmtDate(t.due) + (now ? "" : " · " + MK.relDay(t.due, today)) + '</span>' +
        kindTag(t, showCase) + (MK.num(t.moved) ? '<span class="moved">נדחתה ' + (MK.num(t.moved) === 1 ? "פעם אחת" : t.moved + " פעמים") + '</span>' : "") +
        (k === "people" && t.what ? '<span class="history">מחכה ל: ' + esc(t.what) + '</span>' : "") + '</div>' +
        '<div class="meta">' + opened(t, today) + '</div></div>' +
      '<div class="acts"><button type="button" class="btn btn-good btn-sm" data-act="done" data-id="' + esc(t.id) + '">' + icon("check") + doneLabel(t) + '</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-act="move" data-id="' + esc(t.id) + '">' + icon("clock") + 'דחה</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="' + esc(t.id) + '" aria-label="עריכה">' + icon("edit") + '</button></div></div>';
  }

  /** Kind-specific fields (quick add + edit dialog). */
  function kindFields(k, v, prefix) {
    if (k === "people") return '<div class="kbox k-people"><div><label for="' + prefix + 'Who">אחרי מי</label><input type="text" id="' + prefix + 'Who" data-f="who" value="' + esc(v.who) + '" list="peopleList" placeholder="שם" maxlength="80" autocomplete="off"></div>' +
      '<div><label for="' + prefix + 'What">מה הוא אמור לעשות</label><input type="text" id="' + prefix + 'What" data-f="what" value="' + esc(v.what) + '" placeholder="למשל: לשלוח הצעת מחיר" maxlength="200" autocomplete="off"></div></div>';
    if (k === "case") return '<div class="kbox k-case"><div><label for="' + prefix + 'Case">איזה תיק</label><select id="' + prefix + 'Case" data-f="caseId"><option value="">בחרו תיק…</option>' +
      db().cases.filter(function (c) { return c.status !== "closed" || c.id === v.caseId; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; })
        .map(function (c) { return '<option value="' + esc(c.id) + '"' + (v.caseId === c.id ? " selected" : "") + '>' + esc(c.name) + (c.city ? " · " + esc(c.city) : "") + '</option>'; }).join("") + '</select></div>' +
      '<div><label for="' + prefix + 'Owner">מי מטפל</label><input type="text" id="' + prefix + 'Owner" data-f="owner" value="' + esc(v.owner) + '" list="peopleList" placeholder="ריק = אני" maxlength="80" autocomplete="off"></div></div>';
    if (k === "org") return '<div class="kbox k-org"><div><label for="' + prefix + 'Dept">מחלקה</label><select id="' + prefix + 'Dept" data-f="dept"><option value="">ללא מחלקה</option>' +
      MK.DEPTS.map(function (d) { return '<option' + (v.dept === d ? " selected" : "") + '>' + esc(d) + '</option>'; }).join("") + '</select></div><div></div></div>';
    return "";
  }

  // ================================================================ diary
  function diary(t) {
    var s = S(), d = draft(), c = MK.counts(db(), t);
    var filter = { kind: s.view !== "all" && s.view !== "done" ? s.view : "", caseId: s.view === "case" ? s.caseFilter : "" };
    var g = MK.diary(db(), t, filter);
    var html = '<section class="summary" aria-label="סיכום">' +
        sum("bad", c.overdue, "באיחור", "all") + sum("today", c.today, "להיום", "all") + sum("follow", c.people, "מעקב אחרי אנשים", "people") +
        sum("case", c["case"], "מעקב תיקים", "case") + sum("org", c.org, "ניהול ארגוני", "org") + '</section>' +
      '<form class="add" id="addForm" novalidate><div class="add-row"><label for="addTitle" class="sr">משימה חדשה</label>' +
        '<input type="text" id="addTitle" class="add-main" placeholder="משימה חדשה… (למשל: לבדוק עם יוסי אם שלח את ההצעה)" value="' + esc(d.title) + '" autocomplete="off" maxlength="300">' +
        '<button type="submit" class="btn btn-primary">' + icon("plus") + 'הוספה</button></div>' +
        '<div class="add-opts" role="group" aria-label="סוג המשימה"><span class="kind-label">סוג:</span>' +
          MK.KIND_ORDER.map(function (k) { return '<button type="button" class="chip k-' + k + (d.kind === k ? " on" : "") + '" data-act="kind" data-kind="' + k + '" aria-pressed="' + (d.kind === k) + '">' + icon(MK.KINDS[k].icon) + MK.KINDS[k].short + '</button>'; }).join("") +
        '</div>' + kindFields(d.kind, d, "add") +
        '<div class="add-opts" role="group" aria-label="תאריך"><span class="kind-label">מתי:</span>' +
          MK.quickDates(t).map(function (q) { return '<button type="button" class="chip' + (d.due === q.date ? " on" : "") + '" data-act="due" data-date="' + q.date + '">' + q.label + (q.key === "today" ? "" : ' <small>' + MK.fmtDate(q.date).slice(0, 5) + '</small>') + '</button>'; }).join("") +
          '<label for="addDue" class="sr">תאריך אחר</label><input type="date" id="addDue" value="' + d.due + '" min="' + t + '" class="date-sm"></div>' +
        peopleList() + '<div class="error" id="addError" hidden></div></form>' +
      '<nav class="views" aria-label="תצוגה">' + viewBtn("all", "הכול", c.all, "list") +
        MK.KIND_ORDER.map(function (k) { return viewBtn(k, MK.KINDS[k].label, c[k], MK.KINDS[k].icon); }).join("") + viewBtn("done", "בוצעו", c.done, "check") + '</nav>';
    if (s.view === "case") html += caseChips();
    if (s.view === "done") {
      html += group("done", "בוצעו", MK.doneTasks(db()).slice(0, 100), true, '<div class="empty"><b>עוד לא סימנת משימות</b></div>', false, t);
    } else {
      if (g.overdue.length) html += group("overdue", "באיחור", g.overdue, true, "", false, t);
      html += group("today", "להיום", g.today, true, '<div class="empty"><b>' + (s.view === "all" ? "אין עוד משימות להיום" : "אין היום משימות מהסוג הזה") + '</b>' + (g.upcoming.length ? "אפשר להציץ במה שמחכה בהמשך" : "") + '</div>', false, t);
      html += group("upcoming", "בהמשך", g.upcoming, s.upcomingOpen, '<div class="empty">אין משימות בהמשך</div>', true, t);
    }
    return html;
  }
  function sum(cls, n, label, v) { return '<button type="button" class="sum ' + cls + '" data-act="view" data-view="' + v + '"><b>' + n + '</b><span>' + label + '</span></button>'; }
  function viewBtn(v, label, n, ic) {
    var on = S().view === v;
    return '<button type="button" data-act="view" data-view="' + v + '" class="' + (on ? "on" : "") + '" aria-pressed="' + on + '"><span class="ico">' + icon(ic) + '</span>' + label + ' <span class="n">' + n + '</span></button>';
  }
  function caseChips() {
    var counts = {}, f = S().caseFilter;
    MK.openTasks(db()).forEach(function (t) { if (MK.kindOf(t) === "case") counts[t.caseId] = (counts[t.caseId] || 0) + 1; });
    return '<div class="add-opts" role="group" aria-label="סינון לפי תיק"><span class="kind-label">תיק:</span>' +
      '<button type="button" class="chip k-case' + (!f ? " on" : "") + '" data-act="casefilter" data-case="">כל התיקים</button>' +
      db().cases.filter(function (c) { return counts[c.id] || f === c.id; }).map(function (c) {
        return '<button type="button" class="chip k-case' + (f === c.id ? " on" : "") + '" data-act="casefilter" data-case="' + esc(c.id) + '">' + esc(c.name) + ' <small>' + (counts[c.id] || 0) + '</small></button>';
      }).join("") + (f ? '<a class="btn btn-ghost btn-sm" href="#/case/' + encodeURIComponent(f) + '">' + icon("folder") + 'לכרטיס התיק</a>' : "") + '</div>';
  }
  function group(cls, title, list, isOpen, empty, collapsible, t) {
    var head = '<span class="dot"></span><h2>' + title + '</h2><span class="count">' + list.length + '</span>' + (collapsible ? '<span class="chev">' + icon("chev") + '</span>' : "");
    return '<section class="group ' + cls + (isOpen ? "" : " closed") + '">' +
      (collapsible ? '<button type="button" class="group-head" data-act="toggle-up" aria-expanded="' + isOpen + '">' + head + '</button>' : '<div class="group-head">' + head + '</div>') +
      (isOpen ? (list.length ? list.map(function (x) { return taskRow(x, t, true); }).join("") : empty) : "") + '</section>';
  }
  function wireDiary() {
    var form = $("#addForm"), d = draft();
    $$("#addTitle, [data-f]", form).forEach(function (el) {
      var f = function () { d[el.dataset.f || "title"] = el.value; };
      el.addEventListener("input", f); el.addEventListener("change", f);
    });
    $("#addDue").addEventListener("change", function (e) { if (e.target.value) { d.due = e.target.value; App.render(); focusAdd(); } });
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var btn = form.querySelector("button[type=submit]"); if (btn.disabled) return;
      btn.disabled = true;
      var res = await App.act("addTask", { kind: d.kind, title: d.title, due: d.due, who: d.who, what: d.what, caseId: d.caseId, owner: d.owner, dept: d.dept });
      btn.disabled = false;
      if (!res.ok) {
        var err = $("#addError");
        if (err && res.fields) { err.textContent = res.message; err.hidden = false; }
        return;
      }
      var when = d.due === App.today() ? "להיום" : "ל" + MK.fmtDate(d.due);
      if (S().view === "done") S().view = "all";
      S().draft = freshDraft();
      App.render(); focusAdd();
      UI.toast("המשימה נוספה " + when);
    });
  }
  function focusAdd() { var el = $("#addTitle"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }

  // ================================================================ cases list
  function cases(t) {
    var s = S(), list = MK.casesList(db(), { q: s.casesQuery, status: s.casesStatus });
    return '<div class="list-head"><h2 class="screen-title">תיקים</h2><button type="button" class="btn btn-primary" data-act="new-case">' + icon("plus") + 'תיק חדש</button></div>' +
      '<div class="filters"><div class="search">' + icon("search") + '<input type="search" id="caseQ" placeholder="חיפוש לפי שם, עיר, מפנה או נתונים" value="' + esc(s.casesQuery) + '" aria-label="חיפוש תיקים"></div>' +
        '<div class="views">' + [["open", "פתוחים"], ["closed", "סגורים"], ["all", "הכול"]].map(function (x) {
          return '<button type="button" data-act="cstatus" data-st="' + x[0] + '" class="' + (s.casesStatus === x[0] ? "on" : "") + '">' + x[1] + '</button>'; }).join("") + '</div></div>' +
      '<div class="group"><div class="table-wrap"><table class="ctable"><thead><tr><th>שם</th><th>עיר</th><th>נתונים חשובים</th><th>מפנה</th><th>המשימה הבאה</th><th>מי מטפל</th><th>מצב</th></tr></thead><tbody>' +
      (list.length ? list.map(function (r) {
        var c = r["case"], n = r.next, late = n && n.due < t;
        return '<tr data-opencase="' + esc(c.id) + '" tabindex="0"><td class="nm">' + esc(c.name) + '</td><td data-l="עיר">' + esc(c.city || "—") + '</td><td data-l="נתונים">' + esc(c.info || "—") + '</td>' +
          '<td data-l="מפנה">' + esc(c.referredBy || "—") + '</td>' +
          '<td data-l="הבא">' + (n ? esc(n.title) + '<div class="due ' + (late ? "late" : n.due === t ? "now" : "") + '">' + icon(late ? "alert" : "clock") + MK.fmtDate(n.due) + ' · ' + MK.relDay(n.due, t) + '</div>'
            : '<span class="faint">' + (c.status === "closed" ? esc(c.closeReason || "סגור") : "אין משימה פתוחה") + '</span>') + '</td>' +
          '<td data-l="מטפל">' + (n ? esc(n.owner || "אני") : "—") + '</td><td>' + stPill(c.status) + '</td></tr>';
      }).join("") : '<tr><td colspan="7" class="empty">' + (db().cases.length ? "לא נמצאו תיקים" : 'עוד אין תיקים. לחצו על "תיק חדש" כדי להתחיל.') + '</td></tr>') + '</tbody></table></div></div>';
  }
  function wireCases() {
    var q = $("#caseQ");
    q.addEventListener("input", function () {
      S().casesQuery = q.value;
      var pos = q.selectionStart;
      App.render();
      var n = $("#caseQ"); n.focus(); n.setSelectionRange(pos, pos);
    });
  }

  // ================================================================ case card
  function casePage(t) {
    var c = MK.byId(db().cases, S().caseId);
    if (!c) return '<a class="back" href="#/cases">' + icon("back") + 'לכל התיקים</a><div class="group"><div class="empty"><b>התיק לא נמצא</b></div></div>';
    var open = MK.caseTasks(db(), c.id).filter(function (x) { return !MK.isDone(x); }).sort(function (a, b) { return a.due < b.due ? -1 : 1; });
    var tl = MK.caseTimeline(db(), c.id), docs = MK.caseDocuments(db(), c.id), closed = c.status === "closed";
    var detail = function (label, val) { return '<dt>' + label + '</dt><dd>' + (val ? multiline(val) : '<span class="faint">—</span>') + '</dd>'; };
    var folderUrl = c.folderId ? "https://drive.google.com/drive/folders/" + encodeURIComponent(c.folderId) : "";
    return '<a class="back" href="#/cases">' + icon("back") + 'לכל התיקים</a>' +
      '<section class="case-hero"><div class="grow"><h2 class="case-name">' + esc(c.name) + ' ' + stPill(c.status) + '</h2>' +
        '<div class="facts">' + (c.city ? '<span>' + icon("pin") + esc(c.city) + '</span>' : "") +
          (c.firstContact ? '<span>' + icon("calendar") + 'פנייה ראשונה ' + MK.fmtDate(c.firstContact) + ' · ' + MK.ago(c.firstContact, t) + '</span>' : "") +
          '<span>' + icon("list") + open.length + ' משימות פתוחות</span><span>' + icon("file") + docs.length + ' מסמכים</span></div>' +
        (c.info ? '<div class="info-line">' + icon("alert") + esc(c.info) + '</div>' : "") + '</div>' +
        '<div class="hero-acts"><label class="sr" for="caseStatus">מצב התיק</label><select id="caseStatus" class="select-sm">' +
          MK.CASE_STATUS_ORDER.map(function (s) { return '<option value="' + s + '"' + (s === c.status ? " selected" : "") + '>' + MK.CASE_STATUS[s] + '</option>'; }).join("") + '</select>' +
        '<button type="button" class="btn btn-outline btn-sm" data-act="edit-case">' + icon("edit") + 'עריכת פרטים</button></div></section>' +

      '<div class="case-grid"><div class="col">' +
        '<section class="group"><div class="group-head"><span class="dot" style="background:var(--case)"></span><h2>מה צריך לעשות</h2><span class="count">' + open.length + '</span></div>' +
          (open.length ? open.map(function (x) { return taskRow(x, t, false); }).join("") : '<div class="empty"><b>' + (closed ? "התיק סגור" : "אין משימה פתוחה בתיק") + '</b>' + (closed ? "כדי להוסיף משימות, החזירו את התיק למצב פתוח" : "כדאי לקבוע מה הצעד הבא") + '</div>') +
          (closed ? "" : '<form class="case-add" id="caseTaskForm" novalidate>' +
            '<div class="add-row"><label for="ctTitle" class="sr">משימה חדשה בתיק</label><input type="text" id="ctTitle" placeholder="משימה חדשה בתיק… (מה צריך לעשות)" maxlength="300" autocomplete="off">' +
            '<button type="submit" class="btn btn-primary">' + icon("plus") + 'הוספה</button></div>' +
            '<div class="add-opts"><span class="kind-label">מי מטפל:</span><input type="text" id="ctOwner" list="peopleList" placeholder="ריק = אני" maxlength="80" autocomplete="off" class="owner-in">' +
            '<span class="kind-label">מתי:</span>' + MK.quickDates(t).map(function (q) { return '<button type="button" class="chip' + (q.key === "tomorrow" ? " on" : "") + '" data-ctdue="' + q.date + '">' + q.label + '</button>'; }).join("") +
            '<input type="date" id="ctDue" value="' + MK.addDays(t, 1) + '" min="' + t + '" class="date-sm" aria-label="תאריך"></div>' + peopleList() +
            '<div class="error" id="ctErr" hidden></div></form>') + '</section>' +

        '<section class="group"><div class="group-head"><span class="dot" style="background:var(--case)"></span><h2>מסמכים</h2><span class="count">' + docs.length + '</span>' +
          '<span style="margin-inline-start:auto;display:flex;gap:6px;flex-wrap:wrap">' +
          (folderUrl ? '<a class="btn btn-ghost btn-sm" href="' + folderUrl + '" target="_blank" rel="noopener">' + icon("external") + 'התיקייה בדרייב</a>'
            : (Api.isDemo() ? "" : '<button type="button" class="btn btn-ghost btn-sm" data-act="make-folder">' + icon("folder") + 'יצירת תיקייה בדרייב</button>')) +
          '<button type="button" class="btn btn-outline btn-sm" data-act="upload">' + icon("upload") + 'הוספת מסמך</button></span></div>' +
          '<div class="docs">' + (docs.length ? docs.map(docRow).join("") : '<div class="empty">אין מסמכים בתיק. אפשר להוסיף PDF, תמונות, Word וכל קובץ אחר' + (Api.isDemo() ? "" : ", והם יישמרו בתיקיית התיק בגוגל דרייב") + '.</div>') + '</div></section>' +

        '<section class="group"><div class="group-head"><span class="dot" style="background:var(--accent)"></span><h2>היסטוריה ועדכונים</h2><span class="count">' + tl.length + '</span></div>' +
          '<form class="case-add" id="logForm" novalidate><label for="logText" class="sr">עדכון חדש</label>' +
            '<textarea id="logText" rows="2" placeholder="עדכון חדש: מה קרה, עם מי דיברת, מה התברר…"></textarea>' +
            '<div class="add-opts" style="justify-content:space-between"><span class="faint small">Ctrl+Enter לשמירה</span><button type="submit" class="btn btn-outline btn-sm">' + icon("msg") + 'הוספת עדכון</button></div></form>' +
          '<div class="tl case-tl">' + tl.map(function (ev) { return timelineItem(ev); }).join("") +
            '<div class="tl-i start"><div class="tl-h"><span class="tl-k">' + icon("flag") + 'התיק נפתח</span><span class="tl-d">' + MK.fmtDate(dayOf(c.createdAt)) + '</span></div></div></div></section>' +
      '</div>' +

      '<aside class="col side">' +
        '<section class="group"><div class="group-head"><h2>פרטי התיק</h2></div><dl class="dl">' +
          detail("נתונים חשובים", c.info) + detail("טלפון", c.phone) + detail("עיר", c.city) + detail("מפנה", c.referredBy) + detail("מכיר את התיק / ראש חבורה", c.knownBy) +
          detail("תאריך פנייה ראשונה", MK.fmtDate(c.firstContact)) + (closed ? detail("סיבת סגירה", c.closeReason) : "") + '</dl></section>' +
        '<section class="group"><div class="group-head"><h2>הערות חשובות</h2></div><div class="pad">' + (c.notes ? '<div class="hl">' + multiline(c.notes) + '</div>' : '<span class="faint small">אין הערות</span>') + '</div></section>' +
        '<section class="group"><div class="group-head"><h2>סיפור התיק</h2></div><div class="pad story">' + (c.story ? multiline(c.story) : '<span class="faint small">עוד לא נכתב. אפשר להוסיף ב"עריכת פרטים".</span>') + '</div></section>' +
      '</aside></div>';
  }
  function docUrls(d) {
    var id = encodeURIComponent(d.fileId || "");
    return { view: d.url || (d.fileId ? "https://drive.google.com/file/d/" + id + "/view" : ""), download: d.fileId ? "https://drive.google.com/uc?export=download&id=" + id : "" };
  }
  function docRow(d) {
    var u = docUrls(d);
    return '<div class="doc"><div class="doc-ic" aria-hidden="true">' + esc(UI.fileBadge(d.name, d.mime)) + '</div><div class="doc-body">' +
      '<div class="doc-name">' + esc(d.name) + '</div><div class="doc-meta">' + MK.fmtDate(dayOf(d.createdAt)) + (d.size ? ' · ' + MK.fileSize(d.size) : "") + (d.note ? ' · ' + esc(d.note) : "") + '</div></div>' +
      '<div class="doc-acts">' + (u.view ? '<a class="btn btn-ghost btn-sm" href="' + esc(u.view) + '" target="_blank" rel="noopener">' + icon("external") + 'פתיחה</a>' : "") +
        (u.download ? '<a class="btn btn-ghost btn-sm" href="' + esc(u.download) + '" target="_blank" rel="noopener">' + icon("download") + 'הורדה</a>' : "") +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="rm-doc" data-id="' + esc(d.id) + '" aria-label="הסרת המסמך">' + icon("trash") + '</button></div></div>';
  }
  function timelineItem(ev) {
    var x = ev.item, when = MK.fmtDate(dayOf(ev.at)) + " · " + MK.timeIL(ev.at);
    if (ev.type === "log") return '<div class="tl-i log"><div class="tl-h"><span class="tl-k">' + icon("msg") + (x.auto ? "שינוי" : "עדכון") + '</span><span class="tl-d">' + when + '</span></div><div class="tl-text">' + multiline(x.text) + '</div></div>';
    if (ev.type === "doc") return '<div class="tl-i tl-doc"><div class="tl-h"><span class="tl-k">' + icon("file") + 'נוסף מסמך: ' + esc(x.name) + '</span><span class="tl-d">' + when + '</span></div></div>';
    return '<div class="tl-i ' + (x.result === "notdone" ? "no" : "ok") + '"><div class="tl-h"><span class="tl-k">' + result(x) + ' ' + esc(x.title) + '</span><span class="tl-d">' + when + '</span></div>' +
      '<div class="meta"><span class="who-tag k-owner">' + icon("user") + esc(x.owner || "אני") + '</span><span class="opened">יעד ' + MK.fmtDate(x.due) + (MK.num(x.moved) ? ' · נדחתה ' + x.moved + '×' : "") + '</span></div>' +
      (x.note ? '<div class="note">' + multiline(x.note) + '</div>' : "") + '</div>';
  }
  function wireCase() {
    var c = MK.byId(db().cases, S().caseId);
    if (!c) return;
    var f = $("#caseTaskForm");
    if (f) {
      var due = $("#ctDue");
      f.addEventListener("click", function (e) {
        var b = e.target.closest("[data-ctdue]"); if (!b) return;
        due.value = b.dataset.ctdue;
        $$("[data-ctdue]", f).forEach(function (x) { x.classList.toggle("on", x === b); });
      });
      due.addEventListener("input", function () { $$("[data-ctdue]", f).forEach(function (x) { x.classList.toggle("on", x.dataset.ctdue === due.value); }); });
      f.addEventListener("submit", async function (e) {
        e.preventDefault();
        var title = $("#ctTitle").value, owner = $("#ctOwner").value, when = due.value;
        var res = await App.act("addTask", { kind: "case", caseId: c.id, title: title, owner: owner, due: when });
        if (!res.ok) { var err = $("#ctErr"); if (err && res.fields) { err.textContent = res.message; err.hidden = false; $("#ctTitle").focus(); } return; }
        $("#ctTitle").focus();
        UI.toast("המשימה נוספה לתיק ל" + MK.fmtDate(when));
      });
    }
    var lf = $("#logForm");
    lf.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); lf.requestSubmit(); } });
    lf.addEventListener("submit", async function (e) {
      e.preventDefault();
      var text = $("#logText").value;
      if (!MK.str(text)) { $("#logText").focus(); return; }
      var res = await App.act("addLog", { caseId: c.id, text: text }, "העדכון נשמר בהיסטוריה");
      if (!res.ok && res.fields) UI.toast(res.message, null, true);
    });
    $("#caseStatus").addEventListener("change", function (e) {
      var s = e.target.value;
      e.target.value = c.status;
      if (s === "closed") return Dialogs.closeCase(c);
      App.act("setCaseStatus", { id: c.id, status: s }, "מצב התיק: " + MK.CASE_STATUS[s]);
    });
    // drag a file onto the documents card to upload it
    var docsCard = $(".docs");
    if (docsCard) {
      docsCard.addEventListener("dragover", function (e) { e.preventDefault(); });
      docsCard.addEventListener("drop", function (e) {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) Dialogs.upload(c, e.dataTransfer.files[0]);
      });
    }
  }

  // ================================================================ actions from the screens
  function onAction(a, b) {
    var s = S(), t = b.dataset.id ? MK.byId(db().tasks, b.dataset.id) : null;
    switch (a) {
      case "view":
        s.view = b.dataset.view;
        if (s.view !== "case") s.caseFilter = "";
        if (s.view !== "all" && s.view !== "done") { s.upcomingOpen = true; if (!draft().title) draft().kind = s.view; }
        if (s.route !== "diary") App.go("#/"); else App.render();
        return;
      case "casefilter": s.caseFilter = b.dataset["case"]; if (!draft().title) draft().caseId = s.caseFilter; App.render(); return;
      case "kind": draft().kind = b.dataset.kind; App.render(); var f = $("#addForm [data-f]") || $("#addTitle"); if (f) f.focus(); return;
      case "due": draft().due = b.dataset.date; App.render(); focusAdd(); return;
      case "toggle-up": s.upcomingOpen = !s.upcomingOpen; App.render(); return;
      case "cstatus": s.casesStatus = b.dataset.st; App.render(); return;
      case "done": if (t) Dialogs.complete(t); return;
      case "move": if (t) Dialogs.postpone(t); return;
      case "edit": if (t) Dialogs.editTask(t); return;
      case "undo": if (t) App.act("undoTask", { id: t.id }, "המשימה הוחזרה לרשימה"); return;
      case "new-case": Dialogs.newCase(); return;
      case "edit-case": var c = MK.byId(db().cases, s.caseId); if (c) Dialogs.editCase(c); return;
      case "upload": var c2 = MK.byId(db().cases, s.caseId); if (c2) Dialogs.upload(c2); return;
      case "rm-doc": var d = MK.byId(db().documents, b.dataset.id); if (d) Dialogs.removeDoc(d); return;
      case "make-folder": makeFolder(b); return;
    }
  }
  async function makeFolder(b) {
    b.disabled = true;
    var res = await App.call("caseFolder", { caseId: S().caseId });
    b.disabled = false;
    if (!res.ok) return UI.toast(res.message || "לא ניתן ליצור תיקייה כרגע", null, true);
    App.merge(res);
    UI.toast("התיקייה נוצרה בדרייב");
  }
  document.addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-opencase]");
    if (tr && !e.target.closest("a")) App.go("#/case/" + encodeURIComponent(tr.dataset.opencase));
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.matches && e.target.matches("tr[data-opencase]")) App.go("#/case/" + encodeURIComponent(e.target.dataset.opencase));
  });

  function wire(route) {
    if (route === "diary") wireDiary();
    else if (route === "cases") wireCases();
    else wireCase();
  }

  return { diary: diary, cases: cases, casePage: casePage, wire: wire, onAction: onAction, kindFields: kindFields, peopleList: peopleList, freshDraft: freshDraft };
})();
