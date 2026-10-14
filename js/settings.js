/*
 * Settings: account, PIN lock, location, photo import, backup & restore.
 */
(function (App) {
  "use strict";

  function render(root) {
    const s = App.store;
    const all = s.all();
    const photos = all.reduce((n, e) => n + (e.photos || []).length, 0);
    const first = s.dates()[0];
    const cloud = s.mode === "cloud";
    const user = s.user;
    const delay = App.lock.delayMin();

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
