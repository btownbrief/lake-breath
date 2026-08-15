// Lake Breath v2 — the controller. One rAF drives everything: the WebGL
// lake, the bloom, the breath, sound cues, stillness. All decisions come
// from the pure engine; all words from content.js; DOM lives only here.

import {
  TECHNIQUES, phaseAt, breathLevel,
  townState, TOWN,
  seasonFor, skyPhase, nyParts, nyDateStr, nyMonthKey,
  freshStats, loadStatsFrom, recordSession, mapleStage, skyStrip,
  presenceLine,
} from './engine.js';
import { NOTE_PRESETS, presetById, PLAQUES, FIELD_NOTES, PORCH_INTRO, SAFETY_LINE } from './content.js';
import * as sound from './sound.js';
import * as haptics from './haptics.js';
import * as net from './net.js';
import * as still from './stillness.js';
import { LakeScene, palette, celestial } from './scene-gl.js';
import { Bloom } from './bloom.js';

const $ = (id) => document.getElementById(id);
const STATS_KEY = 'lakebreath-stats';
const STILL_GLASS = 0.12; // churn below this = the water reads as glass

// ------------------------------------------------------------- state

let stats = loadStatsFrom((() => {
  try { return localStorage.getItem(STATS_KEY) || ''; } catch { return ''; }
})());
let techKey = 'lake';
let durationSec = 300;
let session = null;
let wakeLock = null;
let quietTimer = 0;

function saveStats() {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* fine */ }
}

// ------------------------------------------------------------- scene

const scene = new LakeScene($('lake'));
if (!scene.ok) document.body.dataset.gl = 'off';
const bloom = new Bloom($('petals'));
const HORIZON = 0.60;

const PHASE_ORDER = ['night', 'dawn', 'morning', 'day', 'golden', 'dusk'];
function sceneState(nowMs, breath, churn) {
  const p = nyParts(nowMs);
  const season = seasonFor(nowMs);
  const phaseNow = skyPhase(nowMs);
  const phaseSoon = skyPhase(nowMs + 30 * 60000);
  const blend = phaseNow === phaseSoon ? 0 : (p.minute % 30) / 30;
  const pal = palette(phaseNow, phaseSoon, blend, season);
  const night = phaseNow === 'night' ? 1 : (phaseSoon === 'night' ? blend : (phaseNow === 'dusk' || phaseNow === 'dawn' ? 0.3 : 0));
  const dayFrac = (p.hour * 60 + p.minute) / 1440;
  const cel = celestial(dayFrac, night);
  return {
    breath, night, churn,
    horizon: HORIZON,
    ...pal, ...cel,
    bloom: bloom.presence * (0.4 + breath * 0.6),
    _phase: phaseNow, _season: season,
  };
}

// ------------------------------------------------------------- helpers

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.dataset.show = 'true';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.dataset.show = 'false'; }, 3000);
}

function openSheet(id) { const s = $(id); s.dataset.open = 'true'; s.inert = false; }
function closeSheet(id) { const s = $(id); s.dataset.open = 'false'; s.inert = true; }
function closeAllSheets() {
  for (const s of document.querySelectorAll('.sheet')) { s.dataset.open = 'false'; s.inert = true; }
}

const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, '0')}`;
const durLabel = (secs) => secs < 180 ? `${secs} sec` : `${Math.round(secs / 60)} min`;

// --------------------------------------------------------------- home

function greetingFor(nowMs) {
  const h = nyParts(nowMs).hour;
  if (h < 4) return 'The lake is still here.';
  if (h < 12) return 'Good morning.';
  if (h < 17) return 'Good afternoon.';
  if (h < 22) return 'Good evening.';
  return 'Up late.';
}

async function refreshHome() {
  const now = Date.now();
  $('greeting').textContent = greetingFor(now);
  const ts = townState(now);
  const ug = $('undergreeting');
  if (ts.state === 'lobby') {
    ug.innerHTML = 'The 8:02 is gathering — <b>the town breathes at 6:02</b>';
    $('begin').textContent = 'Join the 8:02';
  } else if (ts.state === 'live') {
    ug.innerHTML = '<b>The 8:02 is happening now</b>';
    $('begin').textContent = 'Join the 8:02';
  } else if (ts.state === 'done') {
    ug.textContent = 'Tonight’s 8:02 just ended — same time tomorrow.';
    $('begin').textContent = 'Breathe';
  } else {
    $('begin').textContent = 'Breathe';
    const n = await net.lookAround();
    const line = presenceLine(n ?? 0);
    if (line && document.body.dataset.view === 'front') {
      const [num, ...rest] = line.split(' ');
      ug.innerHTML = `<b>${num}</b> ${rest.join(' ')} right now`;
    } else if (stats.anchor) {
      ug.innerHTML = `<i>${stats.anchor}, I breathe.</i> The 8:02 is at 6:02 tonight.`;
    } else {
      ug.textContent = 'The 8:02 — every evening, the whole town on one inhale.';
    }
  }
}

function refreshPracticeLine() {
  $('practice-name').textContent = TECHNIQUES[techKey].name;
  $('practice-mins').textContent = durLabel(durationSec);
}

// ------------------------------------------------------ practice sheet

function buildPracticeSheet() {
  const wrap = $('practice-rows');
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
      lake: 'The daily practice — in four, out six. The water breathes with you.',
      sigh: 'Two sips in, one long sigh out. Ninety seconds to reset.',
      box: 'Four even sides. For people who already love it.',
      still: 'Hold the phone like a bowl of water. Motion churns the lake; stillness lets it turn to glass.',
      porch: 'Eyes open, no counting. For when watching the breath isn’t it.',
    }[key];
    row.append(name, tag);
    if (key === techKey) {
      const durs = document.createElement('span');
      durs.className = 'durations';
      for (const secs of tech.durations) {
        const b = document.createElement('button');
        b.textContent = durLabel(secs);
        b.setAttribute('aria-pressed', String(secs === durationSec));
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          durationSec = secs;
          refreshPracticeLine(); buildPracticeSheet();
        });
        durs.append(b);
      }
      row.append(durs);
    }
    row.addEventListener('click', () => {
      techKey = key;
      if (!tech.durations.includes(durationSec)) durationSec = tech.defaultDuration;
      refreshPracticeLine(); buildPracticeSheet();
      if (key !== techKey || true) closeSheet('practice-sheet');
    });
    wrap.append(row);
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

async function startSession({ town = false } = {}) {
  const key = town ? 'lake' : techKey;
  const tech = TECHNIQUES[key];
  const now = Date.now();
  let t0 = now, seconds = durationSec;
  if (town) {
    const ts = townState(now);
    if (ts.state !== 'live' && ts.state !== 'lobby') return;
    t0 = ts.start; seconds = TOWN.seconds;
  }
  if (tech.kind === 'still') {
    const ok = await still.start();
    if (!ok) { toast('Still Water needs motion access — your phone said no. Try another practice.'); return; }
  }
  sound.unlock();
  grabWakeLock();

  session = {
    key, tech, t0, seconds, town,
    startedAt: now, lastSegI: -1, porchStep: -1,
    stillSec: 0, lastT: performance.now(),
    presenceTimer: setInterval(async () => {
      const n = await net.beat();
      if (session) $('presence-live').textContent = presenceLine(n ?? 0) || '';
    }, 30000),
  };
  net.beat().then((n) => { if (session) $('presence-live').textContent = presenceLine(n ?? 0) || ''; });

  bloom.show(tech.kind === 'still' || tech.steps ? false : true);
  $('phase-word').textContent = '';
  $('phase-sub').textContent =
    town ? 'The 8:02 — the whole town, one clock'
      : tech.steps ? PORCH_INTRO
      : tech.kind === 'still' ? 'Set the water down gently. Let it settle.'
      : '';
  $('still-meter').textContent = '';
  $('remaining').textContent = '';
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

function sessionFrame(nowP) {
  const s = session;
  const now = Date.now();
  const t = now - s.t0;
  const dt = Math.min(0.05, (nowP - s.lastT) / 1000);
  s.lastT = nowP;

  if (t >= s.seconds * 1000) { finishSession(true); return 0; }

  if (s.tech.steps) {
    // Front Porch — grounding prompts, water rests
    const step = Math.min(s.tech.steps.length - 1, Math.floor(Math.max(0, t) / (s.tech.stepSeconds * 1000)));
    if (step !== s.porchStep) { s.porchStep = step; $('phase-sub').textContent = s.tech.steps[step]; sound.cue('in', 1.2); }
    updateRemaining(t, s);
    return 0.3;
  }

  if (s.tech.kind === 'still') {
    const churn = still.getChurn();
    const glassy = churn < STILL_GLASS;
    if (glassy) s.stillSec += dt;
    // a "stir": the glass broke — count it once, kindly, with a debounce
    if (!glassy && s.wasGlassy && nowP - (s.lastStir || 0) > 2500) {
      s.stirs = (s.stirs || 0) + 1;
      s.lastStir = nowP;
    }
    s.wasGlassy = glassy;
    $('still-meter').textContent = glassy
      ? `glass — ${fmt(s.stillSec)}`
      : 'the water is settling…';
    if (still.spiked()) scene.ripple(0.3 + Math.random() * 0.4, HORIZON + 0.1 + Math.random() * 0.2, 0.8);
    updateRemaining(t, s);
    return { breath: 0.25, churn };
  }

  if (t >= 0) {
    const level = breathLevel(s.tech, t);
    const p = phaseAt(s.tech, t);
    if (p.i !== s.lastSegI) {
      if (s.lastSegI === -1 && s.town) $('phase-sub').textContent = 'The 8:02 — the whole town, one clock';
      s.lastSegI = p.i;
      $('phase-word').textContent = PHASE_WORDS[p.k] || '';
      const seg = s.tech.segments[p.i];
      if (seg.k === 'in' || seg.k === 'in2' || seg.k === 'out') sound.cue(seg.k, seg.s);
      haptics.phaseTurn(seg.k);
    }
    updateRemaining(t, s);
    return level;
  }
  // 8:02 lobby
  const secs = Math.ceil(-t / 1000);
  $('phase-word').textContent = 'starting soon';
  $('phase-sub').textContent = `the town inhales together at 6:02 — ${fmt(secs)}`;
  return 0.1;
}

function updateRemaining(t, s) {
  const remain = Math.max(0, s.seconds - Math.floor(Math.max(0, t) / 1000));
  $('remaining').textContent = t >= 0 ? fmt(remain) : '';
}

function teardownSession() {
  if (!session) return;
  clearInterval(session.presenceTimer);
  still.stop();
  haptics.stop();
  dropWakeLock();
  net.leave();
  sound.releaseSession();
  clearTimeout(quietTimer);
  document.body.dataset.quiet = 'false';
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
  stats = recordSession(stats, Date.now(), practicedSec);
  if (s.key === 'still' && s.stillSec > (stats.glassBest || 0)) stats.glassBest = Math.round(s.stillSec);
  saveStats();
  if (stats.monthKey === nyMonthKey(Date.now())) net.submitMonthSeconds(stats.monthSec);
  const after = mapleStage(stats.daysPracticed);

  // ---- the release: the one moment we spend everything on
  if (completed && practicedSec >= 30) {
    bloom.release();
    sound.unlock(); sound.bowl(); haptics.phaseTurn('bell');
  }
  bloom.show(false);

  const mins = Math.round(practicedSec / 60);
  $('end-big').textContent =
    practicedSec >= 60 ? `${mins === 1 ? 'One quiet minute' : `${['','','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten'][mins] || mins} quiet minutes`}.`
    : practicedSec >= 30 ? `${practicedSec} quiet seconds.`
    : 'That’s okay.';
  $('end-sub').textContent =
    practicedSec < 30 ? 'Even sitting down counts for something. The lake will be here.'
    : s.town ? 'You breathed with the whole town tonight.'
    : s.key === 'still' ? `The water held glass for ${fmt(s.stillSec)}${
        s.stirs ? ` — it stirred ${s.stirs === 1 ? 'once' : s.stirs === 2 ? 'twice' : `${s.stirs} times`}` : ' — it never stirred'}.`
    : '';
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
    more.addEventListener('click', (e) => { e.preventDefault(); $('bench').dataset.open = 'true'; });
    plaque.append(more);
    stats.plaque += 1;
    if (stats.plaque >= PLAQUES.length) stats.plaquesDone = true;
    saveStats();
  } else plaque.hidden = true;

  refreshWall();
  $('note-sent').textContent = '';
  setTimeout(() => { document.body.dataset.view = 'end'; }, completed && practicedSec >= 30 ? 1500 : 150);

  if (stats.sessions === 1 && !stats.anchor && completed) {
    setTimeout(() => openSheet('anchor-sheet'), 4200);
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

function buildNoteSheet() {
  const wrap = $('note-rows');
  wrap.innerHTML = '';
  const day = parseInt(nyDateStr(Date.now()).slice(8), 10);
  const picks = [...NOTE_PRESETS].filter((_, i) => (i + day) % 3 !== 0).slice(0, 7);
  for (const p of picks) {
    const b = document.createElement('button');
    b.className = 'note-row';
    b.textContent = `${p.text} ${p.emoji}`;
    b.addEventListener('click', async () => {
      b.disabled = true;
      closeSheet('note-sheet');
      const ok = await net.sendNote(p.id);
      $('note-sent').textContent = ok
        ? 'Sent. It’s on the town wall for the next two days.'
        : 'Couldn’t send right now — one note every couple hours, or the lake is offline.';
      if (ok) refreshWall();
    });
    wrap.append(b);
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
    ? 'Your maple reached full canopy — day 66 is when habits take root.'
    : `Your maple is ${['a bare shore', 'a sprout', 'a seedling', 'a sapling', 'a young tree', 'a young tree', 'growing', 'growing', 'filling in', 'filling in', 'almost there'][m.stage]}. It only ever grows — full canopy lands around day 66.`;
  $('anchor-line').innerHTML = stats.anchor
    ? `<i>${stats.anchor}, I breathe.</i>`
    : 'No anchor yet — it’s offered after your first sit.';
  const mins = await net.townMinutes();
  $('town-line').innerHTML = mins != null && mins > 0
    ? `Burlington has taken <b>${mins.toLocaleString()}</b> quiet minutes together this month.`
    : '';
}

// -------------------------------------------------------------- bench

function buildBench() {
  $('bench-notes').innerHTML = FIELD_NOTES.map((n) =>
    `<h3></h3><p></p>`).join('');
  const hs = $('bench-notes').querySelectorAll('h3');
  const ps = $('bench-notes').querySelectorAll('p');
  FIELD_NOTES.forEach((n, i) => { hs[i].textContent = n.title; ps[i].textContent = n.body; });
  fetch('data/builder-note.json').then((r) => r.ok ? r.json() : null).then((note) => {
    if (note && note.body) {
      $('from-builder').hidden = false;
      $('builder-title').textContent = `From Stephen — ${note.date || ''}`;
      $('builder-body').textContent = note.body;
    }
  }).catch(() => { /* fine */ });
}

// ---------------------------------------------------------- main loop

let breathSmooth = 0;
let lastLoop = performance.now();
function loop(nowP) {
  const dt = Math.min(0.05, (nowP - lastLoop) / 1000);
  lastLoop = nowP;
  scene.resize();

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
    target = breathLevel(TECHNIQUES.lake, Date.now() % 10000) * 0.35;
  }
  breathSmooth += (target - breathSmooth) * Math.min(1, dt * 5);

  const st = sceneState(Date.now(), breathSmooth, churn);
  scene.draw(st);
  bloom.setColors(st.sunCol, st.skyLow);
  bloom.draw(breathSmooth, HORIZON, dt, idle);
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
  $('practice-line').addEventListener('click', () => { buildPracticeSheet(); openSheet('practice-sheet'); });
  $('stop').addEventListener('click', () => finishSession(false));
  $('end-done').addEventListener('click', () => { document.body.dataset.view = 'front'; refreshHome(); });
  $('end-again').addEventListener('click', () => { document.body.dataset.view = 'front'; startSession(); });
  $('felt-worse').addEventListener('click', () => {
    techKey = 'porch'; durationSec = TECHNIQUES.porch.defaultDuration;
    refreshPracticeLine();
    document.body.dataset.view = 'front'; refreshHome();
    toast('Fair. Front Porch is set — eyes open, no counting. Or just stop for today; that’s fine too.');
  });
  $('send-note').addEventListener('click', () => { buildNoteSheet(); openSheet('note-sheet'); });
  $('open-shore').addEventListener('click', () => { refreshShore(); openSheet('shore-sheet'); });
  $('open-bench').addEventListener('click', () => { $('bench').dataset.open = 'true'; });
  for (const b of document.querySelectorAll('[data-close]')) {
    b.addEventListener('click', () => {
      const id = b.dataset.close;
      if (id === 'bench') $('bench').dataset.open = 'false';
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

  // sound toggle lives in the top links, quiet
  const sBtn = document.createElement('button');
  sBtn.className = 'tbtn'; sBtn.textContent = 'sound on';
  sBtn.addEventListener('click', () => {
    const on = !sound.soundEnabled();
    sound.setSoundEnabled(on);
    if (on) sound.unlock();
    sBtn.textContent = on ? 'sound on' : 'sound off';
  });
  document.querySelector('.toplinks').prepend(sBtn);

  // touching the water makes ripples — your hand moves the world
  window.addEventListener('pointerdown', (e) => {
    const y = e.clientY / window.innerHeight;
    if (y > HORIZON) scene.ripple(e.clientX / window.innerWidth, y, 1);
    if (session) wakeQuietTimer();
    sound.resumeFromGesture();
  });

  // iOS: real system tick per genuine tap on a native control, no box
  haptics.mountSwitch($('tick-zone'), () => { /* the tick is the feedback */ });
  $('tick-zone').className = 'thumb-switch';

  // interruption contract: hidden = the session ends honestly
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (session) { finishSession(false); toast('Session ended when the screen went away.'); }
      sound.fadeOutAndSuspend();
    } else {
      sound.resumeFromGesture();
      refreshHome();
    }
  });
  window.addEventListener('pagehide', () => { if (session) finishSession(false); else net.leave(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAllSheets(); $('bench').dataset.open = 'false'; return; }
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLAnchorElement) return;
    e.preventDefault();
    if (session) finishSession(false);
    else if (document.body.dataset.view === 'front') startSession();
  });

  window.addEventListener('resize', () => { scene.resize(); bloom.resize(); });
  setInterval(() => { if (!session && document.body.dataset.view === 'front') refreshHome(); }, 30000);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* fine */ });
  });
}

wire();
buildBench();
refreshPracticeLine();
refreshHome();
bloom.show(true);
requestAnimationFrame(loop);

if (stats.monthSec > 0 && stats.monthKey === nyMonthKey(Date.now())) {
  net.submitMonthSeconds(stats.monthSec);
}
window.addEventListener('online', () => {
  if (stats.monthSec > 0 && stats.monthKey === nyMonthKey(Date.now())) {
    net.submitMonthSeconds(stats.monthSec);
  }
});
