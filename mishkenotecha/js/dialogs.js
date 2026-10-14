/* dialogs.js - every window: close / defer / edit a task, new / edit / close a case, documents, password. */
var Dialogs = (function () {
  "use strict";
  var esc = UI.esc, icon = UI.icon, $ = UI.$, $$ = UI.$$;
  function db() { return App.state.db; }
  function val(dlg, name) { var el = $('[name="' + name + '"]', dlg); return el ? el.value : ""; }
  function picked(dlg, name) { var el = $('[name="' + name + '"]:checked', dlg); return el ? el.value : ""; }
  var SAVE = function (label, cls) { return '<button type="submit" class="btn ' + (cls || "btn-good") + '">' + icon("check") + (label || "שמירה") + '</button><button type="button" class="btn btn-ghost" data-close>ביטול</button>'; };
  function choice(name, value, title, sub, checked) {
    return '<label class="choice"><input type="radio" name="' + name + '" value="' + value + '"' + (checked ? " checked" : "") + '><div><b>' + title + '</b><span>' + sub + '</span></div></label>';
  }

  // ================================================================ close a task
  /**
   *  mine / org: one tap, with "undo" on the toast.
   *  people: did they do it? If not, when to check again (the follow-up comes back that day).
   *  case: done / not done + details + what's next on the case (step, who, when), or no next step.
   */
  function complete(t) {
    var k = MK.kindOf(t), today = App.today();
    if (k === "mine" || k === "org") {
      App.act("completeTask", { id: t.id, result: "done" }, "סומן כבוצע", function () { App.act("undoTask", { id: t.id }); });
      return;
    }
    if (k === "people") {
      UI.dialog({
        title: "בדקתי עם " + t.who, sub: t.title,
        body: (t.what ? '<div class="note">מחכה ל: ' + esc(t.what) + '</div>' : "") +
          '<div class="choices">' + choice("res", "done", "זה בוצע", "המעקב נסגר", true) + choice("res", "notdone", "עוד לא", "לבדוק שוב בתאריך אחר") + '</div>' +
          '<div class="field"><label for="f_note">מה נאמר (לא חובה)</label><textarea id="f_note" name="note" rows="3" placeholder="למשל: אמר שישלח עד יום חמישי"></textarea></div>' +
          '<div class="field" data-again hidden><label>מתי לבדוק שוב</label>' + UI.dateChips("next", MK.addDays(today, 2), today) + '</div>',
        foot: SAVE(),
        onMount: function (dlg) {
          UI.wireChips(dlg);
          dlg.addEventListener("change", function (e) { if (e.target.name === "res") $("[data-again]", dlg).hidden = e.target.value !== "notdone"; });
        },
        onSubmit: async function (dlg) {
          var again = picked(dlg, "res") === "notdone";
          var res = await App.act("completeTask", { id: t.id, result: again ? "notdone" : "done", note: val(dlg, "note") || (again ? "עוד לא בוצע" : ""), next: again ? { due: val(dlg, "next") } : null });
          if (!res.ok) return UI.fail(dlg, res);
          UI.close();
          UI.toast(again ? "נבדוק שוב עם " + t.who + " ב-" + MK.fmtDate(val(dlg, "next")) : "המעקב אחרי " + t.who + " נסגר", function () { App.act("undoTask", { id: t.id }); });
        }
      });
      return;
    }
    var c = MK.byId(db().cases, t.caseId);
    UI.dialog({
      title: (t.owner ? "מעקב: " + t.owner : "טיפלתי") + (c ? " · " + c.name : ""), sub: t.title,
      body: '<div class="field"><label>מה קרה</label><div class="choices">' + choice("res", "done", "בוצע", "המשימה נעשתה", true) + choice("res", "notdone", "לא בוצע", "נרשם בהיסטוריה כ\"לא בוצע\"") + '</div></div>' +
        '<div class="field"><label for="f_note">פירוט (לא חובה)</label><textarea id="f_note" name="note" rows="3" placeholder="עם מי דיברת, מה התקדם, למה לא בוצע…"></textarea></div>' +
        '<div class="field"><label>מה הלאה בתיק</label><div class="choices">' + choice("next", "yes", "יש צעד הבא", "מה, מי ומתי", true) + choice("next", "no", "אין צעד הבא כרגע", "בלי משימה חדשה") + '</div></div>' +
        '<div class="kbox k-case" data-nextbox><div style="grid-column:1/-1"><label for="f_nt">הצעד הבא</label><input type="text" id="f_nt" name="nt" maxlength="300" placeholder="למשל: לחזור אליו ולעדכן"></div>' +
          '<div><label for="f_no">מי מטפל</label><input type="text" id="f_no" name="no" list="peopleList" value="' + esc(t.owner) + '" placeholder="ריק = אני" maxlength="80" autocomplete="off"></div>' +
          '<div><label>מתי</label>' + UI.dateChips("nd", MK.addDays(today, 1), today) + '</div></div>' + Pages.peopleList(),
      foot: SAVE(),
      onMount: function (dlg) {
        UI.wireChips(dlg);
        dlg.addEventListener("change", function (e) {
          if (e.target.name === "next") $("[data-nextbox]", dlg).hidden = e.target.value !== "yes";
          if (e.target.name === "res" && e.target.value === "notdone" && !val(dlg, "nt")) $("[name=nt]", dlg).value = t.title;
        });
      },
      onSubmit: async function (dlg) {
        var hasNext = picked(dlg, "next") === "yes", r = picked(dlg, "res");
        if (hasNext && !MK.str(val(dlg, "nt"))) return UI.fail(dlg, "כתבו מה הצעד הבא", "[name=nt]");
        var res = await App.act("completeTask", { id: t.id, result: r, note: val(dlg, "note"),
          next: hasNext ? { title: val(dlg, "nt"), due: val(dlg, "nd"), owner: val(dlg, "no") } : null });
        if (!res.ok) return UI.fail(dlg, res);
        UI.close();
        UI.toast((r === "done" ? "נרשם: בוצע" : "נרשם: לא בוצע") + (hasNext ? ". הצעד הבא נקבע ל" + MK.fmtDate(val(dlg, "nd")) : ""), function () { App.act("undoTask", { id: t.id }); });
      }
    });
  }

  function postpone(t) {
    var today = App.today(), start = t.due < today ? MK.addDays(today, 1) : MK.addDays(t.due, 1);
    UI.dialog({
      title: "דחיית משימה", sub: t.title,
      body: '<div class="field"><label>לאיזה תאריך</label>' + UI.dateChips("due", start, today, t.due < today) + '</div>' +
        (MK.num(t.moved) ? '<p class="muted-p">כבר נדחתה ' + (MK.num(t.moved) === 1 ? "פעם אחת" : t.moved + " פעמים") + ' · במקור ל-' + MK.fmtDate(t.original) + '</p>' : ""),
      foot: '<button type="submit" class="btn btn-primary">' + icon("clock") + 'דחייה</button><button type="button" class="btn btn-ghost" data-close>ביטול</button>',
      onMount: UI.wireChips,
      onSubmit: async function (dlg) {
        var d = val(dlg, "due");
        var res = await App.act("postponeTask", { id: t.id, due: d });
        if (!res.ok) return UI.fail(dlg, res);
        UI.close();
        UI.toast("נדחה ל" + (d === MK.addDays(today, 1) ? "מחר" : "תאריך " + MK.fmtDate(d)));
      }
    });
  }

  function editTask(t) {
    var state = { kind: MK.kindOf(t), who: t.who, what: t.what, caseId: t.caseId, owner: t.owner, dept: t.dept };
    function readKind(dlg) { $$("[data-kf] [data-f]", dlg).forEach(function (el) { state[el.dataset.f] = el.value; }); }
    var o = t.openedAt || MK.todayYmd(t.createdAt);
    UI.dialog({
      title: "עריכת משימה", sub: "נפתחה לראשונה ב-" + MK.fmtDate(o) + (MK.num(t.steps) > 1 ? " · סבב " + t.steps : ""),
      body: '<div class="field"><label for="f_title">מה צריך לעשות</label><input type="text" id="f_title" name="title" value="' + esc(t.title) + '" maxlength="300"></div>' +
        '<div class="add-opts" role="group" aria-label="סוג המשימה"><span class="kind-label">סוג:</span>' +
          MK.KIND_ORDER.map(function (k) { return '<button type="button" class="chip k-' + k + (state.kind === k ? " on" : "") + '" data-ek="' + k + '">' + icon(MK.KINDS[k].icon) + MK.KINDS[k].short + '</button>'; }).join("") + '</div>' +
        '<div data-kf>' + Pages.kindFields(state.kind, state, "ed") + '</div>' + Pages.peopleList(),
      foot: SAVE("שמירה", "btn-primary") + '<button type="button" class="btn btn-ghost" id="delBtn" style="margin-inline-start:auto;color:var(--bad)">' + icon("trash") + 'מחיקה</button>',
      onMount: function (dlg) {
        dlg.addEventListener("click", function (e) {
          var b = e.target.closest("[data-ek]"); if (!b) return;
          readKind(dlg); state.kind = b.dataset.ek;
          $$("[data-ek]", dlg).forEach(function (c) { c.classList.toggle("on", c === b); });
          $("[data-kf]", dlg).innerHTML = Pages.kindFields(state.kind, state, "ed");
          var f = $("[data-kf] input, [data-kf] select", dlg); if (f) f.focus();
        });
        var del = $("#delBtn", dlg), armed = false;
        del.addEventListener("click", async function () {
          if (!armed) { armed = true; del.textContent = "ללחוץ שוב למחיקה"; return; }
          var res = await App.act("deleteTask", { id: t.id });
          if (!res.ok) return UI.fail(dlg, res);
          UI.close(); UI.toast("המשימה נמחקה");
        });
      },
      onSubmit: async function (dlg) {
        readKind(dlg);
        var res = await App.act("updateTask", { id: t.id, kind: state.kind, title: val(dlg, "title"), who: state.who, what: state.what, caseId: state.caseId, owner: state.owner, dept: state.dept });
        if (!res.ok) return UI.fail(dlg, res);
        UI.close(); UI.toast("נשמר");
      }
    });
  }

  // ================================================================ cases
  function caseFields(c) {
    var today = App.today();
    var f = function (id, label, v, ph, wide, type) {
      return '<div class="field' + (wide ? " span2" : "") + '"><label for="cf_' + id + '">' + label + '</label><input type="' + (type || "text") + '" id="cf_' + id + '" name="' + id + '" value="' + esc(v) + '" placeholder="' + (ph || "") + '" maxlength="300"' + (type === "tel" ? ' dir="ltr" style="text-align:right"' : "") + '></div>';
    };
    return '<div class="grid2">' + f("name", "שם התיק / האברך *", c.name) + f("city", "עיר", c.city) +
      f("info", "נתונים חשובים", c.info, "בשורה אחת: מה הכי חשוב לדעת", true) +
      f("referredBy", "מפנה", c.referredBy, "גיס, מטפל, שכנים…") + f("knownBy", "מכיר את התיק / ראש חבורה", c.knownBy) +
      f("phone", "טלפון", c.phone, "", false, "tel") +
      '<div class="field"><label for="cf_firstContact">תאריך פנייה ראשונה</label><input type="date" id="cf_firstContact" name="firstContact" value="' + (c.firstContact || today) + '" max="' + today + '"></div>' +
      '<div class="field span2"><label for="cf_notes">הערות חשובות</label><textarea id="cf_notes" name="notes" rows="2">' + esc(c.notes) + '</textarea></div>' +
      '<div class="field span2"><label for="cf_story">סיפור התיק</label><textarea id="cf_story" name="story" rows="4" placeholder="מה הסיפור, מה ידוע, מה עדיין לא ידוע">' + esc(c.story) + '</textarea></div></div>';
  }
  function readCase(dlg) {
    var o = {};
    ["name", "phone", "city", "info", "referredBy", "knownBy", "firstContact", "notes", "story"].forEach(function (k) { o[k] = val(dlg, k); });
    return o;
  }
  function newCase() {
    var today = App.today();
    UI.dialog({
      title: "תיק חדש", sub: "כל תיק נפתח יחד עם המשימה הראשונה שלו", wide: true,
      body: caseFields({ firstContact: today }) +
        '<div class="kbox k-case"><div style="grid-column:1/-1"><label for="f_ft">המשימה הראשונה *</label><input type="text" id="f_ft" name="ft" maxlength="300" placeholder="למשל: שיחת היכרות ראשונה"></div>' +
        '<div><label for="f_fo">מי מטפל</label><input type="text" id="f_fo" name="fo" list="peopleList" placeholder="ריק = אני" maxlength="80" autocomplete="off"></div>' +
        '<div><label>מתי</label>' + UI.dateChips("fd", today, today, true) + '</div></div>' + Pages.peopleList(),
      foot: '<button type="submit" class="btn btn-primary">' + icon("plus") + 'פתיחת התיק</button><button type="button" class="btn btn-ghost" data-close>ביטול</button>',
      onMount: UI.wireChips,
      onSubmit: async function (dlg) {
        var res = await App.act("createCase", { "case": readCase(dlg), firstTask: { title: val(dlg, "ft"), owner: val(dlg, "fo"), due: val(dlg, "fd") } });
        if (!res.ok) return UI.fail(dlg, res, res.fields && res.fields.name ? "[name=name]" : res.fields && res.fields.ftTitle ? "[name=ft]" : null);
        UI.close();
        App.go("#/case/" + encodeURIComponent(res.id));
        UI.toast("התיק נפתח");
      }
    });
  }
  function editCase(c) {
    UI.dialog({
      title: "עריכת פרטי התיק", sub: c.name, wide: true, body: caseFields(c), foot: SAVE("שמירה", "btn-primary"),
      onSubmit: async function (dlg) {
        var res = await App.act("updateCase", { id: c.id, "case": readCase(dlg) });
        if (!res.ok) return UI.fail(dlg, res);
        UI.close(); UI.toast("הפרטים נשמרו");
      }
    });
  }
  function closeCase(c) {
    var open = MK.caseTasks(db(), c.id).filter(function (t) { return !MK.isDone(t); }).length;
    UI.dialog({
      title: "סגירת התיק", sub: c.name,
      body: '<div class="field"><label for="f_reason">סיבת הסגירה</label><input type="text" id="f_reason" name="reason" maxlength="300" placeholder="בקצרה"></div>' +
        (open ? '<p class="muted-p">יש בתיק ' + open + ' משימות פתוחות. הן יירשמו כ"לא בוצע" ויוסרו מהיומן.</p>' : ""),
      foot: '<button type="submit" class="btn btn-primary">סגירת התיק</button><button type="button" class="btn btn-ghost" data-close>ביטול</button>',
      onSubmit: async function (dlg) {
        var res = await App.act("setCaseStatus", { id: c.id, status: "closed", reason: val(dlg, "reason") });
        if (!res.ok) return UI.fail(dlg, res, "[name=reason]");
        UI.close(); UI.toast("התיק נסגר");
      }
    });
  }

  // ================================================================ documents
  function upload(c, preset) {
    var max = (App.state.meta.maxUploadMb || MK.MAX_UPLOAD_MB), file = null;
    UI.dialog({
      title: "הוספת מסמך", sub: c.name,
      body: '<label class="drop" id="drop" tabindex="0"><input type="file" id="f_file" hidden><b>בחירת קובץ</b>או לגרור לכאן · עד ' + max + 'MB · PDF, תמונה, Word וכל קובץ אחר</label>' +
        '<div class="file-pick" id="picked" hidden></div>' +
        '<div class="field"><label for="f_note">תיאור (לא חובה)</label><input type="text" id="f_note" name="note" maxlength="500" placeholder="למשל: טופס חתום, סיכום פגישה"></div>' +
        (Api.isDemo() ? '<p class="muted-p">במצב הדגמה הקובץ עצמו לא נשמר, רק הרישום שלו.</p>' : '<p class="muted-p">הקובץ יישמר בגוגל דרייב, בתיקייה של התיק.</p>') +
        '<div class="progress" id="prog" hidden><i></i></div>',
      foot: '<button type="submit" class="btn btn-primary">' + icon("upload") + 'העלאה</button><button type="button" class="btn btn-ghost" data-close>ביטול</button>',
      onMount: function (dlg) {
        var input = $("#f_file", dlg), drop = $("#drop", dlg);
        function pick(f) {
          if (!f) return;
          if (f.size > max * 1024 * 1024) { file = null; return UI.fail(dlg, "הקובץ גדול מדי (עד " + max + "MB)"); }
          file = f;
          $(".d-body > .error", dlg).hidden = true;
          var p = $("#picked", dlg);
          p.innerHTML = '<div class="doc-ic">' + esc(UI.fileBadge(f.name, f.type)) + '</div><div class="doc-name">' + esc(f.name) + '<div class="doc-meta">' + MK.fileSize(f.size) + '</div></div>';
          p.hidden = false;
          $("#f_note", dlg).focus();
        }
        input.addEventListener("change", function () { pick(input.files[0]); });
        drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
        ["dragover", "dragenter"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
        ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove("over"); }); });
        drop.addEventListener("drop", function (e) { e.preventDefault(); pick(e.dataTransfer.files[0]); });
        if (preset) pick(preset);
      },
      onSubmit: async function (dlg) {
        if (!file) return UI.fail(dlg, "בחרו קובץ");
        $("#prog", dlg).hidden = false;
        var data;
        try { data = await UI.readBase64(file); } catch (e) { $("#prog", dlg).hidden = true; return UI.fail(dlg, "לא ניתן לקרוא את הקובץ"); }
        var res = await App.call("uploadDocument", { caseId: c.id, name: file.name, mime: file.type, data: data, note: val(dlg, "note") });
        $("#prog", dlg).hidden = true;
        if (!res.ok) return UI.fail(dlg, res);
        App.merge(res);
        UI.close();
        UI.toast(Api.isDemo() ? "המסמך נרשם (הדגמה)" : "המסמך נשמר בדרייב");
      }
    });
  }
  function removeDoc(d) {
    UI.dialog({
      title: "הסרת מסמך", sub: d.name,
      body: '<p class="muted-p">המסמך יוסר מהתיק' + (d.fileId ? ', והקובץ יעבור לסל האשפה בגוגל דרייב (אפשר לשחזר משם 30 יום).' : ".") + '</p>',
      foot: '<button type="submit" class="btn btn-primary" style="background:var(--bad)">' + icon("trash") + 'הסרה</button><button type="button" class="btn btn-ghost" data-close>ביטול</button>',
      onSubmit: async function (dlg) {
        var res = await App.act("removeDocument", { id: d.id });
        if (!res.ok) return UI.fail(dlg, res);
        UI.close(); UI.toast("המסמך הוסר");
      }
    });
  }

  // ================================================================ account
  function changePassword() {
    UI.dialog({
      title: "שינוי סיסמה",
      body: '<div class="field"><label for="f_cur">סיסמה נוכחית</label><input type="password" id="f_cur" name="current" autocomplete="current-password" dir="ltr"></div>' +
        '<div class="field"><label for="f_pw">סיסמה חדשה</label><input type="password" id="f_pw" name="password" autocomplete="new-password" dir="ltr"><span class="muted-p">לפחות 10 תווים, גם אותיות וגם ספרות</span></div>' +
        '<div class="field"><label for="f_pw2">אימות</label><input type="password" id="f_pw2" name="password2" autocomplete="new-password" dir="ltr"></div>',
      foot: SAVE("שמירה", "btn-primary"),
      onMount: function (dlg) { setTimeout(function () { $("#f_cur", dlg).focus(); }, 30); },
      onSubmit: async function (dlg) {
        var pw = val(dlg, "password"), weak = MK.passwordProblem(pw);
        if (weak) return UI.fail(dlg, weak, "[name=password]");
        if (pw !== val(dlg, "password2")) return UI.fail(dlg, "הסיסמאות לא זהות", "[name=password2]");
        var res = await App.call("changePassword", { current: val(dlg, "current"), password: pw });
        if (!res.ok) return UI.fail(dlg, res);
        App.setToken(res.token);
        UI.close(); UI.toast("הסיסמה עודכנה");
      }
    });
  }

  return { complete: complete, postpone: postpone, editTask: editTask, newCase: newCase, editCase: editCase, closeCase: closeCase,
    upload: upload, removeDoc: removeDoc, changePassword: changePassword };
})();
