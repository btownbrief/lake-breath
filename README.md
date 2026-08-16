# Lake Breath

**Burlington breathes together.** A quiet breathing practice on a Lake
Champlain horizon — water rises as you inhale, settles as you exhale — with
the town's evening ritual built in: **The 8:02**, every night at 8:02 PM,
six minutes at six breaths a minute, every phone phase-locked to the same
wall clock.

Live (once deployed): https://play.btownbrief.com/lake-breath/

## What's in it

- **The Lake Breath** — the evidence-backed default: ~6 breaths/min,
  exhale-weighted (in 4, out 6), no holds. Plus **Quick Sigh** (cyclic
  sighing, ~90s reset), **Box**, and **Front Porch** (eyes-open grounding
  for the many people breath-focus doesn't suit).
- **A living lake** — a WebGL shader scene (real moving water, sun/moon
  glitter path, stars, Adirondack ridges) that follows Burlington's actual
  clock and season, swells with the breath, and ripples where you touch it.
  The hero object is **the bloom**: six translucent petals on the water
  that open with the inhale and settle on the long exhale; at session end
  they release and drift out over the water as a synthesized bowl rings.
- **Steady** — an accelerometer layer in every session by default. Hold the
  phone flat or upright and keep the light centered; the receipt reports
  movement as a plain fact. It silently disappears without a sensor and
  can be turned off for a session.
- **Generative sound, zero assets** — a synthesized lake (rumble, swell,
  laps), a time-of-day pad, generated reverb, breath cues, a bowl, and the
  occasional distant loon at night. Android also gets vibration pacing;
  iOS fires a real system tick per finger tap via a native switch control
  (the only haptic left on iOS web).
- **The 8:02** — the nightly town breath with a live neighbor count and a
  shared closing bell. Sync is pure wall-clock math; no server conducts it.
- **The kind-notes wall** — after a session, write your own short note to
  the town. Every note is held unapproved until a human reads it in the
  moderation queue, then it sits on the wall for 48 hours. The old preset
  lines survive only as the placeholder examples in the note box.
- **The local layer** — the sky itself is tomorrow's Burlington forecast:
  clearly warmer red or colder blue, with rain, snow, and clear-weather
  motion. Upcoming anchors breathe as an emblem in the clouds, never event
  text. Both forecast color and the emblem have quiet persisted toggles.
  One good neighborhood link can still appear on the end screen.
- **Your maple** — a tree on your shore that only ever grows, reaching
  full canopy around day 66 of practice (the honest habit-formation
  number). No streaks, no flames, nothing to break.
- **Field Notes** — the science, told straight: what slow breathing does,
  what the 400-person placebo trial found, why "vagus nerve activation"
  is oversold, what to do when breathing exercises feel bad.
- **The Community Exhale** — Burlington's quiet minutes this month, summed
  across everyone, shown on Your Shore. No individual ranking anywhere.

## Setup

1. **Deploy:** push to `main` — GitHub Pages serves the repo root at
   `play.btownbrief.com/lake-breath/`. No build step.
2. **Backend (one-time):** open `supabase/lake-breath-2026-08-15.sql`.
   Pick a long random moderator secret, run
   `select extensions.crypt('your-secret', extensions.gen_salt('bf'));`
   in the SQL editor, and **paste the resulting `$2a$…` hash into
   `lb_mod_hash()`** (the plaintext secret never goes in the file). Then
   paste the whole file into the shared btown-games Supabase project's SQL
   editor and run. Until then the app hides presence, the wall, and town
   totals. While the placeholder hash is still in place the moderation
   gate fails closed and no secret opens the queue.
3. **Moderating notes:** open `/lake-breath/mod.html` (linked from nowhere
   in the app, not cached by the service worker), paste the plaintext
   secret, and approve or remove what's waiting. The page keeps it in
   sessionStorage only, and there's a "forget the secret" link; closing
   the tab forgets it too. Approved notes appear on the town wall for 48
   hours from approval; nothing reaches the wall unread.
4. **Note:** the shared arcade nav.js is deliberately omitted — a
   meditation scene is a sanctuary, not a portal; a quiet link to the
   arcade lives on the Your Shore sheet instead.
5. **Catalog:** add an entry to the guide repo's `data/catalog.json` so
   the hub shows it.

## The local layer

`js/town.js` reads five small static JSON files from
`guide.btownbrief.com/data/` with plain GETs: `weather/latest.json` (NWS
periods), `weather/read.json` (a written one-liner per day),
`events/rail.json` (per-day event counts and picks), `calendar.json` (the
hand-kept annual anchors), and `goodburlington-queue.json` (good
neighborhood links, often empty). Everything is cached in localStorage for
60 minutes, refreshed in the background hourly while the tab is visible and
whenever a hidden tab comes back older than 30 minutes, and every getter
returns cached-or-null so a 404, an offline phone, or blocked storage just
hides a line. `?townfix=1` (upcoming anchor), `?townfix=2` (no anchor, rail
marquee) and `?townfix=3` (a jester-keyword anchor) serve baked fixtures
and never touch the network.

## Verify

    TZ=UTC node --test test/engine.test.mjs
    TZ=America/Los_Angeles node --test test/engine.test.mjs
    for f in js/*.js sw.js scripts/*.mjs; do node --check "$f"; done

Manual device pass (the fleet's Playwright can't feel haptics): on an
actual iPhone check the switch tick, silent-switch audio behavior, and
Home Screen mode; on Android check vibration pacing.

## The science, in one paragraph

Slow, exhale-weighted breathing reliably blunts the body's acute stress
response, with honest effect sizes that are modest (g ≈ 0.2–0.3 across
meta-analyses) and benefits that build over ~4 weeks of short daily
practice. A large placebo-controlled trial showed the ritual and
expectation carry much of the felt benefit — which open-label placebo
research says survives being known, so we say it out loud. Synchronized
group activity measurably increases connection; anchoring practice to an
existing routine is the best-evidenced retention lever; and ranked
leaderboards/streak-guilt measurably backfire for exactly this kind of
app, which is why there aren't any.
