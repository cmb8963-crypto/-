/* ui.js - small UI toolkit: escaping, icons, dialogs, toasts, date pickers, file reading. */
var UI = (function () {
  "use strict";

  /** Every value placed into HTML goes through esc(). */
  function esc(s) { return MK.escapeHtml(s); }
  function multiline(s) { return esc(s).replace(/\n/g, "<br>"); }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }

  var ICONS = {
    check: '<path d="M20 6 9 17l-5-5"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    back: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', chev: '<path d="m15 18-6-6 6-6"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'
  };
  function icon(n) { return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[n] || "") + "</svg>"; }

  // ---------------------------------------------------------------- dialog
  // Esc / backdrop / ✕ cancel. Ctrl+Enter submits from a text area. onSubmit may be async.
  var lastFocus = null;
  function dialog(o) {
    lastFocus = document.activeElement;
    var layer = $("#layer");
    layer.innerHTML = '<div class="scrim" id="scrim"><form class="dialog' + (o.wide ? " wide" : "") + '" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '" id="dlg" novalidate>' +
      '<div class="d-head"><div><h3>' + esc(o.title) + '</h3>' + (o.sub ? '<p>' + esc(o.sub) + '</p>' : "") + '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-close aria-label="סגירה">' + icon("x") + '</button></div>' +
      '<div class="d-body">' + o.body + '<div class="error" hidden></div></div><div class="d-foot">' + o.foot + '</div></form></div>';
    var dlg = $("#dlg"), busy = false;
    $("#scrim").addEventListener("click", function (e) {
      if (busy) return;
      if (e.target.id === "scrim" || e.target.closest("[data-close]")) close();
    });
    dlg.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (busy) return;
      busy = true;
      var btns = $$("button[type=submit]", dlg);
      btns.forEach(function (b) { b.disabled = true; });
      try { await o.onSubmit(dlg); } finally {
        busy = false;
        btns.forEach(function (b) { b.disabled = false; });
      }
    });
    dlg.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); dlg.requestSubmit(); } });
    if (o.onMount) o.onMount(dlg);
    var f = $("[autofocus], .d-body input[type=text], .d-body textarea", dlg);
    if (f) setTimeout(function () { f.focus(); }, 20);
    return dlg;
  }
  function close() {
    $("#layer").innerHTML = "";
    if (lastFocus && document.body.contains(lastFocus)) try { lastFocus.focus(); } catch (e) { /* ignore */ }
  }
  function isOpen() { return !!$("#dlg"); }
  /** Show an error inside the open dialog (from a validation result or a message). */
  function fail(dlg, res, focusSel) {
    var e = $(".d-body > .error", dlg);
    e.textContent = typeof res === "string" ? res : (res.message || "הפעולה נכשלה");
    e.hidden = false;
    if (focusSel) { var f = $(focusSel, dlg); if (f) f.focus(); }
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen()) close(); });

  // ---------------------------------------------------------------- date picker with quick chips
  function dateChips(name, value, today, withToday) {
    return '<div class="add-opts" data-chips="' + name + '">' + MK.quickDates(today).filter(function (q) { return withToday || q.key !== "today"; }).map(function (q) {
      return '<button type="button" class="chip' + (value === q.date ? " on" : "") + '" data-pick="' + q.date + '">' + q.label + (q.key === "today" ? "" : ' <small>' + MK.fmtDate(q.date).slice(0, 5) + '</small>') + '</button>';
    }).join("") + '</div><input type="date" name="' + name + '" id="f_' + name + '" value="' + value + '" min="' + today + '">';
  }
  function wireChips(root) {
    $$("[data-chips]", root).forEach(function (box) {
      var input = $('[name="' + box.dataset.chips + '"]', root);
      var sync = function () { $$("[data-pick]", box).forEach(function (b) { b.classList.toggle("on", b.dataset.pick === input.value); }); };
      box.addEventListener("click", function (e) { var b = e.target.closest("[data-pick]"); if (b) { input.value = b.dataset.pick; sync(); } });
      input.addEventListener("input", sync);
    });
  }

  // ---------------------------------------------------------------- toast (with optional undo)
  var timer = null;
  function toast(msg, undo, bad) {
    var old = $("#toast"); if (old) old.remove();
    var el = document.createElement("div");
    el.className = "toast" + (bad ? " bad" : ""); el.id = "toast"; el.setAttribute("role", "status");
    el.innerHTML = icon(bad ? "alert" : "check") + "<span>" + esc(msg) + "</span>" + (undo ? '<button type="button">ביטול</button>' : "");
    if (undo) el.querySelector("button").addEventListener("click", function () { el.remove(); undo(); });
    document.body.appendChild(el);
    clearTimeout(timer);
    timer = setTimeout(function () { el.remove(); }, undo ? 5000 : bad ? 6000 : 2600);
  }

  /** Read a File as base64 (without the data: prefix). */
  function readBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result); resolve(s.slice(s.indexOf(",") + 1)); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(file);
    });
  }
  function fileBadge(name, mime) {
    var ext = (String(name).split(".").pop() || "").toUpperCase().slice(0, 4);
    if (!ext || ext.length > 4 || ext === String(name).toUpperCase()) ext = /pdf/.test(mime) ? "PDF" : /image/.test(mime) ? "IMG" : "FILE";
    return ext;
  }

  return { esc: esc, multiline: multiline, $: $, $$: $$, icon: icon, dialog: dialog, close: close, isOpen: isOpen, fail: fail,
    dateChips: dateChips, wireChips: wireChips, toast: toast, readBase64: readBase64, fileBadge: fileBadge };
})();
