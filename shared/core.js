/*
 * core.js - business logic shared by the admin app, the client portal and the
 * Google Apps Script backend (copied there by apps-script/build.sh).
 *
 * Pure functions only: no DOM, no network, no storage. Everything takes the
 * in-memory "db" object ({ clients: [...], sessions: [...], ... }) and returns
 * derived numbers, so the browser and the server always agree on balances.
 *
 * Contains NO personal data - real data lives only in the private Google Sheet.
 */
var Core = (function () {
  "use strict";

  // ---------------------------------------------------------------- labels
  var SESSION_STATUS = {
    planned: "מתוכננת",
    held: "התקיימה",
    cancel_ontime: "בוטלה בזמן",
    cancel_late: "בוטלה באיחור (חיוב מלא)",
    unassigned: "לא משויכת",
    ignored: "הוסתרה"
  };
  // Statuses that use up a package unit / create a charge.
  var CONSUMING = { held: true, cancel_late: true };

  var PAY_METHODS = {
    transfer: "העברה בנקאית",
    cash: "מזומן",
    credit: "כרטיס אשראי",
    check: "צ'ק",
    bit: "ביט / פייבוקס",
    other: "אחר"
  };

  var PRICING_MODELS = {
    single: "פגישה בודדת / לפי שעה",
    package: "סל פגישות / שעות",
    monthly: "ליווי חודשי קבוע"
  };

  var UNIT_TYPES = { session: "פגישות", hour: "שעות" };

  // Default price list (editable in Settings -> price list).
  var PACKAGE_PRESETS = [
    { name: "סל 5 שעות", units: 5, unitType: "hour", price: 1500 },
    { name: "סל 10 שעות", units: 10, unitType: "hour", price: 3000 },
    { name: "סל 5 פגישות", units: 5, unitType: "session", price: 1500 },
    { name: "סל 10 פגישות", units: 10, unitType: "session", price: 3000 }
  ];
  var SESSION_PRICES = [350, 300];

  var BUSINESS_EXPENSE_CATS = [
    "שכירות חדר / קליניקה",
    "קורסים והכשרות",
    "מנטורינג",
    "אינטרנט / שרת / אתר",
    "מבדקים (זילבר וכד')",
    "שיווק ופרסום",
    "עמלות הפניה",
    "שונות"
  ];

  // Family budget structure (mirrors the planning workbook's sections).
  var FAMILY_GROUPS = {
    income: "הכנסות",
    fixed: "הוצאות קבועות",
    current: "צריכה שוטפת",
    variable: "הוצאות משתנות",
    maaser: "מעשרות וצדקה",
    annual: "הוצאות שנתיות / מעגל השנה",
    debt: "החזרי חובות וחסכונות",
    unexpected: "לא צפויות"
  };

  var DEFAULT_FAMILY_CATEGORIES = [
    ["משכורת - בעל", "income"], ["משכורת - אשה", "income"], ["קצבאות ביטוח לאומי", "income"],
    ["הכנסה מנכס", "income"], ["החזרי מס", "income"], ["הכנסות אחרות", "income"],
    ["שכר דירה / משכנתא", "fixed"], ["ארנונה", "fixed"], ["ועד בית", "fixed"], ["ביטוחים", "fixed"],
    ["בריאות", "fixed"], ["קופת חולים", "fixed"], ["שכר לימוד", "fixed"], ["מטפלת / מעונות", "fixed"],
    ["חוגים ושיעורים", "fixed"], ["לימודי הורים", "fixed"], ["מנויים", "fixed"], ["הו\"ק שונות", "fixed"],
    ["קניות מרוכזות - סופר", "current"], ["מכולת", "current"], ["פירות וירקות", "current"],
    ["בשר ודגים", "current"], ["אוכל בחוץ", "current"], ["דלק לרכב", "current"], ["נסיעות", "current"],
    ["ביגוד והנעלה", "current"], ["רכישות קטנות", "current"], ["שונות", "current"],
    ["חשמל", "variable"], ["מים", "variable"], ["גז", "variable"], ["תקשורת", "variable"],
    ["עמלות וריבית", "variable"],
    ["מעשר / חומש", "maaser"], ["צדקה", "maaser"],
    ["חגים ומועדים", "annual"], ["ביגוד עונתי", "annual"], ["רכב - טסט וביטוח", "annual"],
    ["תיקונים ותחזוקה", "annual"], ["אירועים ומתנות", "annual"], ["חופשה", "annual"],
    ["החזר הלוואות", "debt"], ["חסכונות והפרשות", "debt"],
    ["הוצאה לא צפויה", "unexpected"],
    ["לא מסווג", "unexpected"]
  ];

  // Vendor -> category starter rules (generic Israeli vendors, editable in the app).
  var DEFAULT_FAMILY_RULES = [
    ["רמי לוי", "קניות מרוכזות - סופר"], ["אושר עד", "קניות מרוכזות - סופר"],
    ["שופרסל", "קניות מרוכזות - סופר"], ["יוחננוף", "קניות מרוכזות - סופר"],
    ["ויקטורי", "קניות מרוכזות - סופר"], ["יש חסד", "קניות מרוכזות - סופר"],
    ["חצי חינם", "קניות מרוכזות - סופר"], ["קשת טעמים", "קניות מרוכזות - סופר"],
    ["דלק", "דלק לרכב"], ["פז ", "דלק לרכב"], ["סונול", "דלק לרכב"], ["דור אלון", "דלק לרכב"],
    ["ten ", "דלק לרכב"], ["חברת החשמל", "חשמל"], ["חשמל", "חשמל"], ["תאגיד", "מים"], ["מי ", "מים"],
    ["סופרגז", "גז"], ["אמישראגז", "גז"], ["פזגז", "גז"], ["בזק", "תקשורת"], ["פרטנר", "תקשורת"],
    ["סלקום", "תקשורת"], ["פלאפון", "תקשורת"], ["הוט ", "תקשורת"], ["גולן טלקום", "תקשורת"],
    ["ארנונה", "ארנונה"], ["עירית", "ארנונה"], ["עיריית", "ארנונה"], ["מכבי", "קופת חולים"],
    ["כללית", "קופת חולים"], ["מאוחדת", "קופת חולים"], ["לאומית", "קופת חולים"],
    ["סופר פארם", "בריאות"], ["ביטוח", "ביטוחים"], ["הראל", "ביטוחים"], ["מגדל", "ביטוחים"],
    ["כלל ", "ביטוחים"], ["הפניקס", "ביטוחים"], ["עמלה", "עמלות וריבית"], ["ריבית", "עמלות וריבית"],
    ["משכנתא", "שכר דירה / משכנתא"], ["הלוואה", "החזר הלוואות"], ["רב קו", "נסיעות"], ["מונית", "נסיעות"],
    ["גט ", "נסיעות"]
  ];

  // Generic defaults - the real account names are set in the app and kept in the private sheet.
  var ACCOUNTS = [
    "עו\"ש - בנק 1",
    "עו\"ש - בנק 2",
    "כרטיס אשראי 1",
    "כרטיס אשראי 2",
    "מזומן / אחר"
  ];

  var DEFAULT_SETTINGS = {
    coachName: "חיים מאיר ברויער",
    businessName: "חיים ברויער - ייעוץ וליווי",
    siteUrl: "https://chaimbreuer.co.il",
    weeklySessionTarget: 15,
    monthlySessionTarget: "",      // empty => weekly * 4.33
    monthlyIncomeTarget: 16000,
    renewalThreshold: 1,
    calendarId: "primary",
    calendarKeyword: "",           // optional: only events whose title contains this are synced
    defaultSessionMinutes: 60,
    defaultRate: 350,
    locations: ["בית שמש", "בני ברק", "זום"],
    slotMinutes: 60,
    bookingDaysAhead: 45,
    availability: [],              // [{day:0-6, from:"09:00", to:"13:00", location:"בית שמש"}]
    reminderAfterDays: 10,
    autoReminders: false,
    shareRecordingsWithClient: true,
    familyIncludeBusiness: true,   // business net profit flows into the family budget
    packagePresets: "",            // price list: [{name, units, unitType, price}] (empty = defaults)
    sessionPrices: ""              // price list: single-session prices, e.g. [350, 300]
  };

  // ---------------------------------------------------------------- utils
  function uid(prefix) {
    var s = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return (prefix || "") + s;
  }
  function num(v) {
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var n = parseFloat(String(v).replace(/[₪,\s]/g, ""));
    return isFinite(n) ? n : 0;
  }
  function round2(n) { return Math.round(n * 100) / 100; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // Dates are stored as local strings: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm".
  function toDate(s) {
    if (!s) return null;
    if (s instanceof Date) return s;
    var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function ymdhm(d) { return ymd(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function monthKey(s) { return s ? String(s).slice(0, 7) : ""; }
  function thisMonth(now) { return ymd(now || new Date()).slice(0, 7); }
  function addMonths(mk, delta) {
    var y = +mk.slice(0, 4), m = +mk.slice(5, 7) - 1 + delta;
    var d = new Date(y, m, 1);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1);
  }
  function daysInMonth(mk) { return new Date(+mk.slice(0, 4), +mk.slice(5, 7), 0).getDate(); }
  function fmtDate(s) {
    var d = toDate(s); if (!d) return "";
    return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear();
  }
  function fmtTime(s) {
    if (!s || String(s).length < 16) return "";
    return String(s).slice(11, 16);
  }
  function fmtMoney(n) {
    n = num(n);
    var neg = n < 0; n = Math.abs(Math.round(n));
    return (neg ? "-" : "") + "₪" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  var HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  var HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  function monthLabel(mk) { return HE_MONTHS[+mk.slice(5, 7) - 1] + " " + mk.slice(0, 4); }

  function byId(list, id) {
    for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function bool(v) { return v === true || v === "true" || v === "TRUE" || v === 1 || v === "1"; }

  function settingsOf(db) {
    var out = {}, k;
    for (k in DEFAULT_SETTINGS) out[k] = DEFAULT_SETTINGS[k];
    (db.settings || []).forEach(function (row) {
      if (!row || !row.id) return;
      var v = row.value;
      if (typeof v === "string" && /^[\[{]/.test(v)) { try { v = JSON.parse(v); } catch (e) {} }
      out[row.id] = v;
    });
    return out;
  }

  // The editable price list: packages and single-session prices.
  function priceList(st) {
    var pk = st.packagePresets, sp = st.sessionPrices;
    if (typeof pk === "string") { try { pk = JSON.parse(pk); } catch (e) { pk = null; } }
    if (typeof sp === "string") { try { sp = JSON.parse(sp); } catch (e) { sp = null; } }
    return {
      packages: Array.isArray(pk) && pk.length ? pk : PACKAGE_PRESETS,
      sessionPrices: Array.isArray(sp) && sp.length ? sp.map(num).filter(function (x) { return x > 0; }) : SESSION_PRICES
    };
  }
  function packageName(units, unitType) { return "סל " + units + " " + (unitType === "hour" ? "שעות" : "פגישות"); }
  // Price per session/hour after the client's fixed discount.
  function effectiveRate(client) { return Math.max(0, num(client && client.rate) - num(client && client.discount)); }

  function monthlySessionTarget(st) {
    if (st.monthlySessionTarget !== "" && st.monthlySessionTarget != null && num(st.monthlySessionTarget) > 0) {
      return Math.round(num(st.monthlySessionTarget));
    }
    return Math.round(num(st.weeklySessionTarget) * 4.33);
  }

  // ---------------------------------------------------------------- clients
  // Billing units a session consumes, in the client's own unit (session/hour).
  function sessionUnits(s, client) {
    if (s.units !== undefined && s.units !== null && s.units !== "") return num(s.units);
    if (client && client.unitType === "hour") return num(s.durationMin || 60) / 60;
    return 1;
  }

  function sessionsOf(db, clientId) {
    return (db.sessions || []).filter(function (s) { return s.clientId === clientId; })
      .sort(function (a, b) { return String(a.date || "").localeCompare(String(b.date || "")); });
  }

  /*
   * Full financial / usage picture for one client.
   * Consuming sessions fill the client's packages in purchase order; anything
   * beyond the packages is billed at the client's rate (or, on the monthly
   * model, as a monthly fee for each month with activity).
   */
  function clientAccount(db, clientId, now) {
    now = now || new Date();
    var nowStr = ymdhm(now);
    var client = byId(db.clients, clientId) || { id: clientId, name: "?" };
    var sessions = sessionsOf(db, clientId);
    var consumed = sessions.filter(function (s) { return CONSUMING[s.status]; });
    var packages = (db.packages || []).filter(function (p) { return p.clientId === clientId; })
      .sort(function (a, b) { return String(a.startDate || "").localeCompare(String(b.startDate || "")); })
      .map(function (p) {
        return { id: p.id, name: p.name, unitType: p.unitType || "session", units: num(p.units),
          price: Math.max(0, num(p.price) - num(p.discount)), listPrice: num(p.price), discount: num(p.discount),
          startDate: p.startDate, notes: p.notes, used: 0, remaining: num(p.units), sessions: [],
          // A package for a period: a fixed price that covers every meeting from startDate to
          // endDate, however many there were (its units are simply what was used).
          endDate: /^\d{4}-\d{2}-\d{2}/.test(p.endDate || "") ? String(p.endDate).slice(0, 10) : "" };
      });
    packages.forEach(function (p) { if (p.endDate) p.remaining = 1e9; });
    function inPeriod(p, day) { return !p.endDate || day <= p.endDate; }

    var overflowUnits = 0, pi = 0, overflowSessions = [], pricedSessions = [];
    var restOf = {};   // session id -> part (0..1) of a session left after the packages ran out
    consumed.forEach(function (s) {
      // A session with its own fixed price (e.g. history kept when two cards are merged)
      // is billed exactly that amount and does not use package units - unless a package
      // bought on or before that day still has room: then the package covers it.
      // A price typed by hand in the meeting form (priceManual) always wins.
      if (s.price !== undefined && s.price !== null && s.price !== "") {
        var day = String(s.date || "").slice(0, 10);
        var covered = !bool(s.priceManual) && day && packages.some(function (p) { return p.remaining > 0.0001 && p.startDate && String(p.startDate).slice(0, 10) <= day && inPeriod(p, day); });
        if (!covered) { pricedSessions.push(s); return; }
      }
      // Fill packages in order. A session bigger than what is left in a package (e.g. 1.5
      // hours with 1 hour left) takes the rest of it, and the remainder continues to the
      // next package - or, when there is none, is billed for exactly that part.
      var part = 1;   // share of this session still to be covered
      while (pi < packages.length && part > 0.0001) {
        var p = packages[pi];
        // a package bought later does not cover an earlier meeting - except the remainder of a
        // meeting that already started in the previous package: that continues into the next one
        if (part >= 0.9999 && String(p.startDate || "") > String(s.date || "").slice(0, 10)) break; // package starts later than this session - leave it unassigned (overflow) rather than skip past a package that will still apply to later sessions
        if (!inPeriod(p, String(s.date || "").slice(0, 10))) { pi++; continue; }   // its period is over (meetings are in date order)
        var full = p.unitType === "hour" ? num(s.durationMin || 60) / 60 : 1;
        if (s.units !== undefined && s.units !== "" && s.units !== null) full = num(s.units);   // units written on the meeting (e.g. 1.5) always count as written
        var need = full * part;
        if (p.remaining > 0.0001 && need > 0) {
          var take = Math.min(need, p.remaining);
          p.used = round2(p.used + take); p.remaining = round2(p.remaining - take);
          p.sessions.push(s.id);
          part = take >= need - 0.0001 ? 0 : part * (1 - take / need);
          if (part <= 0.0001) break;
        } else if (need <= 0) { part = 0; break; }
        pi++;
      }
      if (part > 0.0001) {
        if (part < 0.9999) restOf[s.id] = part;
        if (s.price !== undefined && s.price !== null && s.price !== "") pricedSessions.push(s);
        else { overflowUnits += sessionUnits(s, client) * part; overflowSessions.push(s); }
      }
    });

    // a period package is complete: its units are what it covered, nothing remains
    packages.forEach(function (p) { if (p.endDate) { p.units = round2(p.used); p.remaining = 0; } });

    var model = client.pricingModel || "single";
    var rate = effectiveRate(client);
    var discountNote = num(client.discount) > 0 ? " - כולל הנחה " + fmtMoney(client.discount) : "";
    var chargeLines = [];
    packages.forEach(function (p) {
      chargeLines.push({ date: p.startDate, label: (p.name || "סל") + (p.endDate ? " - כל הפגישות עד " + fmtDate(p.endDate) : "") + (p.discount > 0 ? " (" + fmtMoney(p.listPrice) + " פחות הנחה " + fmtMoney(p.discount) + ")" : ""),
        amount: p.price, kind: "package", packageId: p.id });
    });
    if (model === "monthly") {
      monthlyMonths(client, overflowSessions, now).forEach(function (mk) {
        chargeLines.push({ date: mk + "-01", label: "ליווי חודשי - " + monthLabel(mk) + " (1-" + daysInMonth(mk) + " בחודש)",
          amount: num(client.monthlyFee), kind: "monthly" });
      });
    } else {
      overflowSessions.forEach(function (s) {
        var u = round2(sessionUnits(s, client) * (restOf[s.id] || 1));
        chargeLines.push({ date: s.date, label: (s.status === "cancel_late" ? "ביטול באיחור" : "פגישה") +
          (u !== 1 ? " (" + round2(u) + " " + (client.unitType === "hour" ? "שעות" : "יח'") + ")" : "") +
          (restOf[s.id] ? " - היתרה שמעבר לסל" : "") + discountNote,
          amount: round2(u * rate), kind: "session", sessionId: s.id });
      });
    }
    pricedSessions.forEach(function (s) {
      var share = restOf[s.id] || 1;
      chargeLines.push({ date: s.date, label: (s.status === "cancel_late" ? "ביטול באיחור" : "פגישה") + " (מחיר קבוע" + (share < 1 ? " - היתרה שמעבר לסל" : "") + ")",
        amount: round2(num(s.price) * share), kind: "session", sessionId: s.id });
    });
    (db.charges || []).forEach(function (c) {
      if (c.clientId === clientId) chargeLines.push({ date: c.date, label: c.reason || "תשלום חד-פעמי", amount: num(c.amount), kind: "oneoff", id: c.id });
    });
    chargeLines.sort(function (a, b) { return String(a.date || "").localeCompare(String(b.date || "")); });

    var payments = (db.payments || []).filter(function (p) { return p.clientId === clientId; })
      .sort(function (a, b) { return String(a.date || "").localeCompare(String(b.date || "")); });

    var totalCharges = round2(chargeLines.reduce(function (s, c) { return s + c.amount; }, 0));
    var totalPaid = round2(payments.reduce(function (s, p) { return s + num(p.amount); }, 0));

    // Payments cover the charges in date order, so each package knows how much of it is paid.
    var pool = totalPaid, paidByPkg = {};
    chargeLines.forEach(function (l) {
      if (l.amount <= 0) { pool += -l.amount; return; }
      var take = Math.max(0, Math.min(pool, l.amount)); pool -= take;
      if (l.packageId) paidByPkg[l.packageId] = round2(take);
    });
    // The package as a credit: its price spread over its units.
    packages.forEach(function (p) {
      var per = p.units > 0 ? p.price / p.units : 0;
      p.unitValue = round2(per);
      p.valueUsed = round2(per * p.used);
      p.credit = round2(per * p.remaining);
      p.paid = paidByPkg[p.id] || 0;
      p.unpaid = round2(Math.max(0, p.price - p.paid));
    });

    var unitsPurchased = packages.reduce(function (s, p) { return s + p.units; }, 0);
    var unitsUsedInPkgs = packages.reduce(function (s, p) { return s + p.used; }, 0);
    var activePackage = null;
    for (var i = 0; i < packages.length; i++) { if (packages[i].remaining > 0.0001) { activePackage = packages[i]; break; } }
    var lastPkg = packages.length ? packages[packages.length - 1] : null;
    var currentPkg = activePackage || lastPkg;
    var remaining = round2(packages.reduce(function (s, p) { return s + p.remaining; }, 0));

    var st = settingsOf(db);
    var threshold = num(st.renewalThreshold) || 1;
    var renewal = packages.length > 0 && client.status !== "inactive" && (
      remaining <= threshold || (currentPkg && currentPkg.unitType === "hour" && remaining <= 0)
    );

    var upcoming = sessions.filter(function (s) { return s.status === "planned" && String(s.date) >= nowStr; });
    var awaiting = sessions.filter(function (s) { return s.status === "planned" && s.date && String(s.date) < nowStr; });
    var held = sessions.filter(function (s) { return s.status === "held"; });
    var hoursTotal = round2(held.reduce(function (s, x) { return s + num(x.durationMin || 60) / 60; }, 0));

    return {
      client: client,
      model: model,
      sessions: sessions,
      consumedCount: consumed.length,
      consumedUnits: round2(consumed.reduce(function (s, x) { return s + sessionUnits(x, client); }, 0)),
      heldCount: held.length,
      hoursTotal: hoursTotal,
      packages: packages,
      currentPackage: currentPkg,
      unitsPurchased: round2(unitsPurchased),
      unitsUsed: round2(unitsUsedInPkgs),
      unitsRemaining: remaining,
      overflowUnits: round2(overflowUnits),
      chargeLines: chargeLines,
      payments: payments,
      totalCharges: totalCharges,
      totalPaid: totalPaid,
      balance: round2(totalCharges - totalPaid),   // > 0 => client owes
      renewalAlert: !!renewal,
      nextSession: upcoming[0] || null,
      upcoming: upcoming,
      awaiting: awaiting,
      lastHeld: held.length ? held[held.length - 1] : null
    };
  }

  /*
   * Months billed on the monthly model: a fixed fee for every calendar month (the 1st
   * to the last day) from the start month to the end month, or to the current month
   * while the accompaniment is ongoing. Without a start month, it starts at the first
   * meeting. A meeting outside that period still counts its own month.
   */
  function monthlyMonths(client, sessions, now) {
    var months = {};
    (sessions || []).forEach(function (s) { if (s.date) months[monthKey(s.date)] = true; });
    var first = Object.keys(months).sort()[0] || "";
    var start = /^\d{4}-\d{2}/.test(client.monthlyStart || "") ? String(client.monthlyStart).slice(0, 7) : first;
    var end = thisMonth(now || new Date());
    if (/^\d{4}-\d{2}/.test(client.monthlyEnd || "") && String(client.monthlyEnd).slice(0, 7) < end) end = String(client.monthlyEnd).slice(0, 7);
    // an inactive client with no end month set is not charged after the last meeting
    if (client.status === "inactive" && !client.monthlyEnd) { var last = Object.keys(months).sort().pop() || start; if (last < end) end = last; }
    if (start) for (var mk = start, guard = 0; mk <= end && guard < 600; mk = addMonths(mk, 1), guard++) months[mk] = true;
    return Object.keys(months).sort();
  }

  function allAccounts(db, now) {
    return (db.clients || []).map(function (c) { return clientAccount(db, c.id, now); });
  }

  // ---------------------------------------------------------------- business P&L
  function expensesForMonth(db, mk) {
    var out = [];
    (db.expenses || []).forEach(function (e) {
      var start = monthKey(e.date);
      if (!start) return;
      if (e.recurring === "monthly") {
        var end = e.endDate ? monthKey(e.endDate) : "9999-12";
        if (mk >= start && mk <= end) out.push({ id: e.id, category: e.category, amount: num(e.amount), notes: e.notes, recurring: true });
      } else if (e.recurring === "yearly") {
        if (mk.slice(5) === start.slice(5) && mk >= start && (!e.endDate || mk <= monthKey(e.endDate))) {
          out.push({ id: e.id, category: e.category, amount: num(e.amount), notes: e.notes, recurring: true });
        }
      } else if (start === mk) {
        out.push({ id: e.id, category: e.category, amount: num(e.amount), notes: e.notes, recurring: false, date: e.date });
      }
    });
    return out;
  }

  function businessMonth(db, mk) {
    var sessions = (db.sessions || []).filter(function (s) { return s.clientId && monthKey(s.date) === mk; });
    var held = sessions.filter(function (s) { return s.status === "held"; });
    var late = sessions.filter(function (s) { return s.status === "cancel_late"; });
    var planned = sessions.filter(function (s) { return s.status === "planned"; });
    var pays = (db.payments || []).filter(function (p) { return monthKey(p.date) === mk; });
    var collected = round2(pays.reduce(function (s, p) { return s + num(p.amount); }, 0));
    var exps = expensesForMonth(db, mk);
    var expByCat = {};
    exps.forEach(function (e) { expByCat[e.category || "שונות"] = round2((expByCat[e.category || "שונות"] || 0) + e.amount); });
    var expTotal = round2(exps.reduce(function (s, e) { return s + e.amount; }, 0));
    return {
      month: mk,
      heldCount: held.length,
      heldHours: round2(held.reduce(function (s, x) { return s + num(x.durationMin || 60) / 60; }, 0)),
      lateCancelCount: late.length,
      plannedCount: planned.length,
      collected: collected,
      payments: pays,
      expenses: exps,
      expensesByCategory: expByCat,
      expenseTotal: expTotal,
      net: round2(collected - expTotal)
    };
  }

  function kpi(db, now) {
    now = now || new Date();
    var st = settingsOf(db);
    var mk = thisMonth(now);
    var bm = businessMonth(db, mk);
    var sessTarget = monthlySessionTarget(st);
    var incTarget = num(st.monthlyIncomeTarget);
    var dim = daysInMonth(mk);
    var elapsed = now.getDate() / dim;
    var expectedSess = sessTarget * elapsed;
    var pctSess = sessTarget ? bm.heldCount / sessTarget : 0;
    var pctInc = incTarget ? bm.net / incTarget : 0;
    function pace(actual, expected, target) {
      if (target && actual >= target) return "done";
      if (actual >= expected) return "good";
      if (actual >= expected * 0.8) return "warn";
      return "behind";
    }
    // weekly
    var dow = now.getDay();
    var weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    var weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
    var ws = ymd(weekStart), we = ymd(weekEnd);
    var weekSessions = (db.sessions || []).filter(function (s) { return s.clientId && s.date && s.date >= ws && s.date < we; });
    var weeklyTargetNum = num(st.weeklySessionTarget);
    var weekElapsed = Math.min(1, Math.max(0, (now - weekStart) / (weekEnd - weekStart)));
    var expectedWeek = weeklyTargetNum * weekElapsed;
    // A 2-hour meeting counts as 2 meetings; a late (charged) cancellation still
    // counts as scheduled, same as a held one - only a free on-time cancellation doesn't.
    function weekWeight(s) { return num(s.durationMin || 60) / 60; }
    function weekSum(status) { return round2(weekSessions.filter(function (s) { return s.status === status; }).reduce(function (sum, s) { return sum + weekWeight(s); }, 0)); }
    var weekHeldW = weekSum("held");
    var weekCancelLateW = weekSum("cancel_late");
    var weekPlannedW = weekSum("planned");
    var weekScheduled = round2(weekHeldW + weekCancelLateW + weekPlannedW);
    return {
      month: mk,
      bm: bm,
      sessionTarget: sessTarget,
      weeklyTarget: weeklyTargetNum,
      sessionsHeld: bm.heldCount,
      sessionsLeft: Math.max(0, sessTarget - bm.heldCount),
      sessionsPct: pctSess,
      sessionsPace: pace(bm.heldCount, expectedSess, sessTarget),
      expectedSessionsByNow: Math.round(expectedSess),
      incomeTarget: incTarget,
      incomeNet: bm.net,
      incomeCollected: bm.collected,
      incomeLeft: Math.max(0, incTarget - bm.net),
      incomePct: pctInc,
      incomePace: pace(bm.net, incTarget * elapsed, incTarget),
      weekScheduled: weekScheduled,
      weekHeld: weekHeldW,
      weekCancelLate: weekCancelLateW,
      weekPlanned: weekPlannedW,
      weekLeft: Math.max(0, weeklyTargetNum - weekScheduled),
      weeklyPct: weeklyTargetNum ? weekScheduled / weeklyTargetNum : 0,
      weeklyPace: pace(weekScheduled, expectedWeek, weeklyTargetNum),
      expectedWeekByNow: Math.round(expectedWeek),
      daysLeft: dim - now.getDate()
    };
  }

  // ---------------------------------------------------------------- family
  function categorize(desc, rules) {
    var d = String(desc || "").toLowerCase();
    for (var i = 0; i < (rules || []).length; i++) {
      var p = String(rules[i].pattern || "").toLowerCase();
      if (p && d.indexOf(p) !== -1) return rules[i].category;
    }
    return "לא מסווג";
  }

  function familyCategoryMap(db) {
    var m = {};
    (db.family_categories || []).forEach(function (c) { m[c.name] = c; });
    return m;
  }

  function familyMonth(db, mk) {
    var cats = familyCategoryMap(db);
    var tx = (db.family_tx || []).filter(function (t) { return monthKey(t.date) === mk && !bool(t.excluded); });
    var bm = businessMonth(db, mk);
    var byCat = {};
    var income = 0, expense = 0;
    tx.forEach(function (t) {
      var amt = num(t.amount);
      var cat = t.category || "לא מסווג";
      var isIncome = t.type === "income";
      if (isIncome) income += amt; else expense += amt;
      if (!byCat[cat]) byCat[cat] = { category: cat, group: (cats[cat] && cats[cat].group) || (isIncome ? "income" : "unexpected"), actual: 0, count: 0, budget: cats[cat] ? num(cats[cat].budget) : 0 };
      byCat[cat].actual = round2(byCat[cat].actual + amt);
      byCat[cat].count++;
    });
    // budgeted categories with no transactions still appear
    (db.family_categories || []).forEach(function (c) {
      if (num(c.budget) > 0 && !byCat[c.name]) byCat[c.name] = { category: c.name, group: c.group, actual: 0, count: 0, budget: num(c.budget) };
    });
    var rows = Object.keys(byCat).map(function (k) {
      var r = byCat[k];
      r.over = r.group !== "income" && r.budget > 0 && r.actual > r.budget;
      r.pct = r.budget > 0 ? r.actual / r.budget : 0;
      return r;
    });
    var businessNet = bool(settingsOf(db).familyIncludeBusiness) ? bm.net : 0;
    var totalIncome = round2(income + businessNet);
    return {
      month: mk,
      tx: tx,
      categories: rows,
      businessNet: businessNet,
      business: bm,
      otherIncome: round2(income),
      totalIncome: totalIncome,
      totalExpense: round2(expense),
      balance: round2(totalIncome - expense),
      overBudget: rows.filter(function (r) { return r.over; }),
      uncategorized: tx.filter(function (t) { return !t.category || t.category === "לא מסווג"; }).length
    };
  }

  function loansSummary(db) {
    var loans = db.loans || [];
    var monthly = 0, balance = 0;
    loans.forEach(function (l) { monthly += num(l.monthlyPayment); balance += num(l.balance); });
    return { loans: loans, monthlyTotal: round2(monthly), balanceTotal: round2(balance) };
  }

  function txFingerprint(t) {
    return [t.account || "", t.date || "", String(t.description || "").replace(/\s+/g, " ").trim(), round2(num(t.amount)), t.type || ""].join("|");
  }

  // ---------------------------------------------------------------- booking
  function hmToMin(hm) { var p = String(hm || "0:0").split(":"); return (+p[0]) * 60 + (+p[1] || 0); }
  function minToHm(m) { return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }

  /*
   * Free slots between fromDate (Date) and N days ahead.
   * busy: [{start:"YYYY-MM-DDTHH:mm", end:"..."}] (calendar events + planned sessions)
   */
  function freeSlots(st, busy, fromDate, days) {
    var avail = st.availability || [];
    if (typeof avail === "string") { try { avail = JSON.parse(avail); } catch (e) { avail = []; } }
    var slotMin = num(st.slotMinutes) || 60;
    var out = [];
    var nowStr = ymdhm(fromDate);
    for (var i = 0; i <= days; i++) {
      var d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + i);
      var dow = d.getDay();
      var dayStr = ymd(d);
      avail.forEach(function (w) {
        if (+w.day !== dow) return;
        var a = hmToMin(w.from), b = hmToMin(w.to);
        for (var t = a; t + slotMin <= b; t += slotMin) {
          var start = dayStr + "T" + minToHm(t), end = dayStr + "T" + minToHm(t + slotMin);
          if (start <= nowStr) continue;
          var clash = busy.some(function (x) { return x.start < end && x.end > start; });
          if (!clash) out.push({ start: start, end: end, location: w.location || "" });
        }
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- portal view
  // Only what the client is allowed to see. Never includes notes, other clients,
  // business totals or unshared summaries.
  function portalView(db, clientId, now) {
    var acc = clientAccount(db, clientId, now);
    var c = acc.client;
    var st = settingsOf(db);
    var summaries = (db.summaries || []).filter(function (s) { return s.clientId === clientId && bool(s.shared); });
    var sumBySession = {};
    summaries.forEach(function (s) { sumBySession[s.sessionId] = s; });
    var tasks = (db.tasks || []).filter(function (t) { return t.clientId === clientId && bool(t.shared); });
    function pub(s) {
      var sm = sumBySession[s.id];
      return {
        id: s.id, date: s.date, durationMin: num(s.durationMin || 60), location: s.location || "", status: s.status,
        statusLabel: SESSION_STATUS[s.status] || "",
        summary: sm ? { points: sm.points || "", decisions: sm.decisions || "", homework: sm.homework || "",
          text: sm.text || "", recordingUrl: sm.recordingUrl || "" } : null
      };
    }
    var visible = acc.sessions.filter(function (s) { return s.status !== "ignored" && s.status !== "unassigned"; });
    var pkg = acc.currentPackage;
    return {
      client: { name: c.name, firstName: String(c.name || "").trim().split(/\s+/).slice(-1)[0], email: c.email || "", phone: c.phone || "",
        processName: c.processName || (acc.model === "package" ? "תהליך ליווי (סל)" : "תהליך ליווי") },
      coachName: st.coachName,
      progress: {
        model: acc.model,
        packageName: pkg ? pkg.name : "",
        unitType: pkg ? pkg.unitType : (c.unitType || "session"),
        purchased: pkg ? pkg.units : 0,
        used: pkg ? pkg.used : 0,
        remaining: pkg ? pkg.remaining : 0,
        price: pkg ? pkg.price : 0,
        paid: pkg ? pkg.paid : 0,
        valueUsed: pkg ? pkg.valueUsed : 0,
        credit: pkg ? pkg.credit : 0,
        heldCount: acc.heldCount,
        hoursTotal: acc.hoursTotal
      },
      finance: { total: acc.totalCharges, paid: acc.totalPaid, balance: acc.balance },
      nextSession: acc.nextSession ? pub(acc.nextSession) : null,
      planned: visible.filter(function (s) { return s.status === "planned"; }).map(pub),
      past: visible.filter(function (s) { return s.status !== "planned"; }).reverse().map(pub),
      tasks: tasks.map(function (t) { return { id: t.id, text: t.text, done: bool(t.done), dueDate: t.dueDate || "" }; }),
      locations: st.locations
    };
  }

  // ---------------------------------------------------------------- misc
  function nameTokens(name) {
    return String(name || "").replace(/[-–(),.'"]/g, " ").split(/\s+/)
      .filter(function (w) { return w.length >= 2 && ["זוגי", "בחור", "הרצאה"].indexOf(w) === -1; });
  }
  // Hebrew spelling variants count as the same word: "וורצברגר" = "ורצברגר", "יי" = "י".
  function normWord(w) {
    return String(w || "").replace(/[\u0591-\u05C7"'׳״]/g, "").replace(/וו/g, "ו").replace(/יי/g, "י").toLowerCase();
  }
  function titleWords(t) {
    return String(t || "").replace(/[-–(),.:;!?\/\\|]/g, " ").split(/\s+/).filter(Boolean).map(normWord);
  }
  /*
   * Match a calendar event title to a client: every word of the client's name must
   * appear as a whole word in the title (so "לוי" does not match inside "וואלוי"),
   * or the client's own calendar keyword appears. If two clients match equally
   * well, nobody is chosen - the event waits for a manual pick.
   */
  function matchClient(clients, title) {
    var t = String(title || ""), words = titleWords(t);
    var best = null, bestScore = 0, tie = false;
    (clients || []).forEach(function (c) {
      if (c.status === "inactive") return;
      var score = 0;
      if (c.calendarKeyword && t.indexOf(c.calendarKeyword) !== -1) score = 1000 + String(c.calendarKeyword).length;
      else {
        var toks = nameTokens(c.name).map(normWord);
        if (!toks.length) return;
        var all = toks.every(function (w) { return words.indexOf(w) !== -1; });
        if (!all) return;
        score = toks.length * 100 + toks.join("").length;
      }
      if (score > bestScore) { best = c; bestScore = score; tie = false; }
      else if (score === bestScore && best && best.id !== c.id) tie = true;
    });
    return tie ? null : best;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  return {
    SESSION_STATUS: SESSION_STATUS, CONSUMING: CONSUMING, PAY_METHODS: PAY_METHODS, PRICING_MODELS: PRICING_MODELS,
    UNIT_TYPES: UNIT_TYPES, PACKAGE_PRESETS: PACKAGE_PRESETS, SESSION_PRICES: SESSION_PRICES, priceList: priceList,
    packageName: packageName, effectiveRate: effectiveRate, BUSINESS_EXPENSE_CATS: BUSINESS_EXPENSE_CATS,
    FAMILY_GROUPS: FAMILY_GROUPS, DEFAULT_FAMILY_CATEGORIES: DEFAULT_FAMILY_CATEGORIES, DEFAULT_FAMILY_RULES: DEFAULT_FAMILY_RULES,
    ACCOUNTS: ACCOUNTS, DEFAULT_SETTINGS: DEFAULT_SETTINGS, HE_MONTHS: HE_MONTHS, HE_DAYS: HE_DAYS,
    uid: uid, num: num, round2: round2, pad: pad, toDate: toDate, ymd: ymd, ymdhm: ymdhm, monthKey: monthKey,
    thisMonth: thisMonth, addMonths: addMonths, daysInMonth: daysInMonth, fmtDate: fmtDate, fmtTime: fmtTime,
    fmtMoney: fmtMoney, monthLabel: monthLabel, byId: byId, bool: bool, settingsOf: settingsOf,
    monthlySessionTarget: monthlySessionTarget, sessionUnits: sessionUnits, sessionsOf: sessionsOf,
    clientAccount: clientAccount, allAccounts: allAccounts, monthlyMonths: monthlyMonths, expensesForMonth: expensesForMonth,
    businessMonth: businessMonth, kpi: kpi, categorize: categorize, familyMonth: familyMonth,
    loansSummary: loansSummary, txFingerprint: txFingerprint, freeSlots: freeSlots, hmToMin: hmToMin,
    minToHm: minToHm, portalView: portalView, nameTokens: nameTokens, matchClient: matchClient, escapeHtml: escapeHtml
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Core;
