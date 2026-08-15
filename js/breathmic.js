// Lake Breath — the lake hears you. Optional microphone listening that
// turns your real exhale into wind on the water. Everything stays on the
// phone: the audio stream feeds one analyser node and is never recorded,
// stored, or sent anywhere. Permission is asked only when the user asks.
//
// Detection is deliberately simple and robust: breath across or near a
// phone mic reads as broadband noise well above the room's floor. We
// track a slow noise floor and report how far above it the moment is.

let stream = null, analyser = null, data = null;
let floor = 0.01, level = 0;

export function active() { return !!analyser; }

export async function start(audioCtx) {
  if (analyser) return true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser); // analyser only — never routed to output
    data = new Float32Array(analyser.fftSize);
    floor = 0.01; level = 0;
    return true;
  } catch {
    stop();
    return false;
  }
}

export function stop() {
  try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* fine */ }
  stream = null; analyser = null; data = null; level = 0;
}

// 0..1 — how much breath the mic hears right now. Call per frame.
export function read() {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / data.length);
  // the floor rises slowly and falls even more slowly — steady room noise
  // disappears, an exhale stands out
  floor += (rms - floor) * (rms > floor ? 0.002 : 0.01);
  const raw = Math.max(0, Math.min(1, (rms - floor * 1.8) / 0.08));
  level += (raw - level) * (raw > level ? 0.3 : 0.06);
  return level;
}
