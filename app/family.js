/* family.js - "ניהול כלכלת המשפחה": overview, monthly drill-down, statement import,
   budgets, auto-categorisation rules, mortgages & loans. */
(function () {
  "use strict";
  var C = Core, h = UI.h, raw = UI.raw;
  var Pages = window.Pages = window.Pages || {};
  var Actions = window.Actions = window.Actions || {};
  var ui = { year: String(new Date().getFullYear()), month: C.thisMonth(), catFilter: "", txSearch: "", accFilter: "", imp: null };

  // Self-hosted (app/vendor) so no third-party script ever runs on this page.
  var XLSX_SRC = "vendor/xlsx.full.min.js";
  var PDF_SRC = "vendor/pdf.min.js";
  var PDF_WORKER = "vendor/pdf.worker.min.js";

  function cats() { return (App.db.family_categories || []).slice().sort(function (a, b) { return Object.keys(C.FAMILY_GROUPS).indexOf(a.group) - Object.keys(C.FAMILY_GROUPS).indexOf(b.group) || String(a.name).localeCompare(String(b.name), "he"); }); }
  function catOptions(selected, type) {
    var groups = {};
    cats().forEach(function (c) {
      if (type === "income" && c.group !== "income" && c.group !== "business") return;
      if (type === "expense" && c.group === "income") return;
      (groups[c.group] = groups[c.group] || []).push(c.name);
    });
    var unc = "לא מסווג";
    return [h`<option value="${unc}" ${!selected || selected === unc ? raw("selected") : ""}>${unc}</option>`].concat(Object.keys(groups).map(function (g) {
      return h`<optgroup label="${C.FAMILY_GROUPS[g] || g}">${UI.options(groups[g].filter(function (n) { return n !== unc; }), selected)}</optgroup>`;
    })).concat([h`<option value="__new">➕ קטגוריה חדשה...</option>`]);
  }
  function bizCats() { return C.businessCats(App.settings()); }
  function bizGroupCats() { var m = {}; (App.db.family_categories || []).forEach(function (c) { if (c.group === "business") m[c.name] = true; }); return m; }
  function catNames() { return (App.db.family_categories || []).map(function (c) { return c.name; }); }
  // "➕ קטגוריה חדשה..." picked in a dropdown: create it, then use it there.
  function newCatFromSelect(sel, type, use) {
    sel.value = sel.dataset.prev || "לא מסווג";
    catForm(null, { group: type === "income" ? "income" : "current", onSaved: use });
  }
  function accounts() {
    var saved = App.settings().familyAccounts;
    if (typeof saved === "string") { try { saved = JSON.parse(saved); } catch (e) { saved = null; } }
    var set = (Array.isArray(saved) && saved.length ? saved : C.ACCOUNTS).slice();
    (App.db.family_tx || []).forEach(function (t) { if (t.account && set.indexOf(t.account) === -1) set.push(t.account); });
    return set;
  }
  function monthNav(key) {
    return h`<div class="month-nav"><button data-act="fMonthStep" data-d="1" aria-label="חודש הבא">›</button><span>${C.monthLabel(ui.month)}</span><button data-act="fMonthStep" data-d="-1" aria-label="חודש קודם">‹</button></div>`;
  }
  Actions.fMonthStep = function (t) { ui.month = C.addMonths(ui.month, +t.dataset.d); App.render(); };

  // ================================================================ overview
  Pages["family/overview"] = function () {
    var db = App.db;
    var months = [];
    for (var i = 1; i <= 12; i++) months.push(ui.year + "-" + C.pad(i));
    var fms = months.map(function (m) { return C.familyMonth(db, m); });
    var cur = C.familyMonth(db, C.thisMonth());
    var loans = C.loansSummary(db);
    var yearOpts = [];
    for (var y = new Date().getFullYear() + 1; y >= 2024; y--) yearOpts.push(String(y));
    // Only months up to today count (future months would just show fixed business costs).
    var nowMk = C.thisMonth();
    fms.forEach(function (f) { if (f.month > nowMk && !f.tx.length) { f.businessNet = 0; f.totalIncome = f.otherIncome; f.balance = f.totalIncome - f.totalExpense; } });
    var tot = { inc: 0, exp: 0, biz: 0 };
    fms.forEach(function (f) { tot.inc += f.totalIncome; tot.exp += f.totalExpense; tot.biz += f.businessNet; });
    var active = fms.filter(function (f) { return f.tx.length || f.businessNet; }).length || 1;
    // group totals per month (annual view)
    var groups = Object.keys(C.FAMILY_GROUPS).filter(function (g) { return g !== "income" && g !== "business"; });
    var gm = fms.map(function (f) {
      var o = {};
      f.categories.forEach(function (r) { if (r.group !== "income") o[r.group] = (o[r.group] || 0) + r.actual; });
      return o;
    });
    var budgetTotal = cats().filter(function (c) { return c.group !== "income" && c.group !== "business"; }).reduce(function (s, c) { return s + C.num(c.budget); }, 0);
    return h`<div class="page-head"><div><h1>כלכלת המשפחה</h1><div class="sub">מבט-על חודשי ושנתי · הכנסות העסק מוזרמות אוטומטית</div></div>
      <div class="row"><select data-change="fYear" aria-label="שנה" style="width:auto">${UI.options(yearOpts, ui.year)}</select><a class="btn btn-primary btn-sm" href="#family/import">⇪ ייבוא דוחות</a></div></div>

    <div class="grid grid-4">
      <div class="tile"><div class="lbl">הכנסות ${C.monthLabel(cur.month)}</div><div class="val">${C.fmtMoney(cur.totalIncome)}</div><div class="hint">מתוכן מהעסק (נטו): ${C.fmtMoney(cur.businessNet)}</div></div>
      <div class="tile"><div class="lbl">הוצאות ${C.monthLabel(cur.month)}</div><div class="val">${C.fmtMoney(cur.totalExpense)}</div><div class="hint">תקציב חודשי: ${C.fmtMoney(budgetTotal)}</div></div>
      <div class="tile ${cur.balance >= 0 ? "good" : "bad"}"><div class="lbl">יתרה החודש</div><div class="val">${C.fmtMoney(cur.balance)}</div></div>
      <div class="tile"><div class="lbl">החזרי משכנתאות והלוואות</div><div class="val">${C.fmtMoney(loans.monthlyTotal)}</div><div class="hint">לחודש · יתרה כוללת ${C.fmtMoney(loans.balanceTotal)}</div></div>
    </div>

    ${cur.overBudget.length || cur.uncategorized ? h`<div class="card section"><div class="card-title"><h3>התראות החודש</h3></div><div class="alist">
      ${cur.overBudget.map(function (r) { return h`<div class="aitem bad"><span>⚠️</span><span class="who">חריגה: ${r.category}</span><span class="when">${C.fmtMoney(r.actual)} מתוך תקציב ${C.fmtMoney(r.budget)} (${Math.round(r.pct * 100)}%)</span>
        <span class="acts"><a class="btn btn-outline btn-xs" href="#family/month" data-act="fDrill" data-m="${cur.month}" data-cat="${r.category}">לפירוט</a></span></div>`; })}
      ${cur.uncategorized ? h`<div class="aitem warn"><span>🏷</span><span class="who">${cur.uncategorized} תנועות לא מסווגות</span><span class="acts"><a class="btn btn-outline btn-xs" href="#family/month" data-act="fDrill" data-m="${cur.month}" data-cat="לא מסווג">לסיווג</a></span></div>` : ""}
    </div></div>` : ""}

    <div class="card section"><div class="card-title"><h3>הכנסות מול הוצאות ${ui.year}</h3><span class="sub">ממוצע חודשי: הכנסות ${C.fmtMoney(tot.inc / active)} · הוצאות ${C.fmtMoney(tot.exp / active)}</span></div>
      ${UI.barChart({ labels: months.map(function (m) { return C.HE_MONTHS[+m.slice(5) - 1].slice(0, 3) + "׳"; }), fullLabels: months.map(C.monthLabel),
        series: [{ name: "הכנסות", color: "var(--series-1)", values: fms.map(function (f) { return f.totalIncome; }) }, { name: "הוצאות", color: "var(--series-2)", values: fms.map(function (f) { return f.totalExpense; }) }], format: C.fmtMoney })}</div>

    <div class="card section"><div class="card-title"><h3>תמונה שנתית לפי חודשים</h3><span class="sub">לחיצה על חודש לפירוט מלא</span></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>חודש</th><th class="n">הכנסה מהעסק</th><th class="n">הכנסות אחרות</th>${groups.map(function (g) { return h`<th class="n">${C.FAMILY_GROUPS[g]}</th>`; })}<th class="n">סה"כ הוצאות</th><th class="n">יתרה</th><th>חריגות</th></tr></thead>
      <tbody>${fms.map(function (f, i) {
        return h`<tr class="click" data-act="fDrill" data-m="${months[i]}"><td class="nowrap">${C.monthLabel(months[i])}</td><td class="n">${C.fmtMoney(f.businessNet)}</td><td class="n">${C.fmtMoney(f.otherIncome)}</td>
          ${groups.map(function (g) { return h`<td class="n">${gm[i][g] ? C.fmtMoney(gm[i][g]) : ""}</td>`; })}
          <td class="n">${C.fmtMoney(f.totalExpense)}</td><td class="n"><b class="${f.balance < 0 ? "t-bad" : "t-good"}">${f.tx.length || f.businessNet ? C.fmtMoney(f.balance) : ""}</b></td>
          <td>${f.overBudget.length ? h`<span class="badge bad">${f.overBudget.length}</span>` : ""}</td></tr>`;
      })}</tbody><tfoot><tr><td>סה"כ</td><td class="n">${C.fmtMoney(tot.biz)}</td><td class="n">${C.fmtMoney(tot.inc - tot.biz)}</td>${groups.map(function (g) { return h`<td class="n">${C.fmtMoney(gm.reduce(function (s, o) { return s + (o[g] || 0); }, 0))}</td>`; })}
        <td class="n">${C.fmtMoney(tot.exp)}</td><td class="n">${C.fmtMoney(tot.inc - tot.exp)}</td><td></td></tr></tfoot></table></div></div>`;
  };
  Actions.fYear = function (t) { ui.year = t.value; App.render(); };
  Actions.fDrill = function (t) { ui.month = t.dataset.m; ui.catFilter = t.dataset.cat || ""; location.hash = "#family/month"; };

  // ================================================================ month drill-down
  Pages["family/month"] = function () {
    var f = C.familyMonth(App.db, ui.month);
    var q = ui.txSearch.trim().toLowerCase();
    var tx = (App.db.family_tx || []).filter(function (t) { return C.monthKey(t.date) === ui.month; }).filter(function (t) {
      if (ui.catFilter && (t.category || "לא מסווג") !== ui.catFilter) return false;
      if (ui.accFilter && t.account !== ui.accFilter) return false;
      if (q && String(t.description || "").toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    // business transactions live in the business tab; shown here only on request
    var bizG = bizGroupCats();
    var bizRows = tx.filter(function (t) { return C.bool(t.business) || bizG[t.category]; });
    if (!ui.showBiz) tx = tx.filter(function (t) { return !(C.bool(t.business) || bizG[t.category]); });
    var groups = {};
    f.categories.forEach(function (r) { (groups[r.group] = groups[r.group] || []).push(r); });
    var order = Object.keys(C.FAMILY_GROUPS);
    return h`<div class="page-head"><div><h1>פירוט חודשי</h1><div class="sub">כל ההכנסות וההוצאות, עם אפשרות עריכה וסיווג ידני</div></div>
      <div class="row">${monthNav()}${f.uncategorized ? h`<button class="btn btn-primary btn-sm" data-act="sortTx">🗂 מיון שורה-שורה (${f.uncategorized})</button>` : ""}<button class="btn btn-outline btn-sm" data-act="newTx">+ תנועה ידנית</button></div></div>
    <div class="grid grid-4">
      <div class="tile"><div class="lbl">💼 נכנס מהעסק (נטו)</div><div class="val">${C.fmtMoney(f.businessNet)}</div><div class="hint"><a href="#biz/pnl">הפירוט בניהול העסק ←</a></div></div>
      <div class="tile"><div class="lbl">הכנסות אחרות</div><div class="val">${C.fmtMoney(f.otherIncome)}</div><div class="hint">משכורות, קצבאות ועוד</div></div>
      <div class="tile"><div class="lbl">הוצאות המשפחה</div><div class="val">${C.fmtMoney(f.totalExpense)}</div></div>
      <div class="tile ${f.balance >= 0 ? "good" : "bad"}"><div class="lbl">נשאר החודש</div><div class="val">${C.fmtMoney(f.balance)}</div><div class="hint">כל ההכנסות פחות ההוצאות</div></div></div>
    ${(function () {
      var cand = Object.keys(C.matchClientPayments(App.db, (App.db.family_tx || []).filter(function (x) { return C.monthKey(x.date) === ui.month && !C.bool(x.excluded); }))).length;
      return cand ? h`<div class="aitem warn" style="margin-top:12px">🔗 <span>${cand} הפקדות בבנק נראות כמו תשלומים מלקוחות שכבר רשומים בעסק (אותו סכום, תאריך קרוב).</span><button class="btn btn-primary btn-xs" data-act="matchDeposits">סימון כ"הכנסה מהעסק"</button></div>` : "";
    })()}
    ${f.businessDepositsCount || f.businessPaidCount ? h`<p class="small muted" style="margin:8px 2px 0">💼 תנועות של העסק בבנק ובאשראי (תשלומי לקוחות, הוצאות עסק) כבר כלולות ב"נכנס מהעסק" - הן מסומנות 💼 ברשימה ולא נספרות כאן פעמיים.</p>` : ""}
    <div class="grid section fam-split" style="align-items:start">
      <div class="card"><div class="card-title"><h3>לפי קטגוריות</h3>${ui.catFilter ? h`<button class="chip active" data-act="fCat" data-cat="">סינון: ${ui.catFilter} ✕</button>` : ""}</div>
        ${order.filter(function (g) { return groups[g]; }).map(function (g) {
          var rows = groups[g].sort(function (a, b) { return b.actual - a.actual; });
          return h`<h4 class="small muted" style="margin:12px 0 6px">${C.FAMILY_GROUPS[g]}</h4>
          <div class="table-wrap"><table class="t"><tbody>${rows.map(function (r) {
            var cls = r.over ? "bad" : r.pct > .85 ? "warn" : "good";
            return h`<tr class="click ${r.over ? "flag-bad" : ""}" data-act="fCat" data-cat="${r.category}"><td>${r.category}${r.over ? h` <span class="badge bad">חריגה</span>` : ""}</td>
              <td class="n">${C.fmtMoney(r.actual)}${r.budget ? h`<span class="small muted"> / ${C.fmtMoney(r.budget)}</span>` : ""}</td>
              <td style="width:30%">${r.budget && g !== "income" ? UI.bar(r.pct, cls) : ""}</td>
              <td class="nowrap" style="width:1%">${r.category !== "לא מסווג" ? h`<button class="btn btn-ghost btn-xs" data-act="editCatName" data-cat="${r.category}" title="עריכת הקטגוריה: שם, קבוצה, תקציב" aria-label="עריכת קטגוריה">✎</button>` : ""}</td></tr>`;
          })}</tbody></table></div>`;
        })}
        ${!f.categories.length ? (function () {
          var last = (App.db.family_tx || []).map(function (x) { return C.monthKey(x.date); }).filter(Boolean).sort().pop();
          return last && last !== ui.month
            ? h`<div class="empty">אין תנועות ב${C.monthLabel(ui.month)}.<div style="margin-top:10px"><button class="btn btn-primary btn-sm" data-act="fGoMonth" data-m="${last}">מעבר ל${C.monthLabel(last)} (החודש האחרון עם נתונים)</button></div></div>`
            : h`<div class="empty">אין נתונים לחודש זה. <a href="#family/import">ייבוא דוחות</a></div>`;
        })() : ""}
        <div class="row" style="margin-top:12px"><button class="btn btn-outline btn-sm" data-act="newCat">+ קטגוריה חדשה</button><a class="btn btn-ghost btn-sm" href="#family/budget">כל הקטגוריות והתקציב ←</a></div>
      </div>
      <div class="card"><div class="card-title"><h3>תנועות (${tx.length})</h3></div>
        <div class="toolbar"><input type="search" placeholder="חיפוש בית עסק..." value="${ui.txSearch}" data-change="fTxSearch" aria-label="חיפוש">
          <select data-change="fAcc" aria-label="חשבון">${UI.options([["", "כל החשבונות"]].concat(accounts().map(function (a) { return [a, a]; })), ui.accFilter)}</select>
          ${bizRows.length ? h`<button class="chip ${ui.showBiz ? "active" : ""}" data-act="fShowBiz" title="תנועות שכבר נספרות בעסק">💼 ${ui.showBiz ? "הסתרת" : "הצגת"} ${bizRows.length} תנועות העסק</button>` : ""}</div>
        <div class="table-wrap" style="max-height:70vh;overflow:auto"><table class="t"><thead><tr><th>תאריך</th><th>תיאור</th><th class="n">סכום</th><th>קטגוריה</th><th></th></tr></thead><tbody>
        ${tx.length ? tx.map(function (t) {
            var biz = C.bool(t.business);
          return h`<tr style="${C.bool(t.excluded) ? "opacity:.45" : ""}"><td class="nowrap small">${C.fmtDate(t.date)}${t.purchaseDate && t.purchaseDate !== t.date ? h`<div class="muted">קנייה ${C.fmtDate(t.purchaseDate)}</div>` : ""}</td>
            <td><div>${t.description}</div><div class="small muted">${[t.account, t.branch, t.note].filter(Boolean).join(" · ")}${C.bool(t.excluded) ? " · לא נספר" : ""}${!biz && bizGroupCats()[t.category] ? h` · <b style="color:var(--gold-deep)">💼 נספר רק בעסק</b>` : ""}</div></td>
            <td class="n ${t.type === "income" ? "t-good" : ""}">${t.type === "income" ? "+" : ""}${C.fmtMoney(t.amount)}</td>
            <td>${biz ? (t.type === "income" ? h`<span class="badge gold" title="כבר נספר בהכנסות העסק - לא נספר שוב כאן">💼 הכנסה מהעסק${t.matchNote ? " · " + t.matchNote : ""}</span>` : h`<span class="badge gold" title="נספר בהוצאות העסק, לא בתקציב המשפחה">💼 עסק · ${t.businessCategory || "שונות"}</span>`) : h`<select data-change="fSetCat" data-id="${t.id}" style="min-height:32px;padding:4px 6px;font-size:12.5px">${catOptions(t.category || "לא מסווג", t.type)}</select>`}</td>
            <td class="nowrap">${!C.bool(t.excluded) ? h`<button class="btn btn-ghost btn-xs" data-act="txBiz" data-id="${t.id}" title="${biz ? "להחזיר לתקציב המשפחה" : t.type === "income" ? "תשלום מלקוח שכבר רשום בעסק - לא לספור פעמיים" : "הוצאה של העסק - להעביר לעסק"}" aria-label="${biz ? "להחזיר למשפחה" : "להעביר לעסק"}">${biz ? "↩" : "💼"}</button>` : ""}<button class="btn btn-ghost btn-xs" data-act="txSkip" data-id="${t.id}" title="${C.bool(t.excluded) ? "לספור שוב בתקציב" : "לא הכנסה ולא הוצאה (החזר מחבר, העברה בין חשבונות) - לא לספור"}" aria-label="לא לספור">${C.bool(t.excluded) ? "↺" : "⊘"}</button><button class="btn btn-ghost btn-xs" data-act="editTx" data-id="${t.id}" aria-label="עריכה">✎</button></td></tr>`;
        }) : h`<tr><td colspan="5" class="empty">אין תנועות</td></tr>`}</tbody></table></div></div>
    </div>`;
  };
  // Business expense picker: business category + optional rule for next time.
  function bizModal(desc, done) {
    var key = suggestPattern(desc);
    var m = UI.modal({ title: "💼 הוצאה של העסק", noFocus: true,
      body: h`<p class="small muted">ההוצאה תעבור ל"הוצאות העסק" (רווח והפסד) ולא תיספר בתקציב המשפחה.</p>
        <label class="field" style="margin-top:10px"><span>קטגוריה בעסק</span><select id="bizCat">${UI.options(bizCats(), bizCats()[0])}</select></label>
        ${key ? h`<label class="check" style="margin-top:12px"><input type="checkbox" id="bizRule" checked> לזכור: כל חיוב שמכיל <input type="text" id="bizPat" value="${key}" style="width:auto;display:inline-block;min-height:30px;padding:2px 8px"> הוא של העסק</label>` : ""}`,
      foot: h`<button class="btn btn-primary" data-ok>העברה לעסק</button><button class="btn btn-outline" data-close>ביטול</button>` });
    m.$("[data-ok]").addEventListener("click", async function () {
      var cat = m.$("#bizCat").value;
      var pat = m.$("#bizRule") && m.$("#bizRule").checked ? m.$("#bizPat").value.trim() : "";
      m.close();
      if (pat) await App.save("family_rules", [{ id: C.uid("fr"), pattern: pat, category: cat, business: "true", priority: "1" }], { toast: false, silent: true });
      done(cat, pat);
    });
  }
  Actions.txBiz = async function (t) {
    var tx = C.byId(App.db.family_tx, t.dataset.id);
    if (C.bool(tx.business)) { App.save("family_tx", [{ id: tx.id, business: "", businessCategory: "", paymentId: "", matchNote: "" }], { msg: "הוחזר לתקציב המשפחה" }); return; }
    if (tx.type === "income") {
      var hit = C.matchClientPayments(App.db, [tx], 14)[0];
      App.save("family_tx", [{ id: tx.id, business: "true", paymentId: hit ? hit.id : "", matchNote: hit ? "תשלום של " + App.clientName(hit.clientId) + " מ-" + C.fmtDate(hit.date) : "" }],
        { msg: "סומן כהכנסה מהעסק" + (hit ? " (" + App.clientName(hit.clientId) + ")" : "") + " - לא ייספר פעמיים" });
      return;
    }
    bizModal(tx.description, async function (cat, pat) {
      var upd = [{ id: tx.id, business: "true", businessCategory: cat }];
      if (pat) (App.db.family_tx || []).forEach(function (x) {
        if (x.id !== tx.id && x.type === "expense" && !C.bool(x.excluded) && !C.bool(x.business) && String(x.description).indexOf(pat) !== -1) upd.push({ id: x.id, business: "true", businessCategory: cat });
      });
      await App.save("family_tx", upd, { msg: upd.length > 1 ? upd.length + " הוצאות הועברו לעסק" : "הועבר להוצאות העסק" });
    });
  };
  // ---------------------------------------------------------------- start over
  Actions.resetCats = async function () {
    var n = (App.db.family_categories || []).length;
    var txs = (App.db.family_tx || []).filter(function (x) { return x.category && x.category !== "לא מסווג"; });
    var rules = (App.db.family_rules || []).filter(function (r) { return !C.bool(r.business); });
    if (!(await UI.confirm("התחלה מחדש", "יימחקו " + n + " הקטגוריות של המשפחה ו-" + rules.length + " חוקי הסיווג שלהן, ו-" + txs.length +
      " תנועות יחזרו ל\"לא מסווג\". הוצאות העסק (💼) והחוקים שלהן נשארים. אחר כך ממיינים שורה-שורה ויוצרים רק את הקטגוריות שצריך.", "מחיקה והתחלה מחדש", true))) return;
    if (txs.length) await App.save("family_tx", txs.map(function (x) { return { id: x.id, category: "לא מסווג" }; }), { toast: false, silent: true });
    if (rules.length) await App.remove("family_rules", rules.map(function (r) { return r.id; }));
    if (n) await App.remove("family_categories", (App.db.family_categories || []).map(function (c) { return c.id; }));
    var last = (App.db.family_tx || []).map(function (x) { return C.monthKey(x.date); }).filter(Boolean).sort().pop();
    if (last) ui.month = last;
    location.hash = "#family/month";
    UI.toast("הקטגוריות נמחקו - עכשיו אפשר למיין שורה-שורה");
  };

  // ---------------------------------------------------------------- sort one by one
  // Shows one uncategorised transaction at a time with a button per category.
  Actions.sortTx = function () {
    var skipped = {};
    var m = UI.modal({ title: "🗂 מיון שורה-שורה", wide: true, body: h`<div id="sortBox"></div>`,
      foot: h`<span class="small muted" id="sortLeft"></span><span class="grow"></span><button class="btn btn-outline" data-close>סיום</button>`,
      onClose: function () { App.render(); } });
    function queue() {
      return (App.db.family_tx || []).filter(function (t) {
        return C.monthKey(t.date) === ui.month && !C.bool(t.excluded) && !C.bool(t.business) && (!t.category || t.category === "לא מסווג") && !skipped[t.id];
      }).sort(function (a, b) { return C.num(b.amount) - C.num(a.amount); });
    }
    function show() {
      var q = queue(), t = q[0];
      m.$("#sortLeft").textContent = q.length ? "נשארו " + q.length + " ב" + C.monthLabel(ui.month) : "";
      if (!t) { UI.setHtml(m.$("#sortBox"), h`<div class="empty">✓ כל התנועות של ${C.monthLabel(ui.month)} ממוינות</div>`); return; }
      var key = suggestPattern(t.description);
      var same = q.filter(function (x) { return x.id !== t.id && key && String(x.description).indexOf(key) !== -1; }).length;
      var groups = {};
      cats().forEach(function (c) {
        if (t.type === "income" ? (c.group !== "income" && c.group !== "business") : c.group === "income") return;
        (groups[c.group] = groups[c.group] || []).push(c.name);
      });
      UI.setHtml(m.$("#sortBox"), h`<div class="aitem" style="display:block;padding:14px 16px">
          <div class="row between"><b style="font-size:18px">${t.description}</b><b style="font-size:20px" class="${t.type === "income" ? "t-good" : ""}">${t.type === "income" ? "+" : ""}${C.fmtMoney(t.amount)}</b></div>
          <div class="small muted" style="margin-top:4px">${[C.fmtDate(t.date), t.purchaseDate && t.purchaseDate !== t.date ? "קנייה " + C.fmtDate(t.purchaseDate) : "", t.account, t.branch, t.note].filter(Boolean).join(" · ")}</div></div>
        ${Object.keys(groups).length ? Object.keys(C.FAMILY_GROUPS).filter(function (g) { return groups[g]; }).map(function (g) {
          return h`<div class="small muted" style="margin:12px 0 6px">${C.FAMILY_GROUPS[g]}</div><div class="chips">${groups[g].map(function (n) { return h`<button type="button" class="chip" data-pick="${n}">${n}</button>`; })}</div>`;
        }) : h`<p class="small muted" style="margin-top:12px">עוד אין קטגוריות - צרו את הראשונה כאן למטה.</p>`}
        <div class="row" style="margin-top:14px;gap:8px;flex-wrap:wrap">
          <input type="text" id="sortNew" placeholder="קטגוריה חדשה, למשל: מזון" style="flex:1;min-width:180px">
          <select id="sortGroup" style="width:auto">${UI.options(Object.keys(C.FAMILY_GROUPS).filter(function (g) { return t.type === "income" ? (g === "income" || g === "business") : g !== "income"; }).map(function (g) { return [g, C.FAMILY_GROUPS[g]]; }), t.type === "income" ? "income" : "current")}</select>
          <button type="button" class="btn btn-primary btn-sm" id="sortAdd">יצירה ושיוך</button></div>
        ${key ? h`<label class="check" style="margin-top:12px"><input type="checkbox" id="sortRemember" checked> לזכור: כל תנועה שמכילה <b>${key}</b> תסווג כך גם בעתיד${same ? " (וגם " + same + " נוספות עכשיו)" : ""}</label>` : ""}
        <div class="row" style="margin-top:14px;gap:8px">
          ${t.type === "expense" ? h`<button type="button" class="btn btn-outline btn-sm" id="sortBiz">💼 הוצאה של העסק</button>` : ""}
          <button type="button" class="btn btn-outline btn-sm" id="sortNot" title="החזר מחבר, העברה בין חשבונות, הלוואה שחזרה">⊘ לא הכנסה ולא הוצאה</button>
          <button type="button" class="btn btn-ghost btn-sm" id="sortSkip">דלג ←</button></div>`);
      async function assign(name) {
        var remember = m.$("#sortRemember") && m.$("#sortRemember").checked;
        var upd = [{ id: t.id, category: name }];
        if (remember && key) {
          queue().forEach(function (x) { if (x.id !== t.id && String(x.description).indexOf(key) !== -1) upd.push({ id: x.id, category: name }); });
          var has = (App.db.family_rules || []).some(function (r) { return r.pattern === key && r.category === name; });
          if (!has) await App.save("family_rules", [{ id: C.uid("fr"), pattern: key, category: name, priority: "1" }], { toast: false, silent: true });
        }
        await App.save("family_tx", upd, { toast: false, silent: true });
        show();
      }
      UI.$$("[data-pick]", m.el).forEach(function (b) { b.addEventListener("click", function () { assign(b.dataset.pick); }); });
      async function addNew() {
        var name = m.$("#sortNew").value.trim();
        if (!name) { m.$("#sortNew").focus(); return; }
        if (!(App.db.family_categories || []).some(function (c) { return c.name === name; }))
          await App.save("family_categories", [{ id: C.uid("fc"), name: name, group: m.$("#sortGroup").value, budget: "" }], { toast: false, silent: true });
        assign(name);
      }
      m.$("#sortAdd").addEventListener("click", addNew);
      m.$("#sortNew").addEventListener("keydown", function (e) { if (e.key === "Enter") addNew(); });
      m.$("#sortSkip").addEventListener("click", function () { skipped[t.id] = true; show(); });
      m.$("#sortNot").addEventListener("click", async function () { await App.save("family_tx", [{ id: t.id, excluded: "true" }], { toast: false, silent: true }); show(); });
      var bz = m.$("#sortBiz");
      if (bz) bz.addEventListener("click", function () {
        bizModal(t.description, async function (cat, pat) {
          var upd = [{ id: t.id, business: "true", businessCategory: cat }];
          if (pat) queue().forEach(function (x) { if (x.id !== t.id && x.type === "expense" && String(x.description).indexOf(pat) !== -1) upd.push({ id: x.id, business: "true", businessCategory: cat }); });
          await App.save("family_tx", upd, { toast: false, silent: true });
          show();
        });
      });
    }
    show();
  };
  Actions.txSkip = function (t) {
    var tx = C.byId(App.db.family_tx, t.dataset.id);
    var on = !C.bool(tx.excluded);
    App.save("family_tx", [{ id: tx.id, excluded: on ? "true" : "" }], { msg: on ? "לא נספר בתקציב (לא הכנסה ולא הוצאה)" : "נספר שוב בתקציב" });
  };
  Actions.matchDeposits = async function () {
    var list = (App.db.family_tx || []).filter(function (x) { return C.monthKey(x.date) === ui.month && !C.bool(x.excluded); });
    var hits = C.matchClientPayments(App.db, list);
    var upd = Object.keys(hits).map(function (k) { var x = list[k], p = hits[k]; return { id: x.id, business: "true", paymentId: p.id, matchNote: "תשלום של " + App.clientName(p.clientId) + " מ-" + C.fmtDate(p.date) }; });
    if (!upd.length) return;
    await App.save("family_tx", upd, { msg: upd.length + " הפקדות סומנו כהכנסה מהעסק" });
  };
  Actions.fShowBiz = function () { ui.showBiz = !ui.showBiz; App.render(); };
  Actions.fGoMonth = function (t) { ui.month = t.dataset.m; ui.catFilter = ""; App.render(); };
  Actions.fCat = function (t) { ui.catFilter = ui.catFilter === t.dataset.cat ? "" : t.dataset.cat; App.render(); };
  Actions.fTxSearch = function (t) { ui.txSearch = t.value; App.render(); };
  Actions.fAcc = function (t) { ui.accFilter = t.value; App.render(); };
  Actions.fSetCat = async function (t) {
    var tx = C.byId(App.db.family_tx, t.dataset.id);
    if (t.value === "__new") { t.dataset.prev = tx.category || "לא מסווג"; newCatFromSelect(t, tx.type, function (name) { Actions.fSetCat({ dataset: { id: tx.id }, value: name }); }); return; }
    var newCat = t.value;
    await App.save("family_tx", [{ id: tx.id, category: newCat }], { toast: false, silent: true });
    // offer a rule so next month's import classifies it automatically
    var key = suggestPattern(tx.description);
    var exists = (App.db.family_rules || []).some(function (r) { return r.pattern && String(tx.description).indexOf(r.pattern) !== -1 && r.category === newCat; });
    var same = (App.db.family_tx || []).filter(function (x) { return x.id !== tx.id && key && String(x.description).indexOf(key) !== -1 && x.category !== newCat; });
    if (key && !exists) {
      var m = UI.modal({ title: "לזכור את הסיווג?", noFocus: true,
        body: h`<p>לסווג אוטומטית מעכשיו כל תנועה שמכילה</p>
          <input type="text" id="rulePat" value="${key}" style="margin:10px 0">
          <p>לקטגוריה <b>${newCat}</b>?</p>${same.length ? h`<label class="check" style="margin-top:10px"><input type="checkbox" id="ruleApply" checked> לעדכן גם ${same.length} תנועות קיימות דומות</label>` : ""}`,
        foot: h`<button class="btn btn-primary" data-ok>כן, ליצור חוק</button><button class="btn btn-outline" data-close>לא, רק הפעם</button>`,
        onClose: function () { App.render(); } });
      m.$("[data-ok]").addEventListener("click", async function () {
        var pat = m.$("#rulePat").value.trim();
        var apply = m.$("#ruleApply") && m.$("#ruleApply").checked;
        m.close();
        if (!pat) return;
        // new rule goes first so it wins over generic ones
        var rules = [{ id: C.uid("fr"), pattern: pat, category: newCat, priority: "1" }];
        await App.save("family_rules", rules, { toast: false, silent: true });
        if (apply) {
          var upd = (App.db.family_tx || []).filter(function (x) { return String(x.description).indexOf(pat) !== -1 && x.category !== newCat; }).map(function (x) { return { id: x.id, category: newCat }; });
          if (upd.length) await App.save("family_tx", upd, { toast: false, silent: true });
        }
        App.render();
        UI.toast("החוק נשמר");
      });
    } else App.render();
  };
  // First two words of the description, exactly as written (so the rule really matches it),
  // skipping leading numbers such as cheque or branch codes.
  function suggestPattern(desc) {
    var m = String(desc || "").match(/(?:^|\s)([^\s]*[A-Za-z\u05D0-\u05EA][^\s]*(?:\s+[^\s]*[A-Za-z\u05D0-\u05EA][^\s]*)?)/);
    return m ? m[1].replace(/[)(,.:;]+$/, "") : "";
  }
  function sortedRules() {
    return (App.db.family_rules || []).slice().sort(function (a, b) { return C.num(b.priority) - C.num(a.priority); });
  }

  function txForm(t) {
    t = t || { date: C.ymd(new Date()), type: "expense", account: C.ACCOUNTS[0] };
    var m = UI.modal({
      title: t.id ? "עריכת תנועה" : "תנועה ידנית",
      body: h`<div class="form-grid" id="txBox">
        <label class="field"><span>סוג</span><select name="type">${UI.options([["expense", "הוצאה"], ["income", "הכנסה"]], t.type)}</select></label>
        <label class="field"><span>תאריך</span><input type="date" name="date" value="${t.date}"></label>
        <label class="field span-2"><span>תיאור</span><input type="text" name="description" value="${t.description}"></label>
        <label class="field"><span>סכום ₪</span><input type="number" name="amount" value="${t.amount}" min="0" step="0.01"></label>
        <label class="field"><span>חשבון</span><input type="text" name="account" value="${t.account}" list="accList"><datalist id="accList">${accounts().map(function (a) { return h`<option value="${a}">`; })}</datalist></label>
        <label class="field span-2"><span>קטגוריה</span><select name="category">${catOptions(t.category || "לא מסווג")}</select></label>
        <label class="field span-2"><span>הערות</span><input type="text" name="notes" value="${t.notes}"></label>
        <label class="check span-2"><input type="checkbox" name="excluded" ${C.bool(t.excluded) ? raw("checked") : ""}> לא לספור בתקציב (למשל העברה בין חשבונות או חיוב כרטיס אשראי בעו"ש)</label></div>`,
      foot: h`<button class="btn btn-primary" data-save>שמירה</button>${t.id ? h`<button class="btn btn-bad" data-del>מחיקה</button>` : ""}<button class="btn btn-outline" data-close>ביטול</button>`
    });
    m.$("[data-save]").addEventListener("click", function () {
      var d = UI.formData(m.$("#txBox"));
      if (!(C.num(d.amount) > 0) || !d.date) { UI.toast("יש למלא תאריך וסכום", true); return; }
      d.id = t.id; if (!t.id) d.source = "manual";
      m.close(); App.save("family_tx", [d]);
    });
    var del = m.$("[data-del]");
    if (del) del.addEventListener("click", function () { m.close(); App.remove("family_tx", t.id); });
  }
  Actions.newTx = function () { txForm(null); };
  Actions.editTx = function (t) { txForm(C.byId(App.db.family_tx, t.dataset.id)); };

  // ================================================================ import
  Pages["family/import"] = function () {
    var imp = ui.imp;
    var batches = {};
    (App.db.family_tx || []).forEach(function (t) { if (t.importBatch) { var b = batches[t.importBatch] = batches[t.importBatch] || { id: t.importBatch, n: 0, account: t.account, file: t.importFile, min: t.date, max: t.date, at: t.importedAt }; b.n++; if (t.date < b.min) b.min = t.date; if (t.date > b.max) b.max = t.date; } });
    var bl = Object.keys(batches).map(function (k) { return batches[k]; }).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    return h`<div class="page-head"><div><h1>ייבוא דוחות בנק ואשראי</h1><div class="sub">Excel / CSV / PDF · הקובץ נקרא במחשב שלך, ורק התנועות נשמרות במסד הנתונים הפרטי</div></div></div>
    ${!imp ? h`<div class="grid grid-2">
      <div class="card"><div class="card-title"><h3>1. בחירת חשבון וקובץ</h3></div>
        <div class="form-grid">
          <label class="field span-2"><span>חשבון</span><select id="impAcc">${UI.options(accounts(), accounts()[0])}</select></label>
          <div class="span-2 row"><input type="text" id="newAcc" placeholder='הוספת חשבון, למשל: עו"ש בנק ... / אשראי ...' style="flex:1"><button class="btn btn-outline btn-sm" data-act="addAccount">הוספה</button>
            <button class="btn btn-ghost btn-sm" data-act="editAccounts">עריכת רשימה</button></div>
          <label class="check span-2"><input type="checkbox" id="impPos"> בקובץ הזה סכום חיובי = הוצאה (כמו בדוחות כרטיסי אשראי)</label>
        </div>
        <div class="drop" id="impDrop" style="margin-top:14px" tabindex="0" role="button" aria-label="בחירת קובץ">
          <div style="font-size:28px">⇪</div><b>גררו לכאן קובץ או לחצו לבחירה</b><div class="small muted">xlsx · xls · csv · pdf</div>
          <input type="file" id="impFile" accept=".xlsx,.xls,.csv,.pdf,application/pdf" hidden></div>
      </div>
      <div class="card"><div class="card-title"><h3>קובץ התכנון המשפחתי</h3></div>
        <p class="small muted">ייבוא התקציב (הכנסות, הוצאות קבועות, צריכה שוטפת, משתנות, מעשרות, שנתיות) והמשכנתאות וההלוואות מקובץ התכנון (למשל "תמונת מצב חודשית", "תמונת מצב שנתית", "נכסים מול התחייבויות").</p>
        <div class="row" style="margin-top:12px"><label class="btn btn-outline" for="planFile">בחירת קובץ תכנון</label><input type="file" id="planFile" accept=".xlsx,.xls" hidden></div>
        <div class="card-title" style="margin-top:20px"><h3>ייבואים קודמים</h3></div>
        ${bl.length ? h`<div class="alist">${bl.map(function (b) {
          return h`<div class="aitem"><span class="who">${b.account}</span><span class="when">${b.n} תנועות · ${C.fmtDate(b.min)}–${C.fmtDate(b.max)}${b.file ? " · " + b.file : ""}</span>
            <span class="acts"><button class="btn btn-ghost btn-xs" data-act="undoBatch" data-id="${b.id}">ביטול ייבוא</button></span></div>`;
        })}</div>` : h`<div class="empty">עוד לא יובאו דוחות</div>`}
      </div></div>` : importReview(imp)}`;
  };
  Pages["family/import"].after = function () {
    var drop = UI.$("#impDrop");
    if (drop) {
      var inp = UI.$("#impFile");
      drop.addEventListener("click", function () { inp.click(); });
      drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") inp.click(); });
      drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
      drop.addEventListener("drop", function (e) { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) readStatement(e.dataTransfer.files[0]); });
      inp.addEventListener("change", function () { if (inp.files[0]) readStatement(inp.files[0]); });
      UI.$("#impAcc").addEventListener("change", function () { UI.$("#impPos").checked = /אשראי/.test(this.value); });
      UI.$("#impPos").checked = /אשראי/.test(UI.$("#impAcc").value);
    }
    var pf = UI.$("#planFile");
    if (pf) pf.addEventListener("change", function () { if (pf.files[0]) readPlanning(pf.files[0]); });
  };

  async function readGrid(file) {
    await UI.loadScript(XLSX_SRC);
    var buf = await file.arrayBuffer();
    var wb;
    if (/\.csv$/i.test(file.name)) {
      var text = new TextDecoder("utf-8").decode(buf);
      if (text.indexOf("�") !== -1) text = new TextDecoder("windows-1255").decode(buf);
      wb = XLSX.read(text, { type: "string", raw: true }); // keep dates as text (dd/mm/yyyy)
    } else {
      wb = XLSX.read(buf, { type: "array", cellDates: true });
    }
    return wb;
  }

  async function readStatement(file) {
    var account = UI.$("#impAcc").value;
    var positiveIsExpense = UI.$("#impPos").checked;
    UI.toast("קורא את הקובץ...");
    try {
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        await UI.loadScript(PDF_SRC);
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
        var pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        var lines = [];
        for (var p = 1; p <= pdf.numPages; p++) {
          var page = await pdf.getPage(p);
          var content = await page.getTextContent();
          lines = lines.concat(Importers.linesFromPdfItems(content.items));
        }
        var txs = Importers.transactionsFromLines(lines, { positiveIsExpense: positiveIsExpense });
        ui.imp = { kind: "pdf", file: file.name, account: account, positiveIsExpense: positiveIsExpense, txs: prep(txs, account, positiveIsExpense) };
      } else {
        var wb = await readGrid(file);
        var sheets = wb.SheetNames.map(function (n) { return { name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" }) }; });
        // pick the sheet whose header looks most like a statement
        var best = sheets[0], bestMap = Importers.detect(best.rows);
        sheets.forEach(function (s) { var mp = Importers.detect(s.rows); if (mp.headerRow >= 0 && (bestMap.headerRow < 0 || s.rows.length > best.rows.length)) { best = s; bestMap = mp; } });
        // a credit-card statement (billing date / merchant branch) always has positive = expense
        if (bestMap.billDate || bestMap.branch >= 0) positiveIsExpense = true;
        ui.imp = { kind: "grid", file: file.name, account: account, positiveIsExpense: positiveIsExpense, sheets: sheets, sheet: best.name, map: bestMap };
        ui.imp.txs = prep(Importers.toTransactions(best.rows, bestMap, { positiveIsExpense: positiveIsExpense }), account, positiveIsExpense);
      }
      if (!ui.imp.txs.length) UI.toast("לא זוהו תנועות אוטומטית - אפשר לבחור עמודות ידנית", true);
      App.render();
    } catch (e) {
      console.error(e);
      UI.toast("לא ניתן לקרוא את הקובץ: " + (e.message || e), true);
    }
  }

  function prep(txs, account, isCard) {
    // two identical lines in one file are two real purchases; only what was imported before is a duplicate
    var existing = {};
    (App.db.family_tx || []).forEach(function (t) { var k = C.txFingerprint(t); existing[k] = (existing[k] || 0) + 1; });
    var rules = sortedRules();
    var seen = {};
    return txs.map(function (t, i) {
      t.account = account;
      var k = C.classify(t.description, rules, t.branch, catNames());
      t.category = k.category;
      t.business = k.business; t.businessCategory = k.businessCategory || "";
      // the card bill in the bank statement: its purchases come from the card statement itself
      t.excluded = !isCard && t.type === "expense" && C.isCardBill(t.description);
      var fp = C.txFingerprint(t);
      seen[fp] = (seen[fp] || 0) + 1;
      t.dup = seen[fp] <= (existing[fp] || 0);
      t.include = !t.dup;
      t.i = i;
      return t;
    }).map(function (t, i, all) {
      if (i === 0) {
        var hits = C.matchClientPayments(App.db, all);
        Object.keys(hits).forEach(function (k) { var x = all[k], pay = hits[k]; x.business = true; x.paymentId = pay.id; x.matchNote = "תשלום של " + App.clientName(pay.clientId) + " מ-" + C.fmtDate(pay.date); });
      }
      return t;
    });
  }

  function importReview(imp) {
    var cols = [];
    if (imp.kind === "grid") {
      var sheet = imp.sheets.filter(function (s) { return s.name === imp.sheet; })[0];
      var hdr = sheet.rows[imp.map.headerRow] || sheet.rows[0] || [];
      var width = Math.max.apply(null, sheet.rows.slice(0, 50).map(function (r) { return r.length; }).concat([hdr.length]));
      for (var i = 0; i < width; i++) cols.push([i, (String(hdr[i] || "").trim() || "עמודה " + (i + 1))]);
    }
    var inc = imp.txs.filter(function (t) { return t.include; });
    var counted = inc.filter(function (t) { return !t.excluded && !t.business; });
    var bizSum = inc.filter(function (t) { return t.business && !t.excluded && t.type !== "income"; }).reduce(function (s, t) { return s + t.amount; }, 0);
    var depSum = inc.filter(function (t) { return t.business && t.type === "income"; }).reduce(function (s, t) { return s + t.amount; }, 0);
    var bills = inc.filter(function (t) { return t.excluded; });
    var sumExp = counted.filter(function (t) { return t.type === "expense"; }).reduce(function (s, t) { return s + t.amount; }, 0);
    var sumInc = counted.filter(function (t) { return t.type === "income"; }).reduce(function (s, t) { return s + t.amount; }, 0);
    function colSel(key, label) {
      return h`<label class="field"><span>${label}</span><select data-change="impMap" data-key="${key}">${UI.options([[-1, "—"]].concat(cols), imp.map[key])}</select></label>`;
    }
    return h`<div class="card"><div class="card-title"><h3>2. בדיקה לפני שמירה - ${imp.file}</h3><span class="sub">${imp.account}</span></div>
      ${imp.kind === "grid" ? h`<div class="form-grid" style="margin-bottom:14px">
        ${imp.sheets.length > 1 ? h`<label class="field"><span>גיליון</span><select data-change="impSheet">${UI.options(imp.sheets.map(function (s) { return s.name; }), imp.sheet)}</select></label>` : ""}
        <label class="field"><span>שורת כותרות</span><input type="number" min="1" value="${imp.map.headerRow + 1}" data-change="impHeader"></label>
        ${colSel("date", "עמודת תאריך")}${colSel("desc", "עמודת תיאור")}${colSel("amount", "עמודת סכום")}${colSel("debit", "עמודת חובה")}${colSel("credit", "עמודת זכות")}
      </div>` : h`<p class="small muted" style="margin-bottom:10px">PDF נקרא לפי שורות טקסט - מומלץ לעבור על הרשימה. אם הבנק מאפשר, ייצוא ל-Excel מדויק יותר.</p>`}
      <div class="row" style="margin-bottom:10px"><span class="badge info">${inc.length} ייובאו</span><span class="badge">${imp.txs.length - inc.length} דולגו${imp.txs.some(function (t) { return t.dup; }) ? " (כולל כפילויות)" : ""}</span>
        <span class="small">הוצאות משפחה ${C.fmtMoney(sumExp)} · הכנסות ${C.fmtMoney(sumInc)}${bizSum ? " · 💼 לעסק " + C.fmtMoney(bizSum) : ""}${depSum ? " · 💼 הכנסות מהעסק (כבר נספרו) " + C.fmtMoney(depSum) : ""}</span>
        <span class="grow"></span><button class="btn btn-primary" data-act="impSave">שמירת ${inc.length} תנועות</button><button class="btn btn-outline" data-act="impCancel">ביטול</button></div>
      ${bills.length ? h`<div class="aitem info" style="margin-bottom:10px">💳 ${bills.length} חיובי כרטיס אשראי בדוח הבנק (${C.fmtMoney(bills.reduce(function (s, t) { return s + t.amount; }, 0))}) נשמרים אבל <b>לא נספרים</b> - את הפירוט שלהם מייבאים מדוח האשראי עצמו, כדי שלא ייספרו פעמיים.</div>` : ""}
      ${imp.map && imp.map.billDate ? h`<div class="small muted" style="margin-bottom:8px">דוח אשראי: כל העסקאות נרשמות בחודש החיוב (${C.fmtDate(imp.map.billDate)}). תאריך הקנייה מופיע ליד כל עסקה.</div>` : ""}
      <div class="table-wrap" style="max-height:65vh;overflow:auto"><table class="t"><thead><tr><th></th><th>תאריך</th><th>תיאור</th><th class="n">סכום</th><th>סוג</th><th>קטגוריה</th><th></th></tr></thead><tbody>
      ${imp.txs.map(function (t) {
        return h`<tr style="${t.include ? (t.excluded ? "opacity:.6" : "") : "opacity:.5"}"><td><input type="checkbox" data-change="impInc" data-i="${t.i}" ${t.include ? raw("checked") : ""} aria-label="לכלול"></td>
          <td class="nowrap small">${C.fmtDate(t.date)}${t.purchaseDate && t.purchaseDate !== t.date ? h`<div class="muted">קנייה ${C.fmtDate(t.purchaseDate)}</div>` : ""}</td>
          <td>${t.description}${t.dup ? h` <span class="badge warn">קיים כבר</span>` : ""}${t.excluded ? h` <span class="badge">חיוב כרטיס - לא נספר</span>` : ""}
            ${t.branch || t.note ? h`<div class="small muted">${[t.branch, t.note].filter(Boolean).join(" · ")}</div>` : ""}</td>
          <td class="n">${C.fmtMoney(t.amount)}</td>
          <td><select data-change="impType" data-i="${t.i}" style="min-height:30px;padding:3px 6px;font-size:12.5px;width:auto">${UI.options([["expense", "הוצאה"], ["income", "הכנסה"]], t.type)}</select></td>
          <td>${t.business ? (t.type === "income" ? h`<span class="badge gold" title="${t.matchNote || ""}">💼 הכנסה מהעסק${t.matchNote ? " · " + t.matchNote : ""}</span>` : h`<span class="badge gold">💼 עסק · ${t.businessCategory}</span>`) : h`<select data-change="impCat" data-i="${t.i}" style="min-height:30px;padding:3px 6px;font-size:12.5px">${catOptions(t.category, t.type)}</select>`}</td>
          <td>${!t.excluded ? h`<button class="btn btn-ghost btn-xs" data-act="impBiz" data-i="${t.i}" title="${t.type === "income" ? "תשלום מלקוח שכבר רשום בעסק" : "הוצאה של העסק"}">${t.business ? "↩ משפחה" : "💼 עסק"}</button>` : ""}</td></tr>`;
      })}</tbody></table></div></div>`;
  }
  function reparse() {
    var imp = ui.imp;
    var sheet = imp.sheets.filter(function (s) { return s.name === imp.sheet; })[0];
    imp.txs = prep(Importers.toTransactions(sheet.rows, imp.map, { positiveIsExpense: imp.positiveIsExpense }), imp.account, imp.positiveIsExpense);
    App.render();
  }
  Actions.addAccount = async function () {
    var name = UI.$("#newAcc").value.trim();
    if (!name) return;
    var list = accounts().filter(function (a) { return a !== name; });
    list.unshift(name);
    await App.setSetting("familyAccounts", list);
    App.render();
    UI.$("#impAcc").value = name;
    UI.$("#impPos").checked = /אשראי/.test(name);
  };
  Actions.editAccounts = function () {
    var m = UI.modal({ title: "חשבונות בנק ואשראי",
      body: h`<label class="field"><span>שורה לכל חשבון</span><textarea id="accList" rows="7">${accounts().join("\n")}</textarea></label>
        <p class="small muted" style="margin-top:6px">השמות נשמרים רק בגיליון הפרטי שלך. חשבון שהשם שלו כולל "אשראי" מסומן אוטומטית כ"סכום חיובי = הוצאה".</p>`,
      foot: h`<button class="btn btn-primary" data-ok>שמירה</button><button class="btn btn-outline" data-close>ביטול</button>` });
    m.$("[data-ok]").addEventListener("click", async function () {
      var list = m.$("#accList").value.split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean);
      m.close();
      await App.setSetting("familyAccounts", list);
      App.render();
    });
  };
  Actions.impMap = function (t) { ui.imp.map[t.dataset.key] = +t.value; reparse(); };
  Actions.impHeader = function (t) { ui.imp.map.headerRow = Math.max(0, +t.value - 1); reparse(); };
  Actions.impSheet = function (t) {
    ui.imp.sheet = t.value;
    var sheet = ui.imp.sheets.filter(function (s) { return s.name === t.value; })[0];
    ui.imp.map = Importers.detect(sheet.rows);
    reparse();
  };
  Actions.impInc = function (t) { ui.imp.txs[+t.dataset.i].include = t.checked; App.render(); };
  Actions.impType = function (t) { ui.imp.txs[+t.dataset.i].type = t.value; };
  Actions.impCat = function (t) {
    var x = ui.imp.txs[+t.dataset.i];
    if (t.value === "__new") { t.dataset.prev = x.category; newCatFromSelect(t, x.type, function (name) { x.category = name; App.render(); }); return; }
    x.category = t.value;
  };
  Actions.impBiz = function (t) {
    var x = ui.imp.txs[+t.dataset.i];
    if (x.business) { x.business = false; x.businessCategory = ""; x.paymentId = ""; x.matchNote = ""; App.render(); return; }
    if (x.type === "income") { x.business = true; App.render(); return; }
    bizModal(x.description, function (cat, pat) {
      x.business = true; x.businessCategory = cat;
      if (pat) ui.imp.txs.forEach(function (y) { if (y.type === "expense" && !y.excluded && String(y.description).indexOf(pat) !== -1) { y.business = true; y.businessCategory = cat; } });
      App.render();
    });
  };
  Actions.impCancel = function () { ui.imp = null; App.render(); };
  Actions.impSave = async function (t) {
    var imp = ui.imp;
    var batch = C.uid("ib"), at = C.ymdhm(new Date());
    var rows = imp.txs.filter(function (x) { return x.include; }).map(function (x) {
      return { id: C.uid("ft"), date: x.date, description: x.description, amount: x.amount, type: x.type, category: x.category, account: imp.account,
        source: "import", importBatch: batch, importFile: imp.file, importedAt: at,
        purchaseDate: x.purchaseDate || "", branch: x.branch || "", note: x.note || "",
        excluded: x.excluded ? "true" : "", business: x.business ? "true" : "", businessCategory: x.business ? (x.businessCategory || "") : "",
        paymentId: x.paymentId || "", matchNote: x.matchNote || "" };
    });
    if (!rows.length) { UI.toast("לא נבחרו תנועות", true); return; }
    t.disabled = true;
    var months = {};
    rows.forEach(function (r) { months[C.monthKey(r.date)] = true; });
    var saved = await App.save("family_tx", rows, { msg: rows.length + " תנועות נשמרו" });
    if (saved) {
      ui.imp = null;
      ui.month = Object.keys(months).sort().pop();
      location.hash = "#family/month";
    }
  };
  Actions.undoBatch = async function (t) {
    var ids = (App.db.family_tx || []).filter(function (x) { return x.importBatch === t.dataset.id; }).map(function (x) { return x.id; });
    if (!(await UI.confirm("ביטול ייבוא", "למחוק את " + ids.length + " התנועות שיובאו בייבוא זה?", "מחיקה", true))) return;
    App.remove("family_tx", ids);
  };

  // planning workbook -> budgets + loans
  async function readPlanning(file) {
    try {
      var wb = await readGrid(file);
      var catsOut = [], loansOut = [];
      wb.SheetNames.forEach(function (n) {
        var grid = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" });
        if (/נכסים|התחייבויות/.test(n)) { loansOut = loansOut.concat(Importers.planningLoans(grid)); return; }
        if (/שנתי/.test(n) && /מצב/.test(n)) { catsOut = catsOut.concat(Importers.planningCategories(grid, true)); return; }
        if (/חודשי/.test(n) && /מצב/.test(n)) { catsOut = catsOut.concat(Importers.planningCategories(grid, false)); return; }
      });
      if (!catsOut.length && !loansOut.length) { UI.toast("לא זוהו נתוני תכנון בקובץ", true); return; }
      var existing = {};
      (App.db.family_categories || []).forEach(function (c) { existing[c.name] = c; });
      var m = UI.modal({
        title: "ייבוא מקובץ התכנון", wide: true,
        body: h`<p class="small muted">נמצאו ${catsOut.length} סעיפי תקציב ו-${loansOut.length} הלוואות/משכנתאות. סעיפים קיימים באותו שם יעודכנו.</p>
          <div class="table-wrap" style="max-height:45vh;overflow:auto;margin-top:10px"><table class="t"><thead><tr><th>סעיף</th><th>קבוצה</th><th class="n">תקציב חודשי</th><th class="n">שנתי</th></tr></thead><tbody>
          ${catsOut.map(function (c) { return h`<tr><td>${c.name}${existing[c.name] ? h` <span class="badge">קיים</span>` : ""}</td><td>${C.FAMILY_GROUPS[c.group]}</td><td class="n">${C.fmtMoney(c.budget)}</td><td class="n">${c.annualBudget ? C.fmtMoney(c.annualBudget) : ""}</td></tr>`; })}
          </tbody></table></div>
          ${loansOut.length ? h`<div class="table-wrap" style="margin-top:12px"><table class="t"><thead><tr><th>הלוואה</th><th class="n">החזר חודשי</th><th class="n">יתרה</th><th class="n">תשלומים שנותרו</th></tr></thead><tbody>
          ${loansOut.map(function (l) { return h`<tr><td>${l.name}</td><td class="n">${C.fmtMoney(l.monthlyPayment)}</td><td class="n">${C.fmtMoney(l.balance)}</td><td class="n">${l.paymentsLeft}</td></tr>`; })}</tbody></table></div>` : ""}`,
        foot: h`<button class="btn btn-primary" data-ok>ייבוא</button><button class="btn btn-outline" data-close>ביטול</button>`
      });
      m.$("[data-ok]").addEventListener("click", async function () {
        m.close();
        var catRows = catsOut.map(function (c) {
          var ex = existing[c.name];
          return { id: ex ? ex.id : C.uid("fc"), name: c.name, group: c.group, budget: c.budget, annualBudget: c.annualBudget, notes: c.note || "" };
        });
        if (catRows.length) await App.save("family_categories", catRows, { toast: false, silent: true });
        var exLoans = {};
        (App.db.loans || []).forEach(function (l) { exLoans[l.name] = l; });
        var loanRows = loansOut.map(function (l) { l.id = exLoans[l.name] ? exLoans[l.name].id : C.uid("ln"); return l; });
        if (loanRows.length) await App.save("loans", loanRows, { toast: false, silent: true });
        App.render();
        UI.toast("יובאו " + catRows.length + " סעיפי תקציב ו-" + loanRows.length + " הלוואות");
      });
    } catch (e) { console.error(e); UI.toast("לא ניתן לקרוא את הקובץ", true); }
  }

  // ================================================================ budget & categories
  Pages["family/budget"] = function () {
    var list = cats();
    var f = C.familyMonth(App.db, C.thisMonth());
    var actual = {};
    f.categories.forEach(function (r) { actual[r.category] = r.actual; });
    var byGroup = {};
    list.forEach(function (c) { (byGroup[c.group] = byGroup[c.group] || []).push(c); });
    var totBud = list.filter(function (c) { return c.group !== "income" && c.group !== "business"; }).reduce(function (s, c) { return s + C.num(c.budget); }, 0);
    var totInc = list.filter(function (c) { return c.group === "income"; }).reduce(function (s, c) { return s + C.num(c.budget); }, 0);
    return h`<div class="page-head"><div><h1>תקציב וקטגוריות</h1><div class="sub">תקציב חודשי לכל סעיף - חריגה תוצג כהתראה בדשבורד</div></div>
      <div class="row"><button class="btn btn-primary btn-sm" data-act="newCat">+ קטגוריה</button><button class="btn btn-outline btn-sm" data-act="editBizCats">💼 קטגוריות העסק</button><button class="btn btn-bad btn-sm" data-act="resetCats">🗑 התחלה מחדש</button></div></div>
    <p class="small muted" style="margin:-6px 0 12px">לחיצה על ✎ ליד קטגוריה: שינוי שם (מעדכן את כל התנועות והחוקים), העברה לקבוצה אחרת, תקציב, או מחיקה. שינוי שם לשם של קטגוריה קיימת מאחד את שתיהן.</p>
    <div class="grid grid-4"><div class="tile"><div class="lbl">הכנסות מתוכננות</div><div class="val">${C.fmtMoney(totInc)}</div></div>
      <div class="tile"><div class="lbl">תקציב הוצאות חודשי</div><div class="val">${C.fmtMoney(totBud)}</div></div>
      <div class="tile ${totInc - totBud >= 0 ? "good" : "bad"}"><div class="lbl">צפי יתרה</div><div class="val">${C.fmtMoney(totInc - totBud)}</div><div class="hint">לפני הכנסות העסק</div></div></div>
    ${Object.keys(C.FAMILY_GROUPS).filter(function (g) { return byGroup[g]; }).map(function (g) {
      return h`<div class="card section"><div class="card-title"><h3>${C.FAMILY_GROUPS[g]}</h3><span class="sub">${C.fmtMoney(byGroup[g].reduce(function (s, c) { return s + C.num(c.budget); }, 0))} לחודש</span></div>
        <div class="table-wrap"><table class="t"><thead><tr><th>סעיף</th><th class="n">תקציב חודשי</th><th class="n">שנתי</th><th class="n">בפועל החודש</th><th></th></tr></thead><tbody>
        ${byGroup[g].map(function (c) {
          var a = actual[c.name] || 0, b = C.num(c.budget);
          return h`<tr class="${g !== "income" && b && a > b ? "flag-bad" : ""}"><td>${c.name}${c.notes ? h`<div class="small muted">${c.notes}</div>` : ""}</td>
            <td class="n"><input type="number" value="${c.budget}" min="0" data-change="setBudget" data-id="${c.id}" style="width:110px;min-height:32px;padding:4px 8px;text-align:left" aria-label="תקציב"></td>
            <td class="n small">${c.annualBudget ? C.fmtMoney(c.annualBudget) : ""}</td>
            <td class="n">${a ? C.fmtMoney(a) : ""}</td>
            <td class="nowrap"><button class="btn btn-ghost btn-xs" data-act="editCat" data-id="${c.id}">✎</button></td></tr>`;
        })}</tbody></table></div></div>`;
    })}`;
  };
  // Business expense categories (used by the 💼 button, the rules and the P&L)
  Actions.editBizCats = function () {
    var cur = bizCats();
    var m = UI.modal({ title: "💼 קטגוריות הוצאות העסק",
      body: h`<label class="field"><span>שורה לכל קטגוריה</span><textarea id="bizCatList" rows="10">${cur.join("\n")}</textarea></label>
        <p class="small muted" style="margin-top:6px">שינוי שם בשורה קיימת (באותו מקום ברשימה) מעדכן גם את ההוצאות, התנועות והחוקים שכבר משויכים אליה.</p>`,
      foot: h`<button class="btn btn-primary" data-ok>שמירה</button><button class="btn btn-outline" data-close>ביטול</button>` });
    m.$("[data-ok]").addEventListener("click", async function () {
      var list = m.$("#bizCatList").value.split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (!list.length) { UI.toast("הרשימה ריקה", true); return; }
      m.close();
      // renamed lines (same position, new text) carry their history with them
      var ren = {};
      cur.forEach(function (old, i) { if (list[i] && list[i] !== old && list.indexOf(old) === -1) ren[old] = list[i]; });
      await App.setSetting("businessExpenseCats", list);
      var tx = (App.db.family_tx || []).filter(function (x) { return ren[x.businessCategory]; }).map(function (x) { return { id: x.id, businessCategory: ren[x.businessCategory] }; });
      var ru = (App.db.family_rules || []).filter(function (x) { return C.bool(x.business) && ren[x.category]; }).map(function (x) { return { id: x.id, category: ren[x.category] }; });
      var ex = (App.db.expenses || []).filter(function (x) { return ren[x.category]; }).map(function (x) { return { id: x.id, category: ren[x.category] }; });
      if (tx.length) await App.save("family_tx", tx, { toast: false, silent: true });
      if (ru.length) await App.save("family_rules", ru, { toast: false, silent: true });
      if (ex.length) await App.save("expenses", ex, { toast: false, silent: true });
      App.render();
      UI.toast("קטגוריות העסק נשמרו");
    });
  };
  Actions.setBudget = function (t) { App.save("family_categories", [{ id: t.dataset.id, budget: t.value }], { toast: false, silent: true }); };
  function catForm(c, opts) {
    opts = opts || {};
    c = c || { group: opts.group || "current" };
    var oldName = c.name;   // saving updates c itself, so keep the name it had
    var m = UI.modal({
      title: c.id ? "עריכת קטגוריה" : "קטגוריה חדשה",
      body: h`<div class="form-grid" id="catBox">
        <label class="field span-2"><span>שם</span><input type="text" name="name" value="${c.name}"></label>
        <label class="field"><span>קבוצה</span><select name="group">${UI.options(Object.keys(C.FAMILY_GROUPS).map(function (g) { return [g, C.FAMILY_GROUPS[g]]; }), c.group)}</select></label>
        <label class="field"><span>תקציב חודשי ₪</span><input type="number" name="budget" value="${c.budget}" min="0"></label>
        <label class="field"><span>תקציב שנתי ₪ (לסעיפים שנתיים)</span><input type="number" name="annualBudget" value="${c.annualBudget}" min="0"></label>
        <label class="field span-2"><span>הערות</span><input type="text" name="notes" value="${c.notes}"></label>
        ${c.id && oldName ? h`<label class="field span-2" style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px"><span>איחוד לתוך קטגוריה אחרת (אופציונלי)</span>
          <select id="mergeInto">${UI.options([["", "— לא לאחד —"]].concat(cats().filter(function (x) { return x.name !== oldName; }).map(function (x) { return [x.name, x.name + " (" + (C.FAMILY_GROUPS[x.group] || "") + ")"]; })), "")}</select>
          <span class="small muted">כל התנועות והחוקים של "${oldName}" יעברו לקטגוריה שנבחרה, ו"${oldName}" תימחק.</span></label>` : ""}</div>`,
      foot: h`<button class="btn btn-primary" data-save>שמירה</button>${c.id ? h`<button class="btn btn-bad" data-del>מחיקה</button>` : ""}<button class="btn btn-outline" data-close>ביטול</button>`
    });
    m.$("[name=annualBudget]").addEventListener("input", function () { if (!m.$("[name=budget]").value || c.annualBudget) m.$("[name=budget]").value = Math.round(C.num(this.value) / 12) || ""; });
    m.$("[data-save]").addEventListener("click", async function () {
      var d = UI.formData(m.$("#catBox"));
      var into = m.$("#mergeInto") ? m.$("#mergeInto").value : "";
      if (into) {
        // merge = rename into an existing category (handled below, with the same confirmation)
        var target = (App.db.family_categories || []).filter(function (x) { return x.name === into; })[0];
        d = { name: into, group: target ? target.group : d.group, budget: target ? target.budget : d.budget, annualBudget: target ? target.annualBudget : d.annualBudget, notes: target ? target.notes : d.notes };
      }
      if (!d.name) { UI.toast("יש להזין שם", true); return; }
      d.id = c.id;
      var other = (App.db.family_categories || []).filter(function (x) { return x.name === d.name && x.id !== c.id; })[0];
      if (other && !c.id) { UI.toast("כבר יש קטגוריה בשם הזה", true); return; }
      if (other && !(await UI.confirm("איחוד קטגוריות", "כבר יש קטגוריה בשם \"" + d.name + "\". לאחד אליה את כל התנועות והחוקים של \"" + c.name + "\"?", "איחוד"))) return;
      m.close();
      if (!other) await App.save("family_categories", [d], { toast: !opts.onSaved });
      if (c.id && oldName && oldName !== d.name) {
        var upd = (App.db.family_tx || []).filter(function (x) { return x.category === oldName; }).map(function (x) { return { id: x.id, category: d.name }; });
        var rup = (App.db.family_rules || []).filter(function (x) { return x.category === oldName && !C.bool(x.business); }).map(function (x) { return { id: x.id, category: d.name }; });
        if (upd.length) await App.save("family_tx", upd, { toast: false, silent: true });
        if (rup.length) await App.save("family_rules", rup, { toast: false, silent: true });
        if (other) await App.remove("family_categories", c.id);
        if (ui.catFilter === oldName) ui.catFilter = d.name;
        App.render();
        UI.toast(other ? "הקטגוריות אוחדו" : "השם עודכן" + (upd.length ? " (" + upd.length + " תנועות)" : ""));
      }
      if (opts.onSaved) opts.onSaved(d.name);
    });
    var del = m.$("[data-del]");
    if (del) del.addEventListener("click", async function () {
      if (!(await UI.confirm("מחיקת קטגוריה", "תנועות בקטגוריה יסומנו 'לא מסווג'. להמשיך?", "מחיקה", true))) return;
      m.close();
      var upd = (App.db.family_tx || []).filter(function (x) { return x.category === oldName; }).map(function (x) { return { id: x.id, category: "לא מסווג" }; });
      if (upd.length) await App.save("family_tx", upd, { toast: false, silent: true });
      App.remove("family_categories", c.id);
    });
  }
  Actions.newCat = function () { catForm(null); };
  Actions.editCatName = function (t) {
    var c = (App.db.family_categories || []).filter(function (x) { return x.name === t.dataset.cat; })[0];
    // a category that only exists on transactions (e.g. from an old import) gets a proper entry now
    catForm(c || { id: C.uid("fc"), name: t.dataset.cat, group: "current", _virtual: true });
  };
  Actions.editCat = function (t) { catForm(C.byId(App.db.family_categories, t.dataset.id)); };

  // ================================================================ rules
  Pages["family/rules"] = function () {
    var rules = sortedRules();
    var unc = (App.db.family_tx || []).filter(function (t) { return !t.category || t.category === "לא מסווג"; }).length;
    return h`<div class="page-head"><div><h1>חוקי סיווג אוטומטי</h1><div class="sub">כל תנועה שהתיאור שלה מכיל את הטקסט תסווג לקטגוריה. החוק הראשון שמתאים קובע.</div></div>
      <div class="row"><button class="btn btn-outline btn-sm" data-act="applyRules">הפעלת החוקים על ${unc} תנועות לא מסווגות</button></div></div>
    <div class="card"><div class="row" id="ruleAdd" style="margin-bottom:12px"><input type="text" name="pattern" placeholder='טקסט בתיאור, למשל "רמי לוי"' style="flex:1;min-width:180px">
      <select name="category" style="flex:1;min-width:180px">${catOptions("")}<optgroup label="💼 הוצאה של העסק">${bizCats().map(function (b) { return h`<option value="biz:${b}">עסק - ${b}</option>`; })}</optgroup></select><button class="btn btn-primary btn-sm" data-act="addRule">הוספת חוק</button></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>אם התיאור מכיל</th><th>← קטגוריה</th><th class="n">התאמות</th><th></th></tr></thead><tbody>
      ${rules.map(function (r) {
        var n = (App.db.family_tx || []).filter(function (t) { return r.pattern && String(t.description || "").toLowerCase().indexOf(String(r.pattern).toLowerCase()) !== -1; }).length;
        return h`<tr><td><b>${r.pattern}</b>${C.num(r.priority) ? h` <span class="badge gold">אישי</span>` : ""}</td><td>${C.bool(r.business) ? h`<span class="badge gold">💼 עסק</span> ` : ""}${r.category}</td><td class="n">${n || ""}</td>
          <td><button class="btn btn-ghost btn-xs" data-act="delRow" data-table="family_rules" data-id="${r.id}" aria-label="מחיקה">✕</button></td></tr>`;
      })}</tbody></table></div></div>`;
  };
  Actions.addRule = function () {
    var d = UI.formData(UI.$("#ruleAdd"));
    if (!d.pattern || !d.category) { UI.toast("יש למלא טקסט וקטגוריה", true); return; }
    if (/^biz:/.test(d.category)) { d.category = d.category.slice(4); d.business = "true"; }
    d.priority = "1";
    App.save("family_rules", [d]);
  };
  Actions.applyRules = async function () {
    var rules = sortedRules();
    var upd = (App.db.family_tx || []).filter(function (t) { return (!t.category || t.category === "לא מסווג") && !C.bool(t.business); })
      .map(function (t) {
        var k = C.classify(t.description, rules, t.branch, catNames());
        if (k.business && t.type === "expense") return { id: t.id, business: "true", businessCategory: k.businessCategory };
        return { id: t.id, category: k.category };
      })
      .filter(function (x) { return x.business || x.category !== "לא מסווג"; });
    if (!upd.length) { UI.toast("לא נמצאו התאמות חדשות"); return; }
    await App.save("family_tx", upd, { msg: upd.length + " תנועות סווגו" });
  };

  // ================================================================ loans
  Pages["family/loans"] = function () {
    var s = C.loansSummary(App.db);
    return h`<div class="page-head"><div><h1>משכנתאות והלוואות</h1><div class="sub">התחייבויות קיימות ומימונים</div></div>
      <div class="row"><button class="btn btn-primary btn-sm" data-act="newLoan">+ הלוואה / משכנתא</button></div></div>
    <div class="grid grid-4"><div class="tile"><div class="lbl">החזר חודשי כולל</div><div class="val">${C.fmtMoney(s.monthlyTotal)}</div></div>
      <div class="tile"><div class="lbl">יתרת חוב כוללת</div><div class="val">${C.fmtMoney(s.balanceTotal)}</div></div>
      <div class="tile"><div class="lbl">משכנתאות</div><div class="val">${s.loans.filter(function (l) { return l.type === "mortgage"; }).length}</div></div>
      <div class="tile"><div class="lbl">הלוואות</div><div class="val">${s.loans.filter(function (l) { return l.type !== "mortgage"; }).length}</div></div></div>
    <div class="card section"><div class="table-wrap"><table class="t"><thead><tr><th>שם</th><th>סוג</th><th class="n">סכום מקורי</th><th class="n">החזר חודשי</th><th class="n">תשלומים שנותרו</th><th class="n">יתרה לסילוק</th><th>סיום משוער</th><th></th></tr></thead><tbody>
    ${s.loans.length ? s.loans.map(function (l) {
      var left = C.num(l.paymentsLeft);
      var end = left ? C.monthLabel(C.addMonths(C.thisMonth(), left)) : "";
      var paid = C.num(l.originalAmount) ? 1 - Math.min(1, C.num(l.balance) / Math.max(C.num(l.originalAmount), C.num(l.balance))) : 0;
      return h`<tr><td><b>${l.name}</b>${l.notes ? h`<div class="small muted">${l.notes}</div>` : ""}</td><td>${l.type === "mortgage" ? "משכנתא" : "הלוואה"}</td>
        <td class="n">${C.fmtMoney(l.originalAmount)}</td><td class="n">${C.fmtMoney(l.monthlyPayment)}</td><td class="n">${l.paymentsLeft}</td>
        <td class="n">${C.fmtMoney(l.balance)}</td><td class="small">${end}</td><td><button class="btn btn-ghost btn-xs" data-act="editLoan" data-id="${l.id}">✎</button></td></tr>`;
    }) : h`<tr><td colspan="8" class="empty">עוד לא הוזנו הלוואות. אפשר לייבא מקובץ התכנון במסך "ייבוא דוחות".</td></tr>`}</tbody>
    <tfoot><tr><td colspan="3">סה"כ</td><td class="n">${C.fmtMoney(s.monthlyTotal)}</td><td></td><td class="n">${C.fmtMoney(s.balanceTotal)}</td><td colspan="2"></td></tr></tfoot></table></div>
    <p class="small muted" style="margin-top:10px">ההחזרים החודשיים יורדים בפועל מחשבון העו"ש ולכן נכללים בהוצאות דרך ייבוא הדוחות (קטגוריה "החזר הלוואות" / "שכר דירה / משכנתא").</p></div>`;
  };
  function loanForm(l) {
    l = l || { type: "mortgage" };
    var m = UI.modal({
      title: l.id ? "עריכה" : "הלוואה / משכנתא חדשה",
      body: h`<div class="form-grid" id="loanBox">
        <label class="field span-2"><span>שם</span><input type="text" name="name" value="${l.name}" placeholder="למשל: משכנתא - בנק ..."></label>
        <label class="field"><span>סוג</span><select name="type">${UI.options([["mortgage", "משכנתא"], ["loan", "הלוואה"], ["gmach", "גמ\"ח"]], l.type)}</select></label>
        <label class="field"><span>גוף מלווה</span><input type="text" name="lender" value="${l.lender}"></label>
        <label class="field"><span>סכום מקורי ₪</span><input type="number" name="originalAmount" value="${l.originalAmount}"></label>
        <label class="field"><span>החזר חודשי ₪</span><input type="number" name="monthlyPayment" value="${l.monthlyPayment}"></label>
        <label class="field"><span>תשלומים שנותרו</span><input type="number" name="paymentsLeft" value="${l.paymentsLeft}"></label>
        <label class="field"><span>יתרה לסילוק ₪</span><input type="number" name="balance" value="${l.balance}"></label>
        <label class="field span-2"><span>הערות</span><input type="text" name="notes" value="${l.notes}"></label></div>`,
      foot: h`<button class="btn btn-primary" data-save>שמירה</button>${l.id ? h`<button class="btn btn-bad" data-del>מחיקה</button>` : ""}<button class="btn btn-outline" data-close>ביטול</button>`
    });
    m.$("[data-save]").addEventListener("click", function () {
      var d = UI.formData(m.$("#loanBox"));
      if (!d.name) return;
      d.id = l.id; m.close(); App.save("loans", [d]);
    });
    var del = m.$("[data-del]");
    if (del) del.addEventListener("click", function () { m.close(); App.remove("loans", l.id); });
  }
  Actions.newLoan = function () { loanForm(null); };
  Actions.editLoan = function (t) { loanForm(C.byId(App.db.loans, t.dataset.id)); };
})();
