// Lake Breath v2: the controller. One rAF drives everything: the WebGL
// lake, the bloom, the breath, sound cues, stillness. All decisions come
// from the pure engine; all words from content.js; DOM lives only here.

import {
  TECHNIQUES, phaseAt, breathLevel,
  PRACTICE_MINUTES, minutesFor,
  townState, TOWN,
  seasonFor, skyPhase, nyParts, nyMonthKey, dailyIndex,
  freshStats, loadStatsFrom, recordSession, mapleStage, skyStrip,
  presenceLine, freshPaddle, paddleStroke, freshSteady, steadyStep, steadyRecenter, restingPhrase, driftPhrase,
} from './engine.js';
import {
  presetById, PLAQUES, FIELD_NOTES, PORCH_INTRO, SAFETY_LINE,
  MANTRAS, NOTE_EXAMPLES, GUIDE_STEPS, GUIDE_TITLE, GUIDE_BUTTON,
} from './content.js';
import * as sound from './sound.js';
import * as haptics from './haptics.js';
import * as net from './net.js';
import * as still from './stillness.js';
import * as town from './town.js';
import { LakeScene, palette, celestial } from './scene-gl.js';
import { pickPhoto, loadPhoto } from './photos.js';
import { Bloom } from './bloom.js';

const $ = (id) => document.getElementById(id);
// Screenshot-only clock hook. Production has no timefix parameter, while
// local visual checks can hold dawn, day, gold, or night still long enough
// to compare the rendered sky.
try {
  const fixed = Date.parse(new URLSearchParams(location.search).get('timefix') || '');
  if (Number.isFinite(fixed)) Date.now = () => fixed;
} catch { /* ordinary clock */ }
const STATS_KEY = 'lakebreath-stats';
const GUIDE_KEY = 'lakebreath-guided';
const LEGACY_SIT_KEY = 'lakebreath-sit-mins';
const MINS_KEY = 'lakebreath-mins-';
const FORECAST_KEY = 'lakebreath-forecast';
const EMBLEM_KEY = 'lakebreath-event-emblem';
const STILL_GLASS = 0.12; // churn below this = the water reads as glass

// Steady's geometry, in units of min(canvasW, canvasH) so it means the
// same thing on every screen. Ring radius 0.11 = a target 22% of the short
// edge across; the gain is set so a tilt of about four degrees walks the
// bubble to the ring's edge.
const STEADY_RING = 0.11;
const STEADY_GAIN = 1.5;
let bubble = null; // {x, y, r, inRing} while the steady layer runs
// The upcoming town anchor, re-read only when the feeds change. The draw
// loop must never parse dates. townDirty holds a refresh that landed while
// somebody was mid-sit.
let anchorNow = null;
let townDirty = false;

// ------------------------------------------------------------- state

let stats = loadStatsFrom((() => {
  try { return localStorage.getItem(STATS_KEY) || ''; } catch { return ''; }
})());
let techKey = 'lake';
let durationSec = 0;
let session = null;
let wakeLock = null;
let quietTimer = 0;

function storedBool(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value !== '0';
  } catch { return fallback; }
}
let forecastOn = storedBool(FORECAST_KEY, true);
let emblemOn = storedBool(EMBLEM_KEY, true);

function saveStats() {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* fine */ }
}

// Duration is a preference, not a record. Each practice remembers its own
// wheel position. The old Just Sit key is read once as a quiet migration.
function practiceMins(key, tech = TECHNIQUES[key]) {
  let saved = '';
  try {
    saved = localStorage.getItem(`${MINS_KEY}${key}`) || '';
    if (!saved && key === 'timer') saved = localStorage.getItem(LEGACY_SIT_KEY) || '';
  } catch { /* use the technique default */ }
  return minutesFor(tech, saved);
}
function setPracticeMins(key, mins) {
  const n = minutesFor(TECHNIQUES[key], mins);
  try { localStorage.setItem(`${MINS_KEY}${key}`, String(n)); } catch { /* fine */ }
  return n;
}
function durationFor(key, tech = TECHNIQUES[key]) { return practiceMins(key, tech) * 60; }
durationSec = durationFor(techKey);

// ------------------------------------------------------------- scene

const scene = new LakeScene($('lake'));
if (!scene.ok) document.body.dataset.gl = 'off';
const bloom = new Bloom($('petals'));
bloom.resize(); // owner's job now; draw() no longer resizes per frame
const HORIZON = 0.60;

// Ambient scene state is cached per minute. Intl date math and palette
// blending are far too expensive to run per frame on a phone.
let ambCache = { key: '', st: null };
// The real sky now showing (or loading). Photos are chosen per phase per
// Burlington day; the scene crossfades when the pick changes.
let photoWant = null;   // the entry sceneState last asked for
let photoHave = null;   // {img, entry, colors} once loaded, or null
function wantPhoto(entry) {
  if ((entry?.file || null) === (photoWant?.file || null)) return;
  photoWant = entry;
  if (!entry) { photoHave = null; scene.setPhoto(null); ambCache.key = ''; return; }
  loadPhoto(entry).then((loaded) => {
    if (photoWant !== entry) return; // the sky moved on while this loaded
    photoHave = loaded;
    scene.setPhoto(loaded);
    ambCache.key = ''; // the palette follows the photo now
  });
}
function sceneState(nowMs, breath, churn) {
  const key = `${Math.floor(nowMs / 60000)}:${forecastOn}`;
  if (ambCache.key !== key) {
    const p = nyParts(nowMs);
    const season = seasonFor(nowMs);
    const phaseNow = skyPhase(nowMs);
    const phaseSoon = skyPhase(nowMs + 30 * 60000);
    const blend = phaseNow === phaseSoon ? 0 : (p.minute % 30) / 30;
    const tomorrow = forecastOn ? town.tomorrow(nowMs) : null;
    const tintScale = phaseNow === 'night' ? 0.10
      : (phaseNow === 'dawn' || phaseNow === 'dusk' || phaseNow === 'golden') ? 0.78
      : 1;
    const tintWeather = tomorrow ? { ...tomorrow, deltaF: tomorrow.deltaF * tintScale } : null;
    wantPhoto(pickPhoto(phaseNow, season, dailyIndex(nowMs, 97)));
    let base = palette(phaseNow, phaseSoon, blend, season);
    const pc = photoHave && photoHave.entry === photoWant ? photoHave.colors : null;
    if (pc) {
      // the water and the bloom take their colours off the photograph, so
      // the painted half of the scene belongs to the same evening
      const dark = (c, k) => c.map((v) => v * k);
      base = { ...base, skyTop: pc.skyTop, skyLow: pc.skyLow, waterHi: dark(pc.skyLow, 0.55), waterLo: dark(pc.skyLow, 0.16) };
    }
    const pal = town.tintPalette(base, tintWeather);
    // tomorrow's forecast lands on the photo as the same lean it gives the
    // painted sky: tinted over untinted, per channel
    const photoTint = base.skyLow.map((v, i) => Math.max(0.6, Math.min(1.5, (pal.skyLow[i] + 0.02) / (v + 0.02))));
    const night = phaseNow === 'night' ? 1 : (phaseSoon === 'night' ? blend : (phaseNow === 'dusk' || phaseNow === 'dawn' ? 0.3 : 0));
    const dayFrac = (p.hour * 60 + p.minute) / 1440;
    const cel = celestial(dayFrac, night);
    const weatherKind = forecastKind(tomorrow, p.month);
    ambCache = { key, st: {
      night, horizon: HORIZON, ...pal, ...cel, photoTint,
      clear: weatherKind === 'clear' ? 1 : 0,
      _weather: weatherKind, _phase: phaseNow, _season: season,
    } };
  }
  return { ...ambCache.st, breath, churn };
}

// ------------------------------------------------------------- helpers

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.dataset.show = 'true';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.dataset.show = 'false'; }, 3000);
}

// Touching the water always ripples, in every practice. The first time
// somebody does that mid-breath we say once, quietly, that there is a whole
// practice built on it. Once ever, then never again.
const PADDLE_HINT_KEY = 'lakebreath-paddle-hint';
function maybeHintPaddle(tech) {
  if (tech.steps || tech.kind) return; // breathing practices only
  try {
    if (localStorage.getItem(PADDLE_HINT_KEY)) return;
    localStorage.setItem(PADDLE_HINT_KEY, '1');
  } catch { return; } // no storage means no way to keep the promise of "once"
  toast('That was a paddle stroke. Keep tapping slowly and the lake follows your rhythm.');
}

function openSheet(id) { const s = $(id); s.dataset.open = 'true'; s.inert = false; }
function closeSheet(id) {
  const s = $(id);
  s.dataset.open = 'false';
  s.inert = true;
  if (id === 'practice-sheet') cancelMinuteDial();
}
function closeAllSheets() {
  for (const s of document.querySelectorAll('.sheet')) { s.dataset.open = 'false'; s.inert = true; }
}

const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, '0')}`;
const durLabel = (secs) => `${Math.round(secs / 60)} min`;
// The lake's own breath: what the water does when nothing is pacing it.
const idleBreath = () => breathLevel(TECHNIQUES.lake, Date.now() % 10000) * 0.35;

// --------------------------------------------------------------- home

function greetingFor(nowMs) {
  const h = nyParts(nowMs).hour;
  if (h < 4) return 'The lake is still here.';
  if (h < 12) return 'Good morning.';
  if (h < 17) return 'Good afternoon.';
  if (h < 22) return 'Good evening.';
  return 'Up late.';
}

// Which animation tomorrow wants. NWS 'short' is the honest signal; pop
// and month only break ties for an unnamed wet forecast.
function forecastKind(tw, month) {
  if (!tw) return null;
  const { short, pop } = tw;
  const s = String(short || '').toLowerCase();
  if (/snow|flurr|sleet|ice|wintry|blizzard/.test(s)) return 'snow';
  if (/rain|shower|storm|thunder|drizzle/.test(s)) return 'rain';
  if (pop >= 50) return (month === 12 || month <= 2) ? 'snow' : 'rain';
  if (/clear|sun/.test(s)) return 'clear';
  return null;
}

function applyTownScene() {
  townDirty = false;
  anchorNow = town.anchorEvent(Date.now());
  ambCache.key = '';
}

async function refreshHome() {
  const now = Date.now();
  applyTownScene();
  $('greeting').textContent = greetingFor(now);
  $('mantra').textContent = MANTRAS.join(' ');
  const ts = townState(now);
  const ug = $('undergreeting');
  if (ts.state === 'lobby') {
    ug.innerHTML = 'The 8:02 is gathering. <b>The town breathes at 8:02</b>';
    $('begin').textContent = 'Join the 8:02';
  } else if (ts.state === 'live') {
    ug.innerHTML = '<b>The 8:02 is happening now</b>';
    $('begin').textContent = 'Join the 8:02';
  } else if (ts.state === 'done') {
    ug.textContent = 'Tonight’s 8:02 just ended. Same time tomorrow.';
    $('begin').textContent = 'Breathe';
  } else {
    $('begin').textContent = 'Breathe';
    const n = await net.lookAround();
    const line = presenceLine(n ?? 0);
    if (line && document.body.dataset.view === 'front') {
      const [num, ...rest] = line.split(' ');
      ug.innerHTML = `<b>${num}</b> ${rest.join(' ')} right now`;
    } else if (!stats.lastPaddle && dailyIndex(now, 3) === 0) {
      // Nothing else to say, and they have never paddled. Roughly one day
      // in three, the same day for everybody in town, we mention it.
      ug.textContent = 'Try Paddle. Tap a slow rhythm on the water and let your mind wander.';
    } else if (stats.anchor) {
      ug.innerHTML = `<i>${stats.anchor}, I breathe.</i> Breathe anytime; at 8:02 the town breathes together.`;
    } else {
      ug.textContent = 'Breathe anytime. At 8:02 each evening, the whole town is on one inhale.';
    }
  }
}

// Every practice is on the home screen as a plain word. A menu behind a
// tap is a menu nobody opens; the sheet still exists, one tap deeper, for
// durations and descriptions.
function buildPracticePicks() {
  const wrap = $('practice-picks');
  wrap.innerHTML = '';
  for (const [key, tech] of Object.entries(TECHNIQUES)) {
    if (key === 'still' && !still.supported()) continue;
    const b = document.createElement('button');
    b.className = 'practice-pick';
    b.setAttribute('aria-pressed', String(key === techKey));
    b.textContent = tech.name;
    b.addEventListener('click', () => {
      if (key === techKey) { buildPracticeSheet(); openSheet('practice-sheet'); return; }
      techKey = key;
      durationSec = durationFor(key, tech);
      buildPracticePicks();
    });
    wrap.append(b);
  }
  $('duration-control').textContent = durLabel(durationSec, TECHNIQUES[techKey]);
}

// ------------------------------------------------------ practice sheet

// The dial's Safari fallback fires 160ms after the last scroll event, which
// is long enough for the sheet to have been rebuilt or closed and another
// practice chosen. A stale callback that still ran would write ITS minutes
// into the shared durationSec and hand, say, Quick Sigh an 11-minute
// length. So every dial carries a generation: the moment one is replaced or
// its sheet closes, the old dial's pending commit becomes a no-op.
let dialGen = 0;
let dialSettle = 0;
function cancelMinuteDial() {
  clearTimeout(dialSettle);
  dialSettle = 0;
  dialGen += 1;
}

// Every practice's minute dial: a row of numbers you scroll, the centred one
// being the choice. A wheel asks "how long feels right" instead of
// offering three answers somebody else picked. Snap does the deciding,
// scrollend (or a timeout, for Safari) does the committing, and the arrow
// keys step a minute for anyone not using a thumb.
function buildMinuteDial(key, tech) {
  cancelMinuteDial();
  const gen = dialGen;
  const dial = document.createElement('div');
  dial.className = 'minute-dial';
  dial.tabIndex = 0;
  dial.setAttribute('role', 'slider');
  dial.setAttribute('aria-label', 'How many minutes');
  dial.setAttribute('aria-valuemin', String(PRACTICE_MINUTES.min));
  dial.setAttribute('aria-valuemax', String(PRACTICE_MINUTES.max));

  const track = document.createElement('div');
  track.className = 'dial-track';
  for (let m = PRACTICE_MINUTES.min; m <= PRACTICE_MINUTES.max; m++) {
    const b = document.createElement('span');
    b.className = 'dial-min';
    b.dataset.min = String(m);
    b.textContent = String(m);
    track.append(b);
  }
  dial.append(track);

  const items = () => [...track.children];
  const mark = (mins) => {
    for (const el of items()) {
      el.dataset.on = String(parseInt(el.dataset.min, 10) === mins);
    }
    dial.setAttribute('aria-valuenow', String(mins));
    dial.setAttribute('aria-valuetext', `${mins} min`);
  };
  const centerOn = (mins, smooth) => {
    const el = items().find((e) => parseInt(e.dataset.min, 10) === mins);
    if (!el) return;
    const left = el.offsetLeft - (dial.clientWidth - el.offsetWidth) / 2;
    if (smooth && dial.scrollTo) dial.scrollTo({ left, behavior: 'smooth' });
    else dial.scrollLeft = left;
  };
  const centered = () => {
    const mid = dial.scrollLeft + dial.clientWidth / 2;
    let best = practiceMins(key, tech), bestD = Infinity;
    for (const el of items()) {
      const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
      if (d < bestD) { bestD = d; best = parseInt(el.dataset.min, 10); }
    }
    return best;
  };
  // Alive = this is still the current dial, it is still in the document,
  // and its practice is still selected. Anything else and the
  // callback belongs to a screen that no longer exists.
  const alive = () => gen === dialGen && dial.isConnected && techKey === key;
  const commit = () => {
    if (!alive()) return;
    const mins = centered();
    if (mins === practiceMins(key, tech) && durationSec === mins * 60) { mark(mins); return; }
    setPracticeMins(key, mins);
    durationSec = mins * 60;
    mark(mins);
    buildPracticePicks();
  };
  const step = (delta) => {
    if (!alive()) return;
    const next = Math.min(PRACTICE_MINUTES.max,
      Math.max(PRACTICE_MINUTES.min, practiceMins(key, tech) + delta));
    setPracticeMins(key, next);
    durationSec = next * 60;
    mark(next);
    centerOn(next, true);
    buildPracticePicks();
  };

  dial.addEventListener('scroll', () => {
    if (!alive()) return;
    clearTimeout(dialSettle);
    dialSettle = setTimeout(commit, 160); // Safari has no scrollend yet
  }, { passive: true });
  dial.addEventListener('scrollend', () => { clearTimeout(dialSettle); commit(); });
  dial.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); step(1); }
  });
  track.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target.closest('.dial-min') : null;
    if (!el || !alive()) return;
    const mins = parseInt(el.dataset.min, 10);
    setPracticeMins(key, mins); durationSec = mins * 60;
    mark(mins); centerOn(mins, true); buildPracticePicks();
  });

  mark(practiceMins(key, tech));
  requestAnimationFrame(() => centerOn(practiceMins(key, tech), false));
  return dial;
}

function buildPracticeSheet() {
  const wrap = $('practice-rows');
  cancelMinuteDial(); // the old dial is about to be detached
  wrap.innerHTML = '';
  for (const [key, tech] of Object.entries(TECHNIQUES)) {
    if (key === 'still' && !still.supported()) continue;
    const row = document.createElement('button');
    row.className = 'practice-row';
    row.setAttribute('aria-pressed', String(key === techKey));
    const name = document.createElement('span');
    name.className = 'name'; name.textContent = tech.name;
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = {
      lake: 'The daily practice. In four, out six; the water breathes with you.',
      timer: 'Set a length and sit however you like. A slow gong marks the end.',
      sigh: 'Two sips in, one long sigh out. Set any length that feels useful.',
      box: 'Four even sides. For people who already love it.',
      still: 'Hold the phone flat or upright. Keep the light inside the ring and let your thoughts wander.',
      paddle: 'Tap your own steady rhythm, like strokes on the water. Every tap ripples the lake.',
      porch: 'Eyes open, no counting. For when watching the breath isn’t it.',
    }[key];
    row.append(name, tag);
    row.addEventListener('click', () => {
      techKey = key;
      durationSec = durationFor(key, tech);
      buildPracticePicks(); buildPracticeSheet();
      closeSheet('practice-sheet');
    });
    wrap.append(row);
    // duration controls are siblings, never buttons-inside-a-button
    if (key === techKey) wrap.append(buildMinuteDial(key, tech));
  }
}

// ------------------------------------------------------------ sessions

const PHASE_WORDS = { in: 'breathe in', in2: 'a little more', hold: 'hold, softly', out: 'let it go', rest: 'rest' };

async function grabWakeLock() {
  try {
    const lock = await navigator.wakeLock?.request('screen');
    if (session) wakeLock = lock; else lock?.release();
  } catch { wakeLock = null; }
}
function dropWakeLock() { try { wakeLock?.release(); } catch { /* fine */ } wakeLock = null; }

let starting = false;
// (the flag is destructured as isTown throughout: the town data module is
// imported as `town`, and a shadowed name here would be a trap)
async function startSession({ town: isTown = false } = {}) {
  if (session || starting) return; // double-tap / keyboard re-entry guard
  starting = true;
  try { await startSessionInner({ town: isTown }); } finally { starting = false; }
}

async function startSessionInner({ town: isTown = false } = {}) {
  const key = isTown ? 'lake' : techKey;
  const tech = TECHNIQUES[key];
  const now = Date.now();
  let t0 = now, seconds = durationSec;
  if (isTown) {
    const ts = townState(now);
    if (ts.state !== 'live' && ts.state !== 'lobby') return;
    t0 = ts.start; seconds = TOWN.seconds;
  }
  // Motion permission stays inside the Begin gesture. The steady layer is
  // invited into every session and silently steps aside when unavailable.
  const steadyReady = still.supported() ? await still.start() : false;
  if (tech.kind === 'still' && !steadyReady) {
    toast('Steady needs a motion sensor. This device did not offer one.');
    return;
  }
  sound.unlock();
  // "Again" can start a new sit while the last gong is still ringing its
  // twelve second tail. The new session gets its own silence.
  sound.stopTails();
  const isBreathing = !tech.steps && !tech.kind;
  if (isBreathing) {
    sound.voiceStart();
    bloom.guide = true;
  }
  grabWakeLock();

  session = {
    key, tech, t0, seconds, town: isTown,
    startedAt: now, lastSegI: -1, porchStep: -1,
    stillSec: 0, drifts: 0, lastT: performance.now(),
    // Steady's accounting lives in the engine's state machine; the two
    // numbers below it are just what the meter lines read off.
    steady: freshSteady(),
    steadyReady, steadyOn: steadyReady,
    restToldAt: 0, awayHintDone: false, awayRun: 0,
    // Paddle: taps come in from the window listener and are judged as they
    // land, against the cadence current at that moment.
    paddle: freshPaddle(), lastTap: 0,
    presenceTimer: setInterval(async () => {
      const n = await net.beat();
      if (session) $('presence-live').textContent = presenceLine(n ?? 0) || '';
    }, 30000),
  };
  net.beat().then((n) => { if (session) $('presence-live').textContent = presenceLine(n ?? 0) || ''; });

  // Steady's bubble and Paddle's ripples are focus objects; the bloom
  // steps aside for those dedicated practices. Just Sit has no main focus
  // object of its own, so the
  // bloom stays exactly as it is on the home screen: gentle idle presence.
  bloom.show(!(tech.steps || (tech.kind && tech.kind !== 'timer')));
  bubble = null;
  $('phase-word').textContent = '';
  $('phase-sub').textContent =
    isTown ? 'The 8:02. The whole town, one clock'
      : tech.steps ? PORCH_INTRO
      : tech.kind === 'timer' ? 'The lake keeps time. Sit however you like.'
      : tech.kind === 'still' ? 'Hold the phone in your hand, flat or upright, and keep the light centered. A hand is never perfectly still. That is the point.'
      : tech.kind === 'paddle' ? 'Tap the water at your own steady pace. Like paddle strokes. Keep the rhythm; let your mind go where it wants.'
      : '';
  $('session-instruction').textContent = tech.kind === 'paddle'
    ? 'Tap the water like a paddle stroke. Find a slow, steady rhythm.'
    : isBreathing && steadyReady
      ? 'Breathe with the words. Keep the light centered. Tap the water like a paddle.'
      : isBreathing
        ? 'Breathe with the words. Tap the water like a paddle.'
        : steadyReady
          ? 'Keep the light centered. Tap the water like a paddle.'
          : 'Tap the water like a paddle.';
  $('tap-line').textContent = 'Tap the water. Each touch is a paddle stroke.';
  const steadyBtn = $('session-steady');
  steadyBtn.hidden = !steadyReady || tech.kind === 'still';
  steadyBtn.textContent = 'steady on';
  $('session-recenter').hidden = !steadyReady;
  $('still-meter').textContent = '';
  $('drift-line').textContent = '';
  $('remaining').textContent = '';
  // Steady's bubble owns the middle of the screen; the CSS moves the two
  // meter lines below the ring so nothing sits inside the target.
  document.body.dataset.practice = key;
  document.body.dataset.view = 'session';
  wakeQuietTimer();
}

function wakeQuietTimer() {
  document.body.dataset.quiet = 'false';
  clearTimeout(quietTimer);
  quietTimer = setTimeout(() => {
    if (session) document.body.dataset.quiet = 'true';
  }, 4500);
}

function updateSteadyLayer(s, dt) {
  if (!s.steadyOn) { bubble = null; return 0; }
  const churn = still.getChurn();
  const tilt = still.getTilt();
  const W = bloom.canvas.width, H = bloom.canvas.height;
  const u = Math.min(W, H) || 1;
  const limX = (W / u) * 0.5 - 0.06, limY = (H / u) * 0.5 - 0.06;
  const bx = Math.max(-limX, Math.min(limX, tilt.x * STEADY_GAIN));
  const by = Math.max(-limY, Math.min(limY, -tilt.y * STEADY_GAIN));
  const inRing = Math.hypot(bx, by) <= STEADY_RING;
  const held = still.isHeld();
  bubble = { x: bx, y: by, r: STEADY_RING, inRing, resting: !held };
  s.steady = steadyStep(s.steady, { inRing, flat: tilt.flat, churn, held, dt });
  s.stillSec = s.steady.centeredSec;
  s.drifts = s.steady.drifts;
  if (s.key === 'still') {
    $('still-meter').textContent = held ? `home ${fmt(s.stillSec)}` : 'Set down? Steady counts a hand, not a table.';
    $('drift-line').textContent = held && s.drifts ? `drifts: ${s.drifts}` : '';
  } else if (!held && !s.restToldAt) {
    // the other practices get told once, quietly, the first time the phone
    // reads as resting; the meter lines belong to Steady alone
    s.restToldAt = performance.now();
    toast('The phone is resting on something. Steady only counts a hand.');
  }
  // A hand that settled somewhere new sits off-centre forever unless told
  // otherwise. Six seconds out of the ring, in hand, earns one pointer to
  // the recenter button, per session.
  s.awayRun = held && !inRing ? s.awayRun + dt : 0;
  if (!s.awayHintDone && s.awayRun > 6) {
    s.awayHintDone = true;
    wakeQuietTimer();
    toast('Comfortable where your hand is? Tap recenter and that becomes home.');
  }
  if (still.spiked()) {
    scene.ripple(0.3 + Math.random() * 0.4, HORIZON + 0.1 + Math.random() * 0.2, 0.8);
  }
  return churn;
}

function sessionFrame(nowP) {
  const s = session;
  const now = Date.now();
  const t = now - s.t0;
  const dt = Math.min(0.05, (nowP - s.lastT) / 1000);
  s.lastT = nowP;

  if (t >= s.seconds * 1000) { finishSession(true); return 0; }
  const steadyChurn = updateSteadyLayer(s, dt);

  if (s.tech.steps) {
    // Front Porch: grounding prompts, water rests
    const step = Math.min(s.tech.steps.length - 1, Math.floor(Math.max(0, t) / (s.tech.stepSeconds * 1000)));
    if (step !== s.porchStep) { s.porchStep = step; $('phase-sub').textContent = s.tech.steps[step]; sound.cue('in', 1.2); }
    updateRemaining(t, s);
    return { breath: 0.3, churn: steadyChurn };
  }

  if (s.tech.kind === 'timer') {
    // Just Sit: nothing to run. The clock counts down, the lake breathes
    // its own gentle breath, and the gong is the only event in the whole
    // practice. Deliberately the least code in this file.
    updateRemaining(t, s);
    return { breath: idleBreath(), churn: steadyChurn };
  }

  if (s.tech.kind === 'still') {
    updateRemaining(t, s);
    const water = bubble?.inRing ? steadyChurn : Math.max(steadyChurn, 0.05);
    return { breath: idleBreath() * (steadyChurn < STILL_GLASS ? 1 : 0.7), churn: water };
  }

  if (s.tech.kind === 'paddle') {
    // Paddle counts nothing per frame; taps arrive from the window
    // listener. The water just keeps breathing on its own underneath.
    updateRemaining(t, s);
    return { breath: idleBreath(), churn: steadyChurn };
  }

  if (t >= 0) {
    const level = breathLevel(s.tech, t);
    const p = phaseAt(s.tech, t);
    if (p.i !== s.lastSegI) {
      if (s.lastSegI === -1 && s.town) $('phase-sub').textContent = 'The 8:02. The whole town, one clock';
      s.lastSegI = p.i;
      $('phase-word').textContent = PHASE_WORDS[p.k] || '';
      const seg = s.tech.segments[p.i];
      if (seg.k === 'in' || seg.k === 'in2' || seg.k === 'out') sound.cue(seg.k, seg.s);
      haptics.phaseTurn(seg.k);
    }
    // the continuous voice rides the breath (throttled ~8/s)
    if (nowP - (s.lastVoice || 0) > 120) { s.lastVoice = nowP; sound.voiceLevel(level); }
    updateRemaining(t, s);
    return { breath: level, churn: steadyChurn };
  }
  // 8:02 lobby
  const secs = Math.ceil(-t / 1000);
  $('phase-word').textContent = 'starting soon';
  $('phase-sub').textContent = `the town inhales together at 8:02, in ${fmt(secs)}`;
  return { breath: 0.1, churn: steadyChurn };
}

function tapLine(tally) {
  if (tally.strokes === 1) return '1 paddle stroke. Tap again when it feels right.';
  return `${tally.strokes} paddle strokes. ${tally.onRhythm} of ${tally.judgedGaps} gaps near your rhythm.`;
}

// A paddle stroke in every session: a ripple where the finger landed, a
// soft sound, and a live rhythm fact. Paddle remains the dedicated practice,
// but breathing and steadiness no longer make the person's taps disappear.
function paddleTap(xUv, yUv) {
  const s = session;
  const nowP = performance.now();
  // judged as it lands, against the tempo they are keeping right now
  s.paddle = paddleStroke(s.paddle, s.lastTap ? nowP - s.lastTap : null);
  s.lastTap = nowP;
  // a tap above the waterline still lands ON the water, just below itself:
  // the stroke has to leave a mark or the practice has no answer
  scene.ripple(xUv, Math.max(HORIZON + 0.02, yUv), 1);
  sound.stroke();
  $('tap-line').textContent = tapLine(s.paddle);
}

let lastRemainText = '';
function updateRemaining(t, s) {
  const remain = Math.max(0, s.seconds - Math.floor(Math.max(0, t) / 1000));
  const text = t >= 0 ? fmt(remain) : '';
  if (text !== lastRemainText) { lastRemainText = text; $('remaining').textContent = text; }
}

function teardownSession() {
  if (!session) return;
  clearInterval(session.presenceTimer);
  bubble = null;
  still.stop();
  sound.voiceStop();
  bloom.guide = false;
  haptics.stop();
  dropWakeLock();
  net.leave();
  sound.releaseSession();
  clearTimeout(quietTimer);
  document.body.dataset.quiet = 'false';
}

// The two attention receipts. Facts, then last time for context, and
// never a verdict on either.
function steadyReceipt(s, practicedSec, last) {
  const lines = [
    `The bubble stayed home for ${fmt(s.stillSec)} of ${fmt(practicedSec)}.`,
    driftPhrase(s.drifts),
  ];
  if (last) {
    lines.push(`Last time: ${fmt(last.centeredSec)} and ${last.drifts} ${last.drifts === 1 ? 'drift' : 'drifts'}.`);
  }
  return lines.join(' ');
}

function steadyFact(n) {
  if (n === 0) return 'The light left center 0 times.';
  if (n === 1) return 'The light left center once.';
  if (n === 2) return 'The light left center twice.';
  return `The light left center ${n} times.`;
}

// The denominator is the number of gaps that were actually judged, not the
// number of taps: the first stroke sets the tempo and cannot be off it, so
// four perfect taps read as three of three and not as a miss.
const judged = (t) => (t.judgedGaps != null ? t.judgedGaps : Math.max(0, (t.strokes || 0) - 1));

function paddleReceipt(tally, last) {
  if (!tally || !tally.strokes) return 'No strokes this time. The water waits.';
  const n = judged(tally);
  if (!n) return 'One stroke this time. That is where every rhythm starts.';
  const lines = [`You kept ${tally.onRhythm} of ${n} strokes on rhythm. Longest run: ${tally.longestRun}.`];
  if (last) lines.push(`Last time: ${last.onRhythm} of ${judged(last)}, longest run ${last.longestRun}.`);
  return lines.join(' ');
}

// One good thing from the neighborhood, on the end screen, in the slot the
// science plaques leave behind. textContent only: the title is somebody
// else's words arriving over the network.
function showGoodNews(allowed) {
  const box = $('goodnews');
  const gn = allowed ? town.goodNews() : null;
  if (!gn) { box.hidden = true; return; }
  const a = $('gn-title');
  a.textContent = gn.title;
  a.href = gn.url;
  $('gn-why').textContent = gn.why || '';
  box.hidden = false;
}

function finishSession(completed) {
  if (!session) return;
  const s = session;
  teardownSession();
  session = null;

  const endClock = Math.min(Date.now(), s.t0 + s.seconds * 1000);
  const practicedSec = Math.min(s.seconds,
    Math.max(0, Math.round((endClock - Math.max(s.t0, s.startedAt)) / 1000)));

  const before = mapleStage(stats.daysPracticed);
  const lastSteady = stats.lastSteady, lastPaddle = stats.lastPaddle;
  // nothing is re-judged here: the tally was built stroke by stroke
  const tally = s.paddle;
  stats = recordSession(stats, Date.now(), practicedSec);
  if (s.key === 'still' && practicedSec >= 30) {
    if (s.stillSec > (stats.glassBest || 0)) stats.glassBest = Math.round(s.stillSec);
    stats.lastSteady = {
      centeredSec: Math.round(s.stillSec), drifts: s.drifts, totalSec: practicedSec,
    };
  }
  if (s.key === 'paddle' && practicedSec >= 30) {
    if (tally.longestRun > (stats.paddleBestRun || 0)) stats.paddleBestRun = tally.longestRun;
    stats.lastPaddle = {
      strokes: tally.strokes, judgedGaps: tally.judgedGaps, onRhythm: tally.onRhythm,
      longestRun: tally.longestRun, drifts: tally.drifts, totalSec: practicedSec,
    };
  }
  saveStats();
  if (stats.monthKey === nyMonthKey(Date.now())) net.submitMonthSeconds(stats.monthSec);
  const after = mapleStage(stats.daysPracticed);

  // ---- the release: the one moment we spend everything on
  if (completed && practicedSec >= 30) {
    bloom.release();
    sound.unlock();
    // Just Sit ends on the slow gong; everything else keeps the bowl.
    if (s.tech.kind === 'timer') sound.gong(); else sound.bowl();
    haptics.phaseTurn('bell');
  }
  bloom.show(false);

  const mins = Math.round(practicedSec / 60);
  $('end-big').textContent =
    practicedSec >= 60 ? `${mins === 1 ? 'One quiet minute' : `${['','','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten'][mins] || mins} quiet minutes`}.`
    : practicedSec >= 30 ? `${practicedSec} quiet seconds.`
    : 'That’s okay.';
  const receipt = [];
  if (practicedSec < 30) receipt.push('Even sitting down counts for something. The lake will be here.');
  else if (s.town) receipt.push('You breathed with the whole town tonight.');
  else if (s.key === 'still') receipt.push(steadyReceipt(s, practicedSec, lastSteady));
  else if (s.key === 'paddle') receipt.push(paddleReceipt(tally, lastPaddle));
  else if (tally.strokes === 1) receipt.push('You made 1 paddle stroke.');
  else if (tally.strokes > 1) {
    receipt.push(`You made ${tally.strokes} paddle strokes. ${tally.onRhythm} of ${tally.judgedGaps} gaps stayed near your rhythm.`);
  }
  if (practicedSec >= 30 && s.steadyOn && s.key !== 'still') receipt.push(steadyFact(s.drifts));
  if (s.steadyOn) { const rest = restingPhrase(s.steady.restingSec); if (rest) receipt.push(rest); }
  $('end-sub').textContent = receipt.join(' ');
  $('end-grow').textContent =
    after.stage > before.stage ? 'Your maple grew.'
    : practicedSec >= 30 && !after.grown ? `${after.daysToNext} more ${after.daysToNext === 1 ? 'day' : 'days'} and your maple grows.`
    : '';

  const plaque = $('plaque');
  if (!stats.plaquesDone && practicedSec >= 30) {
    plaque.hidden = false;
    plaque.textContent = PLAQUES[stats.plaque % PLAQUES.length];
    const more = document.createElement('a');
    more.href = '#'; more.textContent = 'why we tell you this';
    more.addEventListener('click', (e) => {
      e.preventDefault();
      openBench();
    });
    plaque.append(more);
    stats.plaque += 1;
    if (stats.plaque >= PLAQUES.length) stats.plaquesDone = true;
    saveStats();
  } else plaque.hidden = true;

  // The plaque slot is shared. A science line goes first while any are
  // left; once they're all read, the neighborhood's good news moves in.
  showGoodNews(plaque.hidden && practicedSec >= 30);

  refreshWall();
  if (townDirty) applyTownScene(); // feeds that refreshed mid-sit land now
  $('note-sent').textContent = '';
  setTimeout(() => { document.body.dataset.view = 'end'; }, completed && practicedSec >= 30 ? 1500 : 150);

  if (stats.sessions === 1 && !stats.anchor && completed) {
    clearTimeout(finishSession._anchorT);
    finishSession._anchorT = setTimeout(() => {
      if (!session && document.body.dataset.view === 'end') openSheet('anchor-sheet');
    }, 4200);
  }
}

// --------------------------------------------------------------- wall

function agoLabel(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h` : 'yesterday';
}

async function refreshWall() {
  const list = $('wall-list');
  const rows = await net.fetchWall();
  list.innerHTML = '';
  if (!rows.length) {
    const li = document.createElement('li');
    li.textContent = 'Quiet water today. Leave the first note?';
    list.append(li);
    return;
  }
  for (const r of rows.slice(0, 5)) {
    const p = presetById(r.preset);
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = p ? `${p.text} ${p.emoji}` : (r.body || '');
    const when = document.createElement('span');
    when.className = 'when'; when.textContent = agoLabel(r.at);
    li.append(text, when);
    list.append(li);
  }
}

// The note sheet: people write their own words now. The old preset lines
// survive only as the placeholder, one a day, as examples of the register
// we're hoping for. A neighbor reads everything before the wall does.
function buildNoteSheet() {
  const box = $('note-text');
  box.value = '';
  box.placeholder = NOTE_EXAMPLES[dailyIndex(Date.now(), NOTE_EXAMPLES.length)];
  $('note-send').disabled = false;
}

async function sendTypedNote() {
  const box = $('note-text');
  const btn = $('note-send');
  const text = box.value.trim();
  if (text.length < 3) { box.focus(); return; }
  btn.disabled = true;
  closeSheet('note-sheet');
  const ok = await net.sendText(text);
  $('note-sent').textContent = ok
    ? 'Sent. A neighbor will read it soon and put it on the wall.'
    : 'Couldn’t send right now. One note every couple hours, or the lake is offline.';
  if (ok) box.value = '';
  btn.disabled = false;
  if (!ok) return;
  // A quick server-side read (Claude behind an edge function) can put a
  // clearly kind note on the wall right away. Anything less than a clear
  // yes keeps the human-queue promise above, so this only ever upgrades.
  const status = await net.checkNote();
  if (status === 'approved') {
    $('note-sent').textContent = 'On the wall. Thanks, neighbor.';
    refreshWall();
  }
}

// -------------------------------------------------------------- shore

async function refreshShore() {
  $('shore-days').innerHTML = skyStrip(stats, Date.now()).map((d) =>
    `<span class="d" data-practiced="${d.practiced}" data-today="${d.today}" title="${d.day}"></span>`).join('');
  $('stat-days').textContent = String(stats.daysPracticed);
  $('stat-minutes').textContent = String(Math.round(stats.totalSec / 60));
  $('stat-glass').textContent = stats.glassBest ? fmt(stats.glassBest) : '–';
  const m = mapleStage(stats.daysPracticed);
  $('maple-line').textContent = m.grown
    ? 'Your maple reached full canopy. Day 66 is when habits take root.'
    : `Your maple is ${['a bare shore', 'a sprout', 'a seedling', 'a sapling', 'a young tree', 'a young tree', 'growing', 'growing', 'filling in', 'filling in', 'almost there'][m.stage]}. It only ever grows; full canopy lands around day 66.`;
  $('anchor-line').innerHTML = stats.anchor
    ? `<i>${stats.anchor}, I breathe.</i>`
    : 'No anchor yet. It’s offered after your first sit.';
  const mins = await net.townMinutes();
  $('town-line').innerHTML = mins != null && mins > 0
    ? `Burlington has taken <b>${mins.toLocaleString()}</b> quiet minutes together this month.`
    : '';
}

// -------------------------------------------------------------- guide

// One screen, once, after the lake has painted itself: what this place is,
// before anyone has to guess. Re-openable from Field Notes forever after.
function buildGuide() {
  $('guide-title').textContent = GUIDE_TITLE;
  const wrap = $('guide-steps');
  wrap.innerHTML = '';
  for (const line of GUIDE_STEPS) {
    const p = document.createElement('p');
    p.className = 'guide-step';
    p.textContent = line;
    wrap.append(p);
  }
  $('guide-phrases').textContent = MANTRAS.join(' ');
  $('guide-done').textContent = GUIDE_BUTTON;
}

function openGuide() {
  const g = $('guide');
  g.dataset.open = 'true'; g.inert = false;
}

function closeGuide() {
  const g = $('guide');
  if (g.dataset.open !== 'true') return;
  g.dataset.open = 'false'; g.inert = true;
  try { localStorage.setItem(GUIDE_KEY, '1'); } catch { /* fine */ }
}

function maybeShowGuide() {
  let seen = '1';
  try { seen = localStorage.getItem(GUIDE_KEY) || ''; } catch { seen = '1'; }
  if (seen) return;
  // let the scene arrive first; the welcome is to a place, not a form
  setTimeout(() => { if (document.body.dataset.view === 'front' && !session) openGuide(); }, 1200);
}

// -------------------------------------------------------------- bench

// Open Field Notes, optionally scrolled to one entry. inert has to come off
// BEFORE the scroll, or the browser has nothing to scroll to.
function openBench(noteId) {
  const bench = $('bench');
  bench.dataset.open = 'true';
  bench.inert = false;
  if (!noteId) return;
  const target = document.getElementById(noteId);
  if (!target) return;
  requestAnimationFrame(() => {
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

function buildBench() {
  $('bench-notes').innerHTML = FIELD_NOTES.map((n) =>
    `<h3></h3><p></p>`).join('');
  const hs = $('bench-notes').querySelectorAll('h3');
  const ps = $('bench-notes').querySelectorAll('p');
  FIELD_NOTES.forEach((n, i) => {
    hs[i].textContent = n.title;
    if (n.id) hs[i].id = n.id; // the mantra line links to one of these
    ps[i].textContent = n.body;
  });
  fetch('data/builder-note.json').then((r) => r.ok ? r.json() : null).then((note) => {
    if (note && note.body) {
      $('from-builder').hidden = false;
      $('builder-title').textContent = `From Stephen, ${note.date || ''}`;
      $('builder-body').textContent = note.body;
    }
  }).catch(() => { /* fine */ });
}

// ---------------------------------------------------------- main loop

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
scene.timeScale = REDUCED.matches ? 0.06 : 1;
REDUCED.addEventListener?.('change', () => { scene.timeScale = REDUCED.matches ? 0.06 : 1; });
scene.onContextChange = (ok) => { document.body.dataset.gl = ok ? 'on' : 'off'; };

let breathSmooth = 0;
let lastLoop = performance.now();
let frameFlip = false;
function loop(nowP) {
  const dt = Math.min(0.05, (nowP - lastLoop) / 1000);
  lastLoop = nowP;
  // idle screens render every other frame. Slow water can't tell, the
  // battery can
  frameFlip = !frameFlip;
  if (!session && frameFlip) { requestAnimationFrame(loop); return; }

  let target = 0, churn = 0, idle = true;
  if (session) {
    const out = sessionFrame(nowP);
    if (session) { // may have finished inside sessionFrame
      idle = false;
      if (typeof out === 'object') { target = out.breath; churn = out.churn; }
      else target = out;
    }
  }
  if (idle) {
    // the lake breathes gently on its own, always
    target = idleBreath();
  }
  breathSmooth += (target - breathSmooth) * Math.min(1, dt * 5);

  const st = sceneState(Date.now(), breathSmooth, churn);
  scene.draw(st);
  bloom.setColors(st.sunCol, st.skyLow);
  bloom.draw(breathSmooth, HORIZON, dt, idle);
  bloom.drawWeather(st._weather, dt);
  const emblemVisible = emblemOn && anchorNow && !session && document.body.dataset.view === 'front';
  if (emblemVisible) bloom.drawEventEmblem(anchorNow.kind, breathSmooth, 1 - st.night * 0.32);
  if (bubble) bloom.drawBubble(bubble); // Steady's focus object
  // warm-night fireflies; a steady breath draws them toward the bloom
  const flyNight = st.night > 0.55 && (st._season === 'summer' || st._season === 'spring' || st._season === 'foliage');
  bloom.drawFireflies(flyNight, session && !session.tech.steps ? 0.9 : 0.15, dt);
  // the maple: dark leaf silhouettes by season, tinted by the sky at night
  const m = mapleStage(stats.daysPracticed);
  const leaf = {
    winter: [126, 142, 152], mud: [96, 104, 66], spring: [66, 118, 70],
    summer: [56, 108, 66], foliage: [176, 84, 40], stick: [92, 76, 60],
  }[st._season] || [56, 108, 66];
  const dim = 1 - st.night * 0.55;
  bloom.drawMaple(m.stage, m.max, leaf.map((v) => Math.round(v * dim)));
  sound.maybeLoon(st.night);

  requestAnimationFrame(loop);
}

// ------------------------------------------------------------- wiring

function wire() {
  $('safety-line').textContent = SAFETY_LINE;

  $('begin').addEventListener('click', () => {
    const ts = townState(Date.now());
    closeAllSheets();
    if (ts.state === 'lobby' || ts.state === 'live') startSession({ town: true });
    else startSession();
  });
  $('duration-control').addEventListener('click', () => {
    buildPracticeSheet();
    openSheet('practice-sheet');
    requestAnimationFrame(() => document.querySelector('.minute-dial')?.scrollIntoView({ block: 'center' }));
  });
  $('guide-done').addEventListener('click', closeGuide);
  $('open-guide').addEventListener('click', () => {
    const bench = $('bench');
    bench.dataset.open = 'false'; bench.inert = true;
    openGuide();
  });
  $('stop').addEventListener('click', () => finishSession(false));
  $('session-recenter').addEventListener('click', () => {
    const s = session;
    if (!s || !s.steadyOn) return;
    still.recenter();
    s.steady = steadyRecenter(s.steady);
    s.awayRun = 0;
    wakeQuietTimer();
    toast('Home is here now.');
  });
  $('session-steady').addEventListener('click', async () => {
    const s = session;
    if (!s) return;
    if (s.steadyOn) {
      s.steadyOn = false;
      bubble = null;
      still.stop();
      $('session-steady').textContent = 'steady off';
      $('session-recenter').hidden = true;
      return;
    }
    const ok = await still.start();
    if (!session || session !== s) { if (ok) still.stop(); return; }
    if (!ok) { $('session-steady').hidden = true; return; }
    s.steadyOn = true;
    $('session-steady').textContent = 'steady on';
    $('session-recenter').hidden = false;
  });
  $('end-done').addEventListener('click', () => {
    clearTimeout(finishSession._anchorT);
    bloom.show(true); // the hero returns home with you
    document.body.dataset.view = 'front'; refreshHome();
  });
  $('end-again').addEventListener('click', () => {
    clearTimeout(finishSession._anchorT);
    document.body.dataset.view = 'front'; startSession();
  });
  $('felt-worse').addEventListener('click', () => {
    techKey = 'porch'; durationSec = durationFor('porch');
    buildPracticePicks();
    document.body.dataset.view = 'front'; refreshHome();
    toast('Fair. Front Porch is set: eyes open, no counting. Or just stop for today; that’s fine too.');
  });
  $('send-note').addEventListener('click', () => { buildNoteSheet(); openSheet('note-sheet'); });
  $('note-send').addEventListener('click', sendTypedNote);
  $('open-shore').addEventListener('click', () => { refreshShore(); openSheet('shore-sheet'); });
  $('open-bench').addEventListener('click', () => openBench());
  // The phrase under the greeting stays unexplained where it sits; tapping
  // it opens the field note that explains all three.
  $('mantra').addEventListener('click', () => openBench('note-three-phrases'));
  for (const b of document.querySelectorAll('[data-close]')) {
    b.addEventListener('click', () => {
      const id = b.dataset.close;
      if (id === 'bench') { const bench = $('bench'); bench.dataset.open = 'false'; bench.inert = true; }
      else closeSheet(id);
    });
  }
  $('reset-history').addEventListener('click', () => {
    if (confirm('Clear your practice history on this device? The town’s totals keep what you already contributed.')) {
      const keep = { monthKey: stats.monthKey, monthSec: stats.monthSec };
      stats = { ...freshStats(), ...keep };
      saveStats(); refreshShore();
    }
  });

  // anchor rows
  const anchors = ['After coffee', 'After brushing my teeth', 'On my lunch break', 'Before bed', ''];
  const arWrap = $('anchor-rows');
  for (const a of anchors) {
    const b = document.createElement('button');
    b.className = 'note-row';
    b.textContent = a || 'I’ll wing it';
    b.addEventListener('click', () => {
      if (a) { stats.anchor = a; saveStats(); toast(`${a}, you breathe. We’ll hold you to nothing.`); }
      closeSheet('anchor-sheet');
      refreshHome();
    });
    arWrap.append(b);
  }

  // Scene and sound toggles live together in the top links.
  const sBtn = document.createElement('button');
  sBtn.className = 'tbtn'; sBtn.textContent = 'sound on';
  sBtn.addEventListener('click', () => {
    const on = !sound.soundEnabled();
    sound.setSoundEnabled(on);
    if (on) sound.unlock();
    sBtn.textContent = on ? 'sound on' : 'sound off';
  });
  const fBtn = document.createElement('button');
  fBtn.className = 'tbtn';
  const showForecastState = () => {
    fBtn.textContent = forecastOn ? 'forecast sky' : 'just the lake';
    fBtn.setAttribute('aria-pressed', String(forecastOn));
  };
  showForecastState();
  fBtn.addEventListener('click', () => {
    forecastOn = !forecastOn;
    try { localStorage.setItem(FORECAST_KEY, forecastOn ? '1' : '0'); } catch { /* fine */ }
    ambCache.key = '';
    showForecastState();
  });
  const eBtn = document.createElement('button');
  eBtn.className = 'tbtn';
  const showEmblemState = () => {
    eBtn.textContent = emblemOn ? 'emblem on' : 'emblem off';
    eBtn.setAttribute('aria-pressed', String(emblemOn));
  };
  showEmblemState();
  eBtn.addEventListener('click', () => {
    emblemOn = !emblemOn;
    try { localStorage.setItem(EMBLEM_KEY, emblemOn ? '1' : '0'); } catch { /* fine */ }
    showEmblemState();
  });
  document.querySelector('.toplinks').prepend(sBtn, fBtn, eBtn);

  // touching the water makes ripples: your hand moves the world. During
  // Paddle every tap anywhere is a stroke, except taps on real controls
  // (the Stop button must never also count as paddling).
  window.addEventListener('pointerdown', (e) => {
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    // (the iOS tick-zone switch is deliberately NOT excluded: its tap is a
    // stroke that happens to tick)
    const onControl = e.target instanceof Element &&
      e.target.closest('button, a, .sheet, .bench, .guide');
    if (session && !onControl) paddleTap(x, y);
    else if (y > HORIZON) scene.ripple(x, y, 1);
    if (session && !onControl) maybeHintPaddle(session.tech);
    if (session) wakeQuietTimer();
    sound.resumeFromGesture();
  });

  // iOS: real system tick per genuine tap on a native control, no box.
  // Only the mounted native label gets the overlay class. An empty div
  // must never swallow taps meant for the Stop button.
  haptics.mountSwitch($('tick-zone'), () => { /* the tick is the feedback */ });

  // interruption contract: hidden = the session ends honestly
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (session) { finishSession(false); toast('Session ended when the screen went away.'); }
      sound.fadeOutAndSuspend();
    } else {
      sound.resumeFromGesture();
      refreshHome();
      // a tab that sat on a home screen all night comes back to stale
      // weather; half an hour is old enough to be worth a quiet fetch.
      // force, because the module's own TTL is an hour and would otherwise
      // turn this catch-up into a no-op until sixty minutes had passed.
      if (town.ageMs() > 30 * 60000) town.refresh(true).then(townChanged);
    }
  });
  window.addEventListener('pagehide', () => { if (session) finishSession(false); else net.leave(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAllSheets(); $('bench').dataset.open = 'false'; closeGuide(); return; }
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if ($('guide').dataset.open === 'true') return; // the welcome comes first
    // a space typed into the note box is a space, never a session
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement
      || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLAnchorElement) return;
    if (e.target instanceof Element && e.target.classList.contains('minute-dial')) return;
    e.preventDefault();
    if (session) finishSession(false);
    else if (document.body.dataset.view === 'front') startSession();
  });

  window.addEventListener('resize', () => { scene.resize(); bloom.resize(); });
  setInterval(() => { if (!session && document.body.dataset.view === 'front') refreshHome(); }, 30000);
  // This app lives on home screens and stays open for days, so the town
  // has to keep itself current on its own. Hourly while visible, quietly.
  setInterval(() => {
    if (!document.hidden) town.refresh().then(townChanged);
  }, 60 * 60000);
}

// New town data landed. Refresh the scene unless somebody is mid-sit.
function townChanged(changed) {
  if (!changed) return;
  if (session) { townDirty = true; return; }
  applyTownScene();
  townDirty = false;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* fine */ });
  });
}

wire();
buildBench();
buildGuide();
buildPracticePicks();
refreshHome();
// the local layer, fetched in the background and drawn whenever it lands
town.refresh().then(townChanged);
bloom.show(true);
requestAnimationFrame(loop);
maybeShowGuide();

if (stats.monthSec > 0 && stats.monthKey === nyMonthKey(Date.now())) {
  net.submitMonthSeconds(stats.monthSec);
}
window.addEventListener('online', () => {
  if (stats.monthSec > 0 && stats.monthKey === nyMonthKey(Date.now())) {
    net.submitMonthSeconds(stats.monthSec);
  }
});
