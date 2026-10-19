/*
 * Store: where journal entries and photos live.
 *
 *  - Cloud mode: Firestore (users/{uid}/entries) + Firebase Storage
 *    (users/{uid}/photos). Syncs across devices, works offline for text.
 *  - Local mode: IndexedDB in this browser only.
 *
 * Entry shape:
 *  { id, date: "YYYY-MM-DD", time: "HH:MM" | null, text, tags: [],
 *    starred, location: { label, lat, lng } | null,
 *    photos: [{ id, w, h, url?, thumbUrl?, takenAt?, sourceKey? }],
 *    source: "manual" | "photo-import", createdAt, updatedAt }
 */
(function (App) {
  "use strict";

  const entries = new Map();
  let byDate = new Map();
  let backend = null;
  let vocabCache = null;
  // Search settings: { people: [{ name, aliases }], groups: [{ name, words }], birthday: "MM-DD" }
  let settings = {};

  function sortDay(list) {
    return list.sort((a, b) => {
      if (a.time && b.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
      if (!!a.time !== !!b.time) return a.time ? -1 : 1;
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
  }

  function reindex() {
    byDate = new Map();
    for (const e of entries.values()) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    }
    byDate.forEach(sortDay);
    vocabCache = null;
    App.emit("data");
  }

  function replaceAll(list) {
    entries.clear();
    list.forEach(e => entries.set(e.id, e));
    reindex();
  }

  // Firestore rejects `undefined`; JSON round-trip drops those keys.
  const clean = e => JSON.parse(JSON.stringify(e));

  // ---------- IndexedDB (local mode) ----------
  function openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("daymark", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("entries", { keyPath: "id" });
        req.result.createObjectStore("photos", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  const idbReq = (db, storeName, mode, fn) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const r = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(r && r.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Storage is full or unavailable."));
  });

  function localBackend() {
    let db;
    const urls = new Map();
    return {
      mode: "local",
      async init() {
        settings = App.lsGet("daymark.settings", {}) || {};
        db = await openIdb();
        replaceAll((await idbReq(db, "entries", "readonly", s => s.getAll())) || []);
      },
      async save(e) { await idbReq(db, "entries", "readwrite", s => s.put(clean(e))); },
      async remove(id) { await idbReq(db, "entries", "readwrite", s => s.delete(id)); },
      async putPhoto(id, full, thumb) {
        await idbReq(db, "photos", "readwrite", s => s.put({ id, full, thumb }));
        return {};
      },
      async deletePhoto(photo) {
        await idbReq(db, "photos", "readwrite", s => s.delete(photo.id));
        ["f", "t"].forEach(k => { const u = urls.get(photo.id + k); if (u) { URL.revokeObjectURL(u); urls.delete(photo.id + k); } });
      },
      async getPhotoBlob(photo, thumb) {
        const rec = await idbReq(db, "photos", "readonly", s => s.get(photo.id));
        return rec ? (thumb ? rec.thumb : rec.full) : null;
      },
      photoSrcSync(photo, thumb) { return urls.get(photo.id + (thumb ? "t" : "f")) || null; },
      async photoSrc(photo, thumb) {
        const key = photo.id + (thumb ? "t" : "f");
        if (urls.has(key)) return urls.get(key);
        const blob = await this.getPhotoBlob(photo, thumb);
        if (!blob) return "";
        const u = URL.createObjectURL(blob);
        urls.set(key, u);
        return u;
      },
      async saveSettings(s) { App.lsSet("daymark.settings", s); },
      async signOut() {},
      async eraseAll() {
        await idbReq(db, "entries", "readwrite", s => s.clear());
        await idbReq(db, "photos", "readwrite", s => s.clear());
        replaceAll([]);
      }
    };
  }

  // ---------- Firebase (cloud mode) ----------
  function cloudBackend(user) {
    const fs = firebase.firestore();
    const col = fs.collection("users").doc(user.uid).collection("entries");
    const bucket = firebase.storage().ref().child(`users/${user.uid}/photos`);
    const settingsDoc = fs.collection("users").doc(user.uid).collection("meta").doc("settings");
    let unsub = null;
    let unsubSettings = null;
    const putOpts = { contentType: "image/jpeg", cacheControl: "private, max-age=31536000" };
    return {
      mode: "cloud",
      user,
      init() {
        unsubSettings = settingsDoc.onSnapshot(doc => { settings = (doc.exists && doc.data()) || {}; App.emit("settings"); }, err => console.error(err));
        return new Promise(resolve => {
          unsub = col.onSnapshot(snap => {
            replaceAll(snap.docs.map(d => d.data()));
            resolve();
          }, err => {
            console.error(err);
            App.emit("store-error", err);
            resolve();
          });
        });
      },
      // Firestore applies the write locally right away and syncs when online,
      // so don't wait for the server (it never answers while offline).
      save(e) {
        col.doc(e.id).set(clean(e)).catch(err => App.toast("Couldn't sync: " + err.message, { type: "error" }));
        return Promise.resolve();
      },
      remove(id) {
        col.doc(id).delete().catch(err => App.toast("Couldn't sync: " + err.message, { type: "error" }));
        return Promise.resolve();
      },
      async putPhoto(id, full, thumb) {
        const fRef = bucket.child(`${id}.jpg`);
        const tRef = bucket.child(`${id}_thumb.jpg`);
        await Promise.all([fRef.put(full, putOpts), tRef.put(thumb, putOpts)]);
        const [url, thumbUrl] = await Promise.all([fRef.getDownloadURL(), tRef.getDownloadURL()]);
        return { url, thumbUrl };
      },
      async deletePhoto(photo) {
        await Promise.all([`${photo.id}.jpg`, `${photo.id}_thumb.jpg`].map(n => bucket.child(n).delete().catch(() => {})));
      },
      // Needs CORS enabled on the storage bucket (see README).
      async getPhotoBlob(photo, thumb) {
        const res = await fetch(thumb ? photo.thumbUrl : photo.url);
        if (!res.ok) throw new Error(res.status);
        return res.blob();
      },
      photoSrcSync(photo, thumb) {
        const full = entries.size && findPhoto(photo.id);
        const p = photo.url ? photo : (full || photo);
        return (thumb ? p.thumbUrl : p.url) || null;
      },
      async photoSrc(photo, thumb) { return this.photoSrcSync(photo, thumb) || ""; },
      saveSettings(s) {
        settingsDoc.set(clean(s)).catch(err => App.toast("Couldn't sync settings: " + err.message, { type: "error" }));
        return Promise.resolve();
      },
      async signOut() { if (unsub) unsub(); if (unsubSettings) unsubSettings(); unsub = unsubSettings = null; settings = {}; replaceAll([]); },
      async eraseAll() { throw new Error("Not supported for cloud journals."); }
    };
  }

  function findPhoto(id) {
    for (const e of entries.values()) for (const p of e.photos || []) if (p.id === id) return p;
    return null;
  }

  // ---------- public API ----------
  const store = {
    get mode() { return backend && backend.mode; },
    get user() { return backend && backend.user; },
    get settings() { return settings; },
    async saveSettings(s) {
      settings = clean(s);
      App.emit("settings");
      await backend.saveSettings(settings);
    },

    // Every distinct word in the journal (for typo fixing in search).
    vocab() {
      if (!vocabCache) {
        const words = new Set();
        for (const e of entries.values()) {
          const text = [e.text, (e.tags || []).join(" "), e.location && e.location.label].filter(Boolean).join(" ");
          App.searchText(text).split(" ").forEach(w => { if (w.length > 1) words.add(w); });
        }
        vocabCache = [...words];
      }
      return vocabCache;
    },

    async start(user) {
      backend = user ? cloudBackend(user) : localBackend();
      await backend.init();
    },
    async stop() { if (backend) await backend.signOut(); backend = null; },

    all: () => [...entries.values()],
    get: id => entries.get(id),
    forDate: d => byDate.get(d) || [],
    dates: () => [...byDate.keys()].sort(),
    hasDate: d => byDate.has(d),

    // [{ tag, count }] most-used first. Tags match case-insensitively.
    tags() {
      const counts = new Map();
      for (const e of entries.values()) for (const t of e.tags || []) {
        const k = App.norm(t);
        const cur = counts.get(k) || { tag: t, count: 0 };
        cur.count++;
        counts.set(k, cur);
      }
      return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    },

    async save(entry) {
      const now = new Date().toISOString();
      const e = { ...entry, updatedAt: now, createdAt: entry.createdAt || now };
      e.tags = [...new Map((e.tags || []).map(t => [App.norm(t), t])).values()];
      entries.set(e.id, clean(e));
      reindex();
      await backend.save(e);
      return e;
    },

    async remove(id) {
      const e = entries.get(id);
      entries.delete(id);
      reindex();
      await backend.remove(id);
      if (e) await Promise.all((e.photos || []).map(p => backend.deletePhoto(p).catch(() => {})));
    },

    // Resize and store a picked photo → photo metadata for an entry.
    async addPhoto(file, extra) {
      const prepared = await App.photos.prepare(file);
      const id = App.genId();
      const urls = await backend.putPhoto(id, prepared.full.blob, prepared.thumb.blob);
      return { id, w: prepared.full.w, h: prepared.full.h, ...(prepared.takenAt ? { takenAt: prepared.takenAt } : {}), ...urls, ...(extra || {}) };
    },
    putPhoto: (id, full, thumb) => backend.putPhoto(id, full, thumb),
    deletePhoto: p => backend.deletePhoto(p),
    getPhotoBlob: (p, thumb) => backend.getPhotoBlob(p, thumb),
    photoSrcSync: (p, thumb) => (backend ? backend.photoSrcSync(p, thumb) : null),
    photoSrc: (p, thumb) => backend.photoSrc(p, thumb),
    eraseAll: () => backend.eraseAll(),

    newEntry: (date) => ({
      id: App.genId(), date, time: date === App.todayStr() ? App.nowTime() : null,
      text: "", tags: [], starred: false, location: null, photos: [], source: "manual"
    })
  };

  App.store = store;
})(window.App);
