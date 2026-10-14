/*
 * Photos: read the "date taken" from a photo's EXIF data and shrink photos
 * to a sensible size before they are stored.
 */
(function (App) {
  "use strict";

  const FULL_MAX = 1600;
  const THUMB_MAX = 360;

  // Returns { date: "YYYY-MM-DD", time: "HH:MM" } or null.
  async function readTakenAt(file) {
    try {
      const buf = await file.slice(0, 256 * 1024).arrayBuffer();
      const v = new DataView(buf);
      if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
      let off = 2;
      while (off + 4 <= v.byteLength) {
        const marker = v.getUint16(off);
        if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
        const size = v.getUint16(off + 2);
        if (marker === 0xFFE1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966) {
          return parseTiffDate(v, off + 10);
        }
        off += 2 + size;
      }
    } catch (e) { /* unreadable or truncated EXIF */ }
    return null;
  }

  function parseTiffDate(v, start) {
    const little = v.getUint16(start) === 0x4949;
    const u16 = o => v.getUint16(start + o, little);
    const u32 = o => v.getUint32(start + o, little);
    const readIfd = ifdOff => {
      const tags = {};
      const n = u16(ifdOff);
      for (let i = 0; i < n; i++) {
        const e = ifdOff + 2 + i * 12;
        tags[u16(e)] = { count: u32(e + 4), valOff: e + 8 };
      }
      return tags;
    };
    const readStr = t => {
      const off = t.count > 4 ? u32(t.valOff) : t.valOff;
      let s = "";
      for (let i = 0; i < t.count - 1; i++) s += String.fromCharCode(v.getUint8(start + off + i));
      return s;
    };
    const ifd0 = readIfd(u32(4));
    let tag = null;
    if (ifd0[0x8769]) {
      const exif = readIfd(u32(ifd0[0x8769].valOff));
      tag = exif[0x9003] || exif[0x9004];
    }
    tag = tag || ifd0[0x0132];
    if (!tag) return null;
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(readStr(tag));
    if (!m || m[1] === "0000") return null;
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
  }

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This photo format couldn't be read.")); };
      img.src = url;
    });
  }

  function scale(img, max, quality) {
    const ratio = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * ratio));
    const h = Math.max(1, Math.round(img.naturalHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve({ blob: b, w, h }) : reject(new Error("Couldn't process photo."))), "image/jpeg", quality));
  }

  // → { full: {blob,w,h}, thumb: {blob,w,h}, takenAt }
  async function prepare(file) {
    const [takenAt, img] = await Promise.all([readTakenAt(file), loadImage(file)]);
    const full = await scale(img, FULL_MAX, 0.82);
    const thumb = await scale(img, THUMB_MAX, 0.75);
    return { full, thumb, takenAt };
  }

  App.photos = { readTakenAt, prepare };
})(window.App);
