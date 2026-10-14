/*
 * api.js - talks to the Apps Script backend, or to an in-browser demo backend.
 *
 * Real mode: every call is a POST with a JSON body (sent as text/plain so the
 * browser doesn't need a CORS preflight). Tokens travel in the body only.
 *
 * Demo mode (?demo=1, or automatically while no server is configured):
 * fictional data kept only in this browser. It runs the same MK rules as the server.
 */
var Api = (function () {
  "use strict";
  var url = (window.MK_CONFIG && window.MK_CONFIG.apiUrl) || "";
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  var demo = !url || /[?&]demo=1\b/.test(location.search) || ssGet("mk_demo") === "1";
  if (demo && url) { try { sessionStorage.setItem("mk_demo", "1"); } catch (e) { /* private mode */ } }

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

// ------------------------------------------------------------------ demo backend (fictional data only)
var DemoBackend = (function () {
  "use strict";
  var KEY = "mk_demo_v2";
  var ME = { id: "demo_user", name: "מנהל לדוגמה", email: "demo@example.com", role: "ADMIN", isActive: "true" };

  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) { /* ignore */ }
    var d = seed(); save(d); return d;
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* ignore */ } }

  function seed() {
    var t = MK.todayYmd(), now = Date.now();
    var day = function (n) { return MK.addDays(t, n); };
    var at = function (n, h) { return new Date(now + n * 864e5 - (h || 0) * 36e5).toISOString(); };
    var d = { users: [ME], cases: [], tasks: [], logs: [], documents: [] };
    function c(id, name, f) {
      d.cases.push(Object.assign({ id: id, name: name, phone: "", info: "", city: "", referredBy: "", knownBy: "", notes: "", story: "", status: "open",
        closeReason: "", firstContact: day(-10), createdAt: at(-10), updatedAt: at(0), folderId: "" }, f));
    }
    c("c1", "כהן א. (דוגמה)", { info: "צריך ליווי צמוד", city: "עיר א'", referredBy: "גיס", knownBy: "ראש החבורה (דוגמה)", firstContact: day(-40), createdAt: at(-40),
      notes: "לחזור אליו רק אחרי השעה 20:00", story: "תיק לדוגמה.\nמה ידוע: יש גורם מקצועי שמלווה.\nמה עוד לא ידוע: מה התוכנית." });
    c("c2", "לוי ש. (דוגמה)", { info: "צריך תשובה מרב", city: "עיר ב'", referredBy: "מטפל", knownBy: "רב לדוגמה", firstContact: day(-25), createdAt: at(-25) });
    c("c3", "רוזנברג י. (דוגמה)", { info: "ממתין לתשובה", city: "עיר ג'", referredBy: "שכנים", firstContact: day(-18), createdAt: at(-18), status: "waiting" });
    c("c4", "גולדברג ד. (דוגמה)", { city: "עיר ד'", referredBy: "ראש חבורה", firstContact: day(-3), createdAt: at(-3) });
    c("c5", "פרידמן מ. (דוגמה)", { info: "צריך לקבוע תור לגורם מקצועי", city: "עיר א'", referredBy: "מטפל", firstContact: day(-9), createdAt: at(-9) });
    c("c6", "שטרן ח. (דוגמה)", { city: "עיר ב'", firstContact: day(-60), createdAt: at(-60), status: "closed", closeReason: "העניין הסתדר" });
    d.logs.push({ id: "l1", caseId: "c1", text: "פנייה ראשונה דרך הגיס. נקבעה שיחת היכרות.", createdAt: at(-40), by: ME.id },
      { id: "l2", caseId: "c1", text: "שוחחתי עם ראש החבורה. לדבריו יש התקדמות, צריך להמשיך לעקוב.", createdAt: at(-9, 3), by: ME.id });
    d.documents.push({ id: "d1", caseId: "c1", name: "סיכום פגישה (דוגמה).pdf", note: "בהדגמה הקובץ לא נשמר", mime: "application/pdf", size: 184320, fileId: "", url: "", createdAt: at(-7), by: ME.id });
    var n = 0;
    function task(kind, title, due, f) {
      var opened = MK.addDays(due, -(2 + (++n) % 6)); if (opened > t) opened = t;
      d.tasks.push(Object.assign({ id: "t" + n, kind: kind, title: title, due: due, original: due, moved: 0, who: "", what: "", caseId: "", owner: "", dept: "",
        done: false, result: "", completedAt: "", note: "", createdAt: at(-1, n), createdBy: ME.id, openedAt: opened, steps: 1, prevId: "" }, f || {}));
    }
    task("people", "לבדוק עם יוסי אם שלח את הצעת המחיר", day(-2), { who: "יוסי (דוגמה)", what: "לשלוח הצעת מחיר לאולם", moved: 1, original: day(-4) });
    task("case", "לוודא שנקבע תור אצל הגורם המקצועי", day(-1), { caseId: "c1", owner: "ברוך (דוגמה)", openedAt: day(-21), steps: 3 });
    task("case", "תיאום מול המטפל", day(-6), { caseId: "c1", done: true, result: "done", completedAt: at(-6), note: "דובר עם המטפל. ממליץ להמשיך במעקב צמוד.", openedAt: day(-21), steps: 2 });
    task("case", "שיחת היכרות ראשונה", day(-12), { caseId: "c1", done: true, result: "done", completedAt: at(-12), note: "שוחחנו כחצי שעה, הוסכם על ליווי שבועי.", openedAt: day(-21) });
    task("case", "לשלוח את הסיכום לראש החבורה", day(-8), { caseId: "c1", owner: "ברוך (דוגמה)", done: true, result: "notdone", completedAt: at(-7), note: "לא הספיק, הועבר אליי." });
    task("mine", "להכין סדר יום לישיבת צוות", day(-1));
    task("org", "לאשר את תקציב הרבעון", t, { dept: "כספים" });
    task("mine", "להתקשר לרואה החשבון לגבי הדוח", t);
    task("people", "לוודא שדוד קבע פגישה עם המדריך", t, { who: "דוד (דוגמה)", what: "לקבוע פגישת היכרות" });
    task("case", "להכין שאלה ולהציג לרב", t, { caseId: "c2", owner: "חיים (דוגמה)" });
    task("case", "לעדכן את האברך בתשובה", day(2), { caseId: "c2" });
    task("people", "לבדוק אם אברהם החזיר את הטפסים החתומים", day(1), { who: "אברהם (דוגמה)", what: "להחזיר טפסים חתומים", openedAt: day(-12), steps: 2 });
    task("org", "לסגור מיקום לקורס המדריכים", day(3), { dept: "מדריכי חתנים" });
    task("case", "לבדוק אם האברך חזר אלינו", day(3), { caseId: "c3" });
    task("case", "שיחת היכרות ראשונה", day(1), { caseId: "c4" });
    task("case", "לקבוע תור לגורם מקצועי", t, { caseId: "c5", owner: "ברוך (דוגמה)" });
    task("people", "לעקוב אחרי שמואל: סיכום הפגישה", day(4), { who: "שמואל (דוגמה)", what: "לשלוח סיכום פגישה" });
    task("org", "להכין דוח פעילות לדירקטוריון", day(6), { dept: "דירקטוריון ובעלים" });
    task("mine", "להזמין כיבוד לאירוע", day(-3), { done: true, result: "done", completedAt: at(-3), note: "הוזמן" });
    return d;
  }

  function ok(o) { return Promise.resolve(Object.assign({ ok: true }, o || {})); }
  function handle(req) {
    var d = load();
    switch (req.action) {
      case "status": return ok({ installed: true, hasUsers: true });
      case "login": case "setupAdmin": return ok({ token: "demo", user: ME });
      case "bootstrap": return ok({ db: d, me: ME, meta: { today: MK.todayYmd(), dbUrl: "", driveUrl: "", maxUploadMb: MK.MAX_UPLOAD_MB } });
      case "changePassword": return ok({ token: "demo" });
      case "mutate":
        if (req.op === "addDocument") return Promise.resolve({ ok: false, error: "unknown_action" });
        return Promise.resolve(commit(d, MK.run(req.op, d, req.input || {}, { userId: ME.id })));
      case "uploadDocument":
        // Demo: the file itself is not kept; only the record is.
        return Promise.resolve(commit(d, MK.run("addDocument", d, { caseId: req.caseId, name: req.name, note: req.note || "בהדגמה הקובץ לא נשמר",
          mime: req.mime, size: Math.floor(String(req.data || "").length * 3 / 4) }, { userId: ME.id })));
      case "caseFolder": return ok({ url: "", demo: true });
      case "resetDemo": try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } return ok();
    }
    return Promise.resolve({ ok: false, error: "unknown_action" });
  }
  function commit(d, res) { if (res.ok) { MK.apply(d, res); save(d); } return res; }
  return { handle: handle };
})();
