/*
 * Query: turn a plain-English search like "what did I do on oct 14" or
 * "highlights from last month with Sam" into filters:
 *   { terms, from, to, monthDay, month, starred, when }
 *  - from/to: an exact date range ("2025-10-14", "last week", "in 2025")
 *  - monthDay "10-14" / month "10": a date with no year, matched in every year
 *  - terms: the words left after dates and filler words are taken out
 *  - when: a readable description of the date part, e.g. "October 14 · every year"
 */
(function (App) {
  "use strict";

  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
  const DAY_RE = "(\\d{1,2})(?:st|nd|rd|th)?";
  const YEAR_RE = "((?:19|20)\\d{2})";

  const STOP = new Set(("what whats did do does doing done i im ive me my mine on in at the a an of for during back when " +
    "was were is are be been there then go went going see saw seen have had has any some thing things stuff that this " +
    "those these day days time times how many much where who whom with tell show find get got up to from about ever last " +
    "happened happen happening list all everything around ago and or by it its you your can could would please remind " +
    "again us we our anything something which moments moment memories memory may").split(" "));
  const STARRED = /\b(highlights?|best|favou?rites?|starred|memorable|top)\b/g;

  const pad = n => String(n).padStart(2, "0");
  const monthNum = name => MONTHS.indexOf(name.slice(0, 3)) + 1;
  const monthName = m => App.parseDate(`2000-${pad(m)}-01`).toLocaleDateString(undefined, { month: "long" });
  const lastDay = (y, m) => new Date(y, m, 0).getDate();
  const validDay = (m, d) => m >= 1 && m <= 12 && d >= 1 && d <= lastDay(2000, m); // 2000 is a leap year

  function parse(q, today) {
    today = today || App.todayStr();
    let s = " " + String(q || "").toLowerCase().replace(/[’']/g, "").replace(/[?!"“”]/g, " ") + " ";
    const out = { terms: [], from: "", to: "", monthDay: "", month: "", starred: false, when: "" };
    const take = (re, fn) => {
      if (out.when) return;
      const m = re.exec(s);
      if (m && fn(m) !== false) s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
    };
    const exact = (y, m, d) => { out.from = out.to = `${y}-${pad(m)}-${pad(d)}`; out.when = App.fmtDayLong(out.from); };
    const range = (from, to, when) => { out.from = from; out.to = to; out.when = when; };
    const ty = Number(today.slice(0, 4));

    // 2025-10-14
    take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, m => (validDay(+m[2], +m[3]) ? exact(+m[1], +m[2], +m[3]) : false));
    // 10/14, 10/14/25, 10/14/2025
    take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/, m => {
      const mo = +m[1], d = +m[2];
      if (!validDay(mo, d)) return false;
      if (m[3]) return exact(m[3].length === 2 ? 2000 + +m[3] : +m[3], mo, d);
      out.monthDay = `${pad(mo)}-${pad(d)}`; out.when = `${monthName(mo)} ${d} · every year`;
    });
    // october 14th, 2025 · oct 14 · 14 oct 2025 · 14th of october
    const monthDayYear = (mo, d, y) => {
      if (!validDay(mo, d)) return false;
      if (y) return exact(+y, mo, d);
      out.monthDay = `${pad(mo)}-${pad(d)}`; out.when = `${monthName(mo)} ${d} · every year`;
    };
    take(new RegExp(`\\b${MONTH_RE}\\s+${DAY_RE}\\b(?:,?\\s+${YEAR_RE}\\b)?`), m => monthDayYear(monthNum(m[1]), +m[2], m[3]));
    take(new RegExp(`\\b${DAY_RE}\\s+(?:of\\s+)?${MONTH_RE}\\b(?:,?\\s+${YEAR_RE}\\b)?`), m => monthDayYear(monthNum(m[2]), +m[1], m[3]));
    // march 2024
    take(new RegExp(`\\b${MONTH_RE}\\s+(?:of\\s+)?${YEAR_RE}\\b`), m => {
      const mo = monthNum(m[1]), y = +m[2];
      range(`${y}-${pad(mo)}-01`, `${y}-${pad(mo)}-${pad(lastDay(y, mo))}`, `${monthName(mo)} ${y}`);
    });
    // relative days, weeks, months, years
    take(/\b(today|tonight|this morning|this afternoon)\b/, () => exact(ty, +today.slice(5, 7), +today.slice(8)));
    take(/\byesterday\b/, () => { const d = App.addDays(today, -1); out.from = out.to = d; out.when = App.fmtDayLong(d); });
    take(/\b(this|last|past|previous)\s+(week|month|year)\b/, m => {
      const back = m[1] !== "this";
      const t = App.parseDate(today);
      if (m[2] === "week") {
        const start = App.addDays(today, -t.getDay() - (back ? 7 : 0));
        range(start, App.addDays(start, 6), back ? "Last week" : "This week");
      } else if (m[2] === "month") {
        const key = App.addMonths(today.slice(0, 7), back ? -1 : 0);
        const y = +key.slice(0, 4), mo = +key.slice(5);
        range(`${key}-01`, `${key}-${pad(lastDay(y, mo))}`, App.fmtMonth(key));
      } else {
        const y = ty - (back ? 1 : 0);
        range(`${y}-01-01`, `${y}-12-31`, String(y));
      }
    });
    // a month on its own: "in march" (every year). "may" only with in/on/during/of.
    take(new RegExp(`(?:\\b(in|on|during|of|from)\\s+)?\\b${MONTH_RE}(?=\\s|$)`), m => {
      if (m[2].startsWith("may") && !m[1]) return false;
      const mo = monthNum(m[2]);
      out.month = pad(mo); out.when = `${monthName(mo)} · every year`;
    });
    // a year on its own: "in 2025"
    take(new RegExp(`\\b${YEAR_RE}\\b`), m => range(`${m[1]}-01-01`, `${m[1]}-12-31`, m[1]));

    STARRED.lastIndex = 0;
    if (STARRED.test(s)) { out.starred = true; s = s.replace(STARRED, " "); }

    out.terms = s.split(/[\s,.;:()]+/).map(App.norm).filter(w => w && !STOP.has(w));
    return out;
  }

  App.parseQuery = parse;
})(window.App);
