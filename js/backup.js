/*
 * Backup & restore. A backup is a .zip holding daymark.json (every entry)
 * plus photos/<id>.jpg and photos/<id>_thumb.jpg. Restoring merges into the
 * current journal and skips entries that are already there, so it also
 * moves a "this phone only" journal into a signed-in one.
 */
(function (App) {
  "use strict";

  // ---------- minimal ZIP (stored, no compression; JPEGs don't shrink anyway) ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // files: [{ name, data: Uint8Array }] → Blob
  function makeZip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true); h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true);
      h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true);
      c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, name);
      offset += 30 + name.length + f.data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
  }

  // Blob → Map(name → Uint8Array). Handles stored and deflated entries.
  async function readZip(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const v = new DataView(buf.buffer);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("This doesn't look like a Daymark backup.");
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const out = new Map();
    for (let i = 0; i < count; i++) {
      const method = v.getUint16(p + 10, true);
      const size = v.getUint32(p + 20, true);
      const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
      const local = v.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
      const dataStart = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      let data = buf.subarray(dataStart, dataStart + size);
      if (method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      else if (method !== 0) throw new Error("Unsupported zip format.");
      out.set(name, data);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  // ---------- export ----------
  async function exportBackup({ withPhotos, onProgress }) {
    const entries = App.store.all().sort((a, b) => (a.date < b.date ? -1 : 1));
    const files = [];
    let failed = 0;
    const photos = withPhotos ? entries.flatMap(e => e.photos || []) : [];
    let done = 0;
    for (const p of photos) {
      for (const thumb of [false, true]) {
        try {
          const blob = await App.store.getPhotoBlob(p, thumb);
          if (blob) files.push({ name: `photos/${p.id}${thumb ? "_thumb" : ""}.jpg`, data: new Uint8Array(await blob.arrayBuffer()) });
          else if (!thumb) failed++;
        } catch (e) {
          if (!thumb) failed++;
        }
      }
      onProgress && onProgress(++done, photos.length);
    }
    const doc = {
      app: "daymark", version: 1, exportedAt: new Date().toISOString(), includesPhotos: !!withPhotos,
      settings: App.store.settings || {},
      entries: entries.map(e => ({ ...e, photos: (e.photos || []).map(({ url, thumbUrl, ...rest }) => rest) }))
    };
    files.unshift({ name: "daymark.json", data: new TextEncoder().encode(JSON.stringify(doc, null, 1)) });
    const name = `daymark-backup-${App.todayStr()}${withPhotos ? "" : "-text"}.zip`;
    return { file: new File([makeZip(files)], name, { type: "application/zip" }), failed, count: entries.length };
  }

  // Share sheet on iPhone ("Save to Files"), plain download elsewhere.
  App.saveFile = async file => {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: file.name }); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement("a"), { href: url, download: file.name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  // ---------- restore ----------
  async function restoreBackup(file, onProgress) {
    const zip = await readZip(file);
    const json = zip.get("daymark.json");
    if (!json) throw new Error("This doesn't look like a Daymark backup.");
    const doc = JSON.parse(new TextDecoder().decode(json));
    if (doc.app !== "daymark" || !Array.isArray(doc.entries)) throw new Error("This doesn't look like a Daymark backup.");
    // Search settings: add people and word groups you don't already have.
    if (doc.settings) {
      const cur = App.store.settings || {};
      const merge = (mine, theirs) => {
        const names = new Set((mine || []).map(x => App.norm(x.name)));
        return [...(mine || []), ...(theirs || []).filter(x => !names.has(App.norm(x.name)))];
      };
      await App.store.saveSettings({
        ...cur,
        people: merge(cur.people, doc.settings.people),
        groups: merge(cur.groups, doc.settings.groups),
        birthday: cur.birthday || doc.settings.birthday || ""
      });
    }
    let added = 0, skipped = 0, done = 0;
    for (const e of doc.entries) {
      onProgress && onProgress(++done, doc.entries.length);
      if (App.store.get(e.id)) { skipped++; continue; }
      const photos = [];
      for (const p of e.photos || []) {
        const full = zip.get(`photos/${p.id}.jpg`);
        const thumb = zip.get(`photos/${p.id}_thumb.jpg`) || full;
        if (full) {
          const urls = await App.store.putPhoto(p.id, new Blob([full], { type: "image/jpeg" }), new Blob([thumb], { type: "image/jpeg" }));
          photos.push({ ...p, ...urls });
        }
      }
      await App.store.save({ ...e, photos });
      added++;
    }
    return { added, skipped };
  }

  App.backup = { exportBackup, restoreBackup, makeZip, readZip };
})(window.App);
