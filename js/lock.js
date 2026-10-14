/*
 * PIN lock. A 4-digit PIN asked for when the app opens and after it has
 * been in the background for a while. The PIN is stored on this device
 * only, as a salted SHA-256 hash.
 *
 * This keeps out someone holding your unlocked phone. It is not encryption:
 * the journal itself is protected by your account sign-in.
 */
(function (App) {
  "use strict";

  const PIN_LEN = 4;
  const MAX_TRIES = 5;
  const COOLDOWN_MS = 30000;

  let account = null;      // which journal the PIN belongs to (uid or "local")
  let unlocked = false;
  let hiddenAt = null;

  const pinKey = () => `daymark.pin.${account}`;
  const hasPin = () => !!App.lsGet(pinKey(), null);
  const delayMin = () => App.lsGet("daymark.lockDelay", 1);

  async function hash(pin, salt) {
    const data = new TextEncoder().encode(salt + ":" + pin);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  async function setPin(pin) {
    const salt = App.genId();
    App.lsSet(pinKey(), { salt, hash: await hash(pin, salt) });
  }
  async function checkPin(pin) {
    const rec = App.lsGet(pinKey(), null);
    return !!rec && rec.hash === (await hash(pin, rec.salt));
  }

  // Shared keypad screen. onDigits(pin) returns a promise of
  // { ok: true } | { error: "message" } and the pad resets on error.
  function keypad({ title, subtitle, onDigits, footer }) {
    const root = document.getElementById("lock");
    root.innerHTML = `
      <div class="lock-inner">
        <img src="icon-192.png" alt="" class="lock-logo">
        <h2 class="lock-title">${App.escapeHtml(title)}</h2>
        <p class="lock-sub">${App.escapeHtml(subtitle || "")}</p>
        <div class="pin-dots">${"<span></span>".repeat(PIN_LEN)}</div>
        <div class="keypad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-k="${n}">${n}</button>`).join("")}
          <span></span>
          <button type="button" data-k="0">0</button>
          <button type="button" data-k="del" aria-label="Delete">${App.icon("delete")}</button>
        </div>
        <div class="lock-footer"></div>
      </div>`;
    if (footer) root.querySelector(".lock-footer").appendChild(footer);
    root.hidden = false;
    let pin = "";
    let busy = false;
    const dots = root.querySelectorAll(".pin-dots span");
    const sub = root.querySelector(".lock-sub");
    const paint = () => dots.forEach((d, i) => d.classList.toggle("on", i < pin.length));
    const press = async k => {
      if (busy) return;
      if (k === "del") pin = pin.slice(0, -1);
      else if (pin.length < PIN_LEN) pin += k;
      paint();
      if (pin.length === PIN_LEN) {
        busy = true;
        const r = await onDigits(pin);
        if (r && r.error) {
          sub.textContent = r.error;
          root.querySelector(".pin-dots").classList.add("shake");
          setTimeout(() => root.querySelector(".pin-dots").classList.remove("shake"), 450);
        }
        pin = ""; paint(); busy = false;
      }
    };
    root.querySelectorAll("[data-k]").forEach(b => { b.onclick = () => press(b.dataset.k); });
    const onKey = e => {
      if (root.hidden) return document.removeEventListener("keydown", onKey);
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("del");
    };
    document.addEventListener("keydown", onKey);
    return { root, setSub: t => { sub.textContent = t; } };
  }

  function hide() {
    const root = document.getElementById("lock");
    root.hidden = true;
    root.innerHTML = "";
  }

  // Ask for the PIN; resolves once it is entered correctly.
  function showLock() {
    unlocked = false;
    return new Promise(resolve => {
      const footer = App.el(`<button type="button" class="link-btn">Forgot PIN?</button>`);
      footer.onclick = async () => {
        const ok = await App.confirm({
          title: "Forgot your PIN?",
          message: "You'll be signed out. Sign back in with Google and you can set a new PIN. Your journal is not affected.",
          confirmText: "Sign out"
        });
        if (ok) { App.lsSet(pinKey(), undefined); hide(); App.emit("signout"); }
      };
      let tries = 0;
      let lockedUntil = 0;
      keypad({
        title: "Daymark is locked",
        subtitle: "Enter your PIN",
        footer,
        onDigits: async pin => {
          if (Date.now() < lockedUntil) return { error: `Too many tries. Wait ${Math.ceil((lockedUntil - Date.now()) / 1000)} seconds.` };
          if (await checkPin(pin)) { unlocked = true; hide(); resolve(); return { ok: true }; }
          tries++;
          if (tries >= MAX_TRIES) { tries = 0; lockedUntil = Date.now() + COOLDOWN_MS; return { error: "Too many tries. Wait 30 seconds." }; }
          return { error: "Wrong PIN, try again" };
        }
      });
    });
  }

  // Create (or change) the PIN: enter twice. Resolves true if set, false if skipped.
  function setupPin({ allowSkip }) {
    return new Promise(resolve => {
      let first = null;
      let footer = null;
      if (allowSkip) {
        footer = App.el(`<button type="button" class="link-btn">Not now</button>`);
        footer.onclick = () => { App.lsSet(`daymark.pinSkipped.${account}`, true); hide(); resolve(false); };
      } else {
        footer = App.el(`<button type="button" class="link-btn">Cancel</button>`);
        footer.onclick = () => { hide(); resolve(false); };
      }
      const pad = keypad({
        title: "Create a PIN",
        subtitle: `Choose ${PIN_LEN} digits to unlock your journal`,
        footer,
        onDigits: async pin => {
          if (first == null) { first = pin; pad.setSub("Enter it again to confirm"); return { ok: true }; }
          if (pin !== first) { first = null; return { error: "Those didn't match. Start again." }; }
          await setPin(pin);
          unlocked = true;
          hide();
          App.toast("PIN set");
          resolve(true);
          return { ok: true };
        }
      });
    });
  }

  // Called after sign-in: lock if a PIN exists, offer to create one if not.
  async function begin(accountId) {
    account = accountId;
    if (hasPin()) return showLock();
    unlocked = true;
    if (accountId !== "local" && !App.lsGet(`daymark.pinSkipped.${accountId}`, false)) await setupPin({ allowSkip: true });
  }

  // Hide the journal from the app switcher and re-lock after a while away.
  document.addEventListener("visibilitychange", () => {
    const cover = document.getElementById("privacyCover");
    if (!account || !hasPin()) return;
    if (document.hidden) {
      hiddenAt = Date.now();
      cover.hidden = false;
    } else {
      cover.hidden = true;
      if (unlocked && hiddenAt && Date.now() - hiddenAt >= delayMin() * 60000) showLock();
      hiddenAt = null;
    }
  });

  App.lock = {
    begin,
    hasPin,
    setupPin: () => setupPin({ allowSkip: false }),
    removePin: () => App.lsSet(pinKey(), undefined),
    lockNow: () => { if (hasPin()) showLock(); },
    delayMin,
    setDelay: m => App.lsSet("daymark.lockDelay", m),
    end: () => { account = null; unlocked = false; hide(); }
  };
})(window.App);
