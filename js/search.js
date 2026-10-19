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

  // The typed text, read as plain English: dates, question type, people,
  // word groups and typo fixes (see query.js).
  const parsed = () => App.parseQuery(state.q, App.todayStr(), { settings: App.store.settings, vocab: App.store.vocab() });
  const active = () => !!(state.q.trim() || state.tags.size || state.starred || state.from || state.to);
  const hay = e => App.searchText([e.text, (e.tags || []).join(" "), e.location && e.location.label].filter(Boolean).join(" "));
  const newestFirst = (a, b) => (a.date === b.date ? String(b.time || "").localeCompare(String(a.time || "")) : a.date < b.date ? 1 : -1);

  // Everything except the words: dates in the question, highlights, the
  // date and tag filters under the search box.
  function inScope(e, p) {
    if ((state.starred || p.starred) && !e.starred) return false;
    if (state.from && e.date < state.from) return false;
    if (state.to && e.date > state.to) return false;
    if (!p.test(e.date)) return false;
    if (state.tags.size) {
      const have = new Set((e.tags || []).map(App.norm));
      for (const t of state.tags) if (!have.has(t)) return false;
    }
    return true;
  }

  // → { exact, closest, pool }. When nothing matches every part of the
  // question, "closest" holds the best partial matches instead.
  function search(p) {
    const pool = App.store.all().filter(e => inScope(e, p)).sort(newestFirst);
    if (!p.groups.length && p.dropped.length) return { exact: [], closest: [], pool };
    const scored = pool.map(e => { const h = hay(e); return { e, n: p.groups.filter(g => App.groupMatches(h, g)).length }; });
    const exact = scored.filter(x => x.n === p.groups.length).map(x => x.e);
    let closest = [];
    if (!exact.length && p.groups.length) {
      const min = p.hasDate || state.from || state.to ? 0 : 1;
      closest = scored.filter(x => x.n >= min).sort((a, b) => b.n - a.n || newestFirst(a.e, b.e)).slice(0, 30).map(x => x.e);
    }
    return { exact, closest, pool };
  }

  // Words to highlight in results.
  const highlightTerms = p => p.groups.flatMap(g => g.alts).filter(a => a.length >= 3);

  // A window of text around the first matching word.
  function around(text, ts, len) {
    const t = (text || "").replace(/\s+/g, " ").trim();
    if (t.length <= len) return t;
    const n = App.norm(t);
    let at = -1;
    for (const term of ts) { const i = n.indexOf(App.norm(term)); if (i >= 0 && (at < 0 || i < at)) at = i; }
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
  const cap = s => s.replace(/^./, c => c.toUpperCase());

  // Short day labels: weekdays for a recent week ("Sat, Sun"), otherwise
  // dates ("Jun 5, Jul 4").
  function dayLabels(dates) {
    const sorted = [...new Set(dates)].sort();
    const days = d => (App.parseDate(App.todayStr()) - App.parseDate(d)) / 86400000;
    const weekdays = days(sorted[0]) <= 13 && days(sorted[0]) - days(sorted[sorted.length - 1]) < 7;
    return sorted.map(d => App.parseDate(d).toLocaleDateString(undefined, weekdays ? { weekday: "short" } : { month: "short", day: "numeric" })).join(", ");
  }

  // The short answer shown above the results.
  function answerCard(p, exact, pool) {
    if (!p.ask) return "";
    const subject = p.groups.length ? p.groups.map(g => `“${App.escapeHtml(g.label)}”`).join(" + ") : p.dropped.length ? `“${App.escapeHtml(p.dropped.join(" "))}”` : "this";
    const scope = p.when ? ` (${App.escapeHtml(p.when)})` : "";
    const open = `<span class="answer-open">Open that day ${App.icon("next")}</span>`;

    if (p.ask === "who" || p.ask === "where") {
      const list = p.groups.length ? exact : pool;
      const found = new Map(); // name → dates
      const add = (name, d) => { if (!found.has(name)) found.set(name, []); found.get(name).push(d); };
      const people = (App.store.settings.people || []).map(x => ({ label: x.name, kind: "person", alts: [x.name, ...(x.aliases || [])] }));
      for (const e of list) {
        if (p.ask === "where") { if (e.location && e.location.label) add(e.location.label, e.date); continue; }
        const h = hay(e);
        if (people.length) people.forEach(g => { if (App.groupMatches(h, g)) add(g.label, e.date); });
        else (e.tags || []).forEach(t => add(t, e.date));
      }
      const what = p.ask === "who" ? "People" : "Places";
      if (!found.size) {
        return `<div class="answer none"><p>${p.ask === "who"
          ? (people.length ? `No one from your People list comes up${scope}.` : `Add people in <a href="#/settings">Settings → Smart search</a> so I can recognize names. Until then, here's what you wrote${scope}.`)
          : `No saved locations${scope}. Here's what you wrote.`}</p></div>`;
      }
      const rows = [...found.entries()].sort((a, b) => b[1].length - a[1].length);
      return `
        <div class="answer">
          <div class="answer-kicker">${what}${scope}</div>
          <ul class="answer-list">${rows.slice(0, 12).map(([name, ds]) => `<li><strong>${App.escapeHtml(name)}</strong><span>${App.escapeHtml(dayLabels(ds))}</span></li>`).join("")}</ul>
        </div>`;
    }

    if (!exact.length) return `<div class="answer none"><p>Nothing in your journal mentions ${subject}${scope} yet.</p></div>`;
    const days = [...new Set(exact.map(e => e.date))].sort();
    const last = days[days.length - 1];
    if (p.ask === "count") {
      return `
        <div class="answer">
          <div class="answer-kicker">${App.escapeHtml(p.when || "In your whole journal")}</div>
          <div class="answer-big">${days.length} ${days.length === 1 ? "time" : "times"}</div>
          <p>Days with an entry mentioning ${subject}. Most recently <a href="#/day/${last}">${App.escapeHtml(App.fmtDayMed(last))}</a>, ${ago(last)}.</p>
        </div>`;
    }
    if (p.ask === "since") {
      return `
        <a class="answer" href="#/day/${last}">
          <div class="answer-kicker">Since ${subject}${scope}</div>
          <div class="answer-big">${cap(ago(last))}</div>
          <p>On ${App.escapeHtml(App.fmtDayLong(last))}${open}</p>
        </a>`;
    }
    if (p.ask === "read") {
      return `
        <div class="answer">
          <div class="answer-kicker">What you wrote${scope}</div>
          <div class="answer-big">${App.plural(exact.length, "entry", "entries")}</div>
          <p>About ${subject}${days.length !== exact.length ? ` on ${App.plural(days.length, "day")}` : ""}. Read them below.</p>
        </div>`;
    }
    const d = p.ask === "first" ? days[0] : last;
    return `
      <a class="answer" href="#/day/${d}">
        <div class="answer-kicker">${p.ask === "first" ? "First time" : "Last time"}${scope}</div>
        <div class="answer-big">${App.escapeHtml(App.fmtDayLong(d))}</div>
        <p>${cap(ago(d))}${days.length > 1 ? ` · mentioned on ${days.length} days in all` : ""}${open}</p>
      </a>`;
  }

  // Tappable examples shown before you type.
  const EXAMPLES = [
    ["Last weekend", "what did I do last weekend"],
    ["When did I last see…", "when did I last see "],
    ["Who did I see this week?", "who did I see this week"],
    ["Workouts this month", "how many times did I work out this month"],
    ["This month's highlights", "highlights this month"],
    ["A year ago today", "a year ago today"]
  ];

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
        <div class="examples">${EXAMPLES.map(([label, q], i) => `<button type="button" class="chip" data-ex="${i}">${App.escapeHtml(label)}</button>`).join("")}</div>
        <p class="muted small">Search a word, person or place, or ask in plain English, like <em>when did I last see James?</em>, <em>what did I do last Sunday?</em> or <em>how many times did I work out this year?</em> Teach it nicknames in <a href="#/settings">Settings → Smart search</a>.</p>
        ${recent.length ? `<h2 class="section-title">${App.icon("star")} Recent highlights</h2><div class="entries">${recent.map(e => App.entryCard({ ...e, text: App.snippet(e, 200) }, { showDate: true })).join("")}</div>` : ""}`;
      App.bindEntries(box);
      box.querySelectorAll("[data-ex]").forEach(b => {
        b.onclick = () => {
          const q = EXAMPLES[Number(b.dataset.ex)][1];
          const input = root.querySelector(".search-box input");
          state.q = q; input.value = q; state.limit = 50;
          if (q.endsWith(" ")) { input.focus(); input.setSelectionRange(q.length, q.length); return; }
          paintResults(root); paintChips(root);
        };
      });
      return;
    }
    const p = parsed();
    const { exact, closest, pool } = search(p);
    const showing = exact.length ? exact : closest;
    const shown = showing.slice(0, state.limit);
    const hl = highlightTerms(p);
    // How the question was read, e.g. "October 14 · every year · “James Agan”".
    const readAs = [p.when, p.starred ? "highlights" : "", ...p.groups.map(g => `“${g.label}”`)].filter(Boolean);
    const plain = p.groups.length === 1 && p.groups[0].kind === "word" && !p.when && !p.starred && App.norm(state.q).trim() === p.groups[0].label;
    const notes = [
      ...p.corrected.map(c => `Searched for “${App.escapeHtml(c.to)}” instead of “${App.escapeHtml(c.from)}”.`),
      ...(p.dropped.length && p.groups.length ? [`Left out ${p.dropped.map(w => `“${App.escapeHtml(w)}”`).join(", ")}, which isn't in your journal.`] : [])
    ];
    let count;
    if (exact.length) count = App.plural(exact.length, "entry", "entries") + (new Set(exact.map(e => e.date)).size !== exact.length ? ` on ${App.plural(new Set(exact.map(e => e.date)).size, "day")}` : "");
    else if (closest.length) count = p.hasDate || state.from || state.to
      ? `Nothing mentions ${p.groups.map(g => `“${App.escapeHtml(g.label)}”`).join(" + ")} then. Here's everything from ${App.escapeHtml(p.when || "those dates")}:`
      : "No entry matches everything. Closest matches:";
    else if (!p.groups.length && p.dropped.length) count = `Nothing in your journal mentions ${p.dropped.map(w => `“${App.escapeHtml(w)}”`).join(", ")}.`;
    else count = "No matches. Try fewer or different words.";
    const answer = answerCard(p, exact, pool);
    box.innerHTML = `
      ${state.q.trim() && !plain && readAs.length ? `<p class="read-as">${App.icon("search")}<span>Showing <strong>${readAs.map(App.escapeHtml).join(" · ")}</strong></span></p>` : ""}
      ${notes.length ? `<p class="search-note">${notes.join(" ")}</p>` : ""}
      ${answer}
      <p class="result-count">${count}</p>
      <div class="entries">${shown.map(e => App.entryCard({ ...e, text: around(e.text, hl, 220) }, { showDate: true, terms: hl, maxPhotos: 4 })).join("")}</div>
      ${showing.length > shown.length ? `<div class="center"><button type="button" class="btn ghost" data-a="more">Show more</button></div>` : ""}
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
