/*
 * On This Day: what you wrote on this calendar date in earlier years.
 * If nothing matches exactly, shows entries from a few days either side.
 */
(function (App) {
  "use strict";

  let date = null; // the date whose month/day we're looking back on
  const NEARBY_DAYS = 3;

  function yearsAgoLabel(fromDate, d) {
    const n = Number(fromDate.slice(0, 4)) - Number(d.slice(0, 4));
    return n === 1 ? "1 year ago" : `${n} years ago`;
  }

  function render(root) {
    const md = date.slice(5);
    const thisYear = Number(date.slice(0, 4));
    const dates = App.store.dates();
    const exact = dates.filter(d => d.slice(5) === md && Number(d.slice(0, 4)) < thisYear).reverse();

    let nearby = [];
    if (!exact.length) {
      const years = [...new Set(dates.map(d => Number(d.slice(0, 4))))].filter(y => y < thisYear).sort((a, b) => b - a);
      for (const y of years) {
        // Feb 29 falls back to Feb 28 in non-leap years.
        let center = `${y}-${md}`;
        if (App.toDateStr(App.parseDate(center)) !== center) center = `${y}-02-28`;
        for (let i = -NEARBY_DAYS; i <= NEARBY_DAYS; i++) {
          const d = App.addDays(center, i);
          if (App.store.hasDate(d)) nearby.push(d);
        }
      }
    }

    const group = (d, extra) => `
      <section class="otd-group">
        <h2 class="otd-year"><span>${yearsAgoLabel(date, d)}</span><a href="#/day/${d}">${App.escapeHtml(extra ? App.fmtDayMed(d) : d.slice(0, 4))}</a></h2>
        <div class="entries">${App.store.forDate(d).map(e => App.entryCard(e)).join("")}</div>
      </section>`;

    root.innerHTML = `
      <header class="page-head cal-head">
        <button type="button" class="icon-btn" data-d="-1" aria-label="Previous day">${App.icon("back")}</button>
        <div class="otd-title">
          <div class="kicker">On this day</div>
          <h1>${App.escapeHtml(App.fmtMonthDay(date))}</h1>
        </div>
        <button type="button" class="icon-btn" data-d="1" aria-label="Next day">${App.icon("next")}</button>
      </header>
      ${date !== App.todayStr() ? `<div class="center"><button type="button" class="chip" data-a="today">Back to today</button></div>` : ""}
      ${exact.length ? exact.map(d => group(d)).join("") : nearby.length ? `
        <p class="muted center small">Nothing on exactly this date in past years. Here's what you did around this time.</p>
        ${nearby.map(d => group(d, true)).join("")}` : `
        <div class="empty">
          <p class="empty-title">No memories here yet</p>
          <p>Keep journaling. Next year, this page will show what you did today.</p>
        </div>`}
    `;
    App.bindEntries(root);
    root.querySelectorAll("[data-d]").forEach(b => { b.onclick = () => { date = App.addDays(date, Number(b.dataset.d)); render(root); }; });
    const t = root.querySelector('[data-a="today"]');
    if (t) t.onclick = () => { date = App.todayStr(); render(root); };
  }

  App.views.onthisday = {
    mount(root) {
      if (!date) date = App.todayStr();
      this.root = root;
      render(root);
    },
    refresh() { if (this.root) render(this.root); },
    unmount() { this.root = null; }
  };
})(window.App);
