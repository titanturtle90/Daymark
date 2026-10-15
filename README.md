# Daymark

A personal journal for remembering what you did each day. You write (or dictate) entries, and you can find them again later on a calendar, by searching, or on "On This Day".

It's an installable web app (PWA) built from plain HTML, CSS, and JavaScript with no build step. Firebase handles sign-in, sync, and photo storage.

## What's in version 1

| Screen | What it does |
| --- | --- |
| **Calendar** | Month grid. A day with entries shows its first photo, or a dot if there's no photo. A star marks highlighted days. Tap the month name to jump to any month or year, or swipe to change months. Below the grid: an "on this day" note from past years and this month's highlights. |
| **Day** | Every entry for that date, in time order, with time, place, photos, and tags. Swipe left or right to change days. You can add entries to any past date. |
| **New entry** (+ button) | Large ruled writing area. Tap the 🎤 on the iPhone keyboard to dictate. Each entry has a date and time, photos, tags (people, places, activities), the current location (filled in automatically for today, and editable), and a highlight star. Unsaved writing is kept as a draft if the app closes. |
| **Search** | Search words across text, tags, and places. Filter by tag, highlights only, and date range (this year, last year, custom). Results link to their day. |
| **On This Day** | This date in every earlier year. If nothing matches exactly, it shows entries from a few days either side. |
| **Settings** | PIN lock, location on/off, import photos by date, download a backup (with or without photos), restore from a backup. |

**Import photos by date:** pick a batch of photos and each one goes onto the day it was taken, read from the photo's own date information. Photos without a date can be assigned a day by hand. Photos imported before are skipped.

**PIN lock:** a 4-digit PIN is asked for on open and again after the app has been in the background (immediately, or after 1, 5, or 15 minutes). The journal is hidden in the app switcher. If you forget the PIN, sign out and back in with Google to reset it. The PIN only stops someone holding your unlocked phone. Your data is protected by your Google sign-in and the Firebase security rules.

**This phone only mode:** if `js/config.js` has no Firebase settings, or you choose it on the welcome screen, entries are stored in the browser on that device only. To move them to the cloud later, download a backup, sign in, and restore the backup.

### Coming in later versions
AI transcription with a record button, auto-tagging, an AI "ask my journal" chat with links to the source days, daily/weekly/monthly/yearly recaps, an 8 PM reminder, and PDF export.

## Setting up Firebase (one time)

1. **Create the project.** Go to [console.firebase.google.com](https://console.firebase.google.com) → *Add project* → name it (e.g. `daymark`). Google Analytics isn't needed.
2. **Upgrade to the Blaze plan** (bottom-left *Upgrade*). New projects need it to store photos. Personal use should stay within the free allowance. Set a budget alert at Google Cloud → Billing → Budgets & alerts (e.g. $5).
3. **Turn on Google sign-in.** Go to *Build → Authentication → Get started → Sign-in method → Google → Enable*.
4. **Create the database.** Go to *Build → Firestore Database → Create database*: choose the **Standard** edition, keep the database ID `(default)`, pick a US region such as **us-east1**, start in **production mode**, and leave scheduled backups off (they cost extra; use the app's own backup). Then open the *Rules* tab, paste in [`firestore.rules`](firestore.rules), and click *Publish*.
5. **Create photo storage.** Go to *Build → Storage → Get started* and choose **us-east1, us-central1 or us-west1**. Only these three regions get the free 5 GB; anywhere else every GB is charged. Open the *Rules* tab, paste in [`storage.rules`](storage.rules), and click *Publish*.
6. **Register the web app.** Go to *Project settings* (gear icon) → *Your apps* → the `</>` web icon. Name it `Daymark` and tick **"Also set up Firebase Hosting"**. Copy the `firebaseConfig` values into [`js/config.js`](js/config.js).
7. **Let backups include photos.** Open [Google Cloud Shell](https://shell.cloud.google.com) for the project and run this once, replacing the bucket name with your `storageBucket` value:
   ```
   echo '[{"origin":["*"],"method":["GET"],"maxAgeSeconds":3600}]' > cors.json
   gcloud storage buckets update gs://YOUR-PROJECT.firebasestorage.app --cors-file=cors.json
   ```
   If you skip this, backups still work, but photos stay in the cloud only.

### Hosting (where the app lives)

Use **Firebase Hosting** rather than GitHub Pages. Google sign-in in an iPhone home-screen app only works reliably when the app is served from the same domain as the sign-in page.

Automatic deploys on every merge to `main`:
1. Go to Firebase console → *Project settings → Service accounts → Generate new private key*.
2. In the GitHub repo, go to *Settings → Secrets and variables → Actions*:
   - Secret `FIREBASE_SERVICE_ACCOUNT`: paste the whole JSON key file.
   - Variable `FIREBASE_PROJECT_ID`: your project ID, e.g. `daymark-12345`.
3. Push or merge to `main`, or run *Actions → Deploy to Firebase Hosting → Run workflow*. Until the secret and variable are set, the workflow skips the deploy instead of failing.

Then open **`https://YOUR-PROJECT.firebaseapp.com`** in Safari on your iPhone (use this address, not `.web.app`, so sign-in works). Tap **Share → Add to Home Screen**, then open Daymark from the home screen and sign in.

## Data model

Firestore: `users/{uid}/entries/{entryId}`

```js
{
  id, date: "2026-10-14", time: "14:05" | null,
  text, tags: ["Sam", "hiking"], starred: false,
  location: { label: "Oxford Exchange, Tampa", lat, lng } | null,
  photos: [{ id, w, h, url, thumbUrl, takenAt?, sourceKey? }],
  source: "manual" | "photo-import", createdAt, updatedAt
}
```

Storage: `users/{uid}/photos/{photoId}.jpg` (up to 1600px) and `{photoId}_thumb.jpg` (360px).

## Project layout

```
index.html          app shell
css/app.css         paper-journal design system
js/config.js        your Firebase settings
js/core.js          helpers, dates, toast, sheet, dialogs, location, routing
js/photos.js        EXIF "date taken" reader + photo resizing
js/store.js         Firestore/Storage (cloud) and IndexedDB (this phone only) storage
js/lock.js          PIN lock
js/editor.js        new/edit entry sheet
js/calendar.js      month view (home)
js/day.js           day view + shared entry card
js/search.js        search + filters
js/onthisday.js     On This Day
js/backup.js        zip backup / restore
js/import.js        import photos by date
js/settings.js      settings screen
js/app.js           boot, sign-in, welcome screen
sw.js, manifest.json  PWA bits
firestore.rules, storage.rules, firebase.json, cors.json  Firebase config
```

## Development

```
npx serve .
```

Then open the printed address. Without Firebase settings, the app runs in this phone only mode.

When you ship changes, bump the `?v=` query on the asset tags in `index.html` and `sw.js`, and bump `CACHE_NAME` in `sw.js`, so installed apps pick up the update.
