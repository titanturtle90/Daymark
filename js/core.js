/*
 * Core: shared helpers, dates, toast, bottom sheet, confirm dialog, routing.
 * Every feature module builds on window.App.
 */
(function (global) {
  "use strict";

  const App = global.App = {};
  const listeners = new Map();

  // ---------- tiny event bus ----------
  App.on = (evt, fn) => { if (!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); return () => listeners.get(evt).delete(fn); };
  App.emit = (evt, data) => { (listeners.get(evt) || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); };

  // ---------- helpers ----------
  App.escapeHtml = str => String(str ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  App.genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  App.icon = (name, cls) => `<svg class="ic ${cls || ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  App.plural = (n, word, pl) => `${n} ${n === 1 ? word : (pl || word + "s")}`;
  App.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  App.lsGet = (k, fallback) => { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } };
  App.lsSet = (k, v) => { try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };
  App.el = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  App.isStandalone = () => global.matchMedia("(display-mode: standalone)").matches || global.navigator.standalone === true;
  App.isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // ---------- dates (always local "YYYY-MM-DD" strings) ----------
  App.parseDate = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d || 1); };
  App.toDateStr = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  App.todayStr = () => App.toDateStr(new Date());
  App.addDays = (s, n) => { const d = App.parseDate(s); d.setDate(d.getDate() + n); return App.toDateStr(d); };
  App.monthKey = s => String(s).slice(0, 7);
  App.addMonths = (key, n) => { const d = App.parseDate(key + "-01"); d.setMonth(d.getMonth() + n); return App.toDateStr(d).slice(0, 7); };
  App.nowTime = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  App.fmtDayLong = s => App.parseDate(s).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  App.fmtDayMed = s => App.parseDate(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  App.fmtMonthDay = s => App.parseDate(s).toLocaleDateString(undefined, { month: "long", day: "numeric" });
  App.fmtMonth = key => App.parseDate(key + "-01").toLocaleDateString(undefined, { month: "long", year: "numeric" });
  App.fmtTime = t => {
    if (!t) return "";
    const [h, m] = t.split(":").map(Number);
    const d = new Date(2000, 0, 1, h, m);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };
  App.relativeDay = s => {
    const today = App.todayStr();
    if (s === today) return "Today";
    if (s === App.addDays(today, -1)) return "Yesterday";
    if (s === App.addDays(today, 1)) return "Tomorrow";
    return "";
  };

  // ---------- text helpers ----------
  // Lowercase and strip accents so "Café" matches "cafe".
  App.norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  App.cleanTag = t => String(t || "").replace(/^#+/, "").replace(/\s+/g, " ").trim();
  const TAG_COLORS = 6;
  App.tagColor = t => { let h = 0; for (const ch of App.norm(t)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % TAG_COLORS; };
  App.tagChip = (t, extra) => `<span class="tag tag-c${App.tagColor(t)} ${extra || ""}">${App.escapeHtml(t)}</span>`;

  // ---------- location ----------
  App.getPosition = () => new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 }
    );
  });
  // OpenStreetMap's free reverse geocoder turns coordinates into a place name.
  App.placeName = async (lat, lng) => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`;
      const res = await fetch(url, { headers: { "Accept-Language": navigator.language || "en" } });
      if (!res.ok) throw new Error(res.status);
      const j = await res.json();
      const a = j.address || {};
      const street = [a.house_number, a.road].filter(Boolean).join(" ");
      const place = j.name || street || a.neighbourhood || a.suburb;
      const town = a.city || a.town || a.village || a.hamlet || a.county;
      const label = [place, town].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(", ");
      return label || j.display_name || null;
    } catch (e) {
      return null;
    }
  };
  App.currentLocation = async () => {
    const pos = await App.getPosition();
    if (!pos) return null;
    const label = await App.placeName(pos.lat, pos.lng);
    return { lat: pos.lat, lng: pos.lng, label: label || `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}` };
  };

  // ---------- toast ----------
  App.toast = (msg, opts = {}) => {
    const wrap = document.getElementById("toasts");
    const t = App.el(`<div class="toast ${opts.type || ""}"><span>${App.escapeHtml(msg)}</span></div>`);
    if (opts.action) {
      const b = App.el(`<button type="button">${App.escapeHtml(opts.action)}</button>`);
      b.onclick = () => { opts.onAction && opts.onAction(); dismiss(); };
      t.appendChild(b);
    }
    wrap.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    const dismiss = () => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); };
    setTimeout(dismiss, opts.duration || 3200);
    return dismiss;
  };

  // ---------- bottom sheet ----------
  // App.sheet({ title, html, onClose, beforeClose, full }) → { el, body, close }
  App.sheet = (opts) => {
    const root = App.el(`
      <div class="sheet-root">
        <div class="sheet-backdrop"></div>
        <div class="sheet ${opts.full ? "full" : ""}" role="dialog" aria-modal="true">
          <div class="sheet-grip"></div>
          <div class="sheet-head">
            <h2>${App.escapeHtml(opts.title || "")}</h2>
            <div class="sheet-head-actions"></div>
            <button type="button" class="icon-btn sheet-close" aria-label="Close">${App.icon("x")}</button>
          </div>
          <div class="sheet-body"></div>
        </div>
      </div>`);
    const body = root.querySelector(".sheet-body");
    if (typeof opts.html === "string") body.innerHTML = opts.html;
    else if (opts.html) body.appendChild(opts.html);
    document.body.appendChild(root);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(() => root.classList.add("open"));

    let closed = false;
    const close = async (force) => {
      if (closed) return;
      if (!force && opts.beforeClose && (await opts.beforeClose()) === false) return;
      closed = true;
      root.classList.remove("open");
      setTimeout(() => {
        root.remove();
        if (!document.querySelector(".sheet-root")) document.body.classList.remove("sheet-open");
      }, 280);
      opts.onClose && opts.onClose();
      if (api.onClosed) api.onClosed();
    };
    root.querySelector(".sheet-backdrop").onclick = () => close();
    root.querySelector(".sheet-close").onclick = () => close();
    const api = { el: root, body, head: root.querySelector(".sheet-head-actions"), close };
    return api;
  };

  // ---------- confirm ----------
  App.confirm = ({ title, message, confirmText = "OK", cancelText = "Cancel", danger }) => new Promise(resolve => {
    const root = App.el(`
      <div class="dialog-root">
        <div class="dialog" role="alertdialog" aria-modal="true">
          <h3>${App.escapeHtml(title || "")}</h3>
          ${message ? `<p>${App.escapeHtml(message)}</p>` : ""}
          <div class="dialog-actions">
            <button type="button" class="btn ghost" data-a="no">${App.escapeHtml(cancelText)}</button>
            <button type="button" class="btn ${danger ? "danger" : "primary"}" data-a="yes">${App.escapeHtml(confirmText)}</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(root);
    requestAnimationFrame(() => root.classList.add("open"));
    const done = v => { root.classList.remove("open"); setTimeout(() => root.remove(), 200); resolve(v); };
    root.querySelector('[data-a="yes"]').onclick = () => done(true);
    root.querySelector('[data-a="no"]').onclick = () => done(false);
  });

  // ---------- photo viewer ----------
  App.viewPhotos = (photos, startIndex, caption) => {
    let i = startIndex || 0;
    const root = App.el(`
      <div class="viewer">
        <button type="button" class="icon-btn viewer-close" aria-label="Close">${App.icon("x")}</button>
        <img alt="">
        <div class="viewer-bar">
          <button type="button" class="icon-btn" data-d="-1" aria-label="Previous">${App.icon("back")}</button>
          <span class="viewer-count"></span>
          <button type="button" class="icon-btn" data-d="1" aria-label="Next">${App.icon("next")}</button>
        </div>
        ${caption ? `<div class="viewer-caption">${App.escapeHtml(caption)}</div>` : ""}
      </div>`);
    const img = root.querySelector("img");
    const show = async () => {
      root.querySelector(".viewer-count").textContent = photos.length > 1 ? `${i + 1} of ${photos.length}` : "";
      root.querySelectorAll("[data-d]").forEach(b => { b.style.visibility = photos.length > 1 ? "visible" : "hidden"; });
      img.src = await App.store.photoSrc(photos[i], false);
    };
    const step = d => { i = (i + d + photos.length) % photos.length; show(); };
    root.querySelectorAll("[data-d]").forEach(b => { b.onclick = () => step(Number(b.dataset.d)); });
    root.querySelector(".viewer-close").onclick = () => root.remove();
    let sx = null;
    root.addEventListener("touchstart", e => { sx = e.touches[0].clientX; }, { passive: true });
    root.addEventListener("touchend", e => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 50 && photos.length > 1) step(dx < 0 ? 1 : -1);
    });
    document.body.appendChild(root);
    show();
  };

  // Fill <img data-photo> placeholders (local mode keeps photos as blobs).
  App.photoImg = (photo, thumb, cls) => {
    const src = App.store.photoSrcSync(photo, thumb);
    return `<img class="${cls || ""}" loading="lazy" alt="" ${src ? `src="${App.escapeHtml(src)}"` : `data-photo="${App.escapeHtml(photo.id)}" data-thumb="${thumb ? 1 : 0}"`}>`;
  };
  App.hydrate = root => {
    root.querySelectorAll("img[data-photo]").forEach(async img => {
      const id = img.dataset.photo;
      img.removeAttribute("data-photo");
      img.src = await App.store.photoSrc({ id }, img.dataset.thumb === "1");
    });
    root.querySelectorAll("[data-bg-photo]").forEach(async el => {
      const id = el.dataset.bgPhoto;
      el.removeAttribute("data-bg-photo");
      const src = await App.store.photoSrc({ id }, true);
      if (src) el.style.backgroundImage = `url("${src}")`;
    });
  };

  // ---------- routing ----------
  // #/calendar/2026-10 · #/day/2026-10-14 · #/search · #/onthisday · #/settings
  App.views = {};
  let current = null;
  App.route = () => {
    const parts = (location.hash.replace(/^#\/?/, "") || "calendar").split("/");
    const name = App.views[parts[0]] ? parts[0] : "calendar";
    const view = document.getElementById("view");
    if (current && current.unmount) current.unmount();
    current = App.views[name];
    current.params = parts.slice(1);
    view.className = `view view-${name}`;
    view.innerHTML = "";
    current.mount(view, parts.slice(1));
    view.scrollTop = 0;
    window.scrollTo(0, 0);
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === (name === "day" ? "calendar" : name)));
  };
  App.refresh = () => { if (current && current.refresh) current.refresh(); };
  App.go = hash => { if (location.hash === hash) App.route(); else location.hash = hash; };
  // The date the "+" button and editor should default to.
  App.contextDate = () => (current && current.contextDate ? current.contextDate() : App.todayStr());
})(window);
