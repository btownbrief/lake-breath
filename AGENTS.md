# Lake Breath — agent notes

A breathing practice on a Lake Champlain horizon. Water rises on the
inhale, settles on the exhale. Every evening at 6:02 PM Burlington time,
"The 8:02" — six minutes, six breaths a minute, the whole town phase-locked
to the same wall clock.

## Rules that will trip you up

- **`js/engine.js` is pure and that purity is the contract.** No DOM, no
  fetch, no `Date.now()` inside it — time comes in as arguments. Every
  behavior change needs a test in `test/engine.test.mjs`, and CI runs the
  suite under `TZ=UTC` and `TZ=America/Los_Angeles`. All product time is
  `America/New_York` (matches the leaderboard SQL's month bucketing).
- **`js/leaderboard.js` is a vendored fleet file.** Only line 14 (`GAME`)
  may differ from maple-scramble's copy. Fix bugs upstream, re-vendor.
- **The score is cumulative seconds, not a high score.** Each device
  submits its total completed seconds this NY month; that's monotonic, so
  the backend's best-per-month `greatest()` stores it correctly. Never
  submit per-session values. The town total (`lb_town_seconds`) sums
  those rows with a per-player cap.
- **No dark patterns, ever.** No streaks, no ranks, no guilt copy, no
  scarcity. The maple only grows; missed days are just sky. If a mechanic
  would make a stressed person feel worse at 11pm, it doesn't ship. Field
  Notes tone is calibrated and honest — effect sizes are small and we say
  so.
- **Note presets are append-only.** `NOTE_PRESETS` ids are validated
  server-side against `lb_note_preset_max()`; bump that function in a new
  SQL migration when appending. Never renumber or delete.
- **iOS haptics are an experiment, not a dependency.** Timed vibration
  does not exist on iOS web (26.5 killed the scripted switch hack). The
  native-switch tick fires only on a real finger toggle. The practice must
  stay complete with visuals + audio alone.
- **Sessions are foreground-only.** `visibilitychange` ends the session
  honestly with partial credit (min 30s to count). Don't "fix" this by
  counting hidden time.
- **Supabase SQL** lives in `supabase/lake-breath-2026-08-15.sql` and must
  be pasted into the shared btown-games project by Stephen. Until then,
  presence, the wall, and town totals hide themselves (`not_ready`
  philosophy — never an error state).

## Layout

- `js/engine.js` — pure logic (breath math, NY time, the 8:02, maple, stats)
- `js/content.js` — every user-facing word that isn't markup
- `js/app.js` — DOM controller, session loop, wiring
- `js/audio.js` — synthesized swells + bell (Web Audio, zero assets)
- `js/haptics.js` — tiered: Android vibrate / iOS native-switch tick / none
- `js/net.js` — presence, kind-notes wall, town minutes, score submission
- `supabase/` — SQL to paste (safe to re-run)
- `scripts/make-icons.mjs` — regenerates the PNG icons, no dependencies

## Verify

    TZ=UTC node --test test/engine.test.mjs
    TZ=America/Los_Angeles node --test test/engine.test.mjs
    for f in js/*.js sw.js scripts/*.mjs; do node --check "$f"; done
    python3 -m http.server 8080   # then open http://localhost:8080
