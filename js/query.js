/*
 * Query: turn a plain-English search into filters.
 *
 *   App.parseQuery("when did I last hang out with Jimmy", today, { settings, vocab })
 *   → { test(date), hasDate, when, groups, dropped, corrected, starred, ask }
 *
 *  - test(date): true for days that fit the date words ("last Sunday",
 *    "weekends in October", "Christmas", "summer 2025", "3 weeks ago"…)
 *  - when: a readable description of those dates
 *  - groups: what an entry must mention, one group per thing asked about.
 *    A group lists alternative words: a person's nicknames (Settings →
 *    People), your word groups, a built-in group (gym = workout = lifted…),
 *    or a single typed word (matched as a word start, so "work" finds "workout").
 *  - corrected: typos fixed against words in the journal ("oreleans" → "orleans")
 *  - dropped: words that appear nowhere in the journal, left out of the search
 *  - ask: the kind of answer wanted: last, first, count, since, who, where,
 *    read ("what did I think of…"), or "" for a plain search
 */
(function (App) {
  "use strict";

  // ---------- word lists ----------
  const BUILTIN_GROUPS = [
    { name: "gym", words: ["gym", "workout", "worked out", "work out", "working out", "lifted", "lifting", "leg day", "arm day", "chest day", "back day", "crossfit", "exercise", "exercised", "weights", "weightlifting"] },
    { name: "running", words: ["run", "ran", "running", "jog", "jogged", "jogging", "5k", "10k", "half marathon", "marathon"] },
    { name: "football", words: ["football", "nfl", "bucs", "buccaneers", "gators", "tailgate", "tailgating", "touchdown", "fantasy football", "super bowl", "superbowl", "dolphins", "jaguars", "seminoles"] },
    { name: "doctor", words: ["doctor", "dr", "physician", "checkup", "check up", "physical", "urgent care", "clinic", "pcp", "emergency room", "hospital"] },
    { name: "dentist", words: ["dentist", "dental", "teeth cleaning", "orthodontist"] },
    { name: "haircut", words: ["haircut", "hair cut", "barber", "salon"] },
    { name: "dinner out", words: ["dinner", "restaurant", "ate out", "eat out", "eating out", "dined"] },
    { name: "movie", words: ["movie", "film", "cinema", "theater", "theatre"] },
    { name: "beach", words: ["beach", "ocean", "shore", "sandbar"] },
    { name: "church", words: ["church", "mass", "sermon", "bible study"] },
    { name: "mental health & feelings", words: ["mental health", "anxious", "anxiety", "worried", "worry", "worrying", "worries", "stress", "stressed", "stressful", "overwhelmed", "depressed", "depression", "sad", "nervous", "panic", "therapy", "therapist", "counselor", "mood", "upset", "burnt out", "burned out", "burnout", "lonely", "frustrated", "angry", "cried", "crying", "overthinking"] },
    { name: "New Orleans", words: ["new orleans", "nola"] },
    { name: "West Palm", words: ["west palm", "west palm beach", "wpb"] },
    { name: "St. Pete", words: ["st pete", "st petersburg", "saint petersburg", "saint pete"] },
    { name: "Gainesville", words: ["gainesville", "gville"] },
    { name: "Jacksonville", words: ["jacksonville", "jax"] },
    { name: "New York", words: ["new york", "nyc", "manhattan"] },
    { name: "Fort Lauderdale", words: ["fort lauderdale", "ft lauderdale"] }
  ];

  const STOP = new Set(("what whats did do does doing done i im ive me my mine on in at the a an of for during back when " +
    "was were is are be been there then go went going see saw seen have had has any some thing things stuff that this " +
    "those these day days time times how many much where who whom with tell show find get got up to from about ever last " +
    "happened happen happening list all everything around ago and or by it its you your can could would please remind " +
    "again us we our anything something which moments moment memories memory may hung hang hanging hangout out spend " +
    "spent visit visited visiting most recent recently latest first earliest often number count since long think thought " +
    "thoughts feel felt opinion really very so just also too kind sort lot lots like trip").split(" "));
  const STARRED = /\b(highlights?|best|favou?rites?|starred|memorable|top)\b/g;

  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
  const DAY_RE = "(\\d{1,2})(?:st|nd|rd|th)?";
  const YEAR_RE = "((?:19|20)\\d{2})";
  const NUMS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, "a couple of": 2, "a couple": 2, "a few": 3 };
  const NUM_RE = "(\\d+|a couple of|a couple|a few|an|a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const SEASONS = { spring: [3, 4, 5], summer: [6, 7, 8], fall: [9, 10, 11], autumn: [9, 10, 11], winter: [12, 1, 2] };

  // ---------- small helpers ----------
  const pad = n => String(n).padStart(2, "0");
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const monthNum = name => MONTHS.indexOf(name.slice(0, 3)) + 1;
  const monthName = m => App.parseDate(`2000-${pad(m)}-01`).toLocaleDateString(undefined, { month: "long" });
  const lastDay = (y, m) => new Date(y, m, 0).getDate();
  const validDay = (m, d) => m >= 1 && m <= 12 && d >= 1 && d <= lastDay(2000, m);
  const num = s => (/^\d+$/.test(s) ? Number(s) : NUMS[s] || 1);
  const weekday = d => App.parseDate(d).getDay();
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const shortDay = d => App.parseDate(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  // Text as space-separated plain words, for word matching: " st pete fl ".
  const clean = s => App.norm(s).replace(/[^a-z0-9]+/g, " ").trim();
  App.searchText = s => ` ${clean(s)} `;

  // A word or phrase from a list matches itself plus common endings
  // ("workout" → "workouts", "stress" → "stressed"); a typed word matches as
  // a word start ("work" → "workout").
  const ENDINGS = "(?:s|es|ed|d|ing|er|ers|y)?";
  function groupRegexes(group) {
    if (!group.res) {
      group.res = group.alts.map(a => (group.kind === "word"
        ? new RegExp(` ${escRe(a)}`)
        : new RegExp(` ${escRe(clean(a))}${ENDINGS}(?= )`)));
    }
    return group.res;
  }
  App.groupMatches = (hay, group) => groupRegexes(group).some(re => re.test(hay));

  // Typo distance (optimal string alignment).
  function distance(a, b) {
    const d = [];
    for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  // ---------- holidays ----------
  function nthWeekday(y, m, wd, n) { // n = 1..5, or -1 for the last one
    if (n > 0) {
      const first = new Date(y, m - 1, 1).getDay();
      return ymd(y, m, 1 + ((wd - first + 7) % 7) + (n - 1) * 7);
    }
    const ld = lastDay(y, m);
    const lastWd = new Date(y, m - 1, ld).getDay();
    return ymd(y, m, ld - ((lastWd - wd + 7) % 7));
  }
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return ymd(y, month, day);
  }
  const HOLIDAYS = [
    { re: "christmas eve", name: "Christmas Eve", on: y => ymd(y, 12, 24) },
    { re: "christmas(?: day)?|xmas", name: "Christmas", on: y => ymd(y, 12, 25) },
    { re: "new years eve|nye", name: "New Year's Eve", on: y => ymd(y, 12, 31) },
    { re: "new years(?: day)?", name: "New Year's Day", on: y => ymd(y, 1, 1) },
    { re: "(?:the )?(?:fourth|4th) of july|independence day", name: "the Fourth of July", on: y => ymd(y, 7, 4) },
    { re: "thanksgiving", name: "Thanksgiving", on: y => nthWeekday(y, 11, 4, 4) },
    { re: "memorial day", name: "Memorial Day", on: y => nthWeekday(y, 5, 1, -1) },
    { re: "labor day", name: "Labor Day", on: y => nthWeekday(y, 9, 1, 1) },
    { re: "easter", name: "Easter", on: easter },
    { re: "halloween", name: "Halloween", on: y => ymd(y, 10, 31) },
    { re: "valentines(?: day)?", name: "Valentine's Day", on: y => ymd(y, 2, 14) },
    { re: "(?:st |saint )?patricks day", name: "St. Patrick's Day", on: y => ymd(y, 3, 17) },
    { re: "mothers day", name: "Mother's Day", on: y => nthWeekday(y, 5, 0, 2) },
    { re: "fathers day", name: "Father's Day", on: y => nthWeekday(y, 6, 0, 3) }
  ];

  // ---------- the parser ----------
  function parse(q, today, ctx) {
    today = today || App.todayStr();
    ctx = ctx || {};
    const settings = ctx.settings || {};
    const ty = Number(today.slice(0, 4));
    const tests = [];
    const when = [];
    const out = { groups: [], dropped: [], corrected: [], starred: false, ask: "" };

    let s = " " + String(q || "").toLowerCase().replace(/[’']/g, "").replace(/[?!"“”,;:()]/g, " ").replace(/\s+/g, " ") + " ";

    // Each rule takes its first match out of the text so later rules don't
    // see it again ("last week" is a date, not the word "last").
    const take = (re, fn) => {
      const m = re.exec(s);
      if (m && fn(m) !== false) s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
    };
    const onDay = (d, label) => { tests.push(x => x === d); when.push(label || App.fmtDayLong(d)); };
    const between = (from, to, label) => { tests.push(x => x >= from && x <= to); when.push(label); };
    const monthOf = (d, n) => { const t = App.parseDate(d); t.setMonth(t.getMonth() + n); return App.toDateStr(t); };

    // 2025-10-14 · 10/14 · 10/14/25
    take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, m => (validDay(+m[2], +m[3]) ? onDay(ymd(+m[1], +m[2], +m[3])) : false));
    take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/, m => {
      const mo = +m[1], d = +m[2];
      if (!validDay(mo, d)) return false;
      if (m[3]) return onDay(ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], mo, d));
      tests.push(x => x.slice(5) === `${pad(mo)}-${pad(d)}`); when.push(`${monthName(mo)} ${d} · every year`);
    });

    // in the past 6 months · last 2 weeks
    take(new RegExp(`\\b(?:in |over )?(?:the )?(?:past|last) ${NUM_RE} (day|week|month|year)s?\\b`), m => {
      const n = num(m[1]);
      const from = m[2] === "day" ? App.addDays(today, -n) : m[2] === "week" ? App.addDays(today, -7 * n) : monthOf(today, -(m[2] === "year" ? 12 * n : n));
      between(from, today, `Past ${n} ${m[2]}${n === 1 ? "" : "s"}`);
    });
    // 3 days ago · two weeks ago · a year ago today
    take(new RegExp(`\\b${NUM_RE} (day|week|month|year)s? ago(?: today)?\\b`), m => {
      const n = num(m[1]);
      const exact = /today\s*$/.test(m[0]);
      if (m[2] === "day") return onDay(App.addDays(today, -n));
      if (m[2] === "week") {
        const d = App.addDays(today, -7 * n), start = App.addDays(d, -weekday(d));
        return between(start, App.addDays(start, 6), `Week of ${shortDay(start)}`);
      }
      const d = monthOf(today, -(m[2] === "year" ? 12 * n : n));
      if (exact) return onDay(d);
      const y = +d.slice(0, 4), mo = +d.slice(5, 7);
      between(ymd(y, mo, 1), ymd(y, mo, lastDay(y, mo)), App.fmtMonth(d.slice(0, 7)));
    });

    // october 14th, 2025 · oct 14 · 14 oct 2025 · 14th of october
    const monthDayYear = (mo, d, y) => {
      if (!validDay(mo, d)) return false;
      if (y) return onDay(ymd(+y, mo, d));
      tests.push(x => x.slice(5) === `${pad(mo)}-${pad(d)}`); when.push(`${monthName(mo)} ${d} · every year`);
    };
    take(new RegExp(`\\b${MONTH_RE} ${DAY_RE}\\b(?: ${YEAR_RE}\\b)?`), m => monthDayYear(monthNum(m[1]), +m[2], m[3]));
    take(new RegExp(`\\b${DAY_RE} (?:of )?${MONTH_RE}\\b(?: ${YEAR_RE}\\b)?`), m => monthDayYear(monthNum(m[2]), +m[1], m[3]));

    // holidays and your birthday: "christmas 2025", "last thanksgiving", "my birthday"
    const holidays = HOLIDAYS.slice();
    if (settings.birthday && /^\d{2}-\d{2}$/.test(settings.birthday)) {
      holidays.push({ re: "(?:my )?birthday|bday", name: "your birthday", on: y => `${y}-${settings.birthday}` });
    }
    for (const h of holidays) {
      take(new RegExp(`\\b(?:(this|last|next) )?(?:on |for |over )?(?:${h.re})\\b(?: (?:of )?${YEAR_RE}\\b)?`), m => {
        if (m[2]) return onDay(h.on(+m[2]), `${h.name} ${m[2]}`);
        if (m[1] === "last") {
          const d = h.on(ty) <= today ? h.on(ty) : h.on(ty - 1);
          return onDay(d, `${h.name} ${d.slice(0, 4)}`);
        }
        if (m[1] === "this") return onDay(h.on(ty), `${h.name} ${ty}`);
        tests.push(x => x === h.on(+x.slice(0, 4)));
        when.push(`${h.name} · every year`);
      });
    }

    // march 2024
    take(new RegExp(`\\b${MONTH_RE} (?:of )?${YEAR_RE}\\b`), m => {
      const mo = monthNum(m[1]), y = +m[2];
      between(ymd(y, mo, 1), ymd(y, mo, lastDay(y, mo)), `${monthName(mo)} ${y}`);
    });

    // seasons, Florida-style: summer = Jun–Aug, winter = Dec–Feb
    take(new RegExp(`\\b(?:(this|last|next|in|during|over|the) )?(spring|summer|fall|autumn|winter)\\b(?: (?:of )?${YEAR_RE}\\b)?`), m => {
      const name = m[2] === "autumn" ? "fall" : m[2];
      if (name === "fall" && !m[1] && !m[3]) return false; // "I fall asleep"
      const months = SEASONS[name];
      const range = y => {
        if (name === "winter") return [ymd(y, 12, 1), ymd(y + 1, 2, lastDay(y + 1, 2))];
        return [ymd(y, months[0], 1), ymd(y, months[2], lastDay(y, months[2]))];
      };
      const label = y => `${name[0].toUpperCase() + name.slice(1)} ${y}`;
      let y = null;
      if (m[3]) y = +m[3];
      else if (m[1] === "this") y = name === "winter" && +today.slice(5, 7) <= 2 ? ty - 1 : ty;
      else if (m[1] === "last") {
        y = name === "winter" && +today.slice(5, 7) <= 2 ? ty - 1 : ty;
        if (range(y)[1] >= today) y -= 1;
      }
      if (y != null) { const [a, b] = range(y); return between(a, b, label(y)); }
      tests.push(x => months.includes(+x.slice(5, 7)));
      when.push(`${name[0].toUpperCase() + name.slice(1)} · every year`);
    });

    // last sunday · on tuesday · sundays
    take(/\b(?:(last|this|past|on|every) )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(s)?\b/, m => {
      const wd = WEEKDAYS.indexOf(m[2]);
      const label = m[2][0].toUpperCase() + m[2].slice(1);
      if (m[3] || m[1] === "every") { tests.push(x => weekday(x) === wd); when.push(`${label}s`); return; }
      const back = (weekday(today) - wd + 7) % 7;
      onDay(App.addDays(today, m[1] === "last" ? -(back || 7) : -back));
    });

    // last weekend · this weekend · weekends
    take(/\b(?:(last|this|past|on) )?weekend(s)?\b/, m => {
      if (m[2] || m[1] === "on" || !m[1]) { tests.push(x => weekday(x) === 0 || weekday(x) === 6); when.push("Weekends"); return; }
      const wd = weekday(today);
      let sat;
      if (m[1] === "this") sat = wd === 0 ? App.addDays(today, -1) : App.addDays(today, 6 - wd);
      else sat = wd === 0 ? App.addDays(today, -8) : wd === 6 ? App.addDays(today, -7) : App.addDays(today, -wd - 1);
      between(sat, App.addDays(sat, 1), m[1] === "this" ? "This weekend" : `Weekend of ${shortDay(sat)}`);
    });

    take(/\b(today|tonight|this morning|this afternoon|this evening)\b/, () => onDay(today));
    take(/\byesterday\b/, () => onDay(App.addDays(today, -1)));

    // this week · last month · past year
    take(/\b(this|last|past|previous) (week|month|year)\b/, m => {
      const back = m[1] !== "this";
      if (m[2] === "week") {
        const start = App.addDays(today, -weekday(today) - (back ? 7 : 0));
        return between(start, App.addDays(start, 6), back ? "Last week" : "This week");
      }
      if (m[2] === "month") {
        const key = App.addMonths(today.slice(0, 7), back ? -1 : 0);
        const y = +key.slice(0, 4), mo = +key.slice(5);
        return between(`${key}-01`, ymd(y, mo, lastDay(y, mo)), App.fmtMonth(key));
      }
      const y = ty - (back ? 1 : 0);
      between(`${y}-01-01`, `${y}-12-31`, String(y));
    });

    // a month on its own: "in march" (every year). "may" only with in/on/during/of.
    take(new RegExp(`(?:\\b(in|on|during|of|from) )?\\b${MONTH_RE}(?= )`), m => {
      if (m[2].startsWith("may") && !m[1]) return false;
      const mo = monthNum(m[2]);
      tests.push(x => +x.slice(5, 7) === mo); when.push(`${monthName(mo)} · every year`);
    });
    // a year on its own: "in 2025"
    take(new RegExp(`\\b${YEAR_RE}\\b`), m => between(`${m[1]}-01-01`, `${m[1]}-12-31`, m[1]));

    // ---------- what kind of answer ----------
    if (/\bhow (many|often)\b|\bnumber of\b|\bcount\b/.test(s)) out.ask = "count";
    else if (/\bhow long(?: has it been)?(?: since| ago)?\b/.test(s)) out.ask = "since";
    else if (/\bwho\b/.test(s)) out.ask = "who";
    else if (/\bwhere\b/.test(s)) out.ask = "where";
    else if (/\bfirst\b|\bearliest\b/.test(s)) out.ask = "first";
    else if (/\blast\b|\bmost recent(ly)?\b|\blatest\b|\brecently\b/.test(s) || /^\s*when\b/.test(s)) out.ask = "last";
    else if (/\bwhat did i think\b|\bhow did i feel\b|\bhow (was|were|did)\b|\bthoughts? on\b|\bfe(?:el|lt) about\b|\bopinion\b/.test(s)) out.ask = "read";

    STARRED.lastIndex = 0;
    if (STARRED.test(s)) { out.starred = true; s = s.replace(STARRED, " "); }

    // ---------- what it's about ----------
    s = ` ${clean(s)} `;
    const known = [];
    (settings.people || []).forEach(p => known.push({ name: p.name, kind: "person", words: [p.name, ...(p.aliases || [])] }));
    (settings.groups || []).forEach(g => known.push({ name: g.name, kind: "group", words: [g.name, ...(g.words || [])] }));
    BUILTIN_GROUPS.forEach(g => known.push({ name: g.name, kind: "group", words: g.words }));
    const phrases = [];
    known.forEach(k => k.words.map(clean).filter(Boolean).forEach(w => phrases.push({ w, k })));
    phrases.sort((a, b) => b.w.length - a.w.length);

    // 1. Fix typos first, against journal words and group words, so
    //    "new oreleans" becomes "new orleans" and then matches its group.
    const vocab = ctx.vocab && ctx.vocab.length ? ctx.vocab : null;
    const phraseWords = new Set(phrases.flatMap(p => p.w.split(" ")));
    const known1 = w => phraseWords.has(w) || (vocab ? vocab.some(v => v.startsWith(w)) : true);
    const candidates = [...new Set([...(vocab || []), ...phraseWords])].filter(v => !STOP.has(v));
    s = " " + s.trim().split(" ").map(w => {
      if (!w || STOP.has(w) || w.length < 4 || /\d/.test(w) || known1(w)) return w;
      const max = w.length >= 7 ? 2 : 1;
      let best = null, bestD = max + 1;
      for (const v of candidates) {
        if (v[0] !== w[0] || Math.abs(v.length - w.length) > max) continue; // typos keep the first letter
        const d = distance(w, v);
        if (d < bestD) { best = v; bestD = d; }
      }
      if (!best) return w;
      out.corrected.push({ from: w, to: best });
      return best;
    }).join(" ") + " ";

    // 2. People (Settings → People), your word groups, then built-in groups.
    //    Longest phrases first so "west palm beach" wins over "west palm".
    const used = new Map();
    for (const { w, k } of phrases) {
      const re = new RegExp(` ${escRe(w)}${ENDINGS}(?= )`, "g");
      if (!re.test(s)) continue;
      s = s.replace(re, " ");
      if (!used.has(k)) used.set(k, { label: k.name, kind: k.kind, alts: k.words });
    }
    out.groups.push(...used.values());

    // 3. Remaining typed words: kept if the journal uses them (as a word
    //    start, so "work" finds "workout"); left out if it never does.
    for (const w of s.split(" ").filter(x => x && !STOP.has(x))) {
      if (!vocab || vocab.some(v => v.startsWith(w))) out.groups.push({ label: w, kind: "word", alts: [w] });
      else out.dropped.push(w);
    }

    out.hasDate = tests.length > 0;
    out.when = when.join(" · ");
    out.test = d => tests.every(t => t(d));
    return out;
  }

  App.parseQuery = parse;
  App.builtinGroups = BUILTIN_GROUPS;
})(window.App);
