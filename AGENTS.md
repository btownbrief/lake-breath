# Lake Breath — agent notes

A breathing practice on a Lake Champlain horizon. Water rises on the
inhale, settles on the exhale. Every evening at 8:02 PM Burlington time,
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
  so. **One deliberate exception, per Stephen's call:** the doing
  practices (Steady, Paddle) show a gentle last-session comparison and a
  best that only ever grows. He asked for those. They stay, they stay
  phrased as plain facts, and they are never framed as failure, a target
  to beat, or a thing you lost.
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

## v2 architecture notes

- The scene is `js/scene-gl.js`: raw WebGL2, one fullscreen quad, one
  fragment shader — no three.js, no build step. Palette math happens in
  JS per frame (time-of-day phases blended, season tints). If the shader
  changes, screenshot dawn/day/golden/night before shipping (Playwright
  + fake clock; see the session scratchpad's verify-v2 pattern).
- `js/bloom.js` is the hero object (petals + release moment + the maple
  silhouette) on a 2D canvas above the WebGL canvas. Apple-flower
  grammar: petals translate apart while the group scales and rotates —
  never a single symmetric tween.
- `js/sound.js` is fully generative (no audio assets). Sound is ON by
  default; the toggle lives in the top links.
- `js/stillness.js` = Still Water (accelerometer). iOS needs the
  permission call from a user gesture; feature-hidden elsewhere.
- The shared arcade `nav.js` is deliberately NOT included (sanctuary
  choice, documented in README). Don't re-add it without Stephen.
- Fraunces is used with `font-variation-settings: 'SOFT' 100, 'WONK' 0`
  everywhere — the wonk axis stays off; this is a calm serif, not a
  quirky one.

## v3 notes: the local layer

- **`js/town.js` is the only file that talks to Burlington.** Five static
  JSON feeds off `guide.btownbrief.com/data/` (weather latest + read,
  events rail, calendar anchors, the GoodBurlington queue), plain GETs, no
  headers. Budget: one `Promise.allSettled` per refresh, localStorage TTL
  60 min, hourly while visible plus a catch-up when a hidden tab returns
  older than 30 min. Every getter is synchronous and returns
  cached-or-null; nothing in the UI may assume data exists.
- **Accent doctrine: never louder than the scene.** The two home lines are
  small, dim sans and hide entirely without data. The palette tint is
  capped at 6% on the sun and low sky (4% grey for a wet tomorrow) and is
  meant to be felt, not seen — if you can name the colour change, it's a
  bug. The shore pennants are a few pixels of gold beside the maple and
  dim with the maple at night. `anchorEvent()` is strictly forward-looking:
  the next calendar anchor inside 7 days, never anything past. The
  `'fools'` jester styling is a keyword match that lights itself up when
  Festival of Fools comes back around; gold pennants are the common case.
- **Notes are freeform and moderated.** The client only calls
  `lb_send_text`; every note lands `approved=false`. Approval happens in
  `mod.html` (linked nowhere, not in the service worker's SHELL) against
  `lb_mod_hash()`, a bcrypt hash Stephen pastes into the SQL before
  running it (the plaintext secret never enters the repo, and the gate
  fails closed while the placeholder is there). mod.html keeps the
  working secret in sessionStorage only. Wall age runs off `approved_at`,
  never `created_at` — moving `created_at` would reset the sender's rate
  limit. Wall rendering stays `textContent`, forever.
- **The doing practices account for themselves in the engine.** Steady's
  centered time and drift episodes are `steadyStep()`; Paddle judges each
  gap as it lands with `paddleStroke()`, against the cadence current at
  that moment, and reports `onRhythm` out of `judgedGaps` (n taps, n-1
  gaps). Never re-tally a finished session against its final cadence:
  somebody who slowed down gradually was on rhythm the whole way.
- **Just Sit is the plain timer** (`kind: 'timer'`): no phase words, no
  cues, bloom in idle presence, and the only ending in the app that uses
  `sound.gong()` instead of the bowl. Its length comes off the minute dial
  and lives in `localStorage['lakebreath-sit-mins']`, not in stats.

## Layout

- `js/engine.js` — pure logic (breath math, NY time, the 8:02, maple, stats)
- `js/content.js` — every user-facing word that isn't markup
- `js/app.js` — DOM controller, session loop, wiring
- `js/sound.js` — generative soundscape + cues + bowl (Web Audio, zero assets)
- `js/scene-gl.js` / `js/bloom.js` / `js/stillness.js` — see v2 notes above
- `js/haptics.js` — tiered: Android vibrate / iOS native-switch tick / none
- `js/net.js` — presence, kind-notes wall, town minutes, score submission
- `js/town.js` — the Burlington feeds (weather, events, anchors, good news)
- `mod.html` — the note queue, secret-gated, linked from nowhere
- `supabase/` — SQL to paste (safe to re-run)
- `scripts/make-icons.mjs` — regenerates the PNG icons, no dependencies

## Verify

    TZ=UTC node --test test/engine.test.mjs
    TZ=America/Los_Angeles node --test test/engine.test.mjs
    for f in js/*.js sw.js scripts/*.mjs; do node --check "$f"; done
    python3 -m http.server 8080   # then open http://localhost:8080
