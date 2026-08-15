// Lake Breath — the living lake. One WebGL2 fullscreen quad, one fragment
// shader, zero dependencies: real moving water with a sun/moon glitter
// path, a scattering sky, Adirondack ridges, stars, and touch ripples.
// The whole scene breathes off the same clock as the UI via u_breath.
//
// Palette math (time-of-day, season) happens in JS each frame and feeds
// the shader as color uniforms — the shader stays simple and fast.
// Renders at reduced resolution (soft water hides the upscale) with DPR
// capped; pauses when hidden; falls back to a CSS gradient if WebGL dies.

const VERT = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 O;
uniform vec2 u_res;
uniform float u_time;      // seconds
uniform float u_breath;    // 0 exhaled .. 1 inhaled
uniform float u_night;     // 0 day .. 1 deep night
uniform float u_horizon;   // waterline y in uv (from top)
uniform vec3 u_skyTop, u_skyLow, u_waterHi, u_waterLo, u_sunCol, u_ridge;
uniform vec2 u_sun;        // sun/moon position in uv
uniform float u_sunSize;
uniform vec4 u_ripple[5];  // x, y(uv), birth(sec), strength
uniform float u_bloom;     // glow under the bloom (0..1)
uniform float u_churn;     // Still Water: device motion churns the lake

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0., a = .5;
  for (int i = 0; i < 3; i++){ v += a * noise(p); p *= 2.13; a *= .5; }
  return v;
}
// Adirondack ridge line: layered slow noise
float ridge(float x, float seed){
  return noise(vec2(x * 3.1 + seed, seed)) * .55 + noise(vec2(x * 9.7 + seed, seed * 2.)) * .18;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;      // 0,0 bottom-left
  float y = 1. - uv.y;                    // from top
  float breath = u_breath;
  float horizon = u_horizon + breath * .010; // lake rises with the inhale
  vec3 col;

  float sunGlow = 0.;
  if (y < horizon) {
    // ---- sky
    float t = y / horizon;                 // 0 top .. 1 horizon
    col = mix(u_skyTop, u_skyLow, pow(t, 1.35));
    // sun / moon disc + atmosphere
    float d = distance(vec2(uv.x, y * (u_res.y / u_res.x)), vec2(u_sun.x, u_sun.y * (u_res.y / u_res.x)));
    sunGlow = exp(-d * d / (u_sunSize * u_sunSize * 2.));
    float disc = smoothstep(u_sunSize * .42, u_sunSize * .34, d);
    col += u_sunCol * (sunGlow * .55 + disc * (1. - u_night * .35));
    // stars — sized to survive the reduced-resolution render
    if (u_night > .01) {
      vec2 grid = uv * vec2(52., 34.);
      vec2 g = floor(grid);
      float s = hash(g);
      if (s > .82) {
        float tw = .55 + .45 * sin(u_time * (.6 + hash(g + 7.) * 1.6) + hash(g + 3.) * 6.28);
        vec2 c = vec2(.2 + hash(g + 11.) * .6, .2 + hash(g + 13.) * .6);
        float star = smoothstep(.16, .02, distance(fract(grid), c));
        float mag = .35 + hash(g + 17.) * .65;
        col += vec3(.88, .93, 1.) * star * tw * mag * u_night * (1. - y / horizon) * .9;
      }
    }
    // soft cloud band near horizon
    float cl = fbm(vec2(uv.x * 3. + u_time * .008, y * 14.)) * smoothstep(.45, 1., t) * .5;
    col = mix(col, mix(u_skyLow, u_sunCol, .25), cl * (1. - u_night * .55) * .35);
    // ---- ridges (two, for depth), edges anti-aliased
    float aa = 1.5 / u_res.y;
    float r1 = horizon - .040 - ridge(uv.x, 7.) * .046;
    float r2 = horizon - .013 - ridge(uv.x, 23.) * .026;
    col = mix(col, mix(u_ridge, u_skyLow, .35), smoothstep(r1 - aa, r1 + aa, y) * .88);
    col = mix(col, u_ridge, smoothstep(r2 - aa, r2 + aa, y) * .92);
  } else {
    // ---- water
    float depth = (y - horizon) / (1. - horizon);   // 0 at line .. 1 bottom
    float persp = mix(26., 2.6, depth);             // wave frequency by distance
    // breath swells the waves
    float amp = (.7 + .6 * breath) * (1. + u_churn * 2.6);
    float w = 0.;
    w += sin(uv.x * persp * 6.2 + u_time * .9)  * .5;
    w += sin(uv.x * persp * 11.7 - u_time * 1.3 + depth * 9.) * .3;
    w += sin(uv.x * persp * 21.3 + u_time * 2.1 + depth * 31.) * .2;
    w += (fbm(vec2(uv.x * 9., depth * 26. - u_time * .22)) - .5) * 1.1;
    // Still Water: device motion adds chaotic chop on top
    if (u_churn > .003) {
      w += sin(uv.x * persp * 37. + u_time * 6.3 + depth * 55.) * u_churn * 1.4;
      w += (noise(vec2(uv.x * 60., depth * 90. + u_time * 3.)) - .5) * u_churn * 2.2;
    }
    w *= amp;
    // ripples from touch
    for (int i = 0; i < 5; i++) {
      vec4 rp = u_ripple[i];
      if (rp.w > 0.) {
        float age = u_time - rp.z;
        float rd = distance(vec2(uv.x, y), rp.xy);
        w += sin(rd * 90. - age * 7.) * exp(-rd * 9. - age * 1.1) * rp.w * 2.2;
      }
    }
    // base gradient + wave shading (irregular, so it never bands)
    col = mix(u_waterHi, u_waterLo, pow(depth, .8));
    col += w * .018 * (0.6 + 0.8 * noise(vec2(uv.x * 23., depth * 31.)));
    // sky reflection sheen near the line
    col = mix(col, u_skyLow, (1. - depth) * .38);
    // ---- the glitter path: strongest when the sun sits low
    float lowSun = 1. - smoothstep(.08, .30, horizon - u_sun.y);
    float dx = (uv.x - u_sun.x) / (.05 + depth * .16);
    float column = exp(-dx * dx) * (.25 + .75 * lowSun);
    float sparkle = smoothstep(.35, 1., noise(vec2(uv.x * 320., depth * 240. - u_time * 1.4)))
                  * smoothstep(-.6, .9, w);
    col += u_sunCol * column * (.035 + sparkle * .75) * (.35 + .65 * breath);
    // moonless deep night still shimmers faintly with starlight
    col += vec3(.75, .85, 1.) * sparkle * u_night * .05;
  }

  // vignette + dither (kills gradient banding)
  float vg = smoothstep(1.25, .45, distance(uv, vec2(.5, .48)));
  col *= .82 + .18 * vg;
  col += (hash(gl_FragCoord.xy + fract(u_time)) - .5) / 255. * 3.;
  O = vec4(col, 1.);
}`;

export class LakeScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ok = false;
    this.ripples = [];   // {x, y, t, s}
    this.uniforms = {};
    try { this._init(); } catch { this.ok = false; }
  }

  _init() {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'low-power',
    });
    if (!gl) return;
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const name of ['u_res', 'u_time', 'u_breath', 'u_night', 'u_horizon',
      'u_skyTop', 'u_skyLow', 'u_waterHi', 'u_waterLo', 'u_sunCol', 'u_ridge',
      'u_sun', 'u_sunSize', 'u_ripple', 'u_bloom', 'u_churn']) {
      this.uniforms[name] = gl.getUniformLocation(prog, name);
    }
    this.ok = true;
    this.resize();
  }

  resize() {
    if (!this.ok) return;
    // soft scene: render at 0.6x CSS px, DPR capped at 2 — invisible on
    // blurry water, roughly quarters the fragment work
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = 0.6 * dpr;
    const w = Math.max(2, Math.round(this.canvas.clientWidth * scale));
    const h = Math.max(2, Math.round(this.canvas.clientHeight * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  }

  ripple(xUv, yUv, strength = 1) {
    this.ripples.push({ x: xUv, y: yUv, t: performance.now() / 1000, s: strength });
    if (this.ripples.length > 5) this.ripples.shift();
  }

  // state: { breath, night, horizon, skyTop, skyLow, waterHi, waterLo,
  //          sunCol, ridge, sun:[x,y], sunSize, bloom }  (colors = [r,g,b] 0..1)
  draw(state) {
    if (!this.ok) return;
    const gl = this.gl, u = this.uniforms;
    const t = performance.now() / 1000;
    gl.uniform2f(u.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.u_time, t);
    gl.uniform1f(u.u_breath, state.breath);
    gl.uniform1f(u.u_night, state.night);
    gl.uniform1f(u.u_horizon, state.horizon);
    gl.uniform3fv(u.u_skyTop, state.skyTop);
    gl.uniform3fv(u.u_skyLow, state.skyLow);
    gl.uniform3fv(u.u_waterHi, state.waterHi);
    gl.uniform3fv(u.u_waterLo, state.waterLo);
    gl.uniform3fv(u.u_sunCol, state.sunCol);
    gl.uniform3fv(u.u_ridge, state.ridge);
    gl.uniform2f(u.u_sun, state.sun[0], state.sun[1]);
    gl.uniform1f(u.u_sunSize, state.sunSize);
    gl.uniform1f(u.u_bloom, state.bloom);
    gl.uniform1f(u.u_churn, state.churn || 0);
    const rip = new Float32Array(20);
    this.ripples = this.ripples.filter((r) => t - r.t < 5);
    this.ripples.forEach((r, i) => {
      rip[i * 4] = r.x; rip[i * 4 + 1] = r.y; rip[i * 4 + 2] = r.t; rip[i * 4 + 3] = r.s;
    });
    gl.uniform4fv(u.u_ripple, rip);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

// ---------------------------------------------------------------- palette

// Time-of-day + season → the scene's colors, computed in JS per frame.
// dayFrac: 0..1 through the NY day; season: string from engine.seasonFor.
const P = {
  // [skyTop, skyLow, waterHi, waterLo, sunCol, ridge]
  night:   [[.012,.02,.05], [.05,.08,.14],  [.03,.05,.09],  [.008,.014,.028], [.92,.94,1.0], [.02,.03,.055]],
  dawn:    [[.10,.12,.28],  [.85,.48,.38],  [.30,.22,.30],  [.05,.05,.11],    [1.0,.78,.52], [.10,.08,.16]],
  morning: [[.16,.34,.55],  [.72,.80,.86],  [.24,.42,.55],  [.05,.13,.22],    [1.0,.95,.82], [.11,.20,.30]],
  day:     [[.18,.40,.66],  [.62,.76,.85],  [.22,.44,.60],  [.05,.14,.25],    [1.0,.97,.88], [.13,.24,.36]],
  golden:  [[.22,.30,.50],  [.98,.62,.30],  [.55,.35,.28],  [.08,.08,.15],    [1.0,.80,.45], [.16,.12,.20]],
  dusk:    [[.09,.10,.30],  [.66,.32,.34],  [.26,.16,.28],  [.04,.04,.10],    [1.0,.70,.48], [.08,.07,.17]],
};
const SEASON_TINT = {
  winter:  [.92, 1.0, 1.10],
  mud:     [1.0, .98, .94],
  spring:  [.97, 1.02, .98],
  summer:  [1.0, 1.0, 1.0],
  foliage: [1.06, .98, .90],
  stick:   [.98, .96, .96],
};

const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Blend two named phases for smooth hour-to-hour transitions.
export function palette(phase, nextPhase, blend, season) {
  const a = P[phase] || P.day, b = P[nextPhase] || a;
  const tint = SEASON_TINT[season] || [1, 1, 1];
  const cols = a.map((c, i) => mix3(c, b[i], blend).map((v, k) => Math.min(1, v * tint[k])));
  return {
    skyTop: cols[0], skyLow: cols[1], waterHi: cols[2],
    waterLo: cols[3], sunCol: cols[4], ridge: cols[5],
  };
}

// Sun/moon position across the day: rises east (right), sets west (left)
// over the Adirondacks — Burlington faces west, sunsets land on the water.
export function celestial(dayFrac, night) {
  if (night > 0.6) {
    // the moon idles high-left, small
    return { sun: [0.30, 0.16], sunSize: 0.05 };
  }
  const dayPos = Math.min(1, Math.max(0, (dayFrac - 0.22) / 0.62)); // ~5:15am..8:10pm
  const x = 0.82 - dayPos * 0.62;
  const y = 0.42 - Math.sin(dayPos * Math.PI) * 0.30;
  return { sun: [x, Math.max(0.06, y)], sunSize: 0.085 };
}
