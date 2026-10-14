/*
 * Entry editor: a full-height sheet for writing (or dictating) an entry,
 * attaching photos, tags, location and a highlight star.
 */
(function (App) {
  "use strict";

  const DRAFT_KEY = "daymark.draft";

  App.autoLocation = () => App.lsGet("daymark.autoLocation", true);

  App.openEditor = ({ entry, date } = {}) => {
    const isNew = !entry;
    let e;
    let restored = false;
    if (isNew) {
      const draft = App.lsGet(DRAFT_KEY, null);
      if (draft && (draft.text || (draft.photos || []).length)) {
        e = draft; restored = true;
      } else {
        e = App.store.newEntry(date || App.todayStr());
      }
    } else {
      e = JSON.parse(JSON.stringify(entry));
    }
    const initial = JSON.stringify(e);
    // Photos uploaded in this editing session (deleted again if you discard).
    const newUploads = new Set(isNew ? (e.photos || []).map(p => p.id) : []);
    // Saved photos you removed (deleted from storage only once you save).
    const removed = [];
    let uploading = 0;
    let locToken = 0;

    const sheet = App.sheet({
      title: isNew ? "New entry" : "Edit entry",
      full: true,
      html: `
        <form class="editor" autocomplete="off">
          <div class="ed-when">
            <label class="field"><span>Date</span><input type="date" name="date" required></label>
            <label class="field"><span>Time</span><input type="time" name="time"></label>
          </div>
          <div class="ed-paper">
            <textarea name="text" rows="6" placeholder="What did you do?"></textarea>
          </div>
          <p class="hint">${App.icon("mic")}<span>Tip: tap the microphone on your keyboard to talk instead of typing.</span></p>

          <section class="ed-section">
            <div class="ed-label">${App.icon("image")} Photos</div>
            <div class="ed-photos"></div>
            <input type="file" accept="image/*" multiple hidden name="photoInput">
          </section>

          <section class="ed-section">
            <div class="ed-label">${App.icon("tag")} Tags <small>people, places, activities</small></div>
            <div class="tag-input"><input type="text" name="tag" placeholder="Add a tag…" enterkeyhint="done" autocapitalize="words"></div>
            <div class="tag-suggest"></div>
          </section>

          <section class="ed-section">
            <div class="ed-label">${App.icon("pin")} Location</div>
            <div class="ed-loc"></div>
          </section>
        </form>
        <div class="ed-footer">
          ${isNew ? "" : `<button type="button" class="btn ghost danger-text" data-a="delete">${App.icon("trash")} Delete</button>`}
          <button type="button" class="btn primary" data-a="save">${App.icon("check")} Save</button>
        </div>`,
      beforeClose: async () => {
        if (JSON.stringify(e) === initial && !newUploads.size) return true;
        const ok = await App.confirm({ title: "Discard changes?", message: "What you wrote here hasn't been saved.", confirmText: "Discard", cancelText: "Keep editing", danger: true });
        if (ok) discard();
        return ok;
      }
    });

    const form = sheet.body.querySelector("form");
    const dateIn = form.elements.date;
    const timeIn = form.elements.time;
    const textIn = form.elements.text;

    // ---- star toggle in the sheet header ----
    const starBtn = App.el(`<button type="button" class="icon-btn star-btn" aria-label="Highlight">${App.icon("star")}</button>`);
    sheet.head.appendChild(starBtn);
    const paintStar = () => { starBtn.classList.toggle("on", !!e.starred); starBtn.title = e.starred ? "Highlighted" : "Mark as highlight"; };
    starBtn.onclick = () => { e.starred = !e.starred; paintStar(); changed(); };
    paintStar();

    // ---- date, time, text ----
    dateIn.value = e.date;
    timeIn.value = e.time || "";
    textIn.value = e.text || "";
    const grow = () => { textIn.style.height = "auto"; textIn.style.height = Math.max(textIn.scrollHeight, 180) + "px"; };
    dateIn.onchange = () => { if (dateIn.value) e.date = dateIn.value; changed(); };
    timeIn.onchange = () => { e.time = timeIn.value || null; changed(); };
    textIn.oninput = () => { e.text = textIn.value; grow(); changed(); };
    requestAnimationFrame(grow);

    let finished = false; // saved or discarded: a pending draft write must not resurrect it
    const saveDraft = App.debounce(() => { if (isNew && !finished) App.lsSet(DRAFT_KEY, e); }, 400);
    function changed() { saveDraft(); }

    // ---- photos ----
    const photosEl = form.querySelector(".ed-photos");
    const fileIn = form.elements.photoInput;
    function renderPhotos() {
      photosEl.innerHTML = (e.photos || []).map((p, i) => `
        <div class="ed-photo">${App.photoImg(p, true)}<button type="button" class="ed-photo-x" data-i="${i}" aria-label="Remove photo">${App.icon("x")}</button></div>`).join("")
        + `<button type="button" class="ed-photo-add">${App.icon("plus")}<span>Add</span></button>`;
      App.hydrate(photosEl);
      photosEl.querySelector(".ed-photo-add").onclick = () => fileIn.click();
      photosEl.querySelectorAll(".ed-photo-x").forEach(b => {
        b.onclick = () => {
          const [p] = e.photos.splice(Number(b.dataset.i), 1);
          if (newUploads.has(p.id)) { newUploads.delete(p.id); App.store.deletePhoto(p).catch(() => {}); }
          else removed.push(p);
          renderPhotos(); changed();
        };
      });
    }
    fileIn.onchange = async () => {
      const files = [...fileIn.files];
      fileIn.value = "";
      for (const file of files) {
        const tile = App.el(`<div class="ed-photo pending"><div class="spinner"></div></div>`);
        photosEl.insertBefore(tile, photosEl.querySelector(".ed-photo-add"));
        uploading++;
        try {
          const p = await App.store.addPhoto(file);
          newUploads.add(p.id);
          e.photos = [...(e.photos || []), p];
          changed();
        } catch (err) {
          App.toast(`Couldn't add photo: ${err.message || err}`, { type: "error" });
        } finally {
          uploading--;
          tile.remove();
          renderPhotos();
        }
      }
    };
    renderPhotos();

    // ---- tags ----
    const tagWrap = form.querySelector(".tag-input");
    const tagIn = form.elements.tag;
    const suggestEl = form.querySelector(".tag-suggest");
    function renderTags() {
      tagWrap.querySelectorAll(".tag").forEach(t => t.remove());
      (e.tags || []).forEach((t, i) => {
        const chip = App.el(`<span class="tag tag-c${App.tagColor(t)} removable">${App.escapeHtml(t)}<button type="button" aria-label="Remove ${App.escapeHtml(t)}">${App.icon("x")}</button></span>`);
        chip.querySelector("button").onclick = () => { e.tags.splice(i, 1); renderTags(); changed(); };
        tagWrap.insertBefore(chip, tagIn);
      });
      renderSuggest();
    }
    function addTag(raw) {
      const t = App.cleanTag(raw);
      if (!t) return;
      // Reuse the existing spelling so "sam" and "Sam" stay one tag.
      const existing = App.store.tags().find(x => App.norm(x.tag) === App.norm(t));
      const tag = existing ? existing.tag : t;
      if (!(e.tags || []).some(x => App.norm(x) === App.norm(tag))) e.tags = [...(e.tags || []), tag];
      tagIn.value = "";
      renderTags(); changed();
    }
    function renderSuggest() {
      const q = App.norm(tagIn.value.replace(/^#/, ""));
      const have = new Set((e.tags || []).map(App.norm));
      const list = App.store.tags().filter(x => !have.has(App.norm(x.tag)) && (!q || App.norm(x.tag).includes(q))).slice(0, 8);
      suggestEl.innerHTML = list.map(x => `<button type="button" class="tag tag-c${App.tagColor(x.tag)} suggest" data-t="${App.escapeHtml(x.tag)}">+ ${App.escapeHtml(x.tag)}</button>`).join("");
      suggestEl.querySelectorAll("[data-t]").forEach(b => { b.onclick = () => addTag(b.dataset.t); });
    }
    tagIn.oninput = () => { if (/[,;]$/.test(tagIn.value)) addTag(tagIn.value.slice(0, -1)); else renderSuggest(); };
    tagIn.onkeydown = ev => {
      if (ev.key === "Enter") { ev.preventDefault(); addTag(tagIn.value); }
      else if (ev.key === "Backspace" && !tagIn.value && (e.tags || []).length) { e.tags.pop(); renderTags(); changed(); }
    };
    tagIn.onblur = () => { if (tagIn.value.trim()) addTag(tagIn.value); };
    renderTags();

    // ---- location ----
    const locEl = form.querySelector(".ed-loc");
    function renderLoc(status) {
      if (status) {
        locEl.innerHTML = `<div class="loc-row muted"><div class="spinner sm"></div><span>${App.escapeHtml(status)}</span><button type="button" class="link-btn" data-a="cancel">Cancel</button></div>`;
        locEl.querySelector('[data-a="cancel"]').onclick = () => { locToken++; renderLoc(); };
        return;
      }
      if (e.location) {
        locEl.innerHTML = `<div class="loc-row">${App.icon("pin")}<input type="text" value="${App.escapeHtml(e.location.label)}" aria-label="Location name"><button type="button" class="icon-btn sm" aria-label="Remove location">${App.icon("x")}</button></div>`;
        const inp = locEl.querySelector("input");
        inp.oninput = () => { e.location = { ...e.location, label: inp.value }; changed(); };
        locEl.querySelector("button").onclick = () => { e.location = null; renderLoc(); changed(); };
      } else {
        locEl.innerHTML = `<button type="button" class="btn ghost sm">${App.icon("pin")} Add current location</button>`;
        locEl.querySelector("button").onclick = () => fetchLocation();
      }
    }
    async function fetchLocation() {
      const token = ++locToken;
      renderLoc("Finding your location…");
      const loc = await App.currentLocation();
      if (token !== locToken) return;
      if (loc) { e.location = loc; changed(); }
      else App.toast("Couldn't get your location. Check that Location is allowed for this app.");
      renderLoc();
    }
    renderLoc();
    if (isNew && !restored && !e.location && e.date === App.todayStr() && App.autoLocation()) fetchLocation();

    // ---- save / delete ----
    function discard() {
      finished = true;
      locToken++;
      newUploads.forEach(id => App.store.deletePhoto({ id }).catch(() => {}));
      if (isNew) App.lsSet(DRAFT_KEY, undefined);
    }

    sheet.body.querySelector('[data-a="save"]').onclick = async () => {
      if (uploading) return App.toast("Hang on, photos are still uploading…");
      if (tagIn.value.trim()) addTag(tagIn.value);
      e.text = (e.text || "").trim();
      if (e.location && !e.location.label.trim()) e.location = null;
      if (!e.text && !(e.photos || []).length) return App.toast("Write something or add a photo first.");
      if (!e.date) return App.toast("Pick a date.");
      locToken++;
      try {
        finished = true;
        const saved = await App.store.save(e);
        removed.forEach(p => App.store.deletePhoto(p).catch(() => {}));
        newUploads.clear();
        if (isNew) App.lsSet(DRAFT_KEY, undefined);
        sheet.close(true);
        App.toast(isNew ? "Saved" : "Updated");
        App.emit("saved", saved);
      } catch (err) {
        finished = false;
        App.toast("Couldn't save: " + (err.message || err), { type: "error" });
      }
    };

    const delBtn = sheet.body.querySelector('[data-a="delete"]');
    if (delBtn) delBtn.onclick = async () => {
      const ok = await App.confirm({ title: "Delete this entry?", message: "This removes the entry and its photos. It can't be undone.", confirmText: "Delete", danger: true });
      if (!ok) return;
      newUploads.forEach(id => App.store.deletePhoto({ id }).catch(() => {}));
      await App.store.remove(entry.id);
      sheet.close(true);
      App.toast("Entry deleted");
    };

    if (restored) App.toast("Restored your unsaved draft");
    if (isNew && !restored) setTimeout(() => textIn.focus(), 320);
  };
})(window.App);
