// Lake Breath — pure engine. No DOM, no fetch, no Date.now() of its own:
// every function takes time in and returns state out, so the whole file
// runs under node --test (see test/engine.test.mjs). This purity is the
// contract; keep side effects in app.js.

// ------------------------------------------------------------ techniques

// A technique is a repeating cycle of segments. k: 'in' | 'hold' | 'out'.
// Lake Breath is the evidence-backed default: ~6 breaths/min, exhale-
// weighted, no holds (holds are the part that spooks panic-prone folks).
export const TECHNIQUES = {
  lake: {
    name: 'Lake Breath',
    tag: 'the daily practice',
    segments: [{ k: 'in', s: 4 }, { k: 'out', s: 6 }],
    durations: [180, 300, 600],
    defaultDuration: 300,
  },
  paddle: {
    name: 'Paddle',
    tag: 'a steady rhythm, like strokes on the lake',
    // Also not a pacer: the user sets the tempo by tapping. Each tap is a
    // stroke; the app only watches how even the strokes are, and never
    // scolds a missed one. Second in the list on purpose: it is the
    // easiest way in for anyone who bounces off watching the breath.
    kind: 'paddle',
    cadenceMs: 2000,
    durations: [180, 300, 600],
    defaultDuration: 300,
  },
  timer: {
    name: 'Just Sit',
    tag: 'the lake keeps time',
    // The classic timer, and the simplest way in: pick a length, sit
    // however you like, and a slow gong marks the end. No pacing, no
    // phase words, no cues. Length comes off a minute dial, not preset
    // buttons, so there is no "right" answer offered.
    kind: 'timer',
    minMinutes: 1,
    maxMinutes: 20,
    defaultDuration: 600,
  },
  sigh: {
    name: 'Quick Sigh',
    tag: 'fast reset',
    // Cyclic sighing: two stacked inhales, one long exhale, a beat of rest.
    segments: [
      { k: 'in', s: 1.6 }, { k: 'in2', s: 1.0 },
      { k: 'out', s: 5.4 }, { k: 'rest', s: 2.0 },
    ],
    durations: [90, 180],
    defaultDuration: 90,
  },
  box: {
    name: 'Box',
    tag: 'four square sides',
    segments: [
      { k: 'in', s: 4 }, { k: 'hold', s: 4 },
      { k: 'out', s: 4 }, { k: 'hold', s: 4 },
    ],
    durations: [180, 300, 600],
    defaultDuration: 300,
  },
  still: {
    name: 'Steady',
    tag: 'phone still, light home',
    // Not a pacer: a spirit level. Hold the phone flat or upright and a
    // luminous bubble drifts with every tilt; the practice is
    // keeping it inside the ring while your thoughts go wherever they
    // want. Needs DeviceMotion; hidden where unsupported.
    kind: 'still',
    durations: [180, 300],
    defaultDuration: 180,
  },
  porch: {
    name: 'Front Porch',
    tag: 'eyes open, no breath counting',
    // Not a breath pacer: a grounding sequence. Each step holds ~40s.
    steps: [
      'Find the farthest sound you can hear.',
      'Now the nearest one.',
      'Feel where your body touches the chair, the step, the ground.',
      'Find the farthest thing you can see.',
      'Watch one thing that’s moving: leaves, water, clouds.',
      'Let your breath do whatever it wants.',
    ],
    stepSeconds: 40,
    durations: [240],
    defaultDuration: 240,
  },
};

// Every practice uses the same minute wheel. Technique defaults still set
// the first value, but no practice owns or locks its duration.
export const PRACTICE_MINUTES = { min: 1, max: 20 };

export function minutesFor(tech, saved) {
  const fallback = Math.round((tech?.defaultDuration || 60) / 60);
  const parsed = Number.parseInt(saved, 10);
  const mins = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(PRACTICE_MINUTES.max, Math.max(PRACTICE_MINUTES.min, mins));
}

export function cycleMs(tech) {
  return tech.segments.reduce((a, s) => a + s.s, 0) * 1000;
}

// Where in the breath are we, t ms into a session? Sessions always start
// at the top of an inhale (t = 0 is segment 0).
export function phaseAt(tech, tMs) {
  const cyc = cycleMs(tech);
  const into = ((tMs % cyc) + cyc) % cyc;
  let acc = 0;
  for (let i = 0; i < tech.segments.length; i++) {
    const seg = tech.segments[i];
    const segMs = seg.s * 1000;
    if (into < acc + segMs) {
      return {
        k: seg.k,
        i,
        progress: (into - acc) / segMs,
        cycle: Math.floor(tMs / cyc),
      };
    }
    acc += segMs;
  }
  return { k: tech.segments[0].k, i: 0, progress: 0, cycle: Math.floor(tMs / cyc) };
}

// 0 → 1 "fullness" of the breath (how high the water sits) at t ms.
// Inhale ramps up, holds stay flat, exhale ramps down, rest stays empty.
// in2 (the sigh's second sip) tops up the last stretch.
export function breathLevel(tech, tMs) {
  const p = phaseAt(tech, tMs);
  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x); // gentle s-curve
  if (p.k === 'in') return ease(p.progress) * (tech.segments[p.i + 1]?.k === 'in2' ? 0.75 : 1);
  if (p.k === 'in2') return 0.75 + ease(p.progress) * 0.25;
  if (p.k === 'hold') {
    // flat at whatever the previous segment ended on
    const prev = tech.segments[(p.i + tech.segments.length - 1) % tech.segments.length];
    return (prev.k === 'in' || prev.k === 'in2') ? 1 : 0;
  }
  if (p.k === 'out') return 1 - ease(p.progress);
  return 0; // rest
}

// ------------------------------------------------------------- paddling

// Paddle watches the gaps between taps, never the taps themselves. A
// human paddling on the lake lands somewhere between a stroke a second
// and a stroke every few seconds, so that's the range we'll accept as
// somebody's own tempo.
export const PADDLE_MIN_MS = 800;
export const PADDLE_MAX_MS = 3500;

const clampCadence = (ms) => Math.min(PADDLE_MAX_MS, Math.max(PADDLE_MIN_MS, ms));

// On rhythm = within 35% of the cadence either side. Generous on purpose:
// this is a meditation, not a metronome test.
export function paddleOnRhythm(gap, cadenceMs) {
  return gap >= cadenceMs * 0.65 && gap <= cadenceMs * 1.35;
}

// The user's own tempo, learned from their first strokes and then drifting
// slowly toward whatever they settle into. cadenceMs null = not set yet.
export function paddleCadence(cadenceMs, gap) {
  if (cadenceMs == null) return clampCadence(gap);
  if (!paddleOnRhythm(gap, cadenceMs)) return cadenceMs;
  return clampCadence(cadenceMs + (gap - cadenceMs) * 0.2);
}

// Paddle is judged ONLINE, stroke by stroke, against the cadence that was
// current at that moment — never re-tallied at the end against whatever
// tempo the session drifted into. Somebody who slows down gradually is
// paddling perfectly well the whole way down, and a final-cadence rewrite
// would go back and call those early strokes wrong.
//
// n taps produce n-1 judged gaps. The first gap is what SETS the tempo, so
// it is on rhythm by definition: you cannot miss a beat you just invented.
export function freshPaddle() {
  return {
    strokes: 0,      // taps
    judgedGaps: 0,   // gaps judged (strokes - 1, once there are any)
    onRhythm: 0,
    run: 0, longestRun: 0,
    drifts: 0,
    cadence: null,   // their own tempo, learned and slowly drifting
  };
}

// One tap. gapMs is the ms since the previous tap, or null for the first
// tap of the session. Pure: returns a new state.
export function paddleStroke(state, gapMs) {
  const s = { ...state };
  s.strokes += 1;
  if (gapMs == null) return s;
  const cadence = s.cadence;
  s.judgedGaps += 1;
  const on = cadence == null ? true : paddleOnRhythm(gapMs, cadence);
  if (on) {
    s.onRhythm += 1;
    s.run += 1;
    if (s.run > s.longestRun) s.longestRun = s.run;
  } else {
    s.run = 0;
    // a gap long enough that attention clearly went somewhere else
    if (gapMs > cadence * 1.8) s.drifts += 1;
  }
  s.cadence = paddleCadence(cadence, gapMs);
  return s;
}

// ---------------------------------------------------------------- steady

// Steady's accounting, as a pure state machine so it can be tested without
// a phone. Per tick it takes what the sensor says right now:
//   inRing — is the bubble inside the ring
//   flat   — 0..1, confidence in the auto-picked flat or upright pose
//   churn  — 0..1 smoothed motion
//   dt     — seconds since the last tick
//
// Centered ("home") time needs all three: bubble home, a valid calibrated
// pose, and the lake calm. Without the pose gate a device with no useful
// orientation reading would earn a perfect session at zero.
//
// Drifts are episodes, not samples: one departure or one pickup is one
// drift however long it lasts, it only counts once it has lasted a second,
// and the count can't advance again until the phone comes properly home.
export const STEADY_FLAT_MIN = 0.5;    // below this the bubble means nothing
export const STEADY_CALM_MAX = 0.35;   // churn above this is not "settled"
export const STEADY_PICKUP = 0.5;      // churn above this is a pickup
export const STEADY_AWAY_SEC = 1;      // an away has to last a second

export function freshSteady() {
  return { centeredSec: 0, drifts: 0, awaySec: 0, awayCounted: false };
}

export function steadyStep(state, { inRing, flat, churn, dt }) {
  const s = { ...state };
  const step = Math.max(0, Math.min(0.25, dt || 0));
  const home = inRing && flat > STEADY_FLAT_MIN && churn < STEADY_CALM_MAX;
  const away = !inRing || churn > STEADY_PICKUP;
  if (home) {
    s.centeredSec += step;
    s.awaySec = 0;
    s.awayCounted = false;
  } else if (away) {
    s.awaySec += step;
    if (!s.awayCounted && s.awaySec > STEADY_AWAY_SEC) {
      s.drifts += 1;
      s.awayCounted = true;
    }
  }
  // Neither home nor away (a phone tipped up, or settling after a pickup)
  // earns nothing and costs nothing. Silence is a fair answer.
  return s;
}

// Shared receipt line for the two attention practices. Counting is fine;
// scolding is not, so zero reads as a plain fact, never as praise withheld.
export function driftPhrase(n) {
  if (!n) return 'It never drifted.';
  if (n === 1) return 'It drifted once.';
  if (n === 2) return 'It drifted twice.';
  return `It drifted ${n} times.`;
}

// ------------------------------------------------------- Burlington time

const NY = 'America/New_York';

export function nyParts(ms) {
  const d = new Date(ms);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NY, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of fmt.formatToParts(d)) {
    if (part.type !== 'literal') p[part.type] = parseInt(part.value, 10);
  }
  if (p.hour === 24) p.hour = 0; // some ICU versions
  return p; // {year, month, day, hour, minute, second}
}

const pad2 = (n) => String(n).padStart(2, '0');

export function nyDateStr(ms) {
  const p = nyParts(ms);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

// The NY calendar date n days from the one `ms` falls on, as 'YYYY-MM-DD'.
// Calendar arithmetic, NOT elapsed time: adding 86,400,000 ms to 11:30 PM
// on the night the clocks spring forward lands on the day after tomorrow.
// Date.UTC normalizes overflow and negative day-of-month for us, and 17:00
// UTC is the same NY calendar day at either offset.
export function nyDayPlus(ms, n) {
  const p = nyParts(ms);
  return nyDateStr(Date.UTC(p.year, p.month - 1, p.day + n, 17, 0, 0));
}

// Pick one of n things for today, the same one for everybody in town all
// day. (djb2 over the NY date; deterministic, no storage, no shuffle.)
export function dailyIndex(ms, n) {
  if (n <= 0) return 0;
  const str = nyDateStr(ms);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h % n;
}

// 'YYYY-MM' — must match the leaderboard SQL, which buckets by NY month.
export function nyMonthKey(ms) {
  const p = nyParts(ms);
  return `${p.year}-${pad2(p.month)}`;
}

// Epoch ms of a given NY wall-clock moment today-or-given-date. Tries both
// EST and EDT offsets and keeps the one that round-trips — no hardcoded
// offset, so DST edges just work.
export function nyWallToEpoch(year, month, day, hour, minute) {
  for (const off of [4, 5]) {
    const guess = Date.UTC(year, month - 1, day, hour + off, minute, 0, 0);
    const p = nyParts(guess);
    if (p.year === year && p.month === month && p.day === day &&
        p.hour === hour && p.minute === minute) return guess;
  }
  // Spring-forward gap (2–3am) can't round-trip; take the EST guess.
  return Date.UTC(year, month - 1, day, hour + 5, minute, 0, 0);
}

// ------------------------------------------------------------- The 8:02

// Burlington's town breath: every evening at 8:02 PM, the 802's own
// minute, six minutes at six breaths a minute. All phones derive phase from
// the same wall-clock start, so the town inhales together.
export const TOWN = {
  hour: 20, minute: 2, seconds: 360,
  lobbyMinutes: 5, // doors open 7:57
};

export function townTimes(ms) {
  const p = nyParts(ms);
  const start = nyWallToEpoch(p.year, p.month, p.day, TOWN.hour, TOWN.minute);
  return {
    lobby: start - TOWN.lobbyMinutes * 60000,
    start,
    end: start + TOWN.seconds * 1000,
  };
}

// state: 'idle' (most of the day) | 'lobby' | 'live' | 'done' (just ended,
// linger 10 min so late arrivals see what happened). After the done window
// the idle state points at TOMORROW's 8:02, never into the past.
export function townState(ms) {
  const t = townTimes(ms);
  if (ms >= t.lobby && ms < t.start) return { state: 'lobby', ...t, msToStart: t.start - ms };
  if (ms >= t.start && ms < t.end) return { state: 'live', ...t, into: ms - t.start };
  if (ms >= t.end && ms < t.end + 600000) return { state: 'done', ...t };
  if (ms >= t.end) {
    // tomorrow's date in NY (start + 24h lands on the next NY calendar day
    // at 17:02–19:02 regardless of DST; we only need its date parts)
    const p = nyParts(t.start + 24 * 3600000);
    const start = nyWallToEpoch(p.year, p.month, p.day, TOWN.hour, TOWN.minute);
    return {
      state: 'idle',
      lobby: start - TOWN.lobbyMinutes * 60000,
      start,
      end: start + TOWN.seconds * 1000,
      msToStart: start - ms,
    };
  }
  return { state: 'idle', ...t, msToStart: t.start - ms };
}

// During the live window every device computes breath phase from the shared
// start, not from when it joined — that's the whole trick.
export function townPhaseMs(ms) {
  const t = townTimes(ms);
  return ms - t.start;
}

// ----------------------------------------------------- seasons & the sky

// Vermont's real six seasons.
export function seasonFor(ms) {
  const p = nyParts(ms);
  const m = p.month, d = p.day;
  if (m === 12 || m <= 2 || (m === 3 && d <= 15)) return 'winter';
  if (m === 3 || m === 4) return 'mud';
  if (m === 5 || m === 6) return 'spring';
  if (m === 7 || m === 8) return 'summer';
  if (m === 9 || m === 10) return 'foliage';
  return 'stick'; // November: bare branches, grey lake, honest
}

// Rough Burlington sky phase by hour + season (close enough for paint).
export function skyPhase(ms) {
  const p = nyParts(ms);
  const h = p.hour + p.minute / 60;
  const season = seasonFor(ms);
  const sunset = { winter: 16.5, mud: 19.2, spring: 20.3, summer: 20.5, foliage: 18.7, stick: 16.6 }[season];
  const sunrise = { winter: 7.3, mud: 6.5, spring: 5.3, summer: 5.5, foliage: 6.8, stick: 7.0 }[season];
  if (h < sunrise - 0.7 || h >= sunset + 1.2) return 'night';
  if (h < sunrise + 0.7) return 'dawn';
  if (h < 11) return 'morning';
  if (h < sunset - 1.3) return 'day';
  if (h < sunset + 0.2) return 'golden';
  return 'dusk';
}

// ----------------------------------------------------- stats & the maple

export function freshStats() {
  return {
    v: 1,
    totalSec: 0,        // all-time completed seconds, this device
    sessions: 0,
    daysPracticed: 0,   // distinct NY days with >= 1 completed session
    lastDay: null,      // 'YYYY-MM-DD'
    last14: [],         // most recent distinct practiced days, newest last
    monthKey: null,     // NY month the monthSec below belongs to
    monthSec: 0,        // completed seconds this NY month (what we submit)
    anchor: null,       // "After coffee" — the if-then line
    plaque: 0,          // next science plaque index to show
    plaquesDone: false, // stop auto-showing once they've all been seen
  };
}

export function loadStatsFrom(json) {
  try {
    const s = JSON.parse(json);
    if (s && s.v === 1) return { ...freshStats(), ...s };
  } catch { /* fall through */ }
  return freshStats();
}

// Record a completed (or honestly-partial) session. endMs stamps which NY
// day and month get the credit — a sit that crosses midnight belongs to
// the day it ends. Pure: returns a new stats object.
export function recordSession(stats, endMs, seconds) {
  const s = { ...stats, last14: [...stats.last14] };
  const day = nyDateStr(endMs);
  const mk = nyMonthKey(endMs);
  const sec = Math.max(0, Math.round(seconds));
  // Normalize the month bucket BEFORE any early return — otherwise a short
  // September sit could leave August's monthSec in place and the next
  // submit would pour last month's seconds into the new server bucket.
  if (s.monthKey !== mk) { s.monthKey = mk; s.monthSec = 0; }
  if (sec < 30) return s; // under half a minute: it happened, we don't count it
  s.totalSec += sec;
  s.sessions += 1;
  s.monthSec += sec;
  if (s.lastDay !== day) {
    s.lastDay = day;
    s.daysPracticed += 1;
    s.last14.push(day);
    if (s.last14.length > 14) s.last14.shift();
  }
  return s;
}

// The maple on your shore. It only ever grows — no withering, no debt.
// Full canopy lands around day 66, the honest habit-formation timeline.
const MAPLE_DAYS = [0, 1, 2, 4, 7, 11, 16, 22, 29, 38, 50, 66];

export function mapleStage(daysPracticed) {
  let stage = 0;
  for (let i = 0; i < MAPLE_DAYS.length; i++) {
    if (daysPracticed >= MAPLE_DAYS[i]) stage = i;
  }
  const max = MAPLE_DAYS.length - 1;
  return {
    stage, max,
    grown: stage >= max,
    daysToNext: stage >= max ? 0 : MAPLE_DAYS[stage + 1] - daysPracticed,
  };
}

// The 14-day sky strip: for each of the trailing 14 NY days, was there a
// practice? Missed days aren't marked "failed" — they're just sky.
export function skyStrip(stats, nowMs) {
  const days = [];
  const have = new Set(stats.last14);
  // Walk NY CALENDAR days, not elapsed 24h periods — around DST changes
  // those disagree. Date.UTC normalizes negative day-of-month; noon-ish UTC
  // is always the same NY calendar date.
  const p = nyParts(nowMs);
  for (let i = 13; i >= 0; i--) {
    const d = nyDateStr(Date.UTC(p.year, p.month - 1, p.day - i, 17, 0, 0));
    days.push({ day: d, practiced: have.has(d), today: i === 0 });
  }
  return days;
}

// -------------------------------------------------------------- presence

// Presence ids rotate daily: enough to count neighbors, no long trail.
// (djb2 — not cryptographic, doesn't need to be.)
export function presenceId(playerId, ms) {
  const str = `${playerId}|${nyDateStr(ms)}|lake-breath`;
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Warm copy for the count. Exact numbers on purpose: "a few" reads as a
// lie, and an honest 1 is still one real neighbor.
export function presenceLine(othersCount) {
  if (othersCount <= 0) return null;
  if (othersCount === 1) return '1 neighbor is breathing with you';
  return `${othersCount} neighbors are breathing with you`;
}
