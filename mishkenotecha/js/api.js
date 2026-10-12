/*
 * api.js - talks to the Apps Script backend, or to an in-browser demo backend.
 *
 * Real mode: every call is a POST with a JSON body (sent as text/plain so the
 * browser doesn't need a CORS preflight). Tokens travel in the body only.
 *
 * Demo mode (?demo=1, or automatically while no server is configured):
 * fictional data kept only in this browser. It runs the exact same MK rules
 * as the server, so everything behaves the same.
 */
var Api = (function () {
  "use strict";
  var url = (window.MK_CONFIG && window.MK_CONFIG.apiUrl) || "";
  var demo = !url || /[?&]demo=1\b/.test(location.search) || ssGet("mk_demo") === "1";
  if (demo && url) ssSet("mk_demo", "1");

  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  async function call(action, payload) {
    var body = Object.assign({ action: action }, payload || {});
    if (demo) return DemoBackend.handle(body);
    var res;
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow", credentials: "omit" });
    } catch (e) {
      return { ok: false, error: "network", message: "אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב." };
    }
    if (!res.ok) return { ok: false, error: "http_" + res.status, message: "השרת לא זמין כרגע (" + res.status + ")" };
    try { return await res.json(); } catch (e) { return { ok: false, error: "bad_response", message: "תשובה לא תקינה מהשרת" }; }
  }

  function exitDemo() { try { sessionStorage.removeItem("mk_demo"); } catch (e) { /* ignore */ } }

  return { call: call, isDemo: function () { return demo; }, hasServer: function () { return !!url; }, exitDemo: exitDemo };
})();

// ------------------------------------------------------------------ demo backend
var DemoBackend = (function () {
  "use strict";
  var KEY = "mk_demo_db_v1";
  var ME = { id: "demo_user", name: "מנהל לדוגמה", email: "demo@example.com", role: "ADMIN", isActive: true };

  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) { /* ignore */ }
    var d = seed(); save(d); return d;
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* ignore */ } }
  function reset() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  // Fictional data, dated relative to today.
  function seed() {
    var today = MK.todayYmd();
    var nowIso = new Date().toISOString();
    var day = function (n) { return MK.addDays(today, n); };
    var stamp = function (n) { return day(n) + "T09:00:00.000Z"; };
    var d = { users: [ME], tags: [], contacts: [], cases: [], tasks: [] };
    MK.DEFAULT_TAGS.forEach(function (name, i) { d.tags.push({ id: "tg" + (i + 1), name: name, sortOrder: i, isActive: true }); });
    d.contacts.push(
      { id: "ct1", fullName: "יועץ לדוגמה", profession: "יועץ", phone: "050-0000001", notes: "" },
      { id: "ct2", fullName: "מטפל לדוגמה", profession: "מטפל", phone: "050-0000002", notes: "" },
      { id: "ct3", fullName: "רב לדוגמה", profession: "רב", phone: "", notes: "" }
    );
    var n = 0;
    function addCase(c, history, open) {
      var id = "demo_c" + (++n);
      d.cases.push(Object.assign({ id: id, phone: "", city: "", referredBy: "", knownBy: "", story: "", tagIds: "", status: "ACTIVE", isUrgent: false,
        closedAt: "", closeReason: "", firstContactDate: day(-40), createdAt: stamp(-40), updatedAt: nowIso }, c));
      var prev = "", k = 0;
      (history || []).forEach(function (h) {
        var tid = id + "_t" + (++k);
        d.tasks.push({ id: tid, caseId: id, title: h[0], dueDate: day(h[1]), originalDueDate: day(h[1]), postponeCount: 0, isDone: true,
          completedAt: stamp(h[1]), completionNotes: h[2], contactId: h[3] || "", previousTaskId: prev, createdAt: stamp(h[1] - 3),
          department: "", project: "", assigneeId: ME.id, lastPostponedAt: "" });
        prev = tid;
      });
      if (open) {
        var oid = id + "_t" + (++k);
        d.tasks.push({ id: oid, caseId: id, title: open[0], dueDate: day(open[1]), originalDueDate: day(open[2] === undefined ? open[1] : open[2]),
          postponeCount: open[2] === undefined ? 0 : 1, isDone: false, completedAt: "", completionNotes: "", contactId: "", previousTaskId: prev,
          createdAt: stamp(-1), department: "", project: "", assigneeId: ME.id, lastPostponedAt: "" });
      }
    }
    addCase({ fullName: "כהן א. (דוגמה)", phone: "050-1234567", city: "בני ברק", referredBy: "גיס", knownBy: "ראש החבורה בכולל", tagIds: "tg1,tg4", isUrgent: true,
      story: "תיק לדוגמה בלבד.\nמה ידוע: פנה לבקשת ליווי צמוד בתקופה עמוסה.\nמה עוד לא ידוע: מי הגורם המקצועי שמלווה כיום." },
      [["שיחת היכרות ראשונה", -12, "שוחחנו כחצי שעה. הוסכם על ליווי שבועי וקבענו להתעדכן מול הגורם המקצועי.", ""],
       ["תיאום מול הגורם המקצועי", -6, "דובר עם המטפל. התקבלה תמונת מצב ראשונית, והוא ממליץ להמשיך במעקב צמוד.", "ct2"]],
      ["לחזור לאברך ולעדכן על ההמלצה", -2]);
    addCase({ fullName: "לוי ש. (דוגמה)", city: "ירושלים", referredBy: "שכנים", tagIds: "tg2,tg6",
      story: "תיק לדוגמה. מספר גורמים מעורבים ויש צורך בתיאום ביניהם." },
      [["פגישת היכרות", -20, "נפגשנו. הפנייה התקבלה, ונדרש בירור מול רב.", ""],
       ["שאלה לרב", -9, "השאלה הוצגה לרב והתקבלה תשובה. הועבר עדכון לאברך.", "ct3"]],
      ["שיחת מעקב אחרי התשובה", 0]);
    addCase({ fullName: "פרידמן מ. (דוגמה)", city: "בית שמש", referredBy: "מטפל", tagIds: "tg8", story: "תיק לדוגמה." },
      [["בירור צרכים", -5, "סוכם לקבוע תור אצל גורם מקצועי מתאים.", ""]],
      ["לקבוע תור אצל גורם מקצועי", 0, -3]);
    addCase({ fullName: "רוזנברג י. (דוגמה)", city: "אלעד", tagIds: "tg1", status: "WAITING", story: "תיק לדוגמה. ממתין לתשובה מהאברך." },
      [["שיחה ראשונה", -15, "האברך ביקש זמן לחשוב, ויחזור אלינו.", ""]],
      ["לבדוק אם חזר אלינו", 3]);
    addCase({ fullName: "גולדברג ד. (דוגמה)", city: "מודיעין עילית", referredBy: "ראש חבורה", tagIds: "tg3,tg1" },
      [], ["שיחת היכרות ראשונה", 1]);
    addCase({ fullName: "שטרן ח. (דוגמה)", city: "בני ברק", tagIds: "tg5", story: "תיק לדוגמה." },
      [["בירור ראשוני", -30, "התקבל מידע ראשוני.", ""], ["מעקב", -18, "המצב השתפר מאוד.", ""],
       ["שיחת סיכום", -4, "האברך מרגיש שהעניין הסתדר, ואין צורך בהמשך ליווי.", ""]], null);
    d.cases[d.cases.length - 1].status = "CLOSED";
    d.cases[d.cases.length - 1].closedAt = stamp(-4);
    d.cases[d.cases.length - 1].closeReason = "העניין הסתדר, אין צורך בהמשך";
    addCase({ fullName: "וייס ב. (דוגמה)", city: "ירושלים", tagIds: "tg4" },
      [["פגישה ראשונה", -8, "נקבע המשך טיפול.", "ct2"]], ["לוודא שהתחיל טיפול", 5]);

    function general(title, due, dept, project) {
      d.tasks.push({ id: "demo_g" + d.tasks.length, caseId: "", title: title, dueDate: day(due), originalDueDate: day(due), postponeCount: 0,
        isDone: false, completedAt: "", completionNotes: "", contactId: "", previousTaskId: "", createdAt: nowIso,
        department: dept, project: project || "", assigneeId: ME.id, lastPostponedAt: "" });
    }
    general("שיחת תיאום עם המדריכים לקראת הקורס", 0, "GROOM_INSTRUCTORS", "קורס מדריכים");
    general("לסגור מיקום לקורס", 4, "ADMIN_LOGISTICS", "קורס מדריכים");
    general("עדכון תזרים חודשי", -1, "FINANCE", "");
    return d;
  }

  function ok(o) { return Promise.resolve(Object.assign({ ok: true }, o || {})); }

  function handle(req) {
    var a = req.action;
    var d = load();
    switch (a) {
      case "status": return ok({ installed: true, hasUsers: true });
      case "login": case "setupAdmin": return ok({ token: "demo", user: ME });
      case "bootstrap": return ok({ db: d, me: ME, meta: { today: MK.todayYmd(), dbUrl: "" } });
      case "changePassword": return ok({ token: "demo" });
      case "mutate":
        var res = MK.run(req.op, d, req.input || {}, { userId: ME.id });
        if (res.ok) { MK.applyChanges(d, res.changes); save(d); }
        return Promise.resolve(res);
      case "resetDemo": reset(); return ok();
    }
    return Promise.resolve({ ok: false, error: "unknown_action" });
  }
  return { handle: handle, reset: reset };
})();
