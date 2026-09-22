/*
 * email-templates.js - the designed client e-mails.
 * Used by the admin app (live preview) and by the Apps Script backend (sending).
 * Email-client-safe HTML: tables + inline styles, RTL, no external CSS.
 */
var EmailTemplates = (function () {
  "use strict";

  var C = {
    gold: "#B8935A", goldDeep: "#96723F", goldLight: "#E4C9AE", ink: "#201A14",
    cream: "#FAF7F1", cream2: "#F2E9DA", muted: "#7C6F5D", border: "#E6DCC7", good: "#4C7A5E", warn: "#B85C38"
  };
  var FONT = "Heebo, Arial, 'Segoe UI', sans-serif";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function money(n) { return Core.fmtMoney(n); }
  function dayName(s) { var d = Core.toDate(s); return d ? "יום " + Core.HE_DAYS[d.getDay()] : ""; }
  function when(s) {
    if (!s) return "";
    var t = Core.fmtTime(s);
    return dayName(s) + ", " + Core.fmtDate(s) + (t ? " בשעה " + t : "");
  }
  function firstName(client) {
    var parts = String((client && client.name) || "").replace(/\s*-.*$/, "").trim().split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(" ") : parts[0] || "";
  }

  function button(label, url) {
    if (!url || !/^https?:\/\//i.test(String(url))) return "";
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px auto 6px;"><tr>' +
      '<td align="center" bgcolor="' + C.goldDeep + '" style="border-radius:999px;">' +
      '<a href="' + esc(url) + '" target="_blank" style="display:inline-block;padding:13px 34px;font-family:' + FONT +
      ';font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;background:' + C.goldDeep + ';">' +
      esc(label) + '</a></td></tr></table>';
  }
  function heading(text) {
    return '<h2 style="margin:26px 0 10px;font-family:' + FONT + ';font-size:17px;color:' + C.goldDeep +
      ';border-bottom:1px solid ' + C.border + ';padding-bottom:6px;">' + esc(text) + '</h2>';
  }
  function para(html) {
    return '<p style="margin:0 0 12px;font-family:' + FONT + ';font-size:15.5px;line-height:1.75;color:' + C.ink + ';">' + html + '</p>';
  }
  function bullets(items) {
    if (!items.length) return "";
    return '<ul style="margin:0 0 12px;padding:0 20px 0 0;font-family:' + FONT + ';font-size:15px;line-height:1.8;color:' + C.ink + ';">' +
      items.map(function (i) { return '<li style="margin-bottom:4px;">' + i + '</li>'; }).join("") + '</ul>';
  }
  // Free text -> structured list: plain lines become bold topics, lines that
  // start with "-", "*" or "•" become sub-items under the previous topic.
  function structured(text) {
    var lines = String(text || "").split(/\r?\n/).map(function (l) { return l.replace(/\s+$/, ""); }).filter(function (l) { return l.trim(); });
    if (!lines.length) return "";
    var html = "", open = false;
    lines.forEach(function (l) {
      var sub = /^\s*[-*•·]\s*/.test(l);
      var txt = esc(l.replace(/^\s*[-*•·]\s*/, "").replace(/^\s*\d+[.)]\s*/, ""));
      if (sub) {
        if (!open) { html += '<ul style="margin:2px 0 10px;padding:0 22px 0 0;color:' + C.ink + ';">'; open = true; }
        html += '<li style="margin-bottom:3px;font-size:14.5px;line-height:1.7;">' + txt + '</li>';
      } else {
        if (open) { html += '</ul>'; open = false; }
        html += '<div style="margin:10px 0 4px;font-weight:700;font-size:15.5px;color:' + C.ink + ';">' + txt + '</div>';
      }
    });
    if (open) html += '</ul>';
    return '<div style="font-family:' + FONT + ';">' + html + '</div>';
  }
  function box(inner, bg) {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0;"><tr><td style="background:' +
      (bg || C.cream) + ';border:1px solid ' + C.border + ';border-radius:12px;padding:16px 18px;font-family:' + FONT + ';">' + inner + '</td></tr></table>';
  }
  function kvTable(rows) {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:' + FONT + ';font-size:14.5px;">' +
      rows.map(function (r, i) {
        return '<tr><td style="padding:9px 12px;border-bottom:1px solid ' + C.border + ';color:' + C.muted + ';width:45%;' + (i % 2 ? '' : 'background:#fff;') + '">' + esc(r[0]) +
          '</td><td style="padding:9px 12px;border-bottom:1px solid ' + C.border + ';color:' + C.ink + ';font-weight:700;' + (i % 2 ? '' : 'background:#fff;') + (r[2] ? 'color:' + r[2] + ';' : '') + '">' + r[1] + '</td></tr>';
      }).join("") + '</table>';
  }
  function progress(used, total) {
    var pct = total > 0 ? Math.max(0, Math.min(100, Math.round(used / total * 100))) : 0;
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 2px;"><tr>' +
      (pct > 0 ? '<td width="' + pct + '%" style="background:' + C.gold + ';height:10px;border-radius:999px;font-size:0;line-height:0;">&nbsp;</td>' : '') +
      (pct < 100 ? '<td style="background:' + C.cream2 + ';height:10px;border-radius:999px;font-size:0;line-height:0;">&nbsp;</td>' : '') +
      '</tr></table>';
  }

  function layout(st, preheader, title, body) {
    return '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + esc(title) + '</title></head><body style="margin:0;padding:0;background:' + C.cream + ';direction:rtl;">' +
      '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + esc(preheader) + '</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + C.cream + ';"><tr><td align="center" style="padding:28px 12px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid ' + C.border + ';border-radius:18px;overflow:hidden;" dir="rtl">' +
      '<tr><td style="height:5px;background:' + C.gold + ';font-size:0;line-height:0;">&nbsp;</td></tr>' +
      '<tr><td style="padding:26px 30px 6px;text-align:right;font-family:' + FONT + ';">' +
      '<div style="font-size:12.5px;color:' + C.muted + ';letter-spacing:.3px;margin-bottom:4px;">' + esc(st.businessName || st.coachName || "") + '</div>' +
      '<h1 style="margin:0;font-family:\'Frank Ruhl Libre\',Georgia,serif;font-size:25px;line-height:1.35;color:' + C.ink + ';">' + esc(title) + '</h1>' +
      '</td></tr><tr><td style="padding:14px 30px 26px;text-align:right;">' + body + '</td></tr>' +
      '<tr><td style="padding:16px 30px 22px;border-top:1px solid ' + C.border + ';background:' + C.cream + ';font-family:' + FONT + ';font-size:12.5px;color:' + C.muted + ';line-height:1.7;text-align:right;">' +
      'בברכה,<br><strong style="color:' + C.ink + ';">' + esc(st.coachName || "") + '</strong><br>' +
      (st.siteUrl ? '<a href="' + esc(st.siteUrl) + '" style="color:' + C.goldDeep + ';text-decoration:none;">' + esc(String(st.siteUrl).replace(/^https?:\/\//, "")) + '</a><br>' : '') +
      '<span style="font-size:11.5px;">המייל נשלח אליך באופן אישי. המידע בו מיועד לך בלבד.</span>' +
      '</td></tr></table></td></tr></table></body></html>';
  }

  var T = {};

  // 1. Welcome / system opened
  T.welcome = function (x) {
    var body = para("שלום " + esc(firstName(x.client)) + ",") +
      para("שמח לבשר שפתחנו עבורך אזור אישי במערכת - מקום אחד מסודר שבו אפשר לראות בכל רגע:") +
      bullets([
        "<strong>איפה אוחזים בתהליך</strong> - כמה פגישות התקיימו וכמה נותרו",
        "<strong>מתי הפגישה הבאה</strong> - ואפשרות לבקש לקבוע פגישה",
        "<strong>סיכומי הפגישות</strong> - נקודות, החלטות ושיעורי בית",
        "<strong>מצב התשלומים</strong> - מה שולם ומה נשאר",
        "<strong>יצירת קשר</strong> - לכתוב לי ישירות, כולל צילום מסך או קובץ"
      ]) +
      (x.setupUrl ? para("כדי להיכנס בפעם הראשונה יש לבחור סיסמה אישית:") + button("בחירת סיסמה וכניסה", x.setupUrl) +
        '<p style="text-align:center;margin:0 0 14px;font-family:' + FONT + ';font-size:12.5px;color:' + C.muted + ';">הקישור תקף ל-' + esc(x.validity || "7 ימים") + '</p>'
        : button("כניסה לאזור האישי", x.portalUrl)) +
      box('<div style="font-size:14px;color:' + C.muted + ';line-height:1.7;">המערכת חדשה ונמצאת בתהליך למידה ושיפור. אם משהו לא ברור או שחסר לך משהו - אשמח מאוד לשמוע.</div>');
    return { subject: "בסיעתא דשמיא - פתחנו עבורך אזור אישי", html: layout(x.st, "האזור האישי שלך מוכן", "בסיעתא דשמיא, פתחנו את המערכת!", body) };
  };

  // 2. Choose / reset password
  T.password = function (x) {
    var body = para("שלום " + esc(firstName(x.client)) + ",") +
      para("לבחירת סיסמה חדשה לאזור האישי יש ללחוץ על הכפתור:") +
      button("בחירת סיסמה", x.setupUrl) +
      '<p style="text-align:center;margin:0 0 14px;font-family:' + FONT + ';font-size:12.5px;color:' + C.muted + ';">הקישור תקף ל-' + esc(x.validity || "שעה") + ' בלבד.</p>' +
      para('<span style="font-size:13.5px;color:' + C.muted + ';">אם לא ביקשת לבחור סיסמה - אפשר להתעלם מהמייל, דבר לא ישתנה.</span>');
    return { subject: "בחירת סיסמה לאזור האישי", html: layout(x.st, "קישור לבחירת סיסמה", "בחירת סיסמה", body) };
  };

  // 3. Reminder to book the next session
  T.reminder = function (x) {
    var last = x.account && x.account.lastHeld;
    var body = para("שלום " + esc(firstName(x.client)) + ",") +
      para(last ? "מאז הפגישה שלנו ב" + esc(when(last.date).split(" בשעה")[0]) + ", עדיין לא קבענו את הפגישה הבאה." :
        "עדיין לא קבענו את הפגישה הבאה שלנו.") +
      para("כדי לשמור על הרצף וההתקדמות - אפשר לבחור מועד נוח ישירות מהאזור האישי:") +
      button("קביעת הפגישה הבאה", x.bookingUrl || x.portalUrl) +
      (x.account && x.account.currentPackage ? box('<div style="font-size:14px;color:' + C.ink + ';">נותרו בסל: <strong>' +
        Core.round2(x.account.currentPackage.remaining) + " " + (x.account.currentPackage.unitType === "hour" ? "שעות" : "פגישות") + '</strong></div>') : "");
    return { subject: "נקבע את הפגישה הבאה?", html: layout(x.st, "עדיין לא קבענו את הפגישה הבאה", "נקבע את הפגישה הבאה?", body) };
  };

  // 4. Account / payments status
  T.account = function (x) {
    var a = x.account, c = x.client;
    var pkg = a.currentPackage;
    var unit = pkg && pkg.unitType === "hour" ? "שעות" : "פגישות";
    var rows = [
      ["שם התהליך", esc(c.processName || (pkg ? pkg.name : "תהליך ליווי"))],
      ["פגישות שהתקיימו", String(a.heldCount)]
    ];
    if (pkg) {
      rows.push(["נוצלו מהסל הנוכחי", Core.round2(pkg.used) + " מתוך " + Core.round2(pkg.units) + " " + unit]);
      rows.push(["נותרו בסל", Core.round2(pkg.remaining) + " " + unit]);
    }
    rows.push(["הפגישה הבאה", a.nextSession ? esc(when(a.nextSession.date)) : "עדיין לא נקבעה"]);
    var dates = a.sessions.filter(function (s) { return Core.CONSUMING[s.status]; }).map(function (s) { return Core.fmtDate(s.date); }).filter(Boolean);
    var bal = a.balance;
    var body = para("שלום " + esc(firstName(c)) + ",") +
      para("להלן סיכום מסודר של מצב התהליך והתשלומים נכון להיום:") +
      heading("מצב התהליך") + kvTable(rows) +
      (pkg ? progress(pkg.used, pkg.units) : "") +
      (dates.length ? '<div style="margin:10px 0 4px;font-family:' + FONT + ';font-size:13px;color:' + C.muted + ';line-height:1.8;">תאריכי הפגישות: ' + esc(dates.slice(-15).join(" · ")) + '</div>' : "") +
      heading("תשלומים") +
      kvTable([
        ["סה\"כ", money(a.totalCharges)],
        ["שולם", money(a.totalPaid), C.good],
        [bal < 0 ? "יתרת זכות" : "נשאר לתשלום", money(Math.abs(bal)), bal > 0 ? C.warn : C.good]
      ]) +
      box('<div style="font-size:14.5px;font-weight:700;color:' + (bal > 0 ? C.warn : C.good) + ';">' +
        (bal > 0 ? "נשמח להסדרת היתרה בהזדמנות. לכל שאלה - אני כאן." : "הכל מסודר. תודה!") + '</div>') +
      button("לאזור האישי", x.portalUrl);
    return { subject: "סיכום מצב התהליך והתשלומים", html: layout(x.st, "מצב התהליך והתשלומים שלך", "מצב התהליך והתשלומים", body) };
  };

  // 5. Session summary
  T.summary = function (x) {
    var s = x.session || {}, sm = x.summary || {}, a = x.account;
    var pkg = a && a.currentPackage;
    var body = para("שלום " + esc(firstName(x.client)) + ",") +
      para("תודה על הפגישה" + (s.date ? " ב" + esc(when(s.date)) : "") + ". הנה הסיכום שלה:") +
      (sm.points ? heading("נקודות שעלו בפגישה") + structured(sm.points) : "") +
      (sm.text && !sm.points ? heading("סיכום") + structured(sm.text) : "") +
      (sm.decisions ? heading("החלטות שהתקבלו") + structured(sm.decisions) : "") +
      (sm.recordingUrl ? button("להקלטת הפגישה", sm.recordingUrl) : "") +
      (sm.homework ? heading("שיעורי בית") + box(structured(sm.homework), "#FFFDF8") : "") +
      (a ? heading("מצב התהליך") + kvTable([
        ["פגישות שהתקיימו", String(a.heldCount)],
        pkg ? ["נותרו בסל", Core.round2(pkg.remaining) + " " + (pkg.unitType === "hour" ? "שעות" : "פגישות")] : ["הפגישה הבאה", a.nextSession ? esc(when(a.nextSession.date)) : "עדיין לא נקבעה"]
      ]) + (pkg ? progress(pkg.used, pkg.units) : "") : "") +
      (a && a.nextSession ? para('<br>הפגישה הבאה: <strong>' + esc(when(a.nextSession.date)) + '</strong>') : button("קביעת הפגישה הבאה", x.bookingUrl || x.portalUrl));
    return { subject: "סיכום הפגישה" + (s.date ? " - " + Core.fmtDate(s.date) : ""), html: layout(x.st, "סיכום, החלטות ושיעורי בית", "סיכום הפגישה שלנו", body) };
  };

  // 6. Session invitation / confirmation
  T.invite = function (x) {
    var s = x.session || (x.account && x.account.nextSession);
    var body = para("שלום " + esc(firstName(x.client)) + ",") +
      (s ? para("נקבעה לנו פגישה:") + box(kvTable([
        ["מועד", esc(when(s.date))],
        ["משך", (Core.num(s.durationMin) || 60) + " דקות"],
        ["מיקום", esc(s.location || "יעודכן")]
      ]), "#fff") : para("עדיין לא נקבע מועד לפגישה הבאה.")) +
      para("אם יש משהו שכדאי שאדע לפני הפגישה - אפשר לכתוב לי דרך האזור האישי.") +
      button("לאזור האישי", x.portalUrl);
    return { subject: s ? "זימון לפגישה - " + Core.fmtDate(s.date) : "זימון לפגישה", html: layout(x.st, s ? when(s.date) : "", "זימון לפגישה", body) };
  };

  var TYPES = {
    welcome: "ברוכים הבאים (פתיחת המערכת)",
    password: "בחירת / איפוס סיסמה",
    reminder: "תזכורת לקביעת פגישה",
    account: "סיכום מצב חשבון ותשלומים",
    summary: "סיכום פגישה",
    invite: "זימון לפגישה"
  };

  function render(type, ctx) {
    if (!T[type]) throw new Error("Unknown email template: " + type);
    ctx.st = ctx.st || Core.DEFAULT_SETTINGS;
    return T[type](ctx);
  }

  return { TYPES: TYPES, render: render, structured: structured };
})();
if (typeof module !== "undefined" && module.exports) module.exports = EmailTemplates;
