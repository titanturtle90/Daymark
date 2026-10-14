/*
 * Import photos by date: pick a batch of photos and each one is placed on
 * the day it was taken (from the photo's own "date taken" information),
 * giving past days on the calendar something to jog your memory.
 */
(function (App) {
  "use strict";

  const MAX_PREVIEW = 8;

  App.openImport = () => {
    let groups = null;   // Map(date|"" → [{ file, takenAt, key, url }])
    let cancelled = false;
    let running = false;
    const previews = [];

    const sheet = App.sheet({
      title: "Import photos",
      full: true,
      html: `<div class="import"></div>`,
      beforeClose: async () => {
        if (!running) return true;
        const ok = await App.confirm({ title: "Stop importing?", message: "Photos already added will stay.", confirmText: "Stop", cancelText: "Keep going" });
        if (ok) cancelled = true;
        return ok;
      },
      onClose: () => previews.forEach(u => URL.revokeObjectURL(u))
    });
    const box = sheet.body.querySelector(".import");

    function intro() {
      box.innerHTML = `
        <p>Pick photos from your library and Daymark puts each one on the day it was taken. It's a quick way to fill in past days you'd like to remember.</p>
        <p class="muted small">Tip: in the photo picker you can tap and drag to select many at once, or open an album first.</p>
        <input type="file" accept="image/*" multiple hidden>
        <button type="button" class="btn primary block" data-a="pick">${App.icon("image")} Choose photos</button>`;
      const input = box.querySelector("input");
      box.querySelector('[data-a="pick"]').onclick = () => input.click();
      input.onchange = () => { if (input.files.length) scan([...input.files]); };
    }

    async function scan(files) {
      box.innerHTML = `<div class="progress-block"><div class="spinner"></div><p>Reading photo dates…</p></div>`;
      const known = new Set(App.store.all().flatMap(e => (e.photos || []).map(p => p.sourceKey).filter(Boolean)));
      groups = new Map();
      let dupes = 0;
      for (const file of files) {
        const takenAt = await App.photos.readTakenAt(file);
        const key = `${file.name}|${file.size}|${takenAt ? takenAt.date + takenAt.time : ""}`;
        if (known.has(key)) { dupes++; continue; }
        known.add(key);
        const date = takenAt ? takenAt.date : "";
        if (!groups.has(date)) groups.set(date, []);
        groups.get(date).push({ file, takenAt, key });
      }
      review(dupes);
    }

    function review(dupes) {
      const dated = [...groups.keys()].filter(Boolean).sort().reverse();
      const undated = groups.get("") || [];
      const thumbs = list => list.slice(0, MAX_PREVIEW).map(p => {
        if (!p.url) { p.url = URL.createObjectURL(p.file); previews.push(p.url); }
        return `<img src="${p.url}" alt="" loading="lazy">`;
      }).join("") + (list.length > MAX_PREVIEW ? `<span class="more">+${list.length - MAX_PREVIEW}</span>` : "");

      const total = [...groups.values()].reduce((s, l) => s + l.length, 0);
      box.innerHTML = `
        ${dupes ? `<p class="muted small">${App.plural(dupes, "photo")} already imported before will be skipped.</p>` : ""}
        ${!total ? `<div class="empty"><p class="empty-title">Nothing new to import</p></div><button type="button" class="btn ghost block" data-a="again">Choose other photos</button>` : ""}
        ${undated.length ? `
          <div class="imp-group undated">
            <div class="imp-head"><strong>No date found</strong><span>${App.plural(undated.length, "photo")}</span></div>
            <p class="muted small">These photos don't say when they were taken. Pick a day for them, or leave blank to skip.</p>
            <label class="field"><span>Put them on</span><input type="date" name="undated" max="${App.todayStr()}"></label>
            <div class="imp-thumbs">${thumbs(undated)}</div>
          </div>` : ""}
        ${dated.map(d => `
          <div class="imp-group">
            <div class="imp-head"><strong>${App.escapeHtml(App.fmtDayMed(d))}</strong><span>${App.plural(groups.get(d).length, "photo")}</span></div>
            <div class="imp-thumbs">${thumbs(groups.get(d))}</div>
          </div>`).join("")}
        ${total ? `<div class="ed-footer"><button type="button" class="btn primary" data-a="go"></button></div>` : ""}`;

      const again = box.querySelector('[data-a="again"]');
      if (again) again.onclick = intro;
      const go = box.querySelector('[data-a="go"]');
      if (!go) return;
      const undatedIn = box.querySelector('[name="undated"]');
      const label = () => {
        const days = dated.length + (undatedIn && undatedIn.value && !groups.has(undatedIn.value) ? 1 : 0);
        const count = dated.reduce((s, d) => s + groups.get(d).length, 0) + (undatedIn && undatedIn.value ? undated.length : 0);
        go.disabled = !count;
        go.innerHTML = `${App.icon("upload")} Add ${App.plural(count, "photo")} to ${App.plural(days, "day")}`;
      };
      if (undatedIn) undatedIn.onchange = label;
      label();
      go.onclick = () => {
        const plan = new Map();
        dated.forEach(d => plan.set(d, [...groups.get(d)]));
        if (undatedIn && undatedIn.value) plan.set(undatedIn.value, [...(plan.get(undatedIn.value) || []), ...undated]);
        run(plan);
      };
    }

    async function run(plan) {
      running = true;
      const total = [...plan.values()].reduce((s, l) => s + l.length, 0);
      let done = 0, failed = 0;
      box.innerHTML = `
        <div class="progress-block">
          <p class="progress-label">Adding photos…</p>
          <div class="progress"><div class="progress-bar"></div></div>
          <p class="muted small">Keep Daymark open until this finishes.</p>
        </div>`;
      const bar = box.querySelector(".progress-bar");
      const lbl = box.querySelector(".progress-label");
      const tick = () => { bar.style.width = `${(done / total) * 100}%`; lbl.textContent = `Adding photos… ${done} of ${total}`; };

      for (const [date, items] of plan) {
        if (cancelled) break;
        items.sort((a, b) => String(a.takenAt && a.takenAt.time).localeCompare(String(b.takenAt && b.takenAt.time)));
        const photos = [];
        // Two uploads at a time.
        let next = 0;
        const worker = async () => {
          while (next < items.length && !cancelled) {
            const item = items[next++];
            try { photos.push(await App.store.addPhoto(item.file, { sourceKey: item.key })); }
            catch (e) { failed++; }
            done++; tick();
          }
        };
        await Promise.all([worker(), worker()]);
        if (!photos.length) continue;
        const existing = App.store.forDate(date).find(e => e.source === "photo-import");
        const times = items.map(i => i.takenAt && i.takenAt.date === date ? i.takenAt.time : null).filter(Boolean).sort();
        if (existing) {
          await App.store.save({ ...existing, photos: [...existing.photos, ...photos] });
        } else {
          await App.store.save({ ...App.store.newEntry(date), time: times[0] || null, photos, source: "photo-import" });
        }
      }
      running = false;
      box.innerHTML = `
        <div class="empty">
          <p class="empty-title">${cancelled ? "Import stopped" : "All done"}</p>
          <p>Added ${App.plural(done - failed, "photo")} to your calendar.${failed ? ` ${App.plural(failed, "photo")} couldn't be added.` : ""}</p>
        </div>
        <button type="button" class="btn primary block" data-a="close">See the calendar</button>`;
      box.querySelector('[data-a="close"]').onclick = () => { sheet.close(true); App.go("#/calendar"); };
    }

    intro();
  };
})(window.App);
