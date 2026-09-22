/* ui.js - small UI toolkit: safe HTML templating, modals, toasts, charts. */
var UI = (function () {
  "use strict";
  var C = Core;

  // ---- safe templating: every interpolated value is escaped unless raw()
  function Raw(s) { this.s = s; }
  Raw.prototype.toString = function () { return this.s; };
  function raw(s) { return new Raw(String(s == null ? "" : s)); }
  function fmt(v) {
    if (v === null || v === undefined || v === false) return "";
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(fmt).join("");
    return C.escapeHtml(v);
  }
  function h(strings) {
    var out = strings[0];
    for (var i = 1; i < arguments.length; i++) out += fmt(arguments[i]) + strings[i];
    return new Raw(out);
  }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function setHtml(el, tpl) { el.innerHTML = fmt(tpl); }

  // ---- toasts
  function toast(msg, bad) {
    var box = $("#toasts");
    var t = document.createElement("div");
    t.className = "toast" + (bad ? " bad" : "");
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, bad ? 6000 : 3200);
  }

  // ---- modal
  var openModals = [];
  function modal(opts) {
    var back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = fmt(h`<div class="modal ${opts.wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${opts.title}">
      <div class="modal-head"><h3>${opts.title}</h3><button class="btn btn-ghost" data-close aria-label="סגירה">✕</button></div>
      <div class="modal-body">${opts.body}</div>
      ${opts.foot ? h`<div class="modal-foot">${opts.foot}</div>` : ""}
    </div>`);
    document.body.appendChild(back);
    openModals.push(back);
    function close() { back.remove(); openModals = openModals.filter(function (m) { return m !== back; }); if (opts.onClose) opts.onClose(); }
    back.addEventListener("click", function (e) {
      if (e.target === back || e.target.closest("[data-close]")) close();
    });
    var first = back.querySelector("input:not([type=hidden]),select,textarea");
    if (first && !opts.noFocus) setTimeout(function () { first.focus(); }, 30);
    var api = { el: back, close: close, $: function (s) { return back.querySelector(s); } };
    if (opts.onMount) opts.onMount(api);
    return api;
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && openModals.length) openModals[openModals.length - 1].querySelector("[data-close]").click();
  });

  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var done = false;
      var m = modal({
        title: title, body: h`<p>${text}</p>`,
        foot: h`<button class="btn ${danger ? "btn-bad" : "btn-primary"}" data-ok>${okLabel || "אישור"}</button><button class="btn btn-outline" data-close>ביטול</button>`,
        onClose: function () { if (!done) resolve(false); }, noFocus: true
      });
      m.$("[data-ok]").addEventListener("click", function () { done = true; m.close(); resolve(true); });
    });
  }

  // Read all named fields of a form/element into an object.
  function formData(el) {
    var o = {};
    $$("[name]", el).forEach(function (f) {
      if (f.type === "checkbox") o[f.name] = f.checked ? "true" : "false";
      else if (f.type === "radio") { if (f.checked) o[f.name] = f.value; }
      else o[f.name] = f.value.trim();
    });
    return o;
  }

  function options(list, selected, placeholder) {
    var out = placeholder !== undefined ? [h`<option value="">${placeholder}</option>`] : [];
    list.forEach(function (it) {
      var v = Array.isArray(it) ? it[0] : it, l = Array.isArray(it) ? it[1] : it;
      out.push(h`<option value="${v}" ${String(v) === String(selected) ? raw("selected") : ""}>${l}</option>`);
    });
    return out;
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1]); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  var scriptCache = {};
  function loadScript(src) {
    if (scriptCache[src]) return scriptCache[src];
    scriptCache[src] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve; s.onerror = function () { delete scriptCache[src]; reject(new Error("load " + src)); };
      document.head.appendChild(s);
    });
    return scriptCache[src];
  }

  // Only http(s) links are ever rendered as href.
  function safeUrl(u) { u = String(u || "").trim(); return /^https?:\/\//i.test(u) ? u : ""; }
  function hebDate(ymd) {
    try {
      var d = C.toDate(ymd); if (!d) return "";
      return new Intl.DateTimeFormat("he-IL-u-ca-hebrew", { day: "numeric", month: "long" }).format(d);
    } catch (e) { return ""; }
  }
  function when(s) {
    if (!s) return "ללא תאריך";
    var d = C.toDate(s);
    return C.HE_DAYS[d.getDay()] + " " + C.fmtDate(s) + (C.fmtTime(s) ? " · " + C.fmtTime(s) : "");
  }

  function statusBadge(st) {
    var cls = { planned: "info", held: "good", cancel_ontime: "", cancel_late: "bad", unassigned: "warn", ignored: "" }[st] || "";
    return h`<span class="badge ${cls}">${C.SESSION_STATUS[st] || st}</span>`;
  }
  function money(n, colorize) {
    var v = C.num(n);
    var cls = colorize ? (v > 0.5 ? "bad" : v < -0.5 ? "good" : "") : "";
    return h`<span class="num ${cls ? "t-" + cls : ""}">${C.fmtMoney(v)}</span>`;
  }
  function bar(pct, cls) {
    var p = Math.max(0, Math.min(100, Math.round(pct * 100)));
    return h`<div class="bar ${cls || ""}" role="img" aria-label="${p}%"><i style="width:${p}%"></i></div>`;
  }

  // ---- grouped bar chart with hover tooltip. Chronological right -> left (RTL).
  function barChart(opts) {
    var labels = opts.labels, series = opts.series;
    // Size the drawing to the screen so text stays ~1:1 (the SVG scales with its box).
    var W = Math.max(300, Math.min(1180, (window.innerWidth || 1000) - (opts.inset || 90)));
    var H = opts.height || (W < 600 ? 200 : 240), padT = 12, padB = 26, padS = 44;
    var max = 0;
    series.forEach(function (s) { s.values.forEach(function (v) { if (v > max) max = v; }); });
    if (max <= 0) max = 1;
    var step = Math.pow(10, Math.floor(Math.log10(max)));
    var nice = Math.ceil(max / step) * step;
    if (nice / step <= 2) step = step / 2;
    var ticks = [];
    for (var t = 0; t <= nice + 1e-9; t += step) ticks.push(t);
    var innerW = W - padS - 6, innerH = H - padT - padB;
    var n = labels.length, groupW = innerW / n;
    var barW = Math.max(4, Math.min(22, (groupW - 10) / series.length - 2));
    function y(v) { return padT + innerH - (v / nice) * innerH; }
    var parts = [];
    ticks.forEach(function (tv) {
      parts.push(h`<line class="grid-l" x1="6" x2="${W - padS}" y1="${y(tv)}" y2="${y(tv)}"></line>`);
      parts.push(h`<text class="axis" x="${W - padS + 6}" y="${y(tv) + 4}" text-anchor="start">${tv >= 1000 ? (+(tv / 1000).toFixed(1)) + "K" : Math.round(tv)}</text>`);
    });
    labels.forEach(function (lab, i) {
      var gx = W - padS - (i + 1) * groupW; // right-to-left
      var total = series.length * (barW + 2) - 2;
      var cols = [];
      series.forEach(function (s, si) {
        var v = Math.max(0, s.values[i] || 0);
        var bx = gx + (groupW - total) / 2 + (series.length - 1 - si) * (barW + 2);
        var top = y(v), hgt = Math.max(0, padT + innerH - top);
        if (hgt > 0) {
          var r = Math.min(4, barW / 2, hgt);
          // rounded data-end, square at the baseline
          cols.push(h`<path d="M${bx},${top + hgt} L${bx},${top + r} Q${bx},${top} ${bx + r},${top} L${bx + barW - r},${top} Q${bx + barW},${top} ${bx + barW},${top + r} L${bx + barW},${top + hgt} Z" style="fill:${s.color}"></path>`);
        }
      });
      parts.push(h`<g class="col" data-i="${i}"><rect class="hit" x="${gx}" y="${padT}" width="${groupW}" height="${innerH}"></rect>${cols}</g>`);
      if (groupW >= 34 || i % 2 === 0) parts.push(h`<text class="axis" x="${gx + groupW / 2}" y="${H - 8}" text-anchor="middle">${lab}</text>`);
    });
    parts.push(h`<line class="base" x1="6" x2="${W - padS}" y1="${padT + innerH}" y2="${padT + innerH}"></line>`);
    var id = "ch" + Math.random().toString(36).slice(2, 8);
    var legend = series.length > 1 ? h`<div class="legend">${series.map(function (s) { return h`<span><i style="background:${s.color}"></i>${s.name}</span>`; })}</div>` : "";
    setTimeout(function () {
      var el = document.getElementById(id);
      if (!el) return;
      var tip = el.querySelector(".tip");
      el.addEventListener("mousemove", function (e) {
        var g = e.target.closest("g.col");
        if (!g) { tip.hidden = true; return; }
        var i = +g.dataset.i;
        tip.innerHTML = fmt(h`<b>${opts.fullLabels ? opts.fullLabels[i] : labels[i]}</b>${series.map(function (s) {
          return h`<div><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${s.color};margin-inline-end:5px"></i>${s.name}: ${opts.format ? opts.format(s.values[i]) : s.values[i]}</div>`;
        })}`);
        var rect = el.getBoundingClientRect();
        tip.style.left = (e.clientX - rect.left) + "px";
        tip.style.top = (e.clientY - rect.top) + "px";
        tip.hidden = false;
      });
      el.addEventListener("mouseleave", function () { tip.hidden = true; });
    }, 0);
    return h`${legend}<div class="chart" id="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.title || "תרשים"}">${parts}</svg><div class="tip" hidden></div></div>`;
  }

  function ring(pct) {
    var r = 36, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct));
    return h`<svg class="kpi-ring" viewBox="0 0 86 86" aria-hidden="true"><circle class="bg" cx="43" cy="43" r="${r}"></circle>
      <circle class="fg" cx="43" cy="43" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 43 43)"></circle>
      <text x="43" y="49" text-anchor="middle">${Math.round(pct * 100)}%</text></svg>`;
  }

  function download(name, text, mime) {
    var blob = new Blob(["﻿" + text], { type: mime || "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function toCsv(rows) {
    return rows.map(function (r) { return r.map(function (c) { c = String(c == null ? "" : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(","); }).join("\n");
  }

  return { safeUrl: safeUrl, h: h, raw: raw, fmt: fmt, $: $, $$: $$, setHtml: setHtml, toast: toast, modal: modal, confirm: confirmBox,
    formData: formData, options: options, fileToBase64: fileToBase64, loadScript: loadScript, hebDate: hebDate, when: when,
    statusBadge: statusBadge, money: money, bar: bar, barChart: barChart, ring: ring, download: download, toCsv: toCsv };
})();
