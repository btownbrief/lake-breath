# Lake Breath

**Burlington breathes together.** A quiet breathing practice on a Lake
Champlain horizon — water rises as you inhale, settles as you exhale — with
the town's evening ritual built in: **The 8:02**, every night at 6:02 PM,
six minutes at six breaths a minute, every phone phase-locked to the same
wall clock.

Live (once deployed): https://play.btownbrief.com/lake-breath/

## What's in it

- **The Lake Breath** — the evidence-backed default: ~6 breaths/min,
  exhale-weighted (in 4, out 6), no holds. Plus **Quick Sigh** (cyclic
  sighing, ~90s reset), **Box**, and **Front Porch** (eyes-open grounding
  for the many people breath-focus doesn't suit).
- **Thumb on the water** — press as the water rises, release as it falls.
  Android paces the breath with gentle vibration; iOS fires a real system
  tick under the finger via a genuine native switch control (the only
  haptic left on iOS web, and honestly the better design anyway).
- **The 8:02** — the nightly town breath with a live neighbor count and a
  shared closing bell. Sync is pure wall-clock math; no server conducts it.
- **The kind-notes wall** — after a session, send one of a curated set of
  good notes to the town ("Beautiful day out there — hope you get
  outside"). Freeform notes and photo spots are designed but wait on the
  approve-to-reveal moderation queue.
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
2. **Backend (one-time):** paste `supabase/lake-breath-2026-08-15.sql`
   into the shared btown-games Supabase project's SQL editor and run.
   Until then the app hides presence, the wall, and town totals.
3. **Catalog:** add an entry to the guide repo's `data/catalog.json` so
   the hub shows it.

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
