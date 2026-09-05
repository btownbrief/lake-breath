// Lake Breath — tiered haptics, honestly.
//
// Tier 1 (Android Chrome/Firefox): navigator.vibrate() works after any
//   user activation; we pace the whole breath with gentle patterns.
// Tier 2 (iOS): there is NO timed web vibration. As of iOS 26.5 even the
//   scripted checkbox-switch trick is dead. What survives is a real finger
//   toggle on a genuine native <input type="checkbox" switch>, which fires
//   one system tick. So on iOS the design inverts: the USER'S press and
//   release are the haptic moments — the thumb-on-the-water interaction
//   routes through an invisible-but-native switch, and each real contact
//   ticks. We never fake it, and the practice never depends on it.
// Tier 0: nothing available; visuals + audio carry the whole practice.

const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;

// iOS detection only decides whether to MOUNT the switch experiment; all
// actual behavior is native (a real control the finger really toggles).
const isIOS = typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export function tier() {
  if (canVibrate) return 'vibrate';
  if (isIOS) return 'switch';
  return 'none';
}

// ---- Tier 1: vibration patterns --------------------------------------

// Called on each phase turn. Patterns stay far slower than the breath —
// fast buzzing measurably raises arousal, the opposite of the point.
export function phaseTurn(kind) {
  if (!canVibrate) return;
  try {
    if (kind === 'in') navigator.vibrate([18, 90, 24]);        // gentle double: rise
    else if (kind === 'in2') navigator.vibrate(14);
    else if (kind === 'out') navigator.vibrate(40);            // single longer: release
    else if (kind === 'bell') navigator.vibrate([30, 120, 30, 120, 60]);
    else navigator.vibrate(0);
  } catch { /* fine */ }
}

export function sharedTick() {
  if (canVibrate) { try { navigator.vibrate(60); } catch { /* fine */ } }
}

export function stop() {
  if (canVibrate) { try { navigator.vibrate(0); } catch { /* fine */ } }
}

// ---- Tier 2: the iOS native-switch experiment ------------------------

// Mounts a genuine switch inside the touch zone. It keeps native
// appearance (restyling kills the haptic) but is visually faded inside an
// overflow container; hit-area is stretched via the label. It is ALSO a
// real accessible control: labeled and focusable.
//
// Honesty about what iOS gives us: a checkbox activates once per full
// tap (on release), so a long press-and-hold yields ONE tick, not a
// down-tick and an up-tick. The interaction copy says "tap with the turn
// of the breath" on iOS for exactly this reason. Visual held-state is
// driven separately by pointer events in app.js; this control only
// supplies the real system tick per genuine tap. If the platform ever
// stops ticking, nothing breaks.
export function mountSwitch(zoneEl, onTick) {
  if (!isIOS || canVibrate) return null;
  const label = document.createElement('label');
  label.className = 'thumb-switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  // 'switch' is the Safari 17.4+ attribute; harmless elsewhere.
  input.setAttribute('switch', '');
  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = 'Tap the water with the turn of each breath';
  label.append(input, sr);
  zoneEl.append(label);
  input.addEventListener('change', () => onTick());
  return { el: label };
}
