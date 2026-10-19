/*
 * Search: keyword search across entry text, tags and places, with filters
 * for tags, highlights only, and a date range.
 */
(function (App) {
  "use strict";

  const state = { q: "", tags: new Set(), starred: false, from: "", to: "", limit: 50 };

  App.searchTag = tag => {
    state.q = ""; state.tags = new Set([App.norm(tag)]); state.starred = false; state.from = ""; state.to = "";
    App.go("#/search");
  };

  // The typed text, read as plain English (dates, "highlights", filler words).
  const parsed = () => App.parseQuery(state.q);
  const active = () => !!(state.q.trim() || state.tags.size || state.starred || state.from || state.to);

  function haystack(e) {
    return App.norm([e.text, (e.tags || []).join(" "), e.location && e.location.label].filter(Boolean).join(" \n "));
  }

  function results() {
    const p = parsed();
    const ts = p.terms;
    return App.store.all().filter(e => {
      if ((state.starred || p.starred) && !e.starred) return false;
      if (state.from && e.date < state.from) return false;
      if (state.to && e.date > state.to) return false;
      if (p.from && e.date < p.from) return false;
      if (p.to && e.date > p.to) return false;
      if (p.monthDay && e.date.slice(5) !== p.monthDay) return false;
      if (p.month && e.date.slice(5, 7) !== p.month) return false;
      if (state.tags.size) {
        const have = new Set((e.tags || []).map(App.norm));
        for (const t of state.tags) if (!have.has(t)) return false;
      }
      if (ts.length) {
        const h = haystack(e);
        for (const t of ts) if (!h.includes(t)) return false;
      }
      return true;
    }).sort((a, b) => (a.date === b.date ? String(b.time || "").localeCompare(String(a.time || "")) : a.date < b.date ? 1 : -1));
  }

  // A window of text around the first matching word.
  function around(text, ts, len) {
    const t = (text || "").replace(/\s+/g, " ").trim();
    if (t.length <= len) return t;
    const n = App.norm(t);
    let at = -1;
    for (const term of ts) { const i = n.indexOf(term); if (i >= 0 && (at < 0 || i < at)) at = i; }
    if (at < 0) return t.slice(0, len).replace(/\s\S*$/, "") + "…";
    const start = Math.max(0, at - Math.floor(len / 3));
    let s = t.slice(start, start + len);
    if (start > 0) s = "…" + s.replace(/^\S*\s/, "");
    if (start + len < t.length) s = s.replace(/\s\S*$/, "") + "…";
    return s;
  }

  // "3 days ago", "2 months ago"…
  function ago(d) {
    const days = Math.round((App.parseDate(App.todayStr()) - App.parseDate(d)) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 14) return `${days} days ago`;
    if (days < 60) return `${Math.round(days / 7)} weeks ago`;
    const months = Math.round(days / 30.44);
    if (months < 12) return `${months} months ago`;
    const y = Math.floor(months / 12), m = months % 12;
    return `${App.plural(y, "year")}${m ? `, ${App.plural(m, "month")}` : ""} ago`;
  }

  // The short answer shown above the results for "when did I last…",
  // "first time I…" and "how many times…" questions.
  function answerCard(p, all) {
    if (!p.ask) return "";
    const subject = p.terms.length ? `“${App.escapeHtml(p.terms.join(" "))}”` : "this";
    const scope = p.when ? ` (${App.escapeHtml(p.when)})` : "";
    if (!all.length) return `<div class="answer none"><p>Nothing in your journal mentions ${subject}${scope} yet.</p></div>`;
    const days = [...new Set(all.map(e => e.date))].sort();
    const last = days[days.length - 1];
    if (p.ask === "count") {
      return `
        <div class="answer">
          <div class="answer-kicker">${App.escapeHtml(p.when || "In your whole journal")}</div>
          <div class="answer-big">${days.length} ${days.length === 1 ? "time" : "times"}</div>
          <p>Days with an entry mentioning ${subject}. Most recently <a href="#/day/${last}">${App.escapeHtml(App.fmtDayMed(last))}</a>, ${ago(last)}.</p>
        </div>`;
    }
    const d = p.ask === "first" ? days[0] : last;
    return `
      <a class="answer" href="#/day/${d}">
        <div class="answer-kicker">${p.ask === "first" ? "First time" : "Last time"}${scope}</div>
        <div class="answer-big">${App.escapeHtml(App.fmtDayLong(d))}</div>
        <p>${ago(d).replace(/^./, c => c.toUpperCase())}${days.length > 1 ? ` · mentioned on ${days.length} days in all` : ""} <span class="answer-open">Open that day ${App.icon("next")}</span></p>
      </a>`;
  }

  function dateLabel() {
    if (!state.from && !state.to) return "Any time";
    if (state.from && state.to) {
      if (state.from.endsWith("-01-01") && state.to.endsWith("-12-31") && state.from.slice(0, 4) === state.to.slice(0, 4)) return state.from.slice(0, 4);
      return `${App.fmtDayMed(state.from)} – ${App.fmtDayMed(state.to)}`;
    }
    return state.from ? `Since ${App.fmtDayMed(state.from)}` : `Until ${App.fmtDayMed(state.to)}`;
  }

  function render(root) {
    root.innerHTML = `
      <header class="page-head"><h1>Search</h1></header>
      <div class="search-box">
        ${App.icon("search")}
        <input type="search" placeholder="Search your journal…" value="${App.escapeHtml(state.q)}" enterkeyhint="search" aria-label="Search">
      </div>
      <div class="filters">
        <button type="button" class="chip ${state.starred ? "on" : ""}" data-a="starred">${App.icon("star")} Highlights</button>
        <button type="button" class="chip ${state.from || state.to ? "on" : ""}" data-a="dates">${App.icon("calendar")} <span>${App.escapeHtml(dateLabel())}</span></button>
        ${active() ? `<button type="button" class="chip ghost" data-a="clear">Clear</button>` : ""}
      </div>
      <div class="tag-strip"></div>
      <div class="results"></div>
    `;
    const input = root.querySelector("input");
    input.oninput = App.debounce(() => { state.q = input.value; state.limit = 50; paintResults(root); paintChips(root); }, 150);
    input.onkeydown = ev => { if (ev.key === "Enter") input.blur(); };
    root.querySelector('[data-a="starred"]').onclick = () => { state.starred = !state.starred; render(root); };
    root.querySelector('[data-a="dates"]').onclick = () => pickDates(root);
    const clear = root.querySelector('[data-a="clear"]');
    if (clear) clear.onclick = () => { state.q = ""; state.tags.clear(); state.starred = false; state.from = ""; state.to = ""; render(root); };
    paintTags(root);
    paintResults(root);
  }

  function paintChips(root) {
    const filters = root.querySelector(".filters");
    const clear = filters.querySelector('[data-a="clear"]');
    if (active() && !clear) {
      const b = App.el(`<button type="button" class="chip ghost" data-a="clear">Clear</button>`);
      b.onclick = () => { state.q = ""; state.tags.clear(); state.starred = false; state.from = ""; state.to = ""; render(root); };
      filters.appendChild(b);
    } else if (!active() && clear) clear.remove();
  }

  function paintTags(root) {
    const strip = root.querySelector(".tag-strip");
    const tags = App.store.tags();
    if (!tags.length) { strip.innerHTML = ""; return; }
    strip.innerHTML = tags.slice(0, 40).map(t => {
      const on = state.tags.has(App.norm(t.tag));
      return `<button type="button" class="tag tag-c${App.tagColor(t.tag)} ${on ? "on" : ""}" data-t="${App.escapeHtml(App.norm(t.tag))}">${App.escapeHtml(t.tag)} <small>${t.count}</small></button>`;
    }).join("");
    strip.querySelectorAll("[data-t]").forEach(b => {
      b.onclick = () => {
        const k = b.dataset.t;
        if (state.tags.has(k)) state.tags.delete(k); else state.tags.add(k);
        render(root);
      };
    });
  }

  function paintResults(root) {
    const box = root.querySelector(".results");
    if (!App.store.all().length) {
      box.innerHTML = `<div class="empty"><p class="empty-title">Nothing to search yet</p><p>Once you've written a few entries, you can find them here by any word, tag or place.</p></div>`;
      return;
    }
    if (!active()) {
      const recent = App.store.all().filter(e => e.starred).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
      box.innerHTML = `
        <p class="muted small">Search a word, person or place, like <em>dentist</em> or <em>Sam</em>, or ask in plain English: <em>what did I do on Oct 14</em>, <em>when did I last see Sam</em>, <em>how many times did I go to the gym last year</em>. Tap a tag above to see every entry with it.</p>
        ${recent.length ? `<h2 class="section-title">${App.icon("star")} Recent highlights</h2><div class="entries">${recent.map(e => App.entryCard({ ...e, text: App.snippet(e, 200) }, { showDate: true })).join("")}</div>` : ""}`;
      App.bindEntries(box);
      return;
    }
    const p = parsed();
    const ts = p.terms;
    const all = results();
    const shown = all.slice(0, state.limit);
    // Say how a question was read, e.g. "October 14 · every year · “sam”".
    const readAs = [p.when, p.starred ? "highlights" : "", ts.length ? `“${ts.join(" ")}”` : ""].filter(Boolean);
    const showReadAs = state.q.trim() && (p.when || p.starred || ts.join(" ") !== App.norm(state.q).trim().replace(/\s+/g, " "));
    box.innerHTML = `
      ${showReadAs ? `<p class="read-as">${App.icon("search")}<span>Showing <strong>${readAs.map(App.escapeHtml).join(" · ") || "everything"}</strong></span></p>` : ""}
      ${answerCard(p, all)}
      <p class="result-count">${all.length ? App.plural(all.length, "entry", "entries") + (new Set(all.map(e => e.date)).size !== all.length ? ` on ${App.plural(new Set(all.map(e => e.date)).size, "day")}` : "") : "No matches. Try fewer or different words."}</p>
      <div class="entries">${shown.map(e => App.entryCard({ ...e, text: around(e.text, ts, 220) }, { showDate: true, terms: ts, maxPhotos: 4 })).join("")}</div>
      ${all.length > shown.length ? `<div class="center"><button type="button" class="btn ghost" data-a="more">Show more</button></div>` : ""}
    `;
    App.bindEntries(box);
    const more = box.querySelector('[data-a="more"]');
    if (more) more.onclick = () => { state.limit += 50; paintResults(root); };
  }

  function pickDates(root) {
    const today = App.todayStr();
    const y = Number(today.slice(0, 4));
    const presets = [
      ["Any time", "", ""],
      ["Last 30 days", App.addDays(today, -30), today],
      ["This year", `${y}-01-01`, `${y}-12-31`],
      ["Last year", `${y - 1}-01-01`, `${y - 1}-12-31`],
      [String(y - 2), `${y - 2}-01-01`, `${y - 2}-12-31`]
    ];
    const sheet = App.sheet({
      title: "Dates",
      html: `
        <div class="preset-list">${presets.map((p, i) => `<button type="button" class="chip" data-p="${i}">${p[0]}</button>`).join("")}</div>
        <div class="ed-when">
          <label class="field"><span>From</span><input type="date" name="from" value="${state.from}"></label>
          <label class="field"><span>To</span><input type="date" name="to" value="${state.to}"></label>
        </div>
        <button type="button" class="btn primary block" data-a="apply">Apply</button>`
    });
    sheet.body.querySelectorAll("[data-p]").forEach(b => {
      b.onclick = () => { const p = presets[Number(b.dataset.p)]; state.from = p[1]; state.to = p[2]; sheet.close(); render(root); };
    });
    sheet.body.querySelector('[data-a="apply"]').onclick = () => {
      state.from = sheet.body.querySelector('[name="from"]').value;
      state.to = sheet.body.querySelector('[name="to"]').value;
      if (state.from && state.to && state.from > state.to) [state.from, state.to] = [state.to, state.from];
      sheet.close(); render(root);
    };
  }

  App.views.search = {
    mount(root) { this.root = root; render(root); },
    refresh() {
      if (!this.root) return;
      paintTags(this.root);
      paintResults(this.root);
    },
    unmount() { this.root = null; }
  };
})(window.App);
