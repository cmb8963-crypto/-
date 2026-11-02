/* newsletter.js - "ניוזלטר": mailing-list subscribers from the /join page, read live
   from the Google Sheet the page writes to. */
(function () {
  "use strict";
  var C = Core, h = UI.h;
  var Pages = window.Pages = window.Pages || {};
  var Actions = window.Actions = window.Actions || {};
  var st = { data: null, loading: false, error: "", search: "" };

  function pickCol(headers, re) {
    for (var i = 0; i < headers.length; i++) if (re.test(String(headers[i]))) return i;
    return -1;
  }
  // "2026-11-02T13:41", "02/11/2026 13:41:00" or an ISO timestamp -> "YYYY-MM-DDTHH:mm"
  function normDate(v) {
    var s = String(v || "").trim();
    var m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
    if (m) return m[1] + (m[2] ? "T" + m[2] : "");
    var d = Importers.parseDate(s);
    if (!d) return "";
    var t = s.match(/(\d{1,2}):(\d{2})/);
    return d + (t ? "T" + C.pad(+t[1]) + ":" + t[2] : "");
  }

  function subscribers() {
    var d = st.data;
    if (!d || !d.configured) return [];
    var H = d.headers;
    var ci = { date: pickCol(H, /תאריך|date|time|ts|חותמת/i), name: pickCol(H, /^שם|name/i), email: pickCol(H, /מייל|mail/i),
      consent: pickCol(H, /אישור|consent/i), source: pickCol(H, /מקור|source/i) };
    var clientsByEmail = {};
    (App.db.clients || []).forEach(function (c) { if (c.email) clientsByEmail[String(c.email).trim().toLowerCase()] = c; });
    var seen = {};
    var list = d.rows.map(function (r) {
      var email = ci.email >= 0 ? String(r[ci.email]).trim() : "";
      return {
        date: ci.date >= 0 ? normDate(r[ci.date]) : "",
        name: ci.name >= 0 ? String(r[ci.name]).trim() : "",
        email: email,
        consent: ci.consent >= 0 ? String(r[ci.consent]).trim() : "",
        source: ci.source >= 0 ? String(r[ci.source]).trim() : "",
        client: clientsByEmail[email.toLowerCase()] || null
      };
    }).filter(function (s) { return s.email; });
    // the first sign-up of each address counts; later ones are marked as repeats
    list.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    list.forEach(function (s) { var k = s.email.toLowerCase(); s.repeat = !!seen[k]; seen[k] = true; });
    return list;
  }

  async function load() {
    st.loading = true; st.error = "";
    App.render();
    var r = await App.call("newsletter");
    st.loading = false;
    if (!r.ok) {
      st.error = r.error === "unknown_action" ? "server_old" : (r.message || r.error || "error");
    } else st.data = r;
    App.render();
  }

  function shortSource(u) {
    var s = String(u || "");
    var m = s.match(/^https?:\/\/[^\/]+(\/[^?#]*)?/);
    return m ? (m[1] && m[1] !== "/" ? m[1].replace(/\/$/, "") : "דף הבית") : s;
  }

  Pages["newsletter"] = function () {
    var joinUrl = String(App.settings().siteUrl || "").replace(/\/$/, "") + "/join/";
    var head = h`<div class="page-head"><div><h1>ניוזלטר</h1><div class="sub">רשימת התפוצה · נרשמים דרך דף ההרשמה באתר</div></div>
      <div class="row"><button class="btn btn-outline btn-sm" data-act="nlReload">⟳ רענון</button>
        <a class="btn btn-outline btn-sm" href="${joinUrl}" target="_blank" rel="noopener">דף ההרשמה ↗</a>
        <button class="btn btn-outline btn-sm" data-act="copyLink" data-url="${joinUrl}">העתקת הקישור</button>
        ${st.data && st.data.url ? h`<a class="btn btn-primary btn-sm" href="${UI.safeUrl(st.data.url)}" target="_blank" rel="noopener">פתיחת הגיליון</a>` : ""}</div></div>`;

    if (!st.data && !st.loading && !st.error) { setTimeout(load, 0); }
    if (st.loading && !st.data) return h`${head}<div class="loading"><span class="spinner"></span> טוען את רשימת התפוצה...</div>`;
    if (st.error === "server_old") return h`${head}<div class="card"><b>צריך לעדכן את קוד השרת.</b>
      <p class="small muted" style="margin-top:6px">הלשונית הזו חדשה. יש להדביק את הקוד המעודכן ב-Apps Script ולפרוס גרסה חדשה (כמו בפעם הקודמת).</p></div>`;
    if (st.error) return h`${head}<div class="card"><b>לא ניתן לטעון את רשימת התפוצה.</b><div class="small muted ltr" style="margin-top:6px">${st.error}</div></div>`;
    if (st.data && !st.data.configured) return h`${head}<div class="card"><b>לא נמצא גיליון בשם "רשימת התפוצה".</b>
      <p class="small muted" style="margin-top:6px">אפשר להדביק כאן את הקישור לגיליון שאליו דף ההרשמה שומר:</p>
      <div class="row" style="margin-top:10px"><input type="url" id="nlSheet" class="ltr" placeholder="https://docs.google.com/spreadsheets/d/..." style="flex:1">
      <button class="btn btn-primary btn-sm" data-act="nlSaveSheet">שמירה</button></div></div>`;

    var all = subscribers();
    var uniq = all.filter(function (s) { return !s.repeat; });
    var now = new Date(), mk = C.thisMonth(now);
    var weekAgo = C.ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
    var thisMonth = uniq.filter(function (s) { return C.monthKey(s.date) === mk; }).length;
    var thisWeek = uniq.filter(function (s) { return s.date && s.date.slice(0, 10) >= weekAgo; }).length;
    var last = uniq.length ? uniq[uniq.length - 1] : null;
    var months = [], m = C.addMonths(mk, -11);
    for (var i = 0; i < 12; i++) { months.push(m); m = C.addMonths(m, 1); }
    var perMonth = months.map(function (x) { return uniq.filter(function (s) { return C.monthKey(s.date) === x; }).length; });

    var q = st.search.trim().toLowerCase();
    var shown = all.slice().reverse().filter(function (s) { return !q || (s.name + " " + s.email).toLowerCase().indexOf(q) !== -1; });

    return h`${head}
    <div class="grid grid-4">
      <div class="tile"><div class="lbl">סה"כ נרשמים</div><div class="val">${uniq.length}</div><div class="hint">כתובות מייל שונות</div></div>
      <div class="tile good"><div class="lbl">הצטרפו החודש</div><div class="val">${thisMonth}</div><div class="hint">${C.monthLabel(mk)}</div></div>
      <div class="tile"><div class="lbl">ב-7 הימים האחרונים</div><div class="val">${thisWeek}</div></div>
      <div class="tile"><div class="lbl">נרשם אחרון</div><div class="val" style="font-size:17px">${last ? last.name || last.email : "—"}</div>
        <div class="hint">${last && last.date ? UI.when(last.date) : ""}</div></div>
    </div>
    <div class="card section"><div class="card-title"><h3>הצטרפויות לפי חודש</h3><span class="sub">12 החודשים האחרונים</span></div>
      ${UI.barChart({ title: "הצטרפויות לפי חודש", labels: months.map(function (x) { return C.HE_MONTHS[+x.slice(5) - 1].slice(0, 3) + "׳"; }), fullLabels: months.map(C.monthLabel),
        series: [{ name: "נרשמים חדשים", color: "var(--series-1)", values: perMonth }], format: function (v) { return v + " נרשמים"; } })}</div>
    <div class="card section">
      <div class="toolbar"><input type="search" id="nlSearch" placeholder="חיפוש לפי שם או מייל..." value="${st.search}" data-input="nlSearch" aria-label="חיפוש">
        <span class="grow"></span>
        <button class="btn btn-outline btn-sm" data-act="nlCopyEmails">העתקת כל המיילים</button>
        <button class="btn btn-outline btn-sm" data-act="nlExport">ייצוא ל-Excel</button></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>תאריך הצטרפות</th><th>שם</th><th>מייל</th><th>אישור דיוור</th><th>מקור</th></tr></thead><tbody>
      ${shown.length ? shown.map(function (s) {
        return h`<tr style="${s.repeat ? "opacity:.6" : ""}"><td class="nowrap small">${s.date ? UI.when(s.date) : "—"}</td>
          <td>${s.name}${s.client ? h` <a class="badge gold" href="#biz/client/${s.client.id}" title="קיים ככרטיס לקוח">לקוח</a>` : ""}${s.repeat ? h` <span class="badge">נרשם שוב</span>` : ""}</td>
          <td class="ltr"><a href="mailto:${s.email}">${s.email}</a></td>
          <td>${/^(כן|yes|true|1)$/i.test(s.consent) ? h`<span class="badge good">כן</span>` : s.consent ? h`<span class="badge">${s.consent}</span>` : ""}</td>
          <td class="small muted">${shortSource(s.source)}</td></tr>`;
      }) : h`<tr><td colspan="5" class="empty">${all.length ? "לא נמצאו תוצאות" : "עוד אין נרשמים. שתף את הקישור לדף ההרשמה!"}</td></tr>`}
      </tbody></table></div>
      ${st.data.title ? h`<p class="small muted" style="margin-top:8px">הנתונים נקראים בזמן אמת מהגיליון "${st.data.title}" בדרייב שלך.</p>` : ""}
    </div>`;
  };
  Pages["newsletter"].after = function () {
    var s = UI.$("#nlSearch");
    if (s && st.focus) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); st.focus = false; }
  };

  Actions.nlReload = function () { load(); };
  Actions.nlSearch = function (t) { st.search = t.value; st.focus = true; App.render(); };
  Actions.nlSaveSheet = async function () {
    var u = UI.$("#nlSheet").value;
    var m = u.match(/\/d\/([A-Za-z0-9_-]{20,})/);
    if (!m) { UI.toast("יש להדביק קישור לגיליון", true); return; }
    await App.setSetting("newsletterSheetId", m[1]);
    st.data = null; load();
  };
  function consented() {
    return subscribers().filter(function (s) { return !s.repeat && (!s.consent || /^(כן|yes|true|1)$/i.test(s.consent)); });
  }
  Actions.nlCopyEmails = function () {
    var list = consented().map(function (s) { return s.email; });
    navigator.clipboard.writeText(list.join(", ")).then(function () { UI.toast(list.length + " כתובות הועתקו (רק מי שאישר דיוור)"); });
  };
  Actions.nlExport = function () {
    var rows = [["תאריך", "שם", "מייל", "אישור דיוור", "מקור"]];
    subscribers().filter(function (s) { return !s.repeat; }).forEach(function (s) { rows.push([s.date.replace("T", " "), s.name, s.email, s.consent, s.source]); });
    UI.download("newsletter-" + C.ymd(new Date()) + ".csv", UI.toCsv(rows));
  };
})();
