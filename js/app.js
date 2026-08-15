// Lake Breath — the controller. Everything impure lives here: DOM, clocks,
// localStorage, wake lock, the session loop. All decisions come from the
// pure engine; all words come from content.js.

import {
  TECHNIQUES, phaseAt, breathLevel,
  townState, TOWN,
  seasonFor, skyPhase, nyDateStr, nyMonthKey,
  freshStats, loadStatsFrom, recordSession, mapleStage, skyStrip,
  presenceLine,
} from './engine.js';
import {
  NOTE_PRESETS, presetById, PLAQUES, FIELD_NOTES, PORCH_INTRO, SAFETY_LINE,
} from './content.js';
import * as audio from './audio.js';
import * as haptics from './haptics.js';
import * as net from './net.js';

const $ = (id) => document.getElementById(id);
const STATS_KEY = 'lakebreath-stats';

// ------------------------------------------------------------- state

// localStorage can be blocked (private browsing, storage pressure) — the
// app must still open; stats just live for the page's lifetime then.
let stats = loadStatsFrom((() => {
  try { return localStorage.getItem(STATS_KEY) || ''; } catch { return ''; }
})());
let techKey = 'lake';
let durationSec = 300;
let session = null; // { t0, tech, seconds, town, lastSegI, counted, presenceTimer, raf }
let wakeLock = null;

function saveStats() {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* fine */ }
}

// ------------------------------------------------------------- scene

function paintAmbience() {
  const now = Date.now();
  document.documentElement.dataset.sky = skyPhase(now);
  document.documentElement.dataset.season = seasonFor(now);
}

// The maple: trunk + branch skeleton, then leaf clusters revealed by
// growth stage. Positions are fixed so the tree "fills in" over weeks.
const LEAF_SPOTS = [
  [50, 44, 16], [36, 52, 12], [64, 52, 12], [43, 34, 11], [57, 34, 11],
  [30, 44, 9], [70, 44, 9], [50, 26, 10], [38, 24, 8], [62, 24, 8],
  [50, 16, 8], [44, 58, 8], [56, 58, 8], [26, 52, 7], [74, 52, 7],
];

function drawMaple() {
  const svg = $('maple');
  const { stage, max } = mapleStage(stats.daysPracticed);
  const t = stage / max; // 0..1 growth
  const trunkH = 18 + t * 46;
  const trunkW = 1.6 + t * 3.4;
  let s = `<g class="trunk"><path d="M ${50 - trunkW} 112 L ${50 - trunkW * 0.55} ${112 - trunkH}
    L ${50 + trunkW * 0.55} ${112 - trunkH} L ${50 + trunkW} 112 Z"/>`;
  if (stage >= 3) {
    s += `<path d="M 49 ${114 - trunkH} L 38 ${104 - trunkH} L 40 ${102 - trunkH} L 51 ${111 - trunkH} Z"/>`;
    s += `<path d="M 51 ${114 - trunkH} L 62 ${104 - trunkH} L 60 ${102 - trunkH} L 49 ${111 - trunkH} Z"/>`;
  }
  s += '</g><g class="leaves">';
  // leaf clusters sit relative to the canopy center, which rides the trunk top
  const cy0 = 112 - trunkH - 6;
  const leafCount = Math.max(0, Math.min(LEAF_SPOTS.length, Math.round((stage / max) * LEAF_SPOTS.length)));
  for (let i = 0; i < LEAF_SPOTS.length; i++) {
    const [x, y, r] = LEAF_SPOTS[i];
    const on = i < leafCount && stage >= 1;
    const fill = i % 3 === 0 ? 'var(--leaf-2)' : 'var(--leaf)';
    s += `<circle cx="${x}" cy="${cy0 - (44 - y)}" r="${r * (0.7 + t * 0.5)}"
      fill="${fill}" style="opacity:${on ? 0.96 : 0}"/>`;
  }
  s += '</g>';
  svg.innerHTML = s;
}

function setBreathVar(level) {
  document.documentElement.style.setProperty('--breath', level.toFixed(4));
}

// ------------------------------------------------------------- views

function show(view) {
  document.body.dataset.view = view;
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.dataset.show = 'true';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.dataset.show = 'false'; }, 2600);
}

// ------------------------------------------------------- front door

const TECH_TAGS = {
  lake: 'the daily practice — in 4, out 6',
  sigh: 'a fast reset — two sips in, one long sigh out',
  box: 'four even sides — in, hold, out, hold',
  porch: 'eyes open, no counting — for when breath-focus isn’t it',
};

const durLabel = (secs) => secs < 180 ? `${secs} sec` : `${Math.round(secs / 60)} min`;

function pickTechnique(key) {
  techKey = key;
  const tech = TECHNIQUES[key];
  for (const btn of document.querySelectorAll('#technique-chips .chip')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.tech === key));
  }
  $('technique-tag').textContent = TECH_TAGS[key];
  // duration chips are rebuilt from the technique's real options — Quick
  // Sigh's 90s and Porch's single length must be representable, not faked
  const wrap = $('duration-chips');
  wrap.innerHTML = '';
  for (const secs of tech.durations) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = durLabel(secs);
    b.dataset.secs = String(secs);
    b.addEventListener('click', () => pickDuration(secs));
    wrap.append(b);
  }
  wrap.hidden = tech.durations.length < 2;
  pickDuration(tech.durations.includes(durationSec) ? durationSec : tech.defaultDuration);
}

function pickDuration(secs) {
  durationSec = secs;
  for (const btn of document.querySelectorAll('#duration-chips .chip')) {
    btn.setAttribute('aria-pressed', String(parseInt(btn.dataset.secs, 10) === secs));
  }
}

function refreshFront() {
  paintAmbience();
  drawMaple();
  // the 8:02 chip
  const ts = townState(Date.now());
  const chip = $('town-chip');
  chip.dataset.live = String(ts.state === 'live' || ts.state === 'lobby');
  const label = $('town-chip-text');
  if (ts.state === 'live') label.textContent = 'The 8:02 is happening — join in';
  else if (ts.state === 'lobby') label.textContent = 'The 8:02 starts in a moment — come in';
  else if (ts.state === 'done') label.textContent = 'The 8:02 just ended — see you tomorrow';
  else label.textContent = 'The 8:02 — tonight at 6:02, the whole town breathes';
  // anchor
  const a = $('anchor-front');
  a.hidden = !stats.anchor;
  if (stats.anchor) a.innerHTML = `<i>${stats.anchor}, I breathe.</i>`;
  // presence peek (read-only)
  net.lookAround().then((n) => {
    if (document.body.dataset.view !== 'front') return;
    const line = presenceLine(n ?? 0);
    $('presence-front').innerHTML = line
      ? `<b>${line.split(' ')[0]}</b> ${line.split(' ').slice(1).join(' ')} right now`
      : '';
  });
}

// --------------------------------------------------------- sessions

const PHASE_WORDS = {
  in: 'breathe in', in2: 'a little more', hold: 'hold, softly',
  out: 'let it go', rest: 'rest',
};

async function grabWakeLock() {
  try {
    const lock = await navigator.wakeLock?.request('screen');
    // the session may have ended while the promise was in flight
    if (session) wakeLock = lock; else lock?.release();
  } catch { wakeLock = null; }
}
function dropWakeLock() {
  try { wakeLock?.release(); } catch { /* fine */ }
  wakeLock = null;
}

function startSession({ town = false } = {}) {
  // The 8:02 is always the synchronized Lake Breath — "the whole town, one
  // inhale" is the contract, and Porch has no shared timeline.
  const tech = town ? TECHNIQUES.lake : TECHNIQUES[techKey];
  const now = Date.now();
  let t0 = now;
  let seconds = durationSec;
  if (town) {
    // The whole town shares one clock: phase comes from the 6:02 start.
    const ts = townState(now);
    if (ts.state !== 'live' && ts.state !== 'lobby') return;
    t0 = ts.start;
    seconds = TOWN.seconds;
  }
  audio.unlock();
  audio.resetSchedule();
  grabWakeLock();

  session = {
    t0, tech, seconds, town,
    startedAt: now, heldMs: 0, lastSegI: -1, counted: false,
    porchStep: -1,
    presenceTimer: setInterval(async () => {
      const n = await net.beat();
      const el = $('presence-session');
      if (el && session) el.textContent = presenceLine(n ?? 0) || '';
    }, 30000),
    raf: 0,
  };
  net.beat().then((n) => {
    const el = $('presence-session');
    if (el && session) el.textContent = presenceLine(n ?? 0) || '';
  });

  $('thumb-hint').textContent = haptics.tier() === 'switch'
    ? 'tap here with the turn of each breath — feel it tick'
    : 'rest a thumb here — press as the water rises';
  $('phase-sub').textContent = session.town ? 'The 8:02 — the whole town, one clock' :
    (techKey === 'porch' ? PORCH_INTRO : '');
  show('session');
  loop();
}

function loop() {
  if (!session) return;
  const now = Date.now();
  const t = now - session.t0;
  const { tech } = session;

  // terminal boundary first — never cue a fresh inhale right under the bell
  if (t >= session.seconds * 1000) { finishSession(true); return; }

  if (tech.steps) {
    // Front Porch: a grounding sequence, not a pacer.
    setBreathVar(0.35);
    const step = Math.min(tech.steps.length - 1, Math.floor(t / (tech.stepSeconds * 1000)));
    if (step !== session.porchStep) {
      session.porchStep = step;
      $('phase-word').textContent = '';
      $('phase-sub').textContent = tech.steps[step];
      audio.tick();
    }
  } else if (t >= 0) {
    const level = breathLevel(tech, t);
    setBreathVar(level);
    const p = phaseAt(tech, t);
    if (p.i !== session.lastSegI) {
      if (session.lastSegI === -1 && session.town) {
        $('phase-sub').textContent = 'The 8:02 — the whole town, one clock';
      }
      session.lastSegI = p.i;
      $('phase-word').textContent = PHASE_WORDS[p.k] || '';
      haptics.phaseTurn(p.k);
      if (haptics.tier() !== 'vibrate') audio.tick();
    }
    audio.keepScheduled(tech, session.t0, now);
  } else {
    // 8:02 lobby: doors open, water waits at rest.
    setBreathVar(0);
    $('phase-word').textContent = 'starting soon';
    const secs = Math.ceil(-t / 1000);
    $('phase-sub').textContent =
      `the town inhales together at 6:02 — ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  }

  const remain = Math.max(0, session.seconds - Math.floor(t / 1000));
  $('session-count').textContent = t >= 0
    ? `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, '0')}`
    : '';

  session.raf = requestAnimationFrame(loop);
}

function teardownSession() {
  if (!session) return;
  cancelAnimationFrame(session.raf);
  clearInterval(session.presenceTimer);
  audio.releaseSession();
  haptics.stop();
  dropWakeLock();
  net.leave();
}

function finishSession(completed) {
  if (!session) return;
  const s = session;
  teardownSession();
  session = null;
  // Credit = time actually present, never the scheduled length — a 6:07
  // joiner to the 8:02 gets their real minute, not the town's six. Clamped
  // to the session's own end so a clock jump can't inflate it either.
  const endClock = Math.min(Date.now(), s.t0 + s.seconds * 1000);
  const practicedSec = Math.min(
    s.seconds,
    Math.max(0, Math.round((endClock - Math.max(s.t0, s.startedAt)) / 1000)),
  );
  if (completed) { audio.unlock(); audio.bell(); haptics.phaseTurn('bell'); }
  setBreathVar(0);

  const before = mapleStage(stats.daysPracticed);
  stats = recordSession(stats, Date.now(), practicedSec);
  saveStats();
  // only ever pour this device's bucket into the month it belongs to
  if (stats.monthKey === nyMonthKey(Date.now())) net.submitMonthSeconds(stats.monthSec);
  const after = mapleStage(stats.daysPracticed);

  // ---- end screen (honest units: under a minute says seconds)
  const mins = Math.round(practicedSec / 60);
  $('end-big').textContent = practicedSec >= 60
    ? `That’s ${mins} quiet ${mins === 1 ? 'minute' : 'minutes'}.`
    : (practicedSec >= 30 ? `That’s ${practicedSec} quiet seconds.` : 'That’s okay.');
  $('end-sub').textContent = practicedSec >= 30
    ? (s.town ? 'You breathed with the whole town tonight.' : '')
    : 'Even sitting down counts for something. The lake will be here.';
  $('end-grow').textContent =
    after.stage > before.stage ? 'Your maple grew.' :
    (practicedSec >= 30 && !after.grown ? `${after.daysToNext} more ${after.daysToNext === 1 ? 'day' : 'days'} of practice and your maple grows.` : '');
  drawMaple();

  // science plaque: rotate until they've all been seen, then rest
  const plaqueCard = $('plaque-card');
  if (!stats.plaquesDone && practicedSec >= 30) {
    plaqueCard.hidden = false;
    $('plaque-text').textContent = PLAQUES[stats.plaque % PLAQUES.length];
    stats.plaque += 1;
    if (stats.plaque >= PLAQUES.length) stats.plaquesDone = true;
    saveStats();
  } else {
    plaqueCard.hidden = true;
  }

  refreshWall();
  $('note-sent').textContent = '';
  show('end');

  // first fully completed session → offer the anchor, gently
  if (stats.sessions === 1 && !stats.anchor && completed) {
    setTimeout(() => {
      const sheet = $('anchor-sheet');
      sheet.dataset.open = 'true';
      sheet.inert = false;
    }, 1600);
  }
}

// ------------------------------------------------------------- wall

function agoLabel(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : 'yesterday';
}

async function refreshWall() {
  const list = $('wall-list');
  const rows = await net.fetchWall();
  list.innerHTML = '';
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'The wall is quiet right now. Leave the first note?';
    list.append(li);
    return;
  }
  // Always textContent, never markup — future freeform notes are user text.
  for (const r of rows.slice(0, 8)) {
    const p = presetById(r.preset);
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = p ? `${p.text} ${p.emoji}` : (r.body || '');
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = agoLabel(r.at);
    li.append(text, when);
    list.append(li);
  }
}

function buildNotePresets() {
  const wrap = $('note-presets');
  // a rotating handful so the sheet stays small; different picks each
  // Burlington day (product time is NY everywhere)
  const day = parseInt(nyDateStr(Date.now()).slice(8), 10);
  const picks = [...NOTE_PRESETS].filter((_, i) => (i + day) % 3 !== 0).slice(0, 6);
  wrap.innerHTML = '';
  for (const p of picks) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = `${p.text} ${p.emoji}`;
    b.addEventListener('click', async () => {
      b.disabled = true;
      const ok = await net.sendNote(p.id);
      $('note-sent').textContent = ok
        ? 'Sent. It’s up on the town wall for the next two days.'
        : 'Couldn’t send right now (one note every couple hours, or the lake is offline).';
      if (ok) refreshWall();
    });
    wrap.append(b);
  }
}

// ------------------------------------------------------------- shore

async function refreshShore() {
  paintAmbience();
  drawMaple();
  const strip = $('sky-strip');
  strip.innerHTML = skyStrip(stats, Date.now()).map((d) =>
    `<div class="d" data-practiced="${d.practiced}" data-today="${d.today}" title="${d.day}"></div>`).join('');
  $('stat-days').textContent = String(stats.daysPracticed);
  $('stat-minutes').textContent = String(Math.round(stats.totalSec / 60));
  const m = mapleStage(stats.daysPracticed);
  $('stat-maple').textContent = m.grown ? 'full canopy'
    : ['bare shore', 'a sprout', 'a seedling', 'a sapling', 'a young tree', 'a young tree',
       'growing', 'growing', 'filling in', 'filling in', 'almost there', 'full canopy'][m.stage];
  $('maple-next').textContent = m.grown
    ? 'Your maple made it. Day 66 is when habits take root — it grew because you kept coming back.'
    : `Full canopy comes around day 66 — the honest habit-formation timeline. No rush; it only ever grows.`;
  $('anchor-shore').innerHTML = stats.anchor
    ? `<i>${stats.anchor}, I breathe.</i>`
    : 'No anchor set. Tying practice to a routine is the best-evidenced way to keep it.';
  const mins = await net.townMinutes();
  $('town-total').innerHTML = mins != null && mins > 0
    ? `Burlington has taken <b>${mins.toLocaleString()}</b> quiet minutes together this month.`
    : '';
}

// ------------------------------------------------------------- bench

function buildBench() {
  $('bench-notes').innerHTML = FIELD_NOTES.map((n) =>
    `<div class="card note-block" style="margin-bottom:12px">
       <h3>${n.title}</h3><p>${n.body}</p></div>`).join('');
  // Builder's note: a tiny JSON Stephen edits by hand (data/builder-note.json).
  fetch('data/builder-note.json').then((r) => r.ok ? r.json() : null).then((note) => {
    if (note && note.body) {
      $('builder-note').hidden = false;
      $('builder-note-title').textContent = `From Stephen — ${note.date || ''}`;
      $('builder-note-body').textContent = note.body;
    }
  }).catch(() => { /* fine */ });
}

// ---------------------------------------------------------- thumb zone

function wireThumbZone() {
  const zone = $('thumb-zone');
  const setHeld = (held) => { zone.dataset.held = String(held); };
  // pointer events always drive the visual held state; on iOS the native
  // switch overlay additionally supplies a real system tick per tap
  zone.addEventListener('pointerdown', () => setHeld(true));
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    zone.addEventListener(ev, () => setHeld(false));
  }
  haptics.mountSwitch(zone, () => { /* the tick is the feedback */ });
}

// -------------------------------------------------- lifecycle & wiring

function wire() {
  $('safety-line').textContent = SAFETY_LINE;

  for (const btn of document.querySelectorAll('#technique-chips .chip')) {
    btn.addEventListener('click', () => pickTechnique(btn.dataset.tech));
  }

  $('begin').addEventListener('click', () => startSession());
  $('town-chip').addEventListener('click', () => {
    const ts = townState(Date.now());
    if (ts.state === 'live' || ts.state === 'lobby') startSession({ town: true });
    else if (ts.state === 'done') {
      toast('Tonight’s 8:02 just wrapped. Same time tomorrow.');
    } else {
      const mins = Math.round(ts.msToStart / 60000);
      toast(mins > 90
        ? 'Every evening at 6:02 — six minutes, the whole town on the same inhale.'
        : `Doors open at 5:57 — ${mins} ${mins === 1 ? 'minute' : 'minutes'} from now.`);
    }
  });

  $('end-early').addEventListener('click', () => finishSession(false));
  $('end-done').addEventListener('click', () => { refreshFront(); show('front'); });
  $('end-again').addEventListener('click', () => startSession());
  $('felt-worse').addEventListener('click', () => {
    pickTechnique('porch');
    refreshFront(); show('front');
    toast('Fair. Try Front Porch — eyes open, no breath counting. Or just stop for today; that’s fine too.');
  });

  $('go-shore').addEventListener('click', () => { refreshShore(); show('shore'); });
  $('shore-back').addEventListener('click', () => { refreshFront(); show('front'); });
  $('go-bench').addEventListener('click', () => { show('bench'); });
  $('bench-back').addEventListener('click', () => { refreshFront(); show('front'); });
  $('plaque-more').addEventListener('click', () => { show('bench'); });

  $('reset-history').addEventListener('click', () => {
    if (confirm('Clear your practice history on this device? The town’s totals keep what you already contributed.')) {
      // The month ledger survives the reset invisibly: the backend keeps
      // each player's greatest cumulative-seconds value, so zeroing it here
      // would make post-reset practice vanish until the new total caught up.
      const keep = { monthKey: stats.monthKey, monthSec: stats.monthSec };
      stats = { ...freshStats(), ...keep };
      saveStats(); refreshShore(); drawMaple();
    }
  });

  for (const btn of document.querySelectorAll('#anchor-chips .chip')) {
    btn.addEventListener('click', () => {
      const a = btn.dataset.anchor;
      if (a) { stats.anchor = a; saveStats(); toast(`${a}, you breathe. We’ll hold you to nothing.`); }
      const sheet = $('anchor-sheet');
      sheet.dataset.open = 'false';
      sheet.inert = true;
      refreshFront();
    });
  }

  // Interruption contract: hidden page = session pauses honestly.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session) {
      finishSession(false);
      toast('Session ended when the screen went away.');
    } else if (!document.hidden) {
      paintAmbience();
    }
  });
  window.addEventListener('pagehide', () => { if (session) finishSession(false); else net.leave(); });

  // keyboard: space/enter starts or stops
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    if (session) finishSession(false);
    else if (document.body.dataset.view === 'front') startSession();
  });

  wireThumbZone();
  buildNotePresets();
  buildBench();

  // ambience + the 8:02 chip keep pace with the real clock (30s so the
  // lobby/live/done transitions never look stale for long)
  setInterval(() => { if (!session && document.body.dataset.view === 'front') refreshFront(); }, 30000);

  // idle breath: the lake breathes gently on the front door too
  (function idle() {
    if (!session) {
      const t = Date.now() % 10000;
      setBreathVar(breathLevel(TECHNIQUES.lake, t) * 0.35);
    }
    requestAnimationFrame(idle);
  })();
}

// service worker: register late, never during a session
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* fine */ });
  });
}

wire();
pickTechnique('lake');
refreshFront();
show('front');

// A submit that died with the tab (or offline) retries here: the score is
// the cumulative month total, so re-sending the current value heals any gap.
if (stats.monthSec > 0 && stats.monthKey === nyMonthKey(Date.now())) {
  net.submitMonthSeconds(stats.monthSec);
}
window.addEventListener('online', () => {
  if (stats.monthSec > 0 && stats.monthKey === nyMonthKey(Date.now())) {
    net.submitMonthSeconds(stats.monthSec);
  }
});
