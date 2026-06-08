# Reset — Home Training

A self-contained, single-file workout tracker for a 4-day Upper/Lower home training plan. No server, no build step, no dependencies beyond Google Fonts.

## Features

- 4-day Upper/Lower split for fat loss (bodyweight + a single 10 kg plate)
- Modern minimalist UI — Inter font, monochrome with a single emerald accent
- Per-set tap-to-complete checkboxes with completion rings
- Optional reps/weight logging per exercise
- Embedded YouTube/Vimeo demo videos (paste in UI or hardcode)
- Rest timer with 45/60/90 s presets, audio beep, and vibrate
- 8-week progression tips built in
- Progress history with session log
- All data stored in `localStorage` on the device

## Deploy on GitHub Pages

1. Push this repo to GitHub (main branch).
2. Go to **Settings → Pages**.
3. Under **Source**, select **Deploy from a branch**, choose `main`, folder `/` (root), and click **Save**.
4. After ~60 seconds your site is live at `https://<username>.github.io/<repo-name>/`.

## Adding demo videos

**In the UI:** Open any session, tap "Add demo video" beneath an exercise, paste a YouTube or Vimeo URL, and press **Embed**. The link is saved to `localStorage`.

**Hardcoded:** In `index.html`, find the `PLAN` array near the top of the `<script>` block. Set the `video` field for any exercise to a full YouTube URL or an 11-character video ID:

```js
{id:"goblet-squat", name:"Goblet Squat", ..., video:"https://youtu.be/XXXXXXXXXXX"}
```
