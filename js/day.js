/*
 * Day: everything you wrote on one date, in time order.
 * Also defines App.entryCard, the entry layout reused by other screens.
 */
(function (App) {
  "use strict";

  // Text with line breaks kept, optional <mark> highlights for search terms.
  App.richText = (text, terms) => {
    let html = App.escapeHtml(text || "");
    if (terms && terms.length) {
      const pattern = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      html = html.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
    }
    return html;
  };

  App.entryCard = (e, opts = {}) => {
    const meta = [
      e.time ? `<span>${App.icon("clock")}${App.escapeHtml(App.fmtTime(e.time))}</span>` : "",
      e.location ? `<span>${App.icon("pin")}${App.escapeHtml(e.location.label)}</span>` : ""
    ].filter(Boolean).join("");
    const photos = e.photos || [];
    return `
      <article class="entry ${e.starred ? "starred" : ""}" data-id="${App.escapeHtml(e.id)}">
        <div class="entry-head">
          <div class="entry-meta">
            ${opts.showDate ? `<a class="entry-date" href="#/day/${e.date}">${App.escapeHtml(App.fmtDayMed(e.date))}</a>` : ""}
            ${meta}
          </div>
          <button type="button" class="icon-btn sm star-btn ${e.starred ? "on" : ""}" data-a="star" aria-label="${e.starred ? "Remove highlight" : "Mark as highlight"}">${App.icon("star")}</button>
        </div>
        ${e.text ? `<div class="entry-text" data-a="edit">${App.richText(opts.clip ? App.snippet(e, opts.clip) : e.text, opts.terms)}</div>` : ""}
        ${photos.length ? `<div class="entry-photos n${Math.min(photos.length, 4)}">${photos.slice(0, opts.maxPhotos || 12).map((p, i) => `<button type="button" class="entry-photo" data-photo-i="${i}">${App.photoImg(p, true)}</button>`).join("")}</div>` : ""}
        ${(e.tags || []).length ? `<div class="entry-tags">${e.tags.map(t => `<a href="#/search" class="tag tag-c${App.tagColor(t)}" data-tag="${App.escapeHtml(t)}">${App.escapeHtml(t)}</a>`).join("")}</div>` : ""}
        ${opts.noEdit ? "" : `<button type="button" class="entry-edit" data-a="edit">${App.icon("edit")} Edit</button>`}
      </article>`;
  };

  // Wire up the buttons inside rendered entry cards.
  App.bindEntries = root => {
    App.hydrate(root);
    root.querySelectorAll(".entry").forEach(card => {
      const id = card.dataset.id;
      card.querySelectorAll('[data-a="edit"]').forEach(b => {
        b.onclick = ev => {
          if (ev.target.closest("a")) return;
          const e = App.store.get(id);
          if (e) App.openEditor({ entry: e });
        };
      });
      const star = card.querySelector('[data-a="star"]');
      if (star) star.onclick = () => {
        const e = App.store.get(id);
        if (e) App.store.save({ ...e, starred: !e.starred });
      };
      card.querySelectorAll("[data-photo-i]").forEach(b => {
        b.onclick = () => {
          const e = App.store.get(id);
          if (e) App.viewPhotos(e.photos, Number(b.dataset.photoI), App.fmtDayLong(e.date));
        };
      });
      card.querySelectorAll("[data-tag]").forEach(a => {
        a.onclick = ev => { ev.preventDefault(); App.searchTag(a.dataset.tag); };
      });
    });
  };

  function render(root, date) {
    const list = App.store.forDate(date);
    const rel = App.relativeDay(date);
    root.innerHTML = `
      <header class="day-head">
        <a class="back-link" href="#/calendar/${App.monthKey(date)}">${App.icon("back")}${App.icon("calendar")}<span>${App.escapeHtml(App.fmtMonth(App.monthKey(date)))}</span></a>
        <div class="day-bar">
          <a class="icon-btn" href="#/day/${App.addDays(date, -1)}" aria-label="Previous day">${App.icon("back")}</a>
          <div class="day-title">
            <div class="kicker">${rel ? `${rel} · ` : ""}${App.escapeHtml(App.parseDate(date).toLocaleDateString(undefined, { weekday: "long" }))}</div>
            <h1>${App.escapeHtml(App.parseDate(date).toLocaleDateString(undefined, { month: "long", day: "numeric" }))}</h1>
            <div class="sub">${App.parseDate(date).getFullYear()}</div>
          </div>
          <a class="icon-btn" href="#/day/${App.addDays(date, 1)}" aria-label="Next day">${App.icon("next")}</a>
        </div>
      </header>
      ${list.length ? `<div class="entries">${list.map(e => App.entryCard(e)).join("")}</div>` : `
        <div class="empty">
          <p class="empty-title">Nothing written for this day</p>
          <p>${date > App.todayStr() ? "This day hasn't happened yet." : "Remember something from this day? Add it now."}</p>
        </div>`}
      <div class="center"><button type="button" class="btn ${list.length ? "ghost" : "primary"}" data-a="add">${App.icon("plus")} Add ${list.length ? "another entry" : "an entry"}</button></div>
    `;
    App.bindEntries(root);
    root.querySelector('[data-a="add"]').onclick = () => App.openEditor({ date });
    const focus = App.focusEntry;
    App.focusEntry = null;
    if (focus) {
      const card = root.querySelector(`.entry[data-id="${CSS.escape(focus)}"]`);
      if (card) { card.scrollIntoView({ block: "center" }); card.classList.add("flash"); }
    }
  }

  App.views.day = {
    mount(root, params) {
      this.date = /^\d{4}-\d{2}-\d{2}$/.test(params[0] || "") ? params[0] : App.todayStr();
      this.root = root;
      render(root, this.date);
      let sx = null, sy = null;
      this.ts = ev => { const t = ev.touches[0]; sx = t.clientX; sy = t.clientY; };
      this.te = ev => {
        if (sx == null || ev.target.closest(".entry-photos")) return;
        const t = ev.changedTouches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        sx = null;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) App.go(`#/day/${App.addDays(this.date, dx < 0 ? 1 : -1)}`);
      };
      root.addEventListener("touchstart", this.ts, { passive: true });
      root.addEventListener("touchend", this.te);
    },
    refresh() { if (this.root) render(this.root, this.date); },
    unmount() {
      this.root.removeEventListener("touchstart", this.ts);
      this.root.removeEventListener("touchend", this.te);
      this.root = null;
    },
    contextDate() { return this.date; }
  };
})(window.App);
