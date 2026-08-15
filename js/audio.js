// Lake Breath — synthesized breath audio. Zero assets: an oscillator pair
// swells with the inhale and decays with the exhale, plus a struck-bell
// tone for session close. All scheduling runs on the AudioContext clock.
//
// iOS realities handled here:
// - AudioContext starts suspended → resume() inside the user's Begin tap.
// - The ringer switch mutes Web Audio by default → we try the AudioSession
//   API ('playback') in a try/catch, and restore 'auto' on session end.
//   Where unsupported, sound honestly follows the silent switch.
// - Interruptions (calls, Siri) → 'statechange' marks us dead until the
//   next user gesture resumes.

let ctx = null;
let master = null;
let enabled = true;      // the user's sound toggle
let running = false;     // a breath session is being scored
let voices = [];         // active nodes to silence on stop

export function soundEnabled() { return enabled; }
export function setSoundEnabled(on) {
  enabled = !!on;
  if (!on) stopAll();
}

// Must be called from a user gesture (the Begin tap).
export function unlock() {
  if (!enabled) return false;
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
    }
    if (ctx.state !== 'running') ctx.resume();
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* fine */ }
    return true;
  } catch {
    return false;
  }
}

export function releaseSession() {
  running = false;
  stopAll();
  try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch { /* fine */ }
}

function stopAll() {
  for (const v of voices) {
    try { v.gain.gain.cancelScheduledValues(0); v.gain.gain.value = 0; v.osc.stop(); } catch { /* already gone */ }
  }
  voices = [];
}

// Schedule one breath segment's sound at an exact context time.
// kind: 'in' | 'in2' | 'out'; holds and rests are silence.
function scheduleSwell(kind, startT, durS) {
  if (!ctx || !enabled) return;
  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  const base = kind === 'out' ? 196 : 220; // G3 falling vs A3 rising
  osc.type = 'sine';
  osc2.type = 'sine';
  osc.frequency.setValueAtTime(base, startT);
  osc2.frequency.setValueAtTime(base * 1.5, startT); // a fifth, quiet
  const peak = kind === 'in2' ? 0.16 : 0.22;
  gain.gain.setValueAtTime(0.0001, startT);
  if (kind === 'out') {
    // exhale: begin full, long decay — the sound of settling
    gain.gain.setValueAtTime(peak, startT);
    osc.frequency.linearRampToValueAtTime(base * 0.84, startT + durS);
    gain.gain.exponentialRampToValueAtTime(0.0001, startT + durS);
  } else {
    // inhale: swell up
    osc.frequency.linearRampToValueAtTime(base * 1.12, startT + durS);
    gain.gain.exponentialRampToValueAtTime(peak, startT + durS * 0.85);
    gain.gain.exponentialRampToValueAtTime(0.0001, startT + durS + 0.4);
  }
  const g2 = ctx.createGain();
  g2.gain.value = 0.25;
  osc2.connect(g2).connect(gain);
  osc.connect(gain);
  gain.connect(master);
  osc.start(startT); osc2.start(startT);
  osc.stop(startT + durS + 0.6); osc2.stop(startT + durS + 0.6);
  voices.push({ osc, gain });
  if (voices.length > 12) voices.splice(0, voices.length - 12);
}

// The session loop calls this each animation frame with the technique and
// session-relative ms; we keep roughly one cycle scheduled ahead.
let scheduledThrough = -1;
export function keepScheduled(tech, sessionT0Ms, nowMs) {
  if (!ctx || !enabled || ctx.state !== 'running') return;
  running = true;
  const cyc = tech.segments.reduce((a, s) => a + s.s, 0) * 1000;
  const into = nowMs - sessionT0Ms;
  const horizon = into + cyc * 1.2;
  let cursor = Math.max(scheduledThrough, Math.floor(into / cyc) * cyc);
  while (cursor < horizon) {
    let segStart = cursor;
    for (const seg of tech.segments) {
      if (segStart >= into - 50 && (seg.k === 'in' || seg.k === 'in2' || seg.k === 'out')) {
        const when = ctx.currentTime + Math.max(0.01, (segStart - into) / 1000);
        scheduleSwell(seg.k, when, seg.s);
      }
      segStart += seg.s * 1000;
    }
    cursor += cyc;
  }
  scheduledThrough = cursor;
}

export function resetSchedule() { scheduledThrough = -1; stopAll(); }

// A soft two-partial bell for session close (and the 8:02's shared ending).
export function bell() {
  if (!ctx || !enabled || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.02;
  for (const [freq, amp, dur] of [[523.25, 0.28, 4.5], [1046.5, 0.10, 3.2], [784, 0.06, 2.4]]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(amp, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t); osc.stop(t + dur);
  }
}

// A single quiet tick (used as the audible cue on phase turns when the
// device has no haptics and sound is on).
export function tick() {
  if (!ctx || !enabled || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 660;
  gain.gain.setValueAtTime(0.08, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(gain).connect(master);
  osc.start(t); osc.stop(t + 0.1);
}
