// Lake Breath — Steady: the accelerometer as a meditation anchor.
// Hold the phone flat, screen up, or upright in either orientation. The
// first steady pose becomes home. Tilt sends the bubble wandering; motion
// churns the lake underneath it.
//
// Three outputs:
//   getChurn() — smoothed 0..1 shake, 0 = held perfectly still (the lake)
//   getTilt()  — smoothed {x, y} in g, roughly -1..1 (the bubble)
//   isHeld()   — is there a living hand under the phone. A hand is never
//                perfectly still: physiological tremor and the breath keep
//                the accelerometer and gyro whispering. A phone laid on a
//                table reads flat, centred, and dead quiet, and Steady
//                must not count that as stillness. Below the sensor's own
//                noise floor for a few seconds means "resting", and the
//                engine gives resting time no credit.
//
// recenter() makes the current pose home, so a hand that has settled into
// a new position is not stuck watching the bubble sit off-centre.
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
let homeX = 0, homeY = 0;      // recenter offset, in the active mode's frame
let rawX = 0, rawY = 0;        // the un-offset smoothed tilt, so recenter can read it
// hand-vs-table: slow trackers of the sensor's fine motion
let microAcc = 0;              // smoothed |accel deviation| in m/s^2
let microRot = 0;              // smoothed |rotation rate| in deg/s
let hasGyro = false;
let quietSec = 0;              // continuous seconds under the noise floor
let resting = false;
let liveSec = 0;               // continuous seconds above it while resting
let motionFixture = false;   // '1' = a calm hand, 'table' = set down
let fixtureTable = false;
try {
  const fx = new URLSearchParams(location.search).get('motionfix');
  motionFixture = fx === '1' || fx === 'table';
  fixtureTable = fx === 'table';
} catch { /* node or no URL */ }

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
  homeX = 0; homeY = 0; rawX = 0; rawY = 0;
  microAcc = 0; microRot = 0; quietSec = 0; liveSec = 0; resting = false;
}

// Noise floors. A phone on a hard surface sits well under both; a hand,
// even a very steady one, sits well over at least one. Both channels have
// to be quiet for the phone to read as set down, and it has to stay that
// way for a few seconds, so a single calm breath in a good hand is never
// mistaken for a table. Devices without a gyro use the accelerometer alone
// with a tighter floor.
const REST_ACC = 0.035;        // m/s^2, smoothed deviation from gravity
const REST_ACC_ONLY = 0.022;
const REST_ROT = 0.35;         // deg/s, smoothed rotation rate
const REST_AFTER_SEC = 3;      // this quiet, this long, is a surface
const LIVE_AFTER_SEC = 0.4;    // and this much life brings the hand back

function trackHand(dev, rotMag, hasRot, dt) {
  // ~1.2 s time constant: tremor is 8-12 Hz, so a second of it is plenty,
  // and a table's floor is reached in about the same time
  const k = 1 - Math.exp(-dt / 1.2);
  microAcc += (dev - microAcc) * k;
  if (hasRot) { hasGyro = true; microRot += (rotMag - microRot) * k; }
  const quiet = hasGyro
    ? microAcc < REST_ACC && microRot < REST_ROT
    : microAcc < REST_ACC_ONLY;
  if (quiet) { quietSec += dt; liveSec = 0; }
  else { liveSec += dt; quietSec = 0; }
  if (!resting && quietSec > REST_AFTER_SEC) resting = true;
  if (resting && liveSec > LIVE_AFTER_SEC) resting = false;
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
  const rotMag = e.rotationRate
    ? Math.hypot(e.rotationRate.alpha || 0, e.rotationRate.beta || 0, e.rotationRate.gamma || 0)
    : 0;
  trackHand(dev, rotMag, !!(e.rotationRate && e.rotationRate.alpha != null), dt);
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
    tiltX = 0; tiltY = 0; rawX = 0; rawY = 0; homeX = 0; homeY = 0;
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
  rawX += (targetX - rawX) * k;
  rawY += (targetY - rawY) * k;
  tiltX = rawX - homeX;
  tiltY = rawY - homeY;
}

// Wherever the hand is right now becomes the centre of the ring. Flat and
// upright both keep their own frame; the offset just moves with the mode.
export function recenter() {
  if (!listening) return;
  homeX = rawX; homeY = rawY;
  tiltX = 0; tiltY = 0;
}

// True while a hand is under the phone (or while nobody can tell: the
// fixture, or the first seconds before the trackers have settled).
export function isHeld() {
  if (!listening) return true;
  if (motionFixture) return !fixtureTable;
  return !resting;
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
