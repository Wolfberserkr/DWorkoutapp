# Reset — Home Training

A personal workout tracker for a 4-day Upper/Lower home training plan, designed for long-term fat loss with bodyweight and one of two plates (5 kg or 10 kg — used one at a time, never combined).

Buildless: vanilla HTML/CSS/JS, ES modules over `<script type="module">`. Storage is Supabase with a localStorage cache so the app works offline and syncs back when online.

## Features

- 4-day Upper/Lower split, **5 kg or 10 kg plate** (single plate only)
- **Injury cues**: amber "BACK" chips on RDL / Bulgarian Split Squat / Superman; red "ELBOW" chips on Plate Curl / Front Raise / Overhead Triceps. Exercises stay in the plan — the chip is a heads-up to be careful with form, range, and load.
- **Exercise swap**: tap ⇄ on any exercise card to pick a safer or different alternative (2–3 per exercise).
- **Session completion screen**: stats + a direct, no-nonsense one-liner after every finished workout.
- **Progress page** — the heart of the app:
  - Weekly weigh-in with inline SVG trend chart
  - Personal records (heaviest weight × reps) per exercise
  - At-a-glance counters (total sessions, this week, active days)
  - **Calendar view** — month grid, tap any training day to see the full session detail (every exercise, sets done, reps and weight logged)
  - Past sessions list
- **Daily nutrition check-in**: Great / Okay / Struggled / Skipped + optional note. Editable per day, last 7 shown below.
- Per-set tap-to-complete checkboxes with completion rings
- Embedded YouTube/Vimeo demo videos (hardcoded or pasted)
- Floating rest timer (45 / 60 / 90 s) with audio + vibration
- 8-week progression tips built in
- **Direct, no-nonsense tone** throughout
- No jumping or high-impact exercises

## File layout

```
index.html         shell only (markup + CSS link + module script)
style.css          all styles
data.js            PLAN, INJURY_FLAGS, SWAPS, WARMUP, COOLDOWN, WEEK_TIPS, FINISH_MSGS
db.js              Firebase Firestore client + cache-first sync + pending-ops queue
app.js             rendering, state, event handlers
firestore.rules    Firestore security rules (paste into Firebase console → Firestore → Rules)
```

## Firebase setup

The app uses **Firebase Firestore** for storage (free Spark plan is plenty for personal use). No login screen — a hard-coded `USER_ID` UUID controls access via Firestore rules.

### Steps

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (or pick an existing one).
2. In your project: **Build → Firestore Database → Create database** → choose a region → start in **production mode**.
3. **Deploy the security rules**:
   - Open **Firestore → Rules** in the console.
   - Replace the default content with the contents of `firestore.rules` in this repo.
   - Click **Publish**.
4. **Get your web app config**:
   - **Project settings** (gear icon) → **Your apps** → **Add app** → Web.
   - Copy the `firebaseConfig` object.
   - Paste it into `db.js` inside the `FIREBASE_CONFIG = { … }` block.
5. Reload the app. Writes go to Firestore; reads hit localStorage first and reconcile from the cloud in the background.

If you leave `FIREBASE_CONFIG.projectId` empty the app falls back to **localStorage-only** mode silently.

### Changing the USER_ID

If you want a different UUID, replace `a1f0c8d2-3b4e-4f5a-9c0d-1e2f3a4b5c6d` in **both** `db.js` (the `USER_ID` constant) and `firestore.rules` (the `userId ==` check), then re-publish the rules.

## Offline behavior

- Writes apply optimistically to the local cache, then push to Supabase.
- If a push fails (offline), the op is queued in `localStorage` under `reset_pending_ops_v1` and retried on next boot and on the `online` event.
- Reads always hit the local cache first, so the UI is instant.

## Deploy on GitHub Pages

1. Push to `main`.
2. **Settings → Pages → Source: Deploy from a branch → main / root → Save**.
3. Live at `https://<username>.github.io/<repo-name>/` in ~60 seconds.

Supabase is reachable from any origin via the anon key.

## Adding demo videos

- **In the UI**: open any session, tap "Add demo video" beneath an exercise, paste a YouTube or Vimeo URL, press Save.
- **Hardcoded**: edit the `video` field on any exercise inside `data.js`.

## Equipment

- 5 kg bumper plate
- 10 kg bumper plate
- Sturdy chair (Bulgarian split squat, single-arm row)
- A wall (wall sit) and a sturdy table (inverted row)

Only one plate is held at a time — there are no combined-plate loads.
