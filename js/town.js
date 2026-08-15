// Lake Breath — the local layer. Five small static JSON feeds from the
// Btown Brief guide, cached for an hour, read synchronously by the app.
//
// Doctrine: the town is a whisper, never a headline. Nothing here may be
// louder than the lake. Every feed is optional; a 404, an offline phone,
// or a blocked localStorage all resolve to null and the UI simply hides
// that line. Plain GETs, no headers, no keys, no cookies.
//
// Feeds (all CORS *, all small):
//   weather/latest.json          NWS periods, today's and tomorrow's highs
//   weather/read.json            a human one-liner per day this week
//   events/rail.json             per-day event counts and picks
//   calendar.json                hand-kept annual anchors (Festival of Fools)
//   goodburlington-queue.json    good neighborhood links, often empty

import { nyDateStr, dailyIndex } from './engine.js';

const BASE = 'https://guide.btownbrief.com/data/';
const KEY = 'lakebreath-town';
const TTL = 60 * 60 * 1000; // an hour is plenty; none of this is urgent

const FEEDS = {
  weather: 'weather/latest.json',
  read: 'weather/read.json',
  rail: 'events/rail.json',
  calendar: 'calendar.json',
  good: 'goodburlington-queue.json',
};

// ----------------------------------------------------------------- store

let store = { fetchedAt: 0, weather: null, read: null, rail: null, calendar: null, good: null };

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s && typeof s === 'object') store = { ...store, ...s };
  } catch { /* fine: we just fetch */ }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* fine */ }
}

// A test hook, and only that: ?townfix=N serves a baked fixture and never
// touches the network, so Playwright can see the town lines deterministically.
//   1 = an upcoming anchor three days out (the common, generic case)
//   2 = no anchor at all, so the rail's marquee carries the line
//   3 = an anchor whose name trips the jester keyword
function fixtureOn() {
  try {
    const v = new URLSearchParams(location.search).get('townfix');
    if (v === null) return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch { return 0; }
}

const dayStr = (ms) => nyDateStr(ms);
const plusDays = (ms, n) => ms + n * 86400000;

// The fixture's dates are built from the clock at load so it always lands
// inside the same windows the real feeds would (tomorrow, this week).
function fixture(variant) {
  const now = Date.now();
  const today = dayStr(now), tom = dayStr(plusDays(now, 1));
  const anchors = {
    1: [{ id: 'fixture-fair', name: 'Champlain Valley Fair', date: dayStr(plusDays(now, 3)), note: 'Essex Jct', hidden: false }],
    2: [{ id: 'fixture-later', name: 'South End Art Hop', date: dayStr(plusDays(now, 40)), note: 'South End', hidden: false }],
    3: [{ id: 'fixture-fools', name: 'Festival of Fools', date: dayStr(plusDays(now, 3)), note: 'Church St', hidden: false }],
  };
  return {
    fetchedAt: now,
    weather: {
      forecast: {
        periods: [
          { name: 'Today', start: `${today}T12:00:00-04:00`, is_day: true, temp_f: 74, pop: 0, short: 'Mostly Sunny' },
          { name: 'Tonight', start: `${today}T20:00:00-04:00`, is_day: false, temp_f: 55, pop: 0, short: 'Mostly Clear' },
          { name: 'Tomorrow', start: `${tom}T12:00:00-04:00`, is_day: true, temp_f: 82, pop: 10, short: 'Mostly Sunny' },
          { name: 'Tomorrow Night', start: `${tom}T20:00:00-04:00`, is_day: false, temp_f: 64, pop: 20, short: 'Partly Cloudy' },
        ],
      },
    },
    read: { week: [{ date: tom, blurb: 'Sunny and pleasant near 82, the pick of the week for being outside.' }] },
    rail: { days: [{ date: today, n: 52, t: 'Half Priced Oysters at La Reprise', picks: [] }] },
    calendar: anchors[variant] || anchors[1],
    good: {
      items: [{
        title: 'Spider web spotted at Eastwoods this morning.',
        url: 'https://www.reddit.com/r/burlington/',
        why: 'Delightful nature photo, wholesome moment',
      }],
    },
  };
}

// ---------------------------------------------------------------- refresh

let refreshing = null;

// How old the cache is. The caller uses this to decide whether coming back
// to a tab that sat all night is worth a fetch.
export function ageMs() { return Date.now() - (store.fetchedAt || 0); }

// Fetch anything stale, in parallel, and never let a failure matter. Feeds
// that fail keep whatever was cached; feeds that never worked stay null.
// Resolves true only when a feed's contents actually changed, so the caller
// can redraw its two quiet lines and otherwise do nothing at all.
export function refresh(force = false) {
  const fx = fixtureOn();
  if (fx) { store = fixture(fx); return Promise.resolve(false); }
  if (refreshing) return refreshing;
  if (!force && ageMs() < TTL && store.weather) return Promise.resolve(false);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(false);
  const names = Object.keys(FEEDS);
  refreshing = Promise.allSettled(names.map((n) =>
    fetch(BASE + FEEDS[n]).then((r) => (r.ok ? r.json() : null)),
  )).then((results) => {
    let got = false, changed = false;
    results.forEach((res, i) => {
      if (res.status !== 'fulfilled' || !res.value) return;
      got = true;
      const name = names[i];
      const next = JSON.stringify(res.value);
      if (next !== JSON.stringify(store[name])) { store[name] = res.value; changed = true; }
    });
    if (got) { store.fetchedAt = Date.now(); save(); }
    refreshing = null;
    return changed;
  }).catch(() => { refreshing = null; return false; });
  return refreshing;
}

const fx0 = fixtureOn();
if (fx0) store = fixture(fx0); else load();

// ------------------------------------------------------------- tomorrow

function clip(text, n = 90) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '')}.`;
}

const periodDay = (p) => {
  const ms = Date.parse(p && p.start);
  return Number.isFinite(ms) ? dayStr(ms) : null;
};

// What the sky is doing tomorrow, plus today's high for the comparison.
// null whenever the feed is missing or has no daytime period for tomorrow.
export function tomorrow(nowMs = Date.now()) {
  const periods = store.weather?.forecast?.periods;
  if (!Array.isArray(periods) || !periods.length) return null;
  const today = dayStr(nowMs), tom = dayStr(plusDays(nowMs, 1));
  const tomP = periods.find((p) => p.is_day && periodDay(p) === tom);
  if (!tomP) return null;
  // After sunset the only daytime period left IS tomorrow's; falling back
  // to it just makes the delta zero, which reads as "no lean" downstream.
  const todayP = periods.find((p) => p.is_day && periodDay(p) === today)
    || periods.find((p) => p.is_day) || tomP;
  const highF = Math.round(tomP.temp_f);
  const todayHighF = Math.round(todayP.temp_f);
  const week = store.read?.week;
  const hit = Array.isArray(week) ? week.find((d) => d.date === tom) : null;
  return {
    highF,
    todayHighF,
    deltaF: highF - todayHighF,
    pop: typeof tomP.pop === 'number' ? tomP.pop : 0,
    short: String(tomP.short || '').trim(),
    blurb: hit ? clip(hit.blurb) : null,
  };
}

// -------------------------------------------------------- anchor events

// The next big local moment inside a week. calendar.json is a hand-kept
// array of {name, date 'YYYY-MM-DD', note, hidden}; anything hidden or
// already past is skipped.
export function anchorEvent(nowMs = Date.now()) {
  const list = store.calendar;
  if (!Array.isArray(list) || !list.length) return null;
  const today = dayStr(nowMs);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  let best = null;
  for (const e of list) {
    if (!e || e.hidden || !e.date || !e.name) continue;
    const ms = Date.parse(`${String(e.date).slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(ms)) continue;
    const days = Math.round((ms - todayMs) / 86400000);
    if (days < 0 || days > 7) continue;
    if (!best || days < best.startsInDays) {
      best = {
        label: String(e.name).trim(),
        startsInDays: days,
        kind: /fool/i.test(e.name) ? 'fools' : 'generic',
      };
    }
  }
  return best;
}

// ------------------------------------------------------------ good news

// One neighborhood link, the same one for everybody in town all day.
export function goodNews(nowMs = Date.now()) {
  const items = store.good?.items;
  if (!Array.isArray(items) || !items.length) return null;
  const usable = items.filter((i) => i && i.title && i.url);
  if (!usable.length) return null;
  const it = usable[dailyIndex(nowMs, usable.length)];
  return { title: String(it.title).trim(), why: String(it.why || '').trim(), url: String(it.url) };
}

// -------------------------------------------------------- tonight in town

// How much is on in Burlington today, and the one headline pick.
export function eventsTonight(nowMs = Date.now()) {
  const days = store.rail?.days;
  if (!Array.isArray(days)) return null;
  const d = days.find((x) => x && x.date === dayStr(nowMs));
  if (!d || !(d.n > 0)) return null;
  return { n: d.n, headline: String(d.t || '').trim() };
}

// ------------------------------------------------------------- the tint

// The palette whisper. Tomorrow being warmer leans the sun and the low sky
// warm; colder leans them cool; a wet tomorrow pulls the sky a touch grey.
// Ceiling is 6% on a 12F swing, which is under the threshold where anyone
// would say "the app looks orange today" — that's the point.
export function tintFor(tw) {
  if (!tw) return null;
  const d = Math.max(-12, Math.min(12, tw.deltaF || 0));
  const warm = d >= 5 ? (d / 12) * 0.06 : 0;
  const cool = d <= -5 ? (-d / 12) * 0.06 : 0;
  const grey = (tw.pop || 0) >= 50 ? 0.04 : 0;
  return warm || cool || grey ? { warm, cool, grey } : null;
}

const clamp1 = (c) => c.map((v) => Math.min(1, Math.max(0, v)));

// Pure: takes the palette object scene-gl.palette() returns and gives back
// a new one. Never mutates, and returns the input untouched when there's
// nothing to say.
export function tintPalette(pal, tw) {
  const t = tintFor(tw);
  if (!t) return pal;
  const warmer = (c, k) => clamp1([c[0] * (1 + k), c[1] * (1 + k * 0.35), c[2] * (1 - k)]);
  const cooler = (c, k) => clamp1([c[0] * (1 - k), c[1] * (1 - k * 0.2), c[2] * (1 + k)]);
  const greyer = (c, k) => {
    const m = (c[0] + c[1] + c[2]) / 3;
    return clamp1(c.map((v) => v + (m - v) * k));
  };
  const out = { ...pal };
  if (t.warm) { out.sunCol = warmer(pal.sunCol, t.warm); out.skyLow = warmer(pal.skyLow, t.warm); }
  if (t.cool) { out.sunCol = cooler(pal.sunCol, t.cool); out.skyLow = cooler(pal.skyLow, t.cool); }
  if (t.grey) { out.skyTop = greyer(out.skyTop, t.grey); out.skyLow = greyer(out.skyLow, t.grey); }
  return out;
}
