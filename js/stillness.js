// Lake Breath — Still Water: the accelerometer as a meditation anchor.
// Hold the phone like a bowl of water. Tilt and tremor churn the lake;
// true stillness lets it settle to glass.
//
// Output is a smoothed churn value 0..1: 0 = held perfectly still.
// iOS requires an explicit permission call from a user gesture
// (DeviceMotionEvent.requestPermission); Android just works over HTTPS.

let churn = 0;          // smoothed 0..1
let baseline = 9.81;    // slow-tracked gravity magnitude
let listening = false;
let lastSpike = 0;

export function supported() {
  return typeof DeviceMotionEvent !== 'undefined';
}

// Must be called from a user gesture. Resolves true when motion data flows.
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
    return true;
  } catch { return false; }
}

export function stop() {
  if (listening) { window.removeEventListener('devicemotion', onMotion); listening = false; }
  churn = 0;
}

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
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
  if (raw > 0.45 && performance.now() - lastSpike > 700) lastSpike = performance.now();
}

export function getChurn() { return listening ? churn : 0; }
export function spiked() {
  const s = performance.now() - lastSpike < 120;
  return s;
}
