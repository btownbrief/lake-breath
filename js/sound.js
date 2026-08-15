// Lake Breath — the generative soundscape. Zero assets, everything
// synthesized: the canonical three-layer water stack (rumble bed, LFO
// swell, crest laps), a slowly-voiced pad that brightens with morning and
// deepens at night, convolution reverb from a generated impulse, slow
// stereo drift, per-phase breath cues, a synthesized bowl for endings,
// and — rarely, at night — something like a loon far out on the water.
//
// iOS notes handled: gesture-gated resume, audioSession 'playback' where
// available, interrupted-state recovery, fade-then-suspend on hide.

import { nyParts } from './engine.js';

let ctx = null, master = null, verb = null, layers = null;
let enabled = true, ambientOn = false, loonTimer = 0, suspendTimer = 0;

export function soundEnabled() { return enabled; }
export function setSoundEnabled(on) {
  enabled = !!on;
  if (!on) {
    stopAmbient();
    // silence everything already in flight (bowl tails, cues, loons)
    if (ctx && master) {
      try {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.1);
      } catch { /* fine */ }
    }
  } else if (ctx) {
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0.7, ctx.currentTime, 0.2);
    } catch { /* fine */ }
    startAmbient();
  }
}

function makeNoise(color = 'brown', seconds = 3) {
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(2, rate * seconds, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else d[i] = w;
    }
  }
  return buf;
}

function makeImpulse(seconds = 3.2, decay = 2.6) {
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(2, rate * seconds, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay);
    }
  }
  return buf;
}

function loopNoise(buf) {
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true; src.start();
  return src;
}

// Purely additive modulation: the param's base value is set ONCE by the
// caller; LFOs only ever contribute their oscillation on top. (A previous
// version reset the base here — two LFOs on one param silenced the layer.)
function lfo(freq, depth, param) {
  const osc = ctx.createOscillator();
  osc.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = depth;
  osc.connect(g).connect(param);
  osc.start();
  return osc;
}

export function unlock() {
  if (!enabled) return false;
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.7;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.ratio.value = 3;
      master.connect(comp).connect(ctx.destination);
      verb = ctx.createConvolver();
      verb.buffer = makeImpulse();
      const verbGain = ctx.createGain(); verbGain.gain.value = 0.5;
      verb.connect(verbGain).connect(master);
      ctx.addEventListener('statechange', () => {
        if (ctx.state === 'running' && enabled && !ambientOn) startAmbient();
      });
    }
    if (ctx.state !== 'running') ctx.resume();
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* fine */ }
    if (!ambientOn) startAmbient();
    return true;
  } catch { return false; }
}

// ------------------------------------------------------------- ambience

function startAmbient() {
  if (!ctx || ambientOn || !enabled) return;
  ambientOn = true;
  const brown = makeNoise('brown'), white = makeNoise('white');
  const L = layers = { oscs: [], nodes: [] };

  // 1. rumble bed — the constant body of the lake
  {
    const src = loopNoise(brown);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
    const g = ctx.createGain(); g.gain.value = 0.055;
    L.oscs.push(lfo(0.031, 0.012, g.gain));
    src.connect(lp).connect(g).connect(master);
    L.nodes.push(src, lp, g);
  }
  // 2. swell — one wave every ~12s, cutoff and gain riding the same LFO,
  //    a second incommensurate LFO keeps it from ever repeating
  {
    const src = loopNoise(brown);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const g = ctx.createGain(); g.gain.value = 0.045;
    const pan = ctx.createStereoPanner(); pan.pan.value = 0;
    L.oscs.push(lfo(0.082, 320, lp.frequency));
    L.oscs.push(lfo(0.082, 0.035, g.gain));
    L.oscs.push(lfo(0.053, 0.018, g.gain));      // incommensurate drift
    L.oscs.push(lfo(0.017, 0.3, pan.pan));
    src.connect(lp).connect(g).connect(pan).connect(master);
    g.connect(verb);
    L.nodes.push(src, lp, g, pan);
  }
  // 3. laps — highpassed white, gated near each swell crest
  {
    const src = loopNoise(white);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1600;
    const g = ctx.createGain(); g.gain.value = 0.008;
    L.oscs.push(lfo(0.082, 0.010, g.gain));
    const pan = ctx.createStereoPanner(); pan.pan.value = 0.1;
    L.oscs.push(lfo(0.023, 0.35, pan.pan));
    src.connect(hp).connect(g).connect(pan).connect(master);
    L.nodes.push(src, hp, g, pan);
  }
  // 4. the pad — root+fifth+octave, detuned and drifting, voiced by
  //    Burlington's hour (product time is NY everywhere)
  {
    const hour = nyParts(Date.now()).hour;
    const root = hour < 6 ? 98.0 : hour < 11 ? 146.8 : hour < 18 ? 130.8 : 110.0; // G2/D3/C3/A2
    for (const [ratio, amp] of [[1, 0.030], [1.5, 0.018], [2, 0.014], [2.997, 0.006]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = root * ratio;
      L.oscs.push(lfo(0.05 + Math.random() * 0.06, 4, osc.detune));
      const g = ctx.createGain(); g.gain.value = amp;
      L.oscs.push(lfo(0.02 + Math.random() * 0.03, amp * 0.5, g.gain));
      osc.connect(g).connect(verb);
      osc.start();
      L.oscs.push(osc);
      L.nodes.push(g);
    }
  }
}

function stopAmbient() {
  if (!layers) { ambientOn = false; return; }
  try {
    for (const o of layers.oscs) { try { o.stop(); } catch { /* not startable */ } }
    for (const n of layers.nodes) { try { n.disconnect(); } catch { /* fine */ } }
  } catch { /* fine */ }
  layers = null; ambientOn = false;
}

export function fadeOutAndSuspend() {
  if (!ctx) return;
  try {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15);
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => { try { ctx.suspend(); } catch { /* fine */ } }, 500);
  } catch { /* fine */ }
}
export function resumeFromGesture() {
  if (!ctx || !enabled) return;
  clearTimeout(suspendTimer); // a rapid return must not be re-suspended
  try {
    ctx.resume();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0.7, ctx.currentTime, 0.4);
  } catch { /* fine */ }
}

// ------------------------------------------------- the continuous voice

// A quiet tone that RIDES the breath — pitch and volume rise with the
// inhale and settle with the exhale, so the ear always knows where the
// breath is, not just when it turns. Updated ~10x/sec from the app loop.
let voice = null;
export function voiceStart() {
  if (!ctx || !enabled || ctx.state !== 'running' || voice) return;
  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'triangle'; osc2.type = 'sine';
  osc.frequency.value = 220; osc2.frequency.value = 331;
  const g2 = ctx.createGain(); g2.gain.value = 0.35;
  g.gain.value = 0.0001;
  osc.connect(g); osc2.connect(g2).connect(g);
  g.connect(verb);
  const dry = ctx.createGain(); dry.gain.value = 0.4;
  g.connect(dry).connect(master);
  osc.start(); osc2.start();
  voice = { osc, osc2, g };
}
export function voiceLevel(level) {
  if (!voice || !ctx) return;
  const t = ctx.currentTime;
  const f = 196 + level * 130;               // G3 rising toward a fifth up
  voice.osc.frequency.setTargetAtTime(f, t, 0.12);
  voice.osc2.frequency.setTargetAtTime(f * 1.5, t, 0.12);
  voice.g.gain.setTargetAtTime(0.012 + level * 0.05, t, 0.15);
}
export function voiceStop() {
  if (!voice || !ctx) return;
  const v = voice; voice = null;
  try {
    v.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
    setTimeout(() => { try { v.osc.stop(); v.osc2.stop(); v.g.disconnect(); } catch { /* fine */ } }, 1500);
  } catch { /* fine */ }
}

// --------------------------------------------------------- breath cues

// A soft cue at each phase turn: inhale = rising warm tone; exhale = a
// longer settling fall — both through the reverb so they live in the room.
export function cue(kind, durS = 4) {
  if (!ctx || !enabled || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.02;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  const base = kind === 'out' ? 392 : kind === 'in2' ? 494 : 440;
  osc.frequency.setValueAtTime(base, t);
  osc.frequency.linearRampToValueAtTime(kind === 'out' ? base * 0.8 : base * 1.12, t + durS * 0.9);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(kind === 'out' ? 0.05 : 0.04, t + 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + durS);
  osc.connect(g).connect(verb);
  osc.start(t); osc.stop(t + durS + 0.2);
}

// The bowl: inharmonic partials with long decays — the session's receipt.
export function bowl() {
  if (!ctx || !enabled || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.03;
  for (const [ratio, amp, dur] of [[1, 0.32, 9], [2.71, 0.10, 6.5], [5.42, 0.045, 4.5], [1.005, 0.18, 8]]) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 261.6 * ratio;
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(verb);
    osc.start(t); osc.stop(t + dur + 0.2);
  }
}

// Far out on the water, sometimes, at night.
export function maybeLoon(nightAmount) {
  if (!ctx || !enabled || ctx.state !== 'running' || nightAmount < 0.5) return;
  const now = performance.now() / 1000;
  if (now < loonTimer) return;
  loonTimer = now + 90 + Math.random() * 150;
  const t = ctx.currentTime + 0.05;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  const vib = ctx.createOscillator(); vib.frequency.value = 5.5;
  const vibG = ctx.createGain(); vibG.gain.value = 9;
  vib.connect(vibG).connect(osc.detune);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(690, t);
  osc.frequency.linearRampToValueAtTime(740, t + 0.5);
  osc.frequency.linearRampToValueAtTime(560, t + 1.8);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.022, t + 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
  osc.connect(g).connect(verb);
  osc.start(t); osc.stop(t + 2.3); vib.start(t); vib.stop(t + 2.3);
}

export function audioCtx() { return ctx; }

export function releaseSession() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch { /* fine */ }
}
