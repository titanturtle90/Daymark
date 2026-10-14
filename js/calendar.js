/*
 * Calendar: the home screen. A month grid where journaled days show their
 * first photo (or a dot), with highlights and an "on this day" nudge below.
 */
(function (App) {
  "use strict";

  let month = null; // "YYYY-MM" being shown; survives navigating away and back

  function dayThumb(list) {
    const ordered = [...list.filter(e => e.starred), ...list.filter(e => !e.starred)];
    for (const e of ordered) if ((e.photos || []).length) return e.photos[0];
    return null;
  }

  function cellHtml(dateStr, inMonth) {
    const list = App.store.forDate(dateStr);
    const today = App.todayStr();
    const day = Number(dateStr.slice(8));
    const cls = ["cal-cell"];
    if (!inMonth) cls.push("out");
    if (dateStr === today) cls.push("today");
    if (dateStr > today) cls.push("future");
    if (list.length) cls.push("has");
    const thumb = list.length ? dayThumb(list) : null;
    let bg = "";
    if (thumb) {
      cls.push("photo");
      const src = App.store.photoSrcSync(thumb, true);
      bg = src ? ` style="background-image:url('${App.escapeHtml(src)}')"` : ` data-bg-photo="${App.escapeHtml(thumb.id)}"`;
    }
    const star = list.some(e => e.starred) ? `<span class="cal-star">${App.icon("star")}</span>` : "";
    return `<a class="${cls.join(" ")}" href="#/day/${dateStr}"${bg} aria-label="${App.fmtDayLong(dateStr)}${list.length ? `, ${App.plural(list.length, "entry", "entries")}` : ""}">
      <span class="cal-num">${day}</span>${star}${list.length && !thumb ? `<span class="cal-dot"></span>` : ""}</a>`;
  }

  function gridHtml(key) {
    const first = App.parseDate(key + "-01");
    const start = new Date(first);
    start.setDate(1 - first.getDay()); // weeks start on Sunday
    const cells = [];
    const weeks = Math.ceil((first.getDay() + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7);
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const s = App.toDateStr(d);
      cells.push(cellHtml(s, App.monthKey(s) === key));
    }
    const names = [0, 1, 2, 3, 4, 5, 6].map(i => new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }));
    return `<div class="cal-week">${names.map(n => `<span>${n}</span>`).join("")}</div><div class="cal-grid">${cells.join("")}</div>`;
  }

  function snippet(e, len) {
    const t = (e.text || "").replace(/\s+/g, " ").trim();
    if (!t) return (e.photos || []).length ? App.plural(e.photos.length, "photo") : "";
    return t.length > len ? t.slice(0, len).replace(/\s\S*$/, "") + "…" : t;
  }
  App.snippet = snippet;

  function render(root) {
    const key = month;
    const today = App.todayStr();
    const days = App.store.dates().filter(d => App.monthKey(d) === key);
    const starred = days.flatMap(d => App.store.forDate(d).filter(e => e.starred));

    // Same day in earlier years, for the nudge card.
    const md = today.slice(5);
    const past = App.store.dates().filter(d => d.slice(5) === md && d < today).reverse();

    root.innerHTML = `
      <header class="page-head cal-head">
        <button type="button" class="icon-btn" data-nav="-1" aria-label="Previous month">${App.icon("back")}</button>
        <button type="button" class="cal-title" data-a="pick"><h1>${App.escapeHtml(App.fmtMonth(key))}</h1>${App.icon("down")}</button>
        <button type="button" class="icon-btn" data-nav="1" aria-label="Next month">${App.icon("next")}</button>
      </header>
      ${key !== App.monthKey(today) ? `<div class="center"><button type="button" class="chip" data-a="today">Back to today</button></div>` : ""}
      <div class="cal">${gridHtml(key)}</div>
      <p class="cal-stats">${days.length ? `You wrote on ${App.plural(days.length, "day")} this month${starred.length ? ` · ${App.plural(starred.length, "highlight")}` : ""}` : "Nothing written this month yet."}</p>

      ${past.length && key === App.monthKey(today) ? `
        <a class="card otd-card" href="#/onthisday">
          <div class="card-kicker">${App.icon("history")} On this day</div>
          ${past.slice(0, 2).map(d => {
            const yrs = Number(today.slice(0, 4)) - Number(d.slice(0, 4));
            const list = App.store.forDate(d);
            const e = list.find(x => x.starred && x.text) || list.find(x => x.text) || list[0];
            return `<div class="otd-line"><strong>${yrs === 1 ? "1 year ago" : `${yrs} years ago`}</strong> ${App.escapeHtml(snippet(e, 90))}</div>`;
          }).join("")}
        </a>` : ""}

      ${starred.length ? `
        <section class="section">
          <h2 class="section-title">${App.icon("star")} Highlights this month</h2>
          <div class="list">${starred.map(e => `
            <a class="list-row" href="#/day/${e.date}">
              <span class="list-date">${App.escapeHtml(App.parseDate(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</span>
              <span class="list-text">${App.escapeHtml(snippet(e, 110))}</span>
            </a>`).join("")}
          </div>
        </section>` : ""}

      ${!App.store.all().length ? `
        <div class="empty">
          <p class="empty-title">Welcome to your journal</p>
          <p>Tap <strong>+</strong> to write about today. Use the microphone on your keyboard to talk instead of type.</p>
        </div>` : ""}
    `;
    App.hydrate(root);
    root.querySelectorAll("[data-nav]").forEach(b => { b.onclick = () => { month = App.addMonths(month, Number(b.dataset.nav)); render(root); }; });
    const todayBtn = root.querySelector('[data-a="today"]');
    if (todayBtn) todayBtn.onclick = () => { month = App.monthKey(App.todayStr()); render(root); };
    root.querySelector('[data-a="pick"]').onclick = () => pickMonth(root);
  }

  // Jump straight to any month and year.
  function pickMonth(root) {
    let year = Number(month.slice(0, 4));
    const withEntries = new Set(App.store.dates().map(App.monthKey));
    const sheet = App.sheet({ title: "Go to month", html: `<div class="mp"></div>` });
    const el = sheet.body.querySelector(".mp");
    const paint = () => {
      el.innerHTML = `
        <div class="mp-year">
          <button type="button" class="icon-btn" data-y="-1" aria-label="Previous year">${App.icon("back")}</button>
          <strong>${year}</strong>
          <button type="button" class="icon-btn" data-y="1" aria-label="Next year">${App.icon("next")}</button>
        </div>
        <div class="mp-grid">${Array.from({ length: 12 }, (_, i) => {
          const k = `${year}-${String(i + 1).padStart(2, "0")}`;
          const label = App.parseDate(k + "-01").toLocaleDateString(undefined, { month: "short" });
          return `<button type="button" class="mp-m ${k === month ? "on" : ""} ${withEntries.has(k) ? "has" : ""}" data-k="${k}">${label}</button>`;
        }).join("")}</div>`;
      el.querySelectorAll("[data-y]").forEach(b => { b.onclick = () => { year += Number(b.dataset.y); paint(); }; });
      el.querySelectorAll("[data-k]").forEach(b => { b.onclick = () => { month = b.dataset.k; sheet.close(); render(root); }; });
    };
    paint();
  }

  App.views.calendar = {
    mount(root, params) {
      if (params[0] && /^\d{4}-\d{2}$/.test(params[0])) month = params[0];
      if (!month) month = App.monthKey(App.todayStr());
      this.root = root;
      render(root);
      // Swipe left/right to change month.
      let sx = null, sy = null;
      this.ts = ev => { const t = ev.touches[0]; sx = t.clientX; sy = t.clientY; };
      this.te = ev => {
        if (sx == null || !ev.target.closest(".cal")) return;
        const t = ev.changedTouches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        sx = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { month = App.addMonths(month, dx < 0 ? 1 : -1); render(root); }
      };
      root.addEventListener("touchstart", this.ts, { passive: true });
      root.addEventListener("touchend", this.te);
    },
    refresh() { if (this.root) render(this.root); },
    unmount() {
      this.root.removeEventListener("touchstart", this.ts);
      this.root.removeEventListener("touchend", this.te);
      this.root = null;
    }
  };
})(window.App);
