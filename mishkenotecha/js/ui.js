/* ui.js - small UI toolkit: safe templating, icons, toasts, modals, menus, form helpers. */
var UI = (function () {
  "use strict";

  // ---- safe templating: every interpolated value is escaped unless raw()
  function Raw(s) { this.s = s; }
  Raw.prototype.toString = function () { return this.s; };
  function raw(s) { return new Raw(String(s == null ? "" : s)); }
  function fmt(v) {
    if (v === null || v === undefined || v === false) return "";
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(fmt).join("");
    return MK.escapeHtml(v);
  }
  function h(strings) {
    var out = strings[0];
    for (var i = 1; i < arguments.length; i++) out += fmt(arguments[i]) + strings[i];
    return new Raw(out);
  }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function setHtml(el, tpl) { el.innerHTML = fmt(tpl); }

  // ---- icons (stroke icons, 24px grid)
  var P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9.5 20v-6h5v6"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    chevron: '<path d="m15 18-6-6 6-6"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M1.5 21a7.5 7.5 0 0 1 15 0"/><path d="M16 4.1a4 4 0 0 1 0 7.8M22.5 21a7.5 7.5 0 0 0-4.5-6.9"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'
  };
  function icon(name, cls) { return raw('<svg class="i ' + (cls || "") + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[name] || "") + "</svg>"); }

  // ---- toasts
  function toast(msg, bad) {
    var box = $("#toasts");
    var t = document.createElement("div");
    t.className = "toast" + (bad ? " bad" : "");
    setHtml(t, h`${icon(bad ? "alert" : "check")}<span>${msg}</span>`);
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, bad ? 6000 : 2800);
  }

  // ---- modal: Esc closes (cancels), Enter submits, Ctrl+Enter submits from a textarea
  var openModals = [];
  function modal(opts) {
    var back = document.createElement("div");
    back.className = "modal-back";
    setHtml(back, h`<form class="modal ${opts.wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${opts.title}" novalidate>
      <div class="modal-head"><div><h3>${opts.title}</h3>${opts.sub ? h`<div class="sub">${opts.sub}</div>` : ""}</div>
        <button type="button" class="btn btn-ghost btn-icon" data-close aria-label="סגירה">${icon("x")}</button></div>
      <div class="modal-body">${opts.body}</div>
      ${opts.foot ? h`<div class="modal-foot">${opts.foot}</div>` : ""}
    </form>`);
    var prevFocus = document.activeElement;
    document.body.appendChild(back);
    document.body.style.overflow = "hidden";
    openModals.push(back);
    var form = back.querySelector("form");
    var busy = false;
    function close() {
      if (!back.isConnected) return;
      back.remove();
      openModals = openModals.filter(function (m) { return m !== back; });
      if (!openModals.length) document.body.style.overflow = "";
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignore */ }
      if (opts.onClose) opts.onClose();
    }
    back.addEventListener("mousedown", function (e) { if (e.target === back) back._downOnBack = true; });
    back.addEventListener("click", function (e) {
      if ((e.target === back && back._downOnBack) || e.target.closest("[data-close]")) close();
      back._downOnBack = false;
    });
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (busy || !opts.onSubmit) return;
      busy = true;
      var btns = $$("button[type=submit]", form);
      btns.forEach(function (b) { b.disabled = true; });
      try { await opts.onSubmit(api, e.submitter); } finally {
        busy = false;
        btns.forEach(function (b) { b.disabled = false; });
      }
    });
    form.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.tagName === "TEXTAREA") {
        e.preventDefault(); form.requestSubmit();
      }
    });
    var api = { el: back, form: form, close: close, $: function (s) { return form.querySelector(s); }, $$: function (s) { return $$(s, form); },
      setBody: function (tpl) { setHtml(form.querySelector(".modal-body"), tpl); },
      setFoot: function (tpl) { setHtml(form.querySelector(".modal-foot"), tpl); },
      focusFirst: function () {
        var first = form.querySelector(".modal-body [autofocus], .modal-body input:not([type=hidden]):not([type=radio]):not([type=checkbox]), .modal-body textarea, .modal-body select");
        if (first) setTimeout(function () { first.focus(); }, 30);
      } };
    if (opts.onMount) opts.onMount(api);
    if (!opts.noFocus) api.focusFirst();
    return api;
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (closeMenu()) return;
      if (openModals.length) openModals[openModals.length - 1].querySelector("[data-close]").click();
    }
  });

  // ---- popup menu
  var menuEl = null;
  function closeMenu() { if (!menuEl) return false; menuEl.remove(); menuEl = null; return true; }
  function menu(anchor, items) {
    closeMenu();
    var m = document.createElement("div");
    m.className = "menu";
    m.setAttribute("role", "menu");
    setHtml(m, items.map(function (it, i) {
      return h`<button type="button" role="menuitem" data-i="${i}"><span class="mi">${icon(it.icon)}</span><span><b>${it.label}</b>${it.sub ? h`<small>${it.sub}</small>` : ""}</span></button>`;
    }));
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    var top = r.bottom + 8;
    if (top + m.offsetHeight > window.innerHeight - 10) top = r.top - m.offsetHeight - 8;
    m.style.top = Math.max(10, top) + "px";
    m.style.right = Math.max(10, window.innerWidth - r.right) + "px";
    menuEl = m;
    m.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-i]");
      if (!b) return;
      closeMenu();
      items[+b.dataset.i].run();
    });
    setTimeout(function () {
      document.addEventListener("click", function off(e) {
        if (menuEl && !menuEl.contains(e.target)) closeMenu();
        if (!menuEl) document.removeEventListener("click", off);
      });
    }, 0);
    var first = m.querySelector("button");
    if (first) first.focus();
  }

  // ---- form helpers
  function val(form, name) {
    var el = form.querySelector('[name="' + name + '"]');
    if (!el) return undefined;
    if (el.type === "checkbox") return el.checked;
    if (el.type === "radio") { var c = form.querySelector('[name="' + name + '"]:checked'); return c ? c.value : ""; }
    return el.value;
  }
  function checkedValues(form, name) {
    return $$('[name="' + name + '"]:checked', form).map(function (e) { return e.value; });
  }
  function clearErrors(form) {
    $$(".field.has-error", form).forEach(function (f) { f.classList.remove("has-error"); });
    $$(".field .error", form).forEach(function (e) { e.remove(); });
  }
  /** Show server/validation errors next to their fields. fieldMap: server key → input name */
  function showErrors(form, res, fieldMap) {
    clearErrors(form);
    var shown = false;
    Object.keys(res.fields || {}).forEach(function (k) {
      var name = (fieldMap && fieldMap[k]) || k;
      var input = form.querySelector('[name="' + name + '"]');
      var field = input && input.closest(".field");
      if (!field) return;
      field.classList.add("has-error");
      var e = document.createElement("div");
      e.className = "error";
      e.textContent = res.fields[k];
      field.appendChild(e);
      if (!shown) { input.focus(); shown = true; }
    });
    if (!shown) toast(res.message || "הפעולה נכשלה", true);
  }

  function initials(name) {
    var p = MK.str(name).split(/\s+/).filter(Boolean);
    return (p[0] ? p[0][0] : "") + (p[1] ? p[1][0] : "");
  }

  return { h: h, raw: raw, fmt: fmt, $: $, $$: $$, setHtml: setHtml, icon: icon, toast: toast, modal: modal, menu: menu, closeMenu: closeMenu,
    val: val, checkedValues: checkedValues, clearErrors: clearErrors, showErrors: showErrors, initials: initials };
})();
