/* dialogs.js - every form in the system, as modals. Business rules are enforced by MK (core.js). */
var Dialogs = (function () {
  "use strict";
  var h = UI.h, icon = UI.icon, raw = UI.raw;

  // ------------------------------------------------------------ building blocks
  function field(label, control, opts) {
    opts = opts || {};
    return h`<div class="field" ${opts.style ? raw('style="' + opts.style + '"') : ""}>
      <label ${opts.for ? raw('for="' + opts.for + '"') : ""}>${label}${opts.req ? h`<span class="req">*</span>` : ""}</label>
      ${control}${opts.hint ? h`<span class="hint">${opts.hint}</span>` : ""}</div>`;
  }
  function text(name, value, attrs) {
    return h`<input type="text" id="f_${name}" name="${name}" value="${value || ""}" ${raw(attrs || "")}>`;
  }
  function dateInput(name, value, min) {
    return h`<input type="date" id="f_${name}" name="${name}" value="${value || ""}" ${min ? raw('min="' + min + '"') : ""}>`;
  }
  /** Date input + quick-pick chips (tomorrow / 3 days / next week). */
  function datePicker(name, value, withToday) {
    var t = App.today();
    var picks = (withToday ? [{ label: "היום", date: t }] : []).concat(MK.quickDates(t));
    return h`<div class="stack date-pick">
      <div class="chips" data-quick="${name}">${picks.map(function (q) {
        return h`<button type="button" class="chip ${q.date === value ? "on" : ""}" data-date="${q.date}">${q.label} <span class="faint small">${MK.fmtDate(q.date).slice(0, 5)}</span></button>`;
      })}</div>
      ${dateInput(name, value, t)}</div>`;
  }
  function wireDates(m) {
    m.$$("[data-quick]").forEach(function (box) {
      var input = m.$('[name="' + box.dataset.quick + '"]');
      function sync() { UI.$$("[data-date]", box).forEach(function (b) { b.classList.toggle("on", b.dataset.date === input.value); }); }
      box.addEventListener("click", function (e) {
        var b = e.target.closest("[data-date]");
        if (!b) return;
        input.value = b.dataset.date;
        sync();
      });
      input.addEventListener("input", sync);
    });
  }
  function tagChips(selected) {
    var sel = MK.splitIds(selected);
    var tags = MK.activeTags(App.state.db);
    // keep inactive tags that are already on the case
    MK.tagsOfCase(App.state.db, { tagIds: sel.join(",") }).forEach(function (t) { if (tags.indexOf(t) === -1) tags.push(t); });
    if (!tags.length) return h`<span class="muted small">אין תגיות. אפשר להוסיף במסך ההגדרות.</span>`;
    return h`<div class="chips">${tags.map(function (t) {
      return h`<label class="chip chip-check"><input type="checkbox" name="tagIds" value="${t.id}" ${sel.indexOf(t.id) !== -1 ? "checked" : ""}>${t.name}</label>`;
    })}</div>`;
  }
  function statusSeg(name, value) {
    return h`<div class="seg" role="radiogroup">${["ACTIVE", "WAITING"].map(function (s) {
      return h`<label class="seg-opt"><input type="radio" name="${name}" value="${s}" ${value === s ? "checked" : ""}><span>${MK.CASE_STATUS[s]}</span></label>`;
    })}</div>`;
  }
  function deptSelect(name, value) {
    return h`<select id="f_${name}" name="${name}"><option value="">ללא מחלקה</option>${Object.keys(MK.DEPARTMENTS).map(function (k) {
      return h`<option value="${k}" ${value === k ? "selected" : ""}>${MK.DEPARTMENTS[k]}</option>`;
    })}</select>`;
  }
  function contactSelect(name, value) {
    var list = (App.state.db.contacts || []).slice().sort(function (a, b) { return a.fullName < b.fullName ? -1 : 1; });
    return h`<select id="f_${name}" name="${name}"><option value="">ללא</option>${list.map(function (c) {
      return h`<option value="${c.id}" ${value === c.id ? "selected" : ""}>${c.fullName}${c.profession ? " · " + c.profession : ""}</option>`;
    })}</select>`;
  }
  function caseFieldsHtml(c) {
    return h`
      <div class="grid-2">
        ${field("שם התיק / האברך", text("fullName", c.fullName, 'autocomplete="off" maxlength="120"'), { req: true, for: "f_fullName" })}
        ${field("טלפון", h`<input type="tel" id="f_phone" name="phone" value="${c.phone || ""}" dir="ltr" style="text-align:right" maxlength="40">`, { for: "f_phone" })}
        ${field("עיר", text("city", c.city, 'maxlength="80"'), { for: "f_city" })}
        ${field("גורם מפנה", text("referredBy", c.referredBy, 'placeholder="גיס, מטפל, שכנים…" maxlength="200"'), { for: "f_referredBy" })}
        ${field("מי מכיר את התיק / ראש חבורה", text("knownBy", c.knownBy, 'maxlength="200"'), { for: "f_knownBy" })}
        ${field("תאריך פנייה ראשונה", dateInput("firstContactDate", c.firstContactDate), { for: "f_firstContactDate" })}
      </div>
      ${field("סיפור התיק", h`<textarea id="f_story" name="story" rows="4" placeholder="מה הסיפור, מה ידוע, מה עדיין לא ידוע">${c.story || ""}</textarea>`, { for: "f_story" })}
      ${field("נושאי טיפול", tagChips(c.tagIds))}
      <div class="row between" style="gap:16px">
        ${c.status === "CLOSED" ? "" : field("סטטוס", statusSeg("status", c.status || "ACTIVE"))}
        <label class="switch"><input type="checkbox" name="isUrgent" ${MK.bool(c.isUrgent) ? "checked" : ""}> תיק דחוף</label>
      </div>`;
  }
  function readCase(form) {
    return {
      fullName: UI.val(form, "fullName"), phone: UI.val(form, "phone"), city: UI.val(form, "city"),
      referredBy: UI.val(form, "referredBy"), knownBy: UI.val(form, "knownBy"),
      firstContactDate: UI.val(form, "firstContactDate"), story: UI.val(form, "story"),
      tagIds: UI.checkedValues(form, "tagIds"), isUrgent: UI.val(form, "isUrgent"),
      status: UI.val(form, "status") || undefined
    };
  }
  function foot(primary, extra) {
    return h`<button type="submit" class="btn btn-primary">${primary}</button>
      <button type="button" class="btn btn-ghost" data-close>ביטול</button>${extra || ""}`;
  }
  function caseName(task) {
    var c = task && task.caseId ? MK.byId(App.state.db.cases, task.caseId) : null;
    return c ? c.fullName : "";
  }

  // ------------------------------------------------------------ cases
  function newCase() {
    var t = App.today();
    UI.modal({
      title: "תיק חדש", sub: "כל תיק נפתח יחד עם המשימה הראשונה שלו", wide: true,
      body: h`<div class="stack">
        ${caseFieldsHtml({ firstContactDate: t, status: "ACTIVE" })}
        <div class="next-card" style="margin:6px 0 0">
          <div class="label">${icon("flag")} המשימה הראשונה</div>
          <div class="stack" style="margin-top:10px">
            ${field("מה צריך לעשות", text("firstTitle", "", 'placeholder="למשל: שיחת היכרות ראשונה" maxlength="300"'), { req: true, for: "f_firstTitle" })}
            ${field("תאריך יעד", datePicker("firstDue", t, true), { req: true })}
          </div>
        </div></div>`,
      foot: foot("פתיחת התיק"),
      onMount: wireDates,
      onSubmit: async function (m) {
        var res = await App.mutate("createCase", { case: readCase(m.form), firstTask: { title: UI.val(m.form, "firstTitle"), dueDate: UI.val(m.form, "firstDue") } });
        if (!res.ok) return UI.showErrors(m.form, res, { taskTitle: "firstTitle", taskDue: "firstDue" });
        m.close();
        UI.toast("התיק נפתח");
        App.go("#/case/" + encodeURIComponent(res.caseId));
      }
    });
  }

  function editCase(caseId) {
    var c = MK.byId(App.state.db.cases, caseId);
    if (!c) return;
    UI.modal({
      title: "עריכת תיק", sub: c.fullName, wide: true,
      body: h`<div class="stack">${caseFieldsHtml(c)}</div>`,
      foot: foot("שמירה"),
      onSubmit: async function (m) {
        var res = await App.mutate("updateCase", { id: caseId, case: readCase(m.form) }, "נשמר");
        if (!res.ok) return UI.showErrors(m.form, res);
        m.close();
      }
    });
  }

  async function toggleUrgent(caseId) {
    var c = MK.byId(App.state.db.cases, caseId);
    if (!c) return;
    var on = !MK.bool(c.isUrgent);
    var res = await App.mutate("updateCase", { id: caseId, case: { isUrgent: on } }, on ? "התיק סומן כדחוף" : "הסימון 'דחוף' הוסר");
    if (!res.ok) UI.toast(res.message || "השמירה נכשלה", true);
  }

  async function setStatus(caseId, status) {
    var res = await App.mutate("updateCase", { id: caseId, case: { status: status } }, "הסטטוס עודכן ל" + MK.CASE_STATUS[status]);
    if (!res.ok) UI.toast(res.message || "השמירה נכשלה", true);
  }

  function reopenCase(caseId) {
    var c = MK.byId(App.state.db.cases, caseId);
    if (!c) return;
    var t = App.today();
    UI.modal({
      title: "פתיחת התיק מחדש", sub: c.fullName,
      body: h`<div class="stack">
        <p class="muted small">תיק פתוח חייב משימה פתוחה. מה הצעד הבא?</p>
        ${field("המשימה הבאה", text("title", "", 'maxlength="300"'), { req: true, for: "f_title" })}
        ${field("תאריך יעד", datePicker("dueDate", t, true), { req: true })}</div>`,
      foot: foot("פתיחה מחדש"),
      onMount: wireDates,
      onSubmit: async function (m) {
        var res = await App.mutate("reopenCase", { caseId: caseId, title: UI.val(m.form, "title"), dueDate: UI.val(m.form, "dueDate") }, "התיק נפתח מחדש");
        if (!res.ok) return UI.showErrors(m.form, res);
        m.close();
      }
    });
  }

  // ------------------------------------------------------------ tasks
  /**
   * Closing a task. Case tasks: two steps in the same window -
   *  A. what was done (mandatory report), B. what's next (next task OR close the case).
   * Nothing is saved until the final step, so cancelling never leaves a task
   * marked done without a follow-up. The server saves everything in one go.
   */
  function completeTask(taskId) {
    var task = MK.byId(App.state.db.tasks, taskId);
    if (!task || MK.bool(task.isDone)) return;
    if (!task.caseId) return completeGeneral(task);
    var c = MK.byId(App.state.db.cases, task.caseId);
    var t = App.today();
    var step = 1;
    var m = UI.modal({
      title: "סגירת משימה", sub: c ? c.fullName : "", wide: false,
      body: h`
        <div class="steps"><div class="step on" data-step="1"><i>1</i>מה בוצע</div><div class="step" data-step="2"><i>2</i>מה הלאה</div></div>
        <div class="task-recap"><span class="muted small">המשימה:</span> <b>${task.title}</b></div>
        <div class="stack" data-pane="1">
          ${field("דיווח ביצוע", h`<textarea id="f_notes" name="notes" rows="5" placeholder="עם מי דיברת, מה נסגר, מה התקדם…" maxlength="5000"></textarea>`, { req: true, for: "f_notes", hint: "Ctrl+Enter להמשך" })}
          ${(App.state.db.contacts || []).length ? field("איש קשר (לא חובה)", contactSelect("contactId", task.contactId), { for: "f_contactId" }) : ""}
        </div>
        <div class="stack" data-pane="2" hidden>
          <div class="choice">
            <label><input type="radio" name="what" value="next" checked><div><b>משימה הבאה</b><span>התיק ממשיך</span></div></label>
            <label class="danger"><input type="radio" name="what" value="close"><div><b>סגירת התיק</b><span>הטיפול הסתיים</span></div></label>
          </div>
          <div class="stack" data-what="next">
            ${field("מה הצעד הבא", text("nextTitle", "", 'maxlength="300" placeholder="למשל: לחזור אליו ולעדכן"'), { req: true, for: "f_nextTitle" })}
            ${field("תאריך יעד", datePicker("nextDue", MK.addDays(t, 1)), { req: true })}
          </div>
          <div class="stack" data-what="close" hidden>
            ${field("סיבת הסגירה", text("closeReason", "", 'maxlength="500" placeholder="בקצרה"'), { req: true, for: "f_closeReason" })}
          </div>
        </div>`,
      foot: h``,
      onMount: function (m) {
        wireDates(m);
        m.form.addEventListener("change", function (e) {
          if (e.target.name !== "what") return;
          var w = UI.val(m.form, "what");
          m.$('[data-what="next"]').hidden = w !== "next";
          m.$('[data-what="close"]').hidden = w !== "close";
          setFoot();
          var f = m.$(w === "next" ? "#f_nextTitle" : "#f_closeReason");
          if (f) f.focus();
        });
      },
      onSubmit: async function (m) {
        if (step === 1) {
          if (!MK.str(UI.val(m.form, "notes"))) return UI.showErrors(m.form, { fields: { notes: "יש לכתוב מה בוצע" } });
          return goStep(2);
        }
        var what = UI.val(m.form, "what");
        var input = { taskId: taskId, notes: UI.val(m.form, "notes"), contactId: UI.val(m.form, "contactId") || "" };
        if (what === "next") input.next = { title: UI.val(m.form, "nextTitle"), dueDate: UI.val(m.form, "nextDue") };
        else input.closeCase = { reason: UI.val(m.form, "closeReason") };
        var res = await App.mutate("completeTask", input);
        if (!res.ok) {
          if (res.fields && (res.fields.notes || res.fields.contactId)) goStep(1);
          return UI.showErrors(m.form, res, { nextDue: "nextDue", nextTitle: "nextTitle", closeReason: "closeReason" });
        }
        m.close();
        UI.toast(what === "next" ? "המשימה נסגרה, והמשימה הבאה נקבעה" : "המשימה בוצעה והתיק נסגר");
      }
    });
    function setFoot() {
      if (step === 1) {
        m.setFoot(h`<button type="submit" class="btn btn-primary">המשך ${icon("chevron")}</button><button type="button" class="btn btn-ghost" data-close>ביטול</button>`);
      } else {
        var close = UI.val(m.form, "what") === "close";
        m.setFoot(h`<button type="submit" class="btn ${close ? "btn-danger" : "btn-good"}">${icon("check")} ${close ? "סגירת המשימה והתיק" : "שמירה"}</button>
          <button type="button" class="btn btn-ghost" id="backStep">חזרה</button>`);
        m.$("#backStep").onclick = function () { goStep(1); };
      }
    }
    function goStep(n) {
      step = n;
      UI.clearErrors(m.form);
      m.$('[data-pane="1"]').hidden = n !== 1;
      m.$('[data-pane="2"]').hidden = n !== 2;
      m.$('.step[data-step="1"]').className = "step " + (n === 1 ? "on" : "done");
      m.$('.step[data-step="2"]').className = "step " + (n === 2 ? "on" : "");
      setFoot();
      m.$(n === 1 ? "#f_notes" : (UI.val(m.form, "what") === "close" ? "#f_closeReason" : "#f_nextTitle")).focus();
    }
    setFoot();
  }

  function completeGeneral(task) {
    UI.modal({
      title: "סימון כבוצע", sub: task.project || (MK.DEPARTMENTS[task.department] || "משימה כללית"),
      body: h`<div class="stack"><div class="task-recap"><b>${task.title}</b></div>
        ${field("הערה (לא חובה)", h`<textarea id="f_notes" name="notes" rows="3" maxlength="5000"></textarea>`, { for: "f_notes" })}</div>`,
      foot: h`<button type="submit" class="btn btn-good">${icon("check")} בוצע</button><button type="button" class="btn btn-ghost" data-close>ביטול</button>`,
      onSubmit: async function (m) {
        var res = await App.mutate("completeTask", { taskId: task.id, notes: UI.val(m.form, "notes") }, "המשימה סומנה כבוצעה");
        if (!res.ok) return UI.showErrors(m.form, res);
        m.close();
      }
    });
  }

  function postponeTask(taskId) {
    var task = MK.byId(App.state.db.tasks, taskId);
    if (!task) return;
    var t = App.today();
    var name = caseName(task);
    UI.modal({
      title: "דחיית משימה", sub: name || "משימה כללית",
      body: h`<div class="stack">
        <div class="task-recap"><b>${task.title}</b><div class="small muted" style="margin-top:4px">
          תאריך נוכחי: ${MK.fmtDate(task.dueDate)}${MK.num(task.postponeCount) ? h` · נדחתה ${task.postponeCount} פעמים (במקור ${MK.fmtDate(task.originalDueDate)})` : ""}</div></div>
        ${field("לאיזה תאריך", datePicker("dueDate", task.dueDate < t ? t : MK.addDays(task.dueDate, 1)), { req: true })}</div>`,
      foot: foot("דחייה"),
      onMount: wireDates,
      onSubmit: async function (m) {
        var res = await App.mutate("postponeTask", { taskId: taskId, dueDate: UI.val(m.form, "dueDate") });
        if (!res.ok) return UI.showErrors(m.form, res);
        m.close();
        UI.toast("המשימה נדחתה לתאריך " + MK.fmtDate(UI.val(m.form, "dueDate")));
      }
    });
  }

  function editTask(taskId) {
    var task = MK.byId(App.state.db.tasks, taskId);
    if (!task) return;
    var general = !task.caseId;
    UI.modal({
      title: "עריכת משימה", sub: caseName(task) || "משימה כללית",
      body: h`<div class="stack">
        ${field("תיאור המשימה", text("title", task.title, 'maxlength="300"'), { req: true, for: "f_title" })}
        ${general ? h`<div class="grid-2">${field("מחלקה", deptSelect("department", task.department), { for: "f_department" })}
          ${field("פרויקט", text("project", task.project, 'list="projects" maxlength="120"'), { for: "f_project" })}</div>${projectList()}` : ""}
        <p class="small muted">כדי לשנות תאריך משתמשים ב"דחייה", כדי שהשינוי יירשם.</p></div>`,
      foot: foot("שמירה"),
      onSubmit: async function (m) {
        var input = { taskId: taskId, title: UI.val(m.form, "title") };
        if (general) { input.department = UI.val(m.form, "department"); input.project = UI.val(m.form, "project"); }
        var res = await App.mutate("updateTask", input, "נשמר");
        if (!res.ok) return UI.showErrors(m.form, res);
        m.close();
      }
    });
  }

  function projectList() {
    var names = { "קורס מדריכים": true };
    (App.state.db.tasks || []).forEach(function (t) { if (t.project) names[t.project] = true; });
    return h`<datalist id="projects">${Object.keys(names).map(function (n) { return h`<option value="${n}">`; })}</datalist>`;
  }

  function newGeneralTask() {
    var t = App.today();
    UI.modal({
      title: "משימה כללית", sub: "משימה שלא שייכת לתיק (מחלקה, פרויקט, קורס…)",
      body: h`<div class="stack">
        ${field("מה צריך לעשות", text("title", "", 'maxlength="300"'), { req: true, for: "f_title" })}
        ${field("תאריך יעד", datePicker("dueDate", t, true), { req: true })}
        <div class="grid-2">${field("מחלקה", deptSelect("department", ""), { for: "f_department" })}
          ${field("פרויקט", text("project", "", 'list="projects" maxlength="120" placeholder="לא חובה"'), { for: "f_project" })}</div>
        ${projectList()}</div>`,
      foot: foot("הוספה"),
      onMount: wireDates,
      onSubmit: async function (m) {
        var res = await App.mutate("createGeneralTask", {
          title: UI.val(m.form, "title"), dueDate: UI.val(m.form, "dueDate"),
          department: UI.val(m.form, "department"), project: UI.val(m.form, "project")
        }, "המשימה נוספה");
        if (!res.ok) return UI.showErrors(m.form, res);
        m.close();
      }
    });
  }

  // ------------------------------------------------------------ settings
  function editTag(tagId) {
    var tag = tagId ? MK.byId(App.state.db.tags, tagId) : null;
    UI.modal({
      title: tag ? "עריכת תגית" : "תגית חדשה",
      body: field("שם התגית", text("name", tag ? tag.name : "", 'maxlength="60"'), { req: true, for: "f_name" }),
      foot: foot("שמירה"),
      onSubmit: async function (m) {
        var res = await App.mutate("saveTag", { id: tagId || "", name: UI.val(m.form, "name") }, "נשמר");
        if (!res.ok) return UI.showErrors(m.form, res);
        m.close();
      }
    });
  }

  function editContact(contactId) {
    var c = contactId ? MK.byId(App.state.db.contacts, contactId) : {};
    UI.modal({
      title: contactId ? "עריכת איש קשר" : "איש קשר מקצועי חדש",
      body: h`<div class="stack"><div class="grid-2">
        ${field("שם מלא", text("fullName", c.fullName, 'maxlength="120"'), { req: true, for: "f_fullName" })}
        ${field("תחום", text("profession", c.profession, 'placeholder="מטפל, רב, יועץ…" maxlength="120"'), { for: "f_profession" })}
        ${field("טלפון", h`<input type="tel" id="f_phone" name="phone" value="${c.phone || ""}" dir="ltr" style="text-align:right" maxlength="40">`, { for: "f_phone" })}</div>
        ${field("הערות", h`<textarea id="f_notes" name="notes" rows="3" maxlength="2000">${c.notes || ""}</textarea>`, { for: "f_notes" })}</div>`,
      foot: foot("שמירה"),
      onSubmit: async function (m) {
        var res = await App.mutate("saveContact", { id: contactId || "", fullName: UI.val(m.form, "fullName"), profession: UI.val(m.form, "profession"), phone: UI.val(m.form, "phone"), notes: UI.val(m.form, "notes") }, "נשמר");
        if (!res.ok) return UI.showErrors(m.form, res);
        m.close();
      }
    });
  }

  function changePassword() {
    UI.modal({
      title: "שינוי סיסמה",
      body: h`<div class="stack">
        ${field("סיסמה נוכחית", h`<input type="password" id="f_current" name="current" autocomplete="current-password" dir="ltr">`, { req: true, for: "f_current" })}
        ${field("סיסמה חדשה", h`<input type="password" id="f_password" name="password" autocomplete="new-password" dir="ltr">`, { req: true, for: "f_password", hint: "לפחות 10 תווים, גם אותיות וגם ספרות" })}
        ${field("אימות סיסמה חדשה", h`<input type="password" id="f_password2" name="password2" autocomplete="new-password" dir="ltr">`, { req: true, for: "f_password2" })}</div>`,
      foot: foot("שמירה"),
      onSubmit: async function (m) {
        var pw = UI.val(m.form, "password");
        var weak = MK.passwordProblem(pw);
        if (weak) return UI.showErrors(m.form, { fields: { password: weak } });
        if (pw !== UI.val(m.form, "password2")) return UI.showErrors(m.form, { fields: { password2: "הסיסמאות לא זהות" } });
        var res = await App.call("changePassword", { current: UI.val(m.form, "current"), password: pw });
        if (!res.ok) return UI.showErrors(m.form, res.error === "bad_password" ? { fields: { current: res.message } } : res);
        App.setToken(res.token);
        m.close();
        UI.toast("הסיסמה עודכנה");
      }
    });
  }

  return { newCase: newCase, editCase: editCase, toggleUrgent: toggleUrgent, setStatus: setStatus, reopenCase: reopenCase,
    completeTask: completeTask, postponeTask: postponeTask, editTask: editTask, newGeneralTask: newGeneralTask,
    editTag: editTag, editContact: editContact, changePassword: changePassword };
})();
