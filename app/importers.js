/*
 * importers.js - turns bank / credit-card exports and the family planning
 * workbook into rows for the system. Pure functions over 2-D arrays (rows of
 * cells) so they run the same in the browser and in tests.
 * Files are parsed locally in the browser; only the resulting rows are sent
 * to your private backend.
 */
var Importers = (function () {
  "use strict";
  var C = typeof Core !== "undefined" ? Core : require("../shared/core.js");

  function s(v) { return v === null || v === undefined ? "" : String(v).trim(); }

  // ------------------------------------------------------------- values
  function parseAmount(v) {
    if (typeof v === "number") return v;
    var t = s(v);
    if (!t) return null;
    var neg = /^\(.*\)$/.test(t) || /-\s*$/.test(t) || /^-/.test(t.replace(/[₪\s]/g, ""));
    t = t.replace(/[^\d.,]/g, "");
    if (!t) return null;
    if (/,\d{1,2}$/.test(t) && t.indexOf(".") === -1) t = t.replace(",", "."); // 12,50
    t = t.replace(/,/g, "");
    var n = parseFloat(t);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  }
  function excelSerialToYmd(n) {
    var ms = Math.round((n - 25569) * 864e5);
    var d = new Date(ms);
    return d.getUTCFullYear() + "-" + C.pad(d.getUTCMonth() + 1) + "-" + C.pad(d.getUTCDate());
  }
  function parseDate(v) {
    if (v instanceof Date && !isNaN(v)) return C.ymd(v);
    if (typeof v === "number" && v > 20000 && v < 80000) return excelSerialToYmd(v);
    var t = s(v);
    var m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + "-" + C.pad(+m[2]) + "-" + C.pad(+m[3]);
    m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (m) {
      var y = +m[3]; if (y < 100) y += 2000;
      var d = +m[1], mo = +m[2];
      if (mo > 12 && d <= 12) { var tmp = d; d = mo; mo = tmp; }
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
      return y + "-" + C.pad(mo) + "-" + C.pad(d);
    }
    return "";
  }

  // ------------------------------------------------------------- statements
  var HEAD = {
    date: /^(תאריך( ה?עסקה| רכישה| פעולה)?|date)$/i,
    date2: /תאריך/,
    desc: /(שם בית ה?עסק|תיאור|פרטים|הפעולה|סוג פעולה|בית עסק|description|merchant)/i,
    charge: /(סכום חיוב|סכום לחיוב|חיוב בש"?ח|סכום בש"?ח)/,
    amount: /(^סכום$|סכום העסקה|סכום עסקה|amount|^סכום)/i,
    debit: /(חובה|debit)/i,
    credit: /(זכות|credit)/i,
    balance: /(יתרה|balance)/i
  };

  // Find the header row and guess which column is what.
  function detect(rows) {
    for (var r = 0; r < Math.min(rows.length, 40); r++) {
      var row = (rows[r] || []).map(s);
      var hasDate = row.some(function (c) { return HEAD.date2.test(c); });
      var hasAmt = row.some(function (c) { return HEAD.amount.test(c) || HEAD.debit.test(c) || HEAD.charge.test(c); });
      if (!hasDate || !hasAmt) continue;
      var map = { headerRow: r, date: -1, desc: -1, amount: -1, debit: -1, credit: -1 };
      row.forEach(function (c, i) {
        if (map.date === -1 && HEAD.date.test(c)) map.date = i;
        if (map.desc === -1 && HEAD.desc.test(c)) map.desc = i;
        if (HEAD.charge.test(c)) map.amount = i;
        else if (map.amount === -1 && HEAD.amount.test(c) && !HEAD.balance.test(c)) map.amount = i;
        if (map.debit === -1 && HEAD.debit.test(c)) map.debit = i;
        if (map.credit === -1 && HEAD.credit.test(c) && !/כרטיס/.test(c)) map.credit = i;
      });
      if (map.date === -1) map.date = row.findIndex(function (c) { return HEAD.date2.test(c); });
      if (map.desc === -1) {
        // widest text column in the next rows
        var best = -1, bestLen = 0;
        for (var i = 0; i < row.length; i++) {
          if (i === map.date || i === map.amount || i === map.debit || i === map.credit) continue;
          var len = 0;
          for (var k = r + 1; k < Math.min(rows.length, r + 15); k++) { var v = s((rows[k] || [])[i]); if (v && isNaN(parseFloat(v))) len += v.length; }
          if (len > bestLen) { bestLen = len; best = i; }
        }
        map.desc = best;
      }
      return map;
    }
    return { headerRow: -1, date: 0, desc: 1, amount: 2, debit: -1, credit: -1 };
  }

  /*
   * Build transactions from rows using a column map.
   * opts.positiveIsExpense: for credit cards (positive charge = expense).
   */
  function toTransactions(rows, map, opts) {
    opts = opts || {};
    var out = [];
    for (var r = map.headerRow + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var date = parseDate(row[map.date]);
      if (!date) continue;
      var desc = s(row[map.desc]);
      var amount = null, type = "expense";
      if (map.debit >= 0 || map.credit >= 0) {
        var dbt = map.debit >= 0 ? parseAmount(row[map.debit]) : null;
        var crd = map.credit >= 0 ? parseAmount(row[map.credit]) : null;
        if (dbt) { amount = Math.abs(dbt); type = "expense"; }
        else if (crd) { amount = Math.abs(crd); type = "income"; }
      }
      if (amount === null && map.amount >= 0) {
        var a = parseAmount(row[map.amount]);
        if (a === null || a === 0) continue;
        if (opts.positiveIsExpense) { type = a >= 0 ? "expense" : "income"; }
        else { type = a < 0 ? "expense" : "income"; }
        amount = Math.abs(a);
      }
      if (!amount) continue;
      if (/^(סה"?כ|total)/i.test(desc)) continue;
      out.push({ date: date, description: desc, amount: C.round2(amount), type: type });
    }
    return out;
  }

  // PDF: pdf.js text items -> lines -> transactions (best effort, editable afterwards).
  function linesFromPdfItems(items) {
    var rows = {};
    items.forEach(function (it) {
      var y = Math.round(it.transform[5] / 3) * 3;
      (rows[y] = rows[y] || []).push({ x: it.transform[4], str: it.str });
    });
    return Object.keys(rows).map(Number).sort(function (a, b) { return b - a; }).map(function (y) {
      return rows[y].sort(function (a, b) { return b.x - a.x; }).map(function (p) { return p.str; }).join(" ").replace(/\s+/g, " ").trim();
    }).filter(Boolean);
  }
  function transactionsFromLines(lines, opts) {
    opts = opts || {};
    var out = [];
    lines.forEach(function (line) {
      var dm = line.match(/(\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4})/);
      if (!dm) return;
      var date = parseDate(dm[1]);
      if (!date) return;
      var rest = line.replace(dm[0], " ");
      rest = rest.replace(/\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}/g, " "); // secondary dates
      var amts = rest.match(/-?₪?\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})|-?\d+\.\d{2}/g);
      if (!amts || !amts.length) return;
      var a = parseAmount(amts[0]);
      if (!a) return;
      var desc = rest;
      amts.forEach(function (x) { desc = desc.replace(x, " "); });
      desc = desc.replace(/[₪]/g, " ").replace(/\s+/g, " ").trim();
      var type = opts.positiveIsExpense ? (a >= 0 ? "expense" : "income") : (a < 0 ? "expense" : "income");
      out.push({ date: date, description: desc, amount: C.round2(Math.abs(a)), type: type });
    });
    return out;
  }

  // ------------------------------------------------------------- planning workbook
  var GROUP_WORDS = { "קבוע": "fixed", "צריכה שוטפת": "current", "משתנות": "variable", "מעשרות/צדקה": "maaser",
    "מעגל השנה": "annual", "הוצאות שוטפות": "annual", "החזרי חובות / חסכונות": "debt" };

  function cell(grid, r, c) { return grid[r] ? grid[r][c] : undefined; }

  /*
   * grid: 2-D array of one sheet. annual: true for the yearly sheet
   * (amounts are per year - stored as annualBudget and budget = /12).
   * Returns [{name, group, budget, annualBudget, note}]
   */
  function planningCategories(grid, annual) {
    var out = [];
    var R = grid.length;
    for (var r = 0; r < R; r++) {
      var row = grid[r] || [];
      for (var c = 0; c < row.length; c++) {
        var v = s(row[c]);
        var isHdr = v === "פירוט" || v === "עיסוק" || v === "מקורות אחרים" || /^שם הגמ"ח/.test(v);
        if (!isHdr) continue;
        var amtCol = -1;
        for (var k = c + 1; k < Math.min(row.length, c + 5); k++) {
          if (/^(ה?סכום( כיום)?)$/.test(s(row[k]))) { amtCol = k; break; }
        }
        if (amtCol === -1) continue;
        // group: look up the column for a section title
        var group = /^שם הגמ"ח/.test(v) ? "debt" : null;
        var incomeBlock = v === "עיסוק" || v === "מקורות אחרים";
        var labelStart = c;
        if (incomeBlock) { group = "income"; labelStart = Math.max(0, c - 1); }
        for (var up = r - 1; up >= Math.max(0, r - 6) && !group; up--) {
          for (var cc = c - 1; cc <= c + 1 && !group; cc++) {
            var t = s(cell(grid, up, cc));
            if (GROUP_WORDS[t]) group = GROUP_WORDS[t];
            else if (/ירידת/.test(t)) group = "unexpected";   // e.g. "ירידת פריון עבודה" = lost income
            else if (/הכנסות/.test(t)) group = "income";
          }
        }
        if (!group && /פירוט/.test(v) && labelStart <= 3) group = "income";
        if (!group) group = annual ? "annual" : "fixed";
        if (annual && group !== "income" && group !== "debt") group = "annual";
        var carry = "", blank = 0, stop = false;
        for (var rr = r + 1; rr < R && blank < 5 && !stop; rr++) {
          var cells = grid[rr] || [];
          var lab = "", rowCarry = "";
          for (var lc = labelStart; lc < amtCol; lc++) {
            var lv = s(cells[lc]);
            if (lv === "פירוט" || lv === "עיסוק" || lv === "מקורות אחרים" || /^שם הגמ"ח/.test(lv) || /^סה"כ/.test(lv)) { stop = true; break; }
            if (lv && isNaN(Number(lv))) {
              if (incomeBlock && lc === labelStart && amtCol - labelStart > 1) { carry = rowCarry = lv; continue; }
              lab = lv;
            }
          }
          if (stop) break;
          if (/^\*/.test(lab)) break;
          // a person's name in the first column applies to the job lines below it
          if (!lab && rowCarry) lab = rowCarry;
          else if (lab && carry && incomeBlock && lab !== carry) lab = carry + " - " + lab;
          var amt = parseAmount(cells[amtCol]);
          if (!lab && amt === null) { blank++; continue; }
          blank = 0;
          if (!lab || !amt || amt <= 0) continue;
          lab = lab.replace(/\*+$/, "").replace(/\s+/g, " ").trim();
          out.push({ name: lab, group: group, budget: annual ? Math.round(amt / 12) : amt, annualBudget: annual ? amt : "", note: s(cells[amtCol + 1]) });
        }
      }
    }
    // de-duplicate by name
    var seen = {};
    return out.filter(function (x) { var k = x.name + "|" + x.group; if (seen[k]) return false; seen[k] = true; return true; });
  }

  function planningLoans(grid) {
    var out = [];
    for (var r = 0; r < grid.length; r++) {
      var row = (grid[r] || []).map(s);
      var ni = row.findIndex(function (c) { return /^שם הגמ"ח/.test(c); });
      var oi = row.findIndex(function (c) { return /סכום הלוואה מקורי/.test(c); });
      if (ni === -1 || oi === -1) continue;
      var pi = row.findIndex(function (c) { return /תשלומים שנותרו/.test(c); });
      var mi = row.findIndex(function (c) { return /סכום כל תשלום/.test(c); });
      var bi = row.findIndex(function (c) { return /יתרת חוב/.test(c); });
      var ri = row.findIndex(function (c) { return /יתרה לפרעון/.test(c); });
      var xi = row.findIndex(function (c) { return /^הערות$/.test(c); });
      for (var rr = r + 1; rr < grid.length; rr++) {
        var x = grid[rr] || [];
        var name = s(x[ni]);
        if (!name) { if (!s(x[oi]) && !s(x[mi])) { if (rr - r > 25) break; continue; } }
        if (/^(שם הגמ"ח|חובות|סה"כ)/.test(name)) break;
        var orig = parseAmount(x[oi]);
        if (!name || !orig) continue;
        out.push({
          name: name, lender: name.replace(/\s*(הלוואה|משכנתא)\s*/g, " ").trim(),
          type: /משכנתא/.test(name) ? "mortgage" : "loan",
          originalAmount: orig, paymentsLeft: parseAmount(x[pi]) || "", monthlyPayment: parseAmount(x[mi]) || "",
          balance: parseAmount(x[bi]) || parseAmount(x[ri]) || "", notes: xi >= 0 ? s(x[xi]) : ""
        });
      }
    }
    return out;
  }

  return {
    parseAmount: parseAmount, parseDate: parseDate, detect: detect, toTransactions: toTransactions,
    linesFromPdfItems: linesFromPdfItems, transactionsFromLines: transactionsFromLines,
    planningCategories: planningCategories, planningLoans: planningLoans
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Importers;
