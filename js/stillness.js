// Lake Breath — Steady: the accelerometer as a meditation anchor.
// Hold the phone flat, screen up, like a full bowl of water. Tilt sends
// the bubble wandering; motion churns the lake underneath it.
//
// Two outputs:
//   getChurn() — smoothed 0..1 shake, 0 = held perfectly still (the lake)
//   getTilt()  — smoothed {x, y} in g, roughly -1..1 (the bubble)
// iOS requires an explicit permission call from a user gesture
// (DeviceMotionEvent.requestPermission); Android just works over HTTPS.

let churn = 0;          // smoothed 0..1
let baseline = 9.81;    // slow-tracked gravity magnitude
let listening = false;
let lastSpike = 0;
let tiltX = 0, tiltY = 0;   // smoothed, in g
let lastEvent = 0;          // performance.now() of the last real reading
let flat = 0;               // 0..1, how flat the phone is being held

export function supported() {
  return typeof DeviceMotionEvent !== 'undefined';
}

// Must be called from a user gesture. Resolves true only once motion data
// is actually FLOWING — permission can be granted on a device whose sensor
// never reports (or a desktop with the API but no hardware), and a practice
// that silently reads zero forever is worse than an honest no.
export async function start() {
  if (!supported()) return false;
  try {
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== 'granted') return false;
    }
    if (!listening) {
      window.addEventListener('devicemotion', onMotion);
      listening = true;
    }
    lastEvent = 0;
    return await new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (lastEvent > 0) { resolve(true); return; }
        if (performance.now() - t0 > 1500) { stop(); resolve(false); return; }
        setTimeout(tick, 60);
      };
      tick();
    });
  } catch { return false; }
}

export function stop() {
  if (listening) { window.removeEventListener('devicemotion', onMotion); listening = false; }
  churn = 0; tiltX = 0; tiltY = 0; flat = 0; lastEvent = 0;
}

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const now = performance.now();
  const dt = lastEvent ? Math.min(0.25, (now - lastEvent) / 1000) : 0.05;
  lastEvent = now;

  const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  baseline += (mag - baseline) * 0.02;            // gravity drifts slowly
  const dev = Math.abs(mag - baseline);
  // rotation shows in accel too via gravity redistribution; add it
  const rot = e.rotationRate
    ? (Math.abs(e.rotationRate.alpha || 0) + Math.abs(e.rotationRate.beta || 0) +
       Math.abs(e.rotationRate.gamma || 0)) / 300
    : 0;
  const raw = Math.min(1, dev / 1.6 + rot);
  // fast attack, slow release — a jolt churns instantly, calm settles slowly
  churn = raw > churn ? churn + (raw - churn) * 0.5 : churn + (raw - churn) * 0.03;
  if (raw > 0.45 && now - lastSpike > 700) lastSpike = now;

  // ---- the bubble. Only meaningful when the phone is roughly flat, so we
  // track flatness (z dominant) and fade the tilt out as the phone stands
  // up rather than flinging the bubble to a corner.
  const az = Math.abs(a.z || 0);
  const flatNow = Math.max(0, Math.min(1, (az - 6.4) / 2.6));
  const g = 9.8;
  const kFlat = 1 - Math.exp(-dt * 6);
  flat += (flatNow - flat) * kFlat;
  // time-based smoothing: same feel at 20Hz or 60Hz
  const k = 1 - Math.exp(-dt * 4.5);
  tiltX += ((a.x || 0) / g - tiltX) * k;
  tiltY += ((a.y || 0) / g - tiltY) * k;
}

export function getChurn() { return listening ? churn : 0; }
export function spiked() {
  const s = performance.now() - lastSpike < 120;
  return s;
}

// {x, y} in g, already smoothed and faded by flatness. x positive = the
// phone's right edge is low; y positive = the top edge is low.
export function getTilt() {
  if (!listening) return { x: 0, y: 0, flat: 0 };
  return { x: tiltX * flat, y: tiltY * flat, flat };
}
