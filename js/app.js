/*
 * App boot: Firebase + sign-in, the welcome screen, and wiring the
 * screens together.
 */
(function (App) {
  "use strict";

  const cfg = window.DAYMARK_FIREBASE_CONFIG;
  App.cloudAvailable = !!(cfg && cfg.apiKey && window.firebase);
  const MODE_KEY = "daymark.mode"; // "local" once you choose this-phone-only

  const $ = id => document.getElementById(id);
  let auth = null;
  let activeAccount; // undefined = nobody yet, null = local, uid = cloud

  function showSplash() { $("splash").hidden = false; $("app").hidden = true; $("welcome").hidden = true; }

  function showWelcome(error) {
    activeAccount = undefined;
    $("splash").hidden = true;
    $("app").hidden = true;
    const w = $("welcome");
    w.hidden = false;
    w.innerHTML = `
      <div class="welcome-inner">
        <img src="icon-192.png" alt="" class="welcome-logo">
        <h1>Daymark</h1>
        <p class="tagline">Write down what you did each day. Find it again whenever you want.</p>
        ${error ? `<p class="welcome-error">${App.escapeHtml(error)}</p>` : ""}
        ${App.cloudAvailable ? `
          <button type="button" class="btn primary block" data-a="google">Sign in with Google</button>
          <p class="muted small">Your journal is kept private to your account and syncs between your devices.</p>
          <button type="button" class="link-btn" data-a="local">Use on this phone only instead</button>` : `
          <button type="button" class="btn primary block" data-a="local">Start journaling</button>
          <p class="muted small">Cloud sync isn't set up yet, so entries are saved on this phone only. Download backups from Settings. You can move them to the cloud later.</p>`}
        ${!App.isStandalone() && App.isIOS() ? `<p class="install-hint">Tip: tap <strong>Share</strong> then <strong>Add to Home Screen</strong> to install Daymark like an app.</p>` : ""}
      </div>`;
    const g = w.querySelector('[data-a="google"]');
    if (g) g.onclick = signIn;
    w.querySelector('[data-a="local"]').onclick = () => { App.lsSet(MODE_KEY, "local"); enter(null); };
  }

  async function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    // Pop-ups don't work in a home-screen app, so redirect there (and on phones generally).
    if (App.isStandalone() || /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
      showSplash();
      return auth.signInWithRedirect(provider).catch(e => showWelcome(e.message));
    }
    try { await auth.signInWithPopup(provider); }
    catch (e) {
      if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") return auth.signInWithRedirect(provider);
      if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") showWelcome(e.message);
    }
  }

  async function enter(user) {
    const account = user ? user.uid : null;
    if (activeAccount === account) return;
    activeAccount = account;
    showSplash();
    try {
      await App.store.start(user);
    } catch (e) {
      console.error(e);
      return showWelcome("Couldn't open your journal: " + (e.message || e));
    }
    $("splash").hidden = true;
    $("welcome").hidden = true;
    await App.lock.begin(user ? user.uid : "local");
    if (activeAccount !== account) return; // signed out from the lock screen
    $("app").hidden = false;
    App.route();
  }

  async function signOut() {
    App.lsSet(MODE_KEY, undefined);
    App.lock.end();
    await App.store.stop();
    if (auth && auth.currentUser) await auth.signOut(); // onAuthStateChanged shows the welcome screen
    else showWelcome();
  }

  // ---------- wiring ----------
  App.on("signout", signOut);
  App.on("data", () => { if (!$("app").hidden) App.refresh(); });
  App.on("settings", () => { if (!$("app").hidden) App.refresh(); });
  App.on("store-error", err => {
    const msg = err && err.code === "permission-denied"
      ? "Daymark isn't allowed to read your journal. Check the Firestore rules (see README)."
      : "Sync problem: " + (err && err.message);
    App.toast(msg, { type: "error", duration: 8000 });
  });
  window.addEventListener("hashchange", () => { if (!$("app").hidden) App.route(); });
  $("fab").onclick = () => App.openEditor({ date: App.contextDate() });

  // ---------- boot ----------
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  if (App.cloudAvailable) {
    firebase.initializeApp(cfg);
    firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch(() => { /* private mode or another tab owns it */ });
    auth = firebase.auth();
    auth.getRedirectResult().catch(e => showWelcome(e.message));
    auth.onAuthStateChanged(user => {
      if (user) enter(user);
      else if (App.lsGet(MODE_KEY, null) === "local") enter(null);
      else showWelcome();
    });
  } else if (App.lsGet(MODE_KEY, null) === "local") {
    enter(null);
  } else {
    showWelcome();
  }
})(window.App);
