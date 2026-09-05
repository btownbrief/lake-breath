// Lake Breath: real skies. Stephen's own Lake Champlain photographs (his
// @btownbrief posts) sit above the waterline; the shader lake below keeps
// moving and reflects them. Nothing here touches the DOM beyond an
// offscreen canvas for colour sampling; the scene owns the texture.
//
// `horizon` is where the waterline sits in the photo (fraction from the
// top); the scene maps it onto its own line. `cx` is where the interesting
// part of the sky is (the sun, mostly), so a portrait crop keeps it.
// Pools follow engine.skyPhase(); night has no photo on purpose, the
// shader's stars are the better night.

export const PHOTOS = [
  { file: 'golden-dock.jpg',    horizon: 0.71, cx: 0.55, pool: 'golden' },
  { file: 'golden-sail.jpg',    horizon: 0.53, cx: 0.55, pool: 'golden' },
  { file: 'golden-sun.jpg',     horizon: 0.56, cx: 0.22, pool: 'golden' },
  { file: 'golden-streaks.jpg', horizon: 0.60, cx: 0.50, pool: 'golden', seasons: ['stick', 'winter', 'mud'] },
  { file: 'dusk-pink.jpg',      horizon: 0.575, cx: 0.45, pool: 'dusk' },
  { file: 'dusk-embers.jpg',    horizon: 0.75, cx: 0.50, pool: 'dusk' },
  { file: 'dusk-pale.jpg',      horizon: 0.61, cx: 0.50, pool: 'dusk', seasons: ['winter', 'mud', 'stick'] },
  { file: 'dusk-winter.jpg',    horizon: 0.70, cx: 0.50, pool: 'dusk', seasons: ['winter', 'stick'] },
  { file: 'day-sails.jpg',      horizon: 0.44, cx: 0.50, pool: 'day' },
  { file: 'day-pine.jpg',       horizon: 0.44, cx: 0.62, pool: 'day', seasons: ['spring', 'summer', 'foliage'] },
  { file: 'day-rays.jpg',       horizon: 0.60, cx: 0.50, pool: 'day' },
];

const POOL_FOR = { golden: 'golden', dusk: 'dusk', dawn: 'dusk', morning: 'day', day: 'day' };

// One photo per phase per Burlington day, so the sky changes with the
// hours and again tomorrow, never mid-sit. `dayIndex` is a small integer
// from engine.dailyIndex. Returns null for phases with no photo.
export function pickPhoto(phase, season, dayIndex) {
  const pool = POOL_FOR[phase];
  if (!pool) return null;
  const all = PHOTOS.filter((p) => p.pool === pool);
  const inSeason = all.filter((p) => !p.seasons || p.seasons.includes(season));
  const list = inSeason.length ? inSeason : all;
  if (!list.length) return null;
  return list[Math.abs(dayIndex || 0) % list.length];
}

const cache = new Map(); // file -> Promise<{img, colors}>

// Loads a photo and reads two colours off it: the sky just above the
// waterline and the sky at the top, so the water, the bloom, and the
// chrome can take their palette from the real evening instead of a table.
export function loadPhoto(entry) {
  if (!entry) return Promise.resolve(null);
  if (cache.has(entry.file)) return cache.get(entry.file);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ img, entry, colors: sampleColors(img, entry.horizon) });
    img.onerror = () => resolve(null);
    img.src = `assets/photos/${entry.file}`;
  });
  cache.set(entry.file, p);
  return p;
}

function sampleColors(img, horizon) {
  try {
    const N = 48;
    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, N, N);
    const px = ctx.getImageData(0, 0, N, N).data;
    const avg = (y0, y1) => {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = Math.max(0, Math.floor(y0 * N)); y < Math.min(N, Math.ceil(y1 * N)); y++) {
        for (let x = 0; x < N; x++) {
          const i = (y * N + x) * 4;
          r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
        }
      }
      return n ? [r / n / 255, g / n / 255, b / n / 255] : null;
    };
    const skyTop = avg(0, horizon * 0.25);
    const skyLow = avg(Math.max(0, horizon - 0.10), horizon);
    if (!skyTop || !skyLow) return null;
    return { skyTop, skyLow };
  } catch {
    return null; // a tainted canvas or no 2D context: the palette stays painted
  }
}
