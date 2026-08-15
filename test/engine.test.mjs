// Lake Breath engine tests. Run under two TZs in CI (TZ=UTC and
// TZ=America/Los_Angeles) — everything Burlington-facing must not care
// what clock the machine wears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TECHNIQUES, cycleMs, phaseAt, breathLevel,
  nyParts, nyDateStr, nyMonthKey, nyWallToEpoch, nyDayPlus, dailyIndex,
  TOWN, townTimes, townState, townPhaseMs,
  seasonFor, skyPhase,
  freshStats, loadStatsFrom, recordSession, mapleStage, skyStrip,
  presenceId, presenceLine,
  PADDLE_MIN_MS, PADDLE_MAX_MS, paddleOnRhythm, paddleCadence,
  freshPaddle, paddleStroke, freshSteady, steadyStep,
  driftPhrase,
} from '../js/engine.js';

// A fixed reference: 2026-08-15 12:00:00 EDT == 16:00 UTC.
const AUG_NOON = Date.UTC(2026, 7, 15, 16, 0, 0);

// ------------------------------------------------------------ breath math

test('lake cycle is 10s, starts on an inhale', () => {
  assert.equal(cycleMs(TECHNIQUES.lake), 10000);
  assert.equal(phaseAt(TECHNIQUES.lake, 0).k, 'in');
  assert.equal(phaseAt(TECHNIQUES.lake, 3999).k, 'in');
  assert.equal(phaseAt(TECHNIQUES.lake, 4000).k, 'out');
  assert.equal(phaseAt(TECHNIQUES.lake, 9999).k, 'out');
  assert.equal(phaseAt(TECHNIQUES.lake, 10000).k, 'in');
  assert.equal(phaseAt(TECHNIQUES.lake, 10000).cycle, 1);
});

test('breath level rises on inhale, falls on exhale, flat on holds', () => {
  const lake = TECHNIQUES.lake;
  assert.equal(breathLevel(lake, 0), 0);
  assert.ok(breathLevel(lake, 2000) > 0.4);
  assert.ok(breathLevel(lake, 3999) > 0.99);
  assert.ok(breathLevel(lake, 9900) < 0.01);
  const box = TECHNIQUES.box;
  assert.ok(breathLevel(box, 5000) > 0.99, 'hold after inhale stays full');
  assert.ok(breathLevel(box, 13000) < 0.01, 'hold after exhale stays empty');
});

test('sigh second sip tops up past the first inhale', () => {
  const sigh = TECHNIQUES.sigh;
  const afterFirst = breathLevel(sigh, 1599);
  const afterSecond = breathLevel(sigh, 2599);
  assert.ok(afterFirst > 0.7 && afterFirst < 0.8);
  assert.ok(afterSecond > 0.99);
  assert.equal(phaseAt(sigh, 8500).k, 'rest');
  assert.equal(breathLevel(sigh, 8500), 0);
});

// ------------------------------------------------- the doing practices

test('the doing practices are not pacers', () => {
  // Steady and Paddle carry a kind and no segments: anything that tries to
  // pace them (cycleMs, phaseAt) would be a bug, not a fallback.
  assert.equal(TECHNIQUES.still.name, 'Steady');
  assert.equal(TECHNIQUES.still.kind, 'still');
  assert.equal(TECHNIQUES.still.segments, undefined);
  assert.equal(TECHNIQUES.paddle.name, 'Paddle');
  assert.equal(TECHNIQUES.paddle.kind, 'paddle');
  assert.equal(TECHNIQUES.paddle.segments, undefined);
  assert.equal(TECHNIQUES.paddle.cadenceMs, 2000);
  assert.equal(TECHNIQUES.paddle.defaultDuration, 300);
  assert.ok(TECHNIQUES.paddle.durations.includes(600));
});

test('Just Sit is a plain timer with a minute range, not a pacer', () => {
  const t = TECHNIQUES.timer;
  assert.equal(t.name, 'Just Sit');
  assert.equal(t.kind, 'timer');
  assert.equal(t.segments, undefined);
  assert.equal(t.steps, undefined);
  assert.equal(t.durations, undefined);   // the dial replaces preset buttons
  assert.equal(t.minMinutes, 1);
  assert.equal(t.maxMinutes, 20);
  assert.equal(t.defaultDuration, 600);
  assert.ok(t.defaultDuration / 60 >= t.minMinutes && t.defaultDuration / 60 <= t.maxMinutes);
  // Picker order, everywhere it appears: the daily practice, then Paddle
  // (the easiest way in for anyone who bounces off watching the breath),
  // then the plain timer, then the rest.
  assert.deepEqual(Object.keys(TECHNIQUES),
    ['lake', 'paddle', 'timer', 'sigh', 'box', 'still', 'porch']);
});

test('a tap is on rhythm within 35% of the cadence, either side', () => {
  assert.equal(paddleOnRhythm(2000, 2000), true);
  assert.equal(paddleOnRhythm(1300, 2000), true);   // exactly -35%
  assert.equal(paddleOnRhythm(2700, 2000), true);   // exactly +35%
  assert.equal(paddleOnRhythm(1299, 2000), false);
  assert.equal(paddleOnRhythm(2701, 2000), false);
});

test('the paddler sets their own cadence, inside human limits', () => {
  assert.equal(paddleCadence(null, 1500), 1500);          // their first gap
  assert.equal(paddleCadence(null, 300), PADDLE_MIN_MS);  // too fast to be paddling
  assert.equal(paddleCadence(null, 9000), PADDLE_MAX_MS); // too slow to be a rhythm
  // on-rhythm gaps drift the base slowly; off-rhythm ones leave it alone
  assert.equal(paddleCadence(1500, 1600), 1520);
  assert.equal(paddleCadence(1500, 4000), 1500);
});

// A whole session of taps, judged as they land. gaps[0] is the gap between
// tap 1 and tap 2, so n gaps means n+1 taps.
function paddleSession(gaps) {
  let s = paddleStroke(freshPaddle(), null);
  for (const g of gaps) s = paddleStroke(s, g);
  return s;
}

test('paddle counts strokes, runs and drifts as they land', () => {
  const t = paddleSession([2000, 2100, 1900, 5000, 2000, 2000]);
  assert.equal(t.strokes, 7);
  assert.equal(t.judgedGaps, 6);
  assert.equal(t.onRhythm, 5);   // the 5000ms wander is the only miss
  assert.equal(t.longestRun, 3);
  assert.equal(t.drifts, 1);
  // a gap that misses the window but isn't a wander is not a drift
  assert.equal(paddleSession([2000, 2900]).drifts, 0);
  assert.equal(paddleSession([2000, 3700]).drifts, 1);
  // no taps at all is nothing at all
  assert.deepEqual(freshPaddle(),
    { strokes: 0, judgedGaps: 0, onRhythm: 0, run: 0, longestRun: 0, drifts: 0, cadence: null });
});

test('four perfect taps read as fully on rhythm, not as a miss', () => {
  // Three gaps, not four: the denominator is judged GAPS. Reporting
  // "3 of 4 strokes" would invent a miss that never happened.
  const t = paddleSession([2000, 2000, 2000]);
  assert.equal(t.strokes, 4);
  assert.equal(t.judgedGaps, 3);
  assert.equal(t.onRhythm, 3);
  assert.equal(t.longestRun, 3);
  assert.equal(t.drifts, 0);
  // the opening gap is what SETS the tempo, so it cannot be off it
  const one = paddleSession([3200]);
  assert.equal(one.judgedGaps, 1);
  assert.equal(one.onRhythm, 1);
});

test('a gradual tempo change stays on rhythm the whole way down', () => {
  // Somebody slowing from 1.6s to about 2.6s a stroke, a few percent at a
  // time. Every gap is on rhythm against the cadence current at that
  // moment; re-tallying at the end against the final cadence would go back
  // and call the opening strokes wrong.
  const gaps = [];
  let gap = 1600;
  for (let i = 0; i < 20; i++) { gaps.push(Math.round(gap)); gap *= 1.026; }
  const t = paddleSession(gaps);
  assert.equal(t.judgedGaps, gaps.length);
  assert.equal(t.onRhythm, gaps.length, 'a slow drift is still their rhythm');
  assert.equal(t.drifts, 0);
  assert.ok(t.cadence > 1600 && t.cadence < 2700, 'the cadence followed them');
});

// Steady, driven a tick at a time the way the frame loop drives it.
function steadyRun(state, seconds, tick) {
  let s = state;
  const dt = 0.05;
  for (let t = 0; t < seconds; t += dt) s = steadyStep(s, { ...tick, dt });
  return s;
}

test('an upright phone earns no centered time and no drifts', () => {
  // Standing on a table the tilt fades to zero, so the bubble reads dead
  // centre. Without the flatness gate that is a perfect session.
  const s = steadyRun(freshSteady(), 60, { inRing: true, flat: 0.05, churn: 0.02 });
  assert.equal(s.centeredSec, 0, 'flat-enough is part of being home');
  assert.equal(s.drifts, 0, 'and a tipped-up phone is not scolded either');
  // held properly flat and calm, the same minute counts
  const home = steadyRun(freshSteady(), 60, { inRing: true, flat: 0.9, churn: 0.02 });
  assert.ok(home.centeredSec >= 59.9 && home.centeredSec <= 60.1);
});

test('churn stops centered time even with the bubble in the ring', () => {
  const s = steadyRun(freshSteady(), 10, { inRing: true, flat: 0.9, churn: 0.4 });
  assert.equal(s.centeredSec, 0, 'shaking is not settled');
});

test('one sustained pickup is one drift, not several', () => {
  let s = steadyRun(freshSteady(), 3, { inRing: true, flat: 0.9, churn: 0.02 });
  s = steadyRun(s, 12, { inRing: false, flat: 0.2, churn: 0.8 }); // picked up
  assert.equal(s.drifts, 1, 'twelve seconds in the hand is one departure');
  // put it back down and leave again: that one is a second drift
  s = steadyRun(s, 5, { inRing: true, flat: 0.9, churn: 0.02 });
  s = steadyRun(s, 4, { inRing: false, flat: 0.9, churn: 0.1 });
  assert.equal(s.drifts, 2);
});

test('a brief wobble out of the ring counts nothing', () => {
  let s = steadyRun(freshSteady(), 5, { inRing: true, flat: 0.9, churn: 0.02 });
  for (let i = 0; i < 6; i++) {
    s = steadyRun(s, 0.8, { inRing: false, flat: 0.9, churn: 0.1 }); // under a second
    s = steadyRun(s, 2, { inRing: true, flat: 0.9, churn: 0.02 });
  }
  assert.equal(s.drifts, 0, 'hovering on the line is not a score');
  assert.ok(s.centeredSec > 16, 'and the time at home still counts');
});

test('drift copy counts plainly and never scolds', () => {
  assert.equal(driftPhrase(0), 'It never drifted.');
  assert.equal(driftPhrase(1), 'It drifted once.');
  assert.equal(driftPhrase(2), 'It drifted twice.');
  assert.equal(driftPhrase(5), 'It drifted 5 times.');
});

// -------------------------------------------------------- Burlington time

test('nyParts reads Burlington wall clock regardless of host TZ', () => {
  const p = nyParts(AUG_NOON);
  assert.deepEqual(
    [p.year, p.month, p.day, p.hour, p.minute],
    [2026, 8, 15, 12, 0],
  );
});

test('month key flips at NY midnight, not UTC midnight', () => {
  // 2026-08-31 23:30 EDT == 2026-09-01 03:30 UTC: still August in Vermont.
  const lateAug = Date.UTC(2026, 8, 1, 3, 30);
  assert.equal(nyMonthKey(lateAug), '2026-08');
  assert.equal(nyDateStr(lateAug), '2026-08-31');
  // Half an hour later it's September everywhere in Vermont.
  assert.equal(nyMonthKey(lateAug + 3600000), '2026-09');
});

test('nyWallToEpoch round-trips in both EST and EDT', () => {
  const july = nyWallToEpoch(2026, 7, 4, 18, 2);   // EDT
  const jan = nyWallToEpoch(2026, 1, 4, 18, 2);    // EST
  assert.equal(nyParts(july).hour, 18);
  assert.equal(nyParts(july).minute, 2);
  assert.equal(nyParts(jan).hour, 18);
  assert.equal(jan - Date.UTC(2026, 0, 4, 23, 2), 0); // EST = UTC-5
});

test('tomorrow is a NY calendar day, not 86,400,000 milliseconds', () => {
  // 11:30 PM on 2026-03-07 EST, the night before the clocks spring
  // forward. Adding 24 hours of elapsed time lands at 12:30 AM on the 9th
  // in NY and skips the 8th entirely.
  const springEve = Date.UTC(2026, 2, 8, 4, 30); // 2026-03-07 23:30 EST
  assert.equal(nyDateStr(springEve), '2026-03-07');
  assert.equal(nyDayPlus(springEve, 1), '2026-03-08');
  assert.equal(nyDateStr(springEve + 86400000), '2026-03-09', 'the bug, for the record');
  // and back the other way, over the same seam
  assert.equal(nyDayPlus(Date.UTC(2026, 2, 8, 16, 0), -1), '2026-03-07');
  // month end, year end, leap day
  assert.equal(nyDayPlus(Date.UTC(2026, 7, 31, 16, 0), 1), '2026-09-01');
  assert.equal(nyDayPlus(Date.UTC(2026, 11, 31, 20, 0), 1), '2027-01-01');
  assert.equal(nyDayPlus(Date.UTC(2028, 1, 28, 16, 0), 1), '2028-02-29');
  // a week out from a fall-back seam, too (2026-11-01 gains an hour)
  assert.equal(nyDayPlus(Date.UTC(2026, 9, 31, 16, 0), 3), '2026-11-03');
});

test('the daily pick is stable all day and rotates with the NY date', () => {
  const morning = nyWallToEpoch(2026, 8, 15, 7, 0);
  const night = nyWallToEpoch(2026, 8, 15, 23, 30);
  assert.equal(dailyIndex(morning, 3), dailyIndex(night, 3));
  assert.equal(dailyIndex(AUG_NOON, 3), dailyIndex(AUG_NOON + 3600000, 3));
  // always in range, and not stuck on one value across a fortnight
  const seen = new Set();
  for (let i = 0; i < 14; i++) {
    const idx = dailyIndex(AUG_NOON + i * 86400000, 3);
    assert.ok(idx >= 0 && idx < 3);
    seen.add(idx);
  }
  assert.ok(seen.size > 1, 'the phrase must actually rotate');
  assert.equal(dailyIndex(AUG_NOON, 0), 0); // no crash on an empty list
});

// --------------------------------------------------------------- the 8:02

test('town window is 8:02 to 8:08 PM Burlington time', () => {
  const t = townTimes(AUG_NOON);
  assert.equal(nyParts(t.start).hour, 20);
  assert.equal(nyParts(t.start).minute, 2);
  assert.equal(t.end - t.start, TOWN.seconds * 1000);
});

test('town states walk idle → lobby → live → done', () => {
  const { start } = townTimes(AUG_NOON);
  assert.equal(townState(start - 3600000).state, 'idle');
  assert.equal(townState(start - 60000).state, 'lobby');
  assert.equal(townState(start + 1000).state, 'live');
  assert.equal(townState(start + TOWN.seconds * 1000 + 1000).state, 'done');
});

test('every phone derives the same town phase from the shared start', () => {
  const { start } = townTimes(AUG_NOON);
  const at = start + 34567;
  assert.equal(townPhaseMs(at), 34567);
  // Joining late still lands mid-cycle in the shared timeline, not at 0.
  assert.equal(phaseAt(TECHNIQUES.lake, townPhaseMs(at)).cycle, 3);
});

test('town start survives DST boundaries', () => {
  // The Sunday US clocks fall back in 2026 is Nov 1.
  for (const [m, d] of [[10, 31], [11, 1], [11, 2], [3, 7], [3, 8], [3, 9]]) {
    const noon = nyWallToEpoch(2026, m, d, 12, 0);
    const t = townTimes(noon);
    assert.equal(nyParts(t.start).hour, 20, `20h on 2026-${m}-${d}`);
    assert.equal(nyParts(t.start).minute, 2);
  }
});

// ----------------------------------------------------------- stats & tree

test('recordSession accumulates and buckets by NY month', () => {
  let s = freshStats();
  s = recordSession(s, AUG_NOON, 300);
  assert.equal(s.totalSec, 300);
  assert.equal(s.monthKey, '2026-08');
  assert.equal(s.daysPracticed, 1);
  // Second session same day: seconds add, days don't.
  s = recordSession(s, AUG_NOON + 3600000, 180);
  assert.equal(s.monthSec, 480);
  assert.equal(s.daysPracticed, 1);
  // New month resets the month bucket, keeps lifetime.
  const sep = Date.UTC(2026, 8, 2, 16, 0);
  s = recordSession(s, sep, 300);
  assert.equal(s.monthKey, '2026-09');
  assert.equal(s.monthSec, 300);
  assert.equal(s.totalSec, 780);
});

test('a midnight-spanning sit credits the day it ends', () => {
  // Ends 12:10 AM Sept 1 in Vermont.
  const endMs = nyWallToEpoch(2026, 9, 1, 0, 10);
  const s = recordSession(freshStats(), endMs, 300);
  assert.equal(s.lastDay, '2026-09-01');
  assert.equal(s.monthKey, '2026-09');
});

test('sits under 30 seconds are not counted', () => {
  const s = recordSession(freshStats(), AUG_NOON, 20);
  assert.equal(s.sessions, 0);
  assert.equal(s.totalSec, 0);
});

test('corrupt stored stats fall back to fresh', () => {
  assert.equal(loadStatsFrom('{"v":9,"weird":true}').sessions, 0);
  assert.equal(loadStatsFrom('not json').sessions, 0);
  const kept = loadStatsFrom(JSON.stringify(recordSession(freshStats(), AUG_NOON, 300)));
  assert.equal(kept.totalSec, 300);
});

test('the maple only grows, full canopy at day 66', () => {
  assert.equal(mapleStage(0).stage, 0);
  assert.equal(mapleStage(1).stage, 1);
  assert.ok(mapleStage(30).stage > mapleStage(10).stage);
  assert.equal(mapleStage(66).grown, true);
  assert.equal(mapleStage(500).stage, mapleStage(66).stage);
  assert.equal(mapleStage(4).daysToNext, 3); // next threshold is day 7
});

test('sky strip is 14 days ending today, practiced days marked', () => {
  let s = freshStats();
  s = recordSession(s, AUG_NOON - 86400000, 300); // yesterday
  s = recordSession(s, AUG_NOON, 300);            // today
  const strip = skyStrip(s, AUG_NOON);
  assert.equal(strip.length, 14);
  assert.equal(strip[13].today, true);
  assert.equal(strip[13].practiced, true);
  assert.equal(strip[12].practiced, true);
  assert.equal(strip[0].practiced, false);
});

test('evening idle points at TOMORROW, never a negative countdown', () => {
  const { end } = townTimes(AUG_NOON);
  const late = end + 3 * 3600000; // ~9:08 PM
  const ts = townState(late);
  assert.equal(ts.state, 'idle');
  assert.ok(ts.msToStart > 0, 'countdown must be positive');
  assert.equal(nyDateStr(ts.start), '2026-08-16');
  assert.equal(nyParts(ts.start).hour, 20);
  assert.equal(nyParts(ts.start).minute, 2);
});

test('a short sit in a new month still rolls the month bucket', () => {
  let s = recordSession(freshStats(), AUG_NOON, 300); // August: 300s
  const sep = Date.UTC(2026, 8, 2, 16, 0);
  s = recordSession(s, sep, 10); // 10s in September: uncounted, but…
  assert.equal(s.monthKey, '2026-09', 'bucket must roll');
  assert.equal(s.monthSec, 0, 'and must not carry August seconds');
  assert.equal(s.totalSec, 300, 'lifetime unchanged by the short sit');
});

test('sky strip walks NY calendar days across DST edges', () => {
  // Late evening on US spring-forward day 2026 (Mar 8): the strip must
  // contain 14 distinct consecutive dates including Mar 8, no dupes.
  const eveningMar8 = nyWallToEpoch(2026, 3, 8, 21, 0);
  const strip = skyStrip(freshStats(), eveningMar8);
  const dates = strip.map((d) => d.day);
  assert.equal(new Set(dates).size, 14, 'no duplicated days');
  assert.equal(dates[13], '2026-03-08');
  assert.equal(dates[0], '2026-02-23');
});

// --------------------------------------------------------------- ambience

test('seasons cover the Vermont year', () => {
  assert.equal(seasonFor(Date.UTC(2026, 0, 15, 17)), 'winter');
  assert.equal(seasonFor(Date.UTC(2026, 3, 10, 16)), 'mud');
  assert.equal(seasonFor(Date.UTC(2026, 6, 15, 16)), 'summer');
  assert.equal(seasonFor(Date.UTC(2026, 9, 5, 16)), 'foliage');
  assert.equal(seasonFor(Date.UTC(2026, 10, 20, 17)), 'stick');
});

test('sky phase: winter 5pm is dusk, winter 7pm is night, summer 5pm is day', () => {
  assert.equal(skyPhase(nyWallToEpoch(2026, 1, 10, 17, 0)), 'dusk');
  assert.equal(skyPhase(nyWallToEpoch(2026, 1, 10, 19, 0)), 'night');
  assert.equal(skyPhase(nyWallToEpoch(2026, 7, 10, 17, 0)), 'day');
});

// --------------------------------------------------------------- presence

test('presence ids rotate daily and stay stable within a day', () => {
  const a = presenceId('player-abc', AUG_NOON);
  const b = presenceId('player-abc', AUG_NOON + 3600000);
  const c = presenceId('player-abc', AUG_NOON + 86400000);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, presenceId('player-xyz', AUG_NOON));
});

test('presence copy is honest at every count', () => {
  assert.equal(presenceLine(0), null);
  assert.equal(presenceLine(1), '1 neighbor is breathing with you');
  assert.equal(presenceLine(7), '7 neighbors are breathing with you');
});
