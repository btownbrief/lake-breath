// Lake Breath — Steady: the accelerometer as a meditation anchor.
// Hold the phone flat, screen up, or upright in either orientation. The
// first steady pose becomes home. Tilt sends the bubble wandering; motion
// churns the lake underneath it.
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
let tiltX = 0, tiltY = 0;   // smoothed displacement from home, in g
let lastEvent = 0;          // performance.now() of the last real reading
let posture = 0;            // 0..1, confidence in flat or upright holding
let mode = 'flat';
let uprightBase = null;
let motionFixture = false;
try { motionFixture = new URLSearchParams(location.search).get('motionfix') === '1'; } catch { /* node or no URL */ }

export function supported() {
  return motionFixture || typeof DeviceMotionEvent !== 'undefined';
}

// Must be called from a user gesture. Resolves true only once motion data
// is actually FLOWING — permission can be granted on a device whose sensor
// never reports (or a desktop with the API but no hardware), and a practice
// that silently reads zero forever is worse than an honest no.
export async function start() {
  if (!supported()) return false;
  if (motionFixture) { listening = true; return true; }
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
  churn = 0; tiltX = 0; tiltY = 0; posture = 0; lastEvent = 0;
  mode = 'flat'; uprightBase = null;
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

  // ---- the bubble. Gravity along z means flat; gravity in the screen
  // plane means upright. Hysteresis keeps the mode from fluttering halfway
  // between the two. Upright calibrates to the pose in the person's hand,
  // so portrait and landscape both have a natural centre.
  const az = Math.abs(a.z || 0);
  const flatNow = Math.max(0, Math.min(1, (az - 6.4) / 2.6));
  const uprightNow = Math.max(0, Math.min(1, (Math.hypot(a.x || 0, a.y || 0) - 6.4) / 2.6));
  const nextMode = uprightNow > flatNow ? 'upright' : 'flat';
  if (nextMode !== mode && Math.abs(uprightNow - flatNow) > 0.18) {
    mode = nextMode;
    tiltX = 0; tiltY = 0;
    uprightBase = mode === 'upright'
      ? { x: (a.x || 0) / 9.8, y: (a.y || 0) / 9.8, z: (a.z || 0) / 9.8 }
      : null;
  }
  const g = 9.8;
  const poseNow = mode === 'upright' ? uprightNow : flatNow;
  const kPose = 1 - Math.exp(-dt * 6);
  posture += (poseNow - posture) * kPose;
  // time-based smoothing: same feel at 20Hz or 60Hz
  const k = 1 - Math.exp(-dt * 4.5);
  let targetX = (a.x || 0) / g;
  let targetY = (a.y || 0) / g;
  if (mode === 'upright' && uprightBase) {
    const portrait = Math.abs(uprightBase.y) >= Math.abs(uprightBase.x);
    targetX = portrait ? (a.x || 0) / g - uprightBase.x : (a.y || 0) / g - uprightBase.y;
    targetY = (a.z || 0) / g - uprightBase.z;
  }
  tiltX += (targetX - tiltX) * k;
  tiltY += (targetY - tiltY) * k;
}

export function getChurn() { return motionFixture && listening ? 0.02 : listening ? churn : 0; }
export function spiked() {
  if (motionFixture) return false;
  const s = performance.now() - lastSpike < 120;
  return s;
}

// {x, y} in g, smoothed around the active pose. `flat` keeps the engine's
// established field name, but now means that either supported pose is
// confidently held. `mode` lets the UI name what was auto-picked.
export function getTilt() {
  if (!listening) return { x: 0, y: 0, flat: 0 };
  if (motionFixture) return { x: 0.025, y: -0.018, flat: 0.95, mode: 'flat' };
  return { x: tiltX, y: tiltY, flat: posture, mode };
}
