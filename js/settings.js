/*
 * Settings: account, PIN lock, location, photo import, backup & restore.
 */
(function (App) {
  "use strict";

  // Capitalized names that show up mid-sentence in at least 3 entries, aren't
  // already People, aren't months/days/places Daymark knows, and are never
  // written in lowercase (so "Gym" at a line start doesn't count).
  const NOT_NAMES = new Set(("i im ive ill id the a an and but so then when this that my mom dad ok okay god lol " +
    "january february march april may june july august september october november december " +
    "monday tuesday wednesday thursday friday saturday sunday today tomorrow yesterday christmas easter thanksgiving").split(" "));
  function suggestNames(st) {
    const known = new Set([...(st.people || []).flatMap(p => [p.name, ...(p.aliases || [])]), ...(st.dismissedNames || [])]
      .flatMap(n => App.norm(n).split(/\s+/)));
    App.builtinGroups.forEach(g => g.words.forEach(w => w.split(" ").forEach(x => known.add(x))));
    const counts = new Map();
    const lower = new Set();
    for (const e of App.store.all()) {
      const text = e.text || "";
      (text.match(/\b[a-z][a-z']+\b/g) || []).forEach(w => lower.add(w));
      const seen = new Set();
      text.split(/[.!?\n]+/).forEach(sentence => {
        const words = sentence.trim().split(/\s+/).slice(1);
        words.forEach(w => {
          const m = /^([A-Z][a-z]{2,})(?:'s)?[,;:)]*$/.exec(w);
          if (m) seen.add(m[1]);
        });
      });
      seen.forEach(n => counts.set(n, (counts.get(n) || 0) + 1));
    }
    return [...counts.entries()]
      .filter(([n, c]) => c >= 3 && !NOT_NAMES.has(n.toLowerCase()) && !known.has(n.toLowerCase()) && !lower.has(n.toLowerCase()))
      .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));
  }

  function render(root) {
    const s = App.store;
    const all = s.all();
    const photos = all.reduce((n, e) => n + (e.photos || []).length, 0);
    const first = s.dates()[0];
    const cloud = s.mode === "cloud";
    const user = s.user;
    const delay = App.lock.delayMin();
    const st = s.settings || {};
    const people = st.people || [];
    const groups = st.groups || [];
    const [bm, bd] = (st.birthday || "-").split("-");
    const nameSuggestions = suggestNames(st);

    root.innerHTML = `
      <header class="page-head"><h1>Settings</h1></header>

      <section class="card settings">
        <h2 class="card-kicker">${App.icon("book")} Your journal</h2>
        <p class="stat-line"><strong>${App.plural(all.length, "entry", "entries")}</strong> on ${App.plural(s.dates().length, "day")}, ${App.plural(photos, "photo")}${first ? `, since ${App.escapeHtml(App.fmtDayMed(first))}` : ""}.</p>
      </section>

      <section class="card settings">
        <h2 class="card-kicker">${App.icon("user")} Account</h2>
        ${cloud ? `
          <p>Signed in as <strong>${App.escapeHtml(user.email || user.displayName || "you")}</strong>. Your journal syncs to your private cloud storage.</p>
          <button type="button" class="btn ghost" data-a="signout">Sign out</button>` : `
          <p>Saved <strong>on this device only</strong>. If this phone is lost or Safari's website data is cleared, the journal is gone. Download backups regularly.</p>
          ${App.cloudAvailable ? `<p class="muted small">To move to the cloud: download a backup below, sign in with Google, then restore the backup there.</p>
          <button type="button" class="btn ghost" data-a="signout">Switch to Google sign-in</button>` : ""}`}
      </section>

      <section class="card settings">
        <h2 class="card-kicker">${App.icon("lock")} PIN lock</h2>
        ${cloud ? (App.lock.hasPin() ? `
          <p>A PIN is needed to open Daymark on this device.</p>
          <label class="field inline"><span>Lock again after</span>
            <select name="delay">
              ${[[0, "Immediately"], [1, "1 minute away"], [5, "5 minutes away"], [15, "15 minutes away"]].map(([v, l]) => `<option value="${v}" ${v === delay ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </label>
          <div class="btn-row">
            <button type="button" class="btn ghost" data-a="lock">Lock now</button>
            <button type="button" class="btn ghost" data-a="changepin">Change PIN</button>
            <button type="button" class="btn ghost danger-text" data-a="removepin">Turn off</button>
          </div>` : `
          <p>Ask for a 4-digit PIN whenever Daymark is opened.</p>
          <button type="button" class="btn ghost" data-a="changepin">Set a PIN</button>`) : `
          <p class="muted">Available after signing in with Google, so a forgotten PIN can always be reset.</p>`}
      </section>

      <section class="card settings">
        <h2 class="card-kicker">${App.icon("pin")} Location</h2>
        <label class="switch-row">
          <span>Add my location to new entries for today</span>
          <input type="checkbox" name="autoloc" ${App.autoLocation() ? "checked" : ""}>
        </label>
        <p class="muted small">Place names come from OpenStreetMap. You can edit or remove the location on any entry.</p>
      </section>

      <section class="card settings">
        <h2 class="card-kicker">${App.icon("search")} Smart search</h2>
        <p>Teach search the names and words you use, so questions like <em>when did I last see Jimmy?</em> find everything.</p>

        <h3 class="set-sub">People</h3>
        <p class="muted small">Add someone once with every way you refer to them, e.g. <em>Sarah</em> also known as <em>my sister, sis</em>.</p>
        ${nameSuggestions.length ? `<div class="name-suggest"><span class="muted small">Names in your journal:</span>${nameSuggestions.map(n => `
          <span class="name-chip"><button type="button" data-add-name="${App.escapeHtml(n.name)}">+ ${App.escapeHtml(n.name)} <small>${n.count}</small></button><button type="button" data-dismiss-name="${App.escapeHtml(n.name)}" aria-label="Not a person">${App.icon("x")}</button></span>`).join("")}</div>` : ""}
        <div class="set-list" data-list="people">${people.map((p, i) => `
          <button type="button" class="set-row" data-edit-person="${i}"><strong>${App.escapeHtml(p.name)}</strong><span>${App.escapeHtml((p.aliases || []).join(", "))}</span>${App.icon("edit")}</button>`).join("") || `<p class="muted small empty-row">No people yet.</p>`}
        </div>
        <button type="button" class="btn ghost sm" data-a="add-person">${App.icon("plus")} Add person</button>

        <h3 class="set-sub">Your word groups</h3>
        <p class="muted small">Words that mean the same thing to you, e.g. <em>pickleball</em> also means <em>pb, pickle</em>.</p>
        <div class="set-list">${groups.map((g, i) => `
          <button type="button" class="set-row" data-edit-group="${i}"><strong>${App.escapeHtml(g.name)}</strong><span>${App.escapeHtml((g.words || []).join(", "))}</span>${App.icon("edit")}</button>`).join("") || `<p class="muted small empty-row">No word groups yet.</p>`}
        </div>
        <button type="button" class="btn ghost sm" data-a="add-group">${App.icon("plus")} Add word group</button>
        <details class="builtin">
          <summary>Built-in groups</summary>
          ${App.builtinGroups.map(g => `<p><strong>${App.escapeHtml(g.name)}:</strong> ${App.escapeHtml(g.words.join(", "))}</p>`).join("")}
        </details>

        <h3 class="set-sub">Your birthday</h3>
        <p class="muted small">So you can search <em>what did I do on my birthday</em>.</p>
        <div class="bday-row">
          <select name="bmonth" aria-label="Birthday month"><option value="">Month</option>${Array.from({ length: 12 }, (_, i) => `<option value="${String(i + 1).padStart(2, "0")}" ${bm === String(i + 1).padStart(2, "0") ? "selected" : ""}>${App.parseDate(`2000-${String(i + 1).padStart(2, "0")}-01`).toLocaleDateString(undefined, { month: "long" })}</option>`).join("")}</select>
          <select name="bday" aria-label="Birthday day"><option value="">Day</option>${Array.from({ length: 31 }, (_, i) => `<option value="${String(i + 1).padStart(2, "0")}" ${bd === String(i + 1).padStart(2, "0") ? "selected" : ""}>${i + 1}</option>`).join("")}</select>
        </div>
      </section>

      <section class="card settings">
        <h2 class="card-kicker">${App.icon("image")} Import photos</h2>
        <p>Fill in past days by adding photos from your library. Each photo lands on the day it was taken.</p>
        <button type="button" class="btn ghost" data-a="import">${App.icon("image")} Import photos by date</button>
      </section>

      <section class="card settings">
        <h2 class="card-kicker">${App.icon("download")} Backup</h2>
        <p>Download everything as one file you can keep in iCloud Drive or Files.</p>
        <div class="btn-row">
          <button type="button" class="btn ghost" data-a="backup-full">${App.icon("download")} With photos</button>
          <button type="button" class="btn ghost" data-a="backup-text">${App.icon("download")} Text only</button>
        </div>
        <p class="muted small">Restoring adds entries from a backup file. Entries you already have are skipped.</p>
        <input type="file" accept=".zip,application/zip" hidden name="restore">
        <button type="button" class="btn ghost" data-a="restore">${App.icon("upload")} Restore from backup</button>
        <div class="backup-status muted small"></div>
      </section>

      ${!cloud && all.length ? `
      <section class="card settings">
        <h2 class="card-kicker">${App.icon("trash")} Erase</h2>
        <button type="button" class="btn ghost danger-text" data-a="erase">Erase everything on this device</button>
      </section>` : ""}

      <p class="muted small center">Daymark · version 1</p>
    `;

    const on = (a, fn) => { const b = root.querySelector(`[data-a="${a}"]`); if (b) b.onclick = fn; };
    on("signout", async () => {
      if (!cloud && all.length && !(await App.confirm({ title: "Leave this-phone-only mode?", message: "Your entries stay saved on this device and come back if you choose this mode again.", confirmText: "Continue" }))) return;
      App.emit("signout");
    });
    on("lock", () => App.lock.lockNow());
    on("changepin", async () => { await App.lock.setupPin(); render(root); });
    on("removepin", async () => {
      if (await App.confirm({ title: "Turn off PIN lock?", confirmText: "Turn off", danger: true })) { App.lock.removePin(); render(root); }
    });
    const delaySel = root.querySelector('[name="delay"]');
    if (delaySel) delaySel.onchange = () => App.lock.setDelay(Number(delaySel.value));
    root.querySelector('[name="autoloc"]').onchange = ev => App.lsSet("daymark.autoLocation", ev.target.checked);
    on("import", () => App.openImport());

    // ---- smart search settings ----
    const saveSettings = patch => App.store.saveSettings({ ...(App.store.settings || {}), ...patch });
    root.querySelectorAll("[data-edit-person]").forEach(b => { b.onclick = () => editItem("person", Number(b.dataset.editPerson)); });
    root.querySelectorAll("[data-edit-group]").forEach(b => { b.onclick = () => editItem("group", Number(b.dataset.editGroup)); });
    on("add-person", () => editItem("person", -1));
    root.querySelectorAll("[data-add-name]").forEach(b => { b.onclick = () => editItem("person", -1, b.dataset.addName); });
    root.querySelectorAll("[data-dismiss-name]").forEach(b => {
      b.onclick = () => saveSettings({ dismissedNames: [...((App.store.settings || {}).dismissedNames || []), b.dataset.dismissName] });
    });
    on("add-group", () => editItem("group", -1));
    const bmonth = root.querySelector('[name="bmonth"]'), bday = root.querySelector('[name="bday"]');
    const saveBday = () => {
      if (bmonth.value && bday.value) { saveSettings({ birthday: `${bmonth.value}-${bday.value}` }); App.toast("Birthday saved"); }
      else if (!bmonth.value && !bday.value) saveSettings({ birthday: "" });
    };
    bmonth.onchange = saveBday; bday.onchange = saveBday;

    function editItem(kind, index, presetName) {
      const key = kind === "person" ? "people" : "groups";
      const listKey = kind === "person" ? "aliases" : "words";
      const list = [...((App.store.settings || {})[key] || [])];
      const item = index >= 0 ? list[index] : { name: presetName || "", [listKey]: [] };
      const sheet = App.sheet({
        title: index >= 0 ? `Edit ${kind}` : kind === "person" ? "Add person" : "Add word group",
        html: `
          <form class="item-form">
            <label class="field"><span>${kind === "person" ? "Name" : "Word"}</span><input name="name" value="${App.escapeHtml(item.name)}" placeholder="${kind === "person" ? "James Agan" : "pickleball"}" autocapitalize="words" required></label>
            <label class="field"><span>${kind === "person" ? "Also known as" : "Also means"}</span><textarea name="alts" rows="3" placeholder="${kind === "person" ? "James, Jimmy, my roommate" : "pb, pickle"}">${App.escapeHtml((item[listKey] || []).join(", "))}</textarea></label>
            <p class="muted small">Separate with commas.</p>
            <div class="btn-row">
              ${index >= 0 ? `<button type="button" class="btn ghost danger-text" data-a="del">${App.icon("trash")} Delete</button>` : ""}
              <button type="submit" class="btn primary">${App.icon("check")} Save</button>
            </div>
          </form>`
      });
      const form = sheet.body.querySelector("form");
      form.onsubmit = ev => {
        ev.preventDefault();
        const name = form.elements.name.value.trim();
        if (!name) return;
        const alts = form.elements.alts.value.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
        const next = { name, [listKey]: [...new Set(alts)] };
        if (index >= 0) list[index] = next; else list.push(next);
        list.sort((a, b) => a.name.localeCompare(b.name));
        saveSettings({ [key]: list });
        sheet.close(true);
      };
      const del = sheet.body.querySelector('[data-a="del"]');
      if (del) del.onclick = () => { list.splice(index, 1); saveSettings({ [key]: list }); sheet.close(true); };
    }

    const status = root.querySelector(".backup-status");
    const busy = on => root.querySelectorAll('[data-a^="backup"], [data-a="restore"]').forEach(b => { b.disabled = on; });
    const doBackup = async withPhotos => {
      busy(true);
      status.textContent = "Preparing backup…";
      try {
        const r = await App.backup.exportBackup({ withPhotos, onProgress: (d, t) => { status.textContent = `Gathering photos… ${d} of ${t}`; } });
        status.textContent = "";
        await App.saveFile(r.file);
        if (r.failed) App.toast(`${App.plural(r.failed, "photo")} couldn't be included. See the README about storage access.`, { duration: 6000 });
      } catch (e) {
        status.textContent = "";
        App.toast("Backup failed: " + (e.message || e), { type: "error" });
      }
      busy(false);
    };
    on("backup-full", () => doBackup(true));
    on("backup-text", () => doBackup(false));

    const restoreIn = root.querySelector('[name="restore"]');
    on("restore", () => restoreIn.click());
    restoreIn.onchange = async () => {
      const f = restoreIn.files[0];
      restoreIn.value = "";
      if (!f) return;
      busy(true);
      try {
        const r = await App.backup.restoreBackup(f, (d, t) => { status.textContent = `Restoring… ${d} of ${t}`; });
        status.textContent = "";
        App.toast(`Restored ${App.plural(r.added, "entry", "entries")}${r.skipped ? `, skipped ${r.skipped} you already had` : ""}`, { duration: 5000 });
      } catch (e) {
        status.textContent = "";
        App.toast("Restore failed: " + (e.message || e), { type: "error" });
      }
      busy(false);
    };

    on("erase", async () => {
      const ok = await App.confirm({ title: "Erase everything?", message: "Every entry and photo on this device will be deleted. Download a backup first if you might want them.", confirmText: "Erase", danger: true });
      if (ok) { await App.store.eraseAll(); App.toast("Erased"); }
    });
  }

  App.views.settings = {
    mount(root) { this.root = root; render(root); },
    refresh() {
      // Don't re-render mid-backup; just the counts would change.
      if (this.root && !this.root.querySelector("button:disabled")) render(this.root);
    },
    unmount() { this.root = null; }
  };
})(window.App);
