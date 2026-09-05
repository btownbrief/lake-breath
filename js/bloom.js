// Lake Breath — the bloom: the hero object. Six translucent petals
// floating just above the waterline, drawn on a transparent 2D canvas
// with screen blending (the Apple-flower grammar: petals TRANSLATE apart
// while the group SCALES and slowly ROTATES — three simultaneous motions,
// never one symmetric tween).
//
// States: idle (gentle 35%-amplitude breathing), session (full breath,
// driven by the engine's breath level), release (the cinematic moment —
// petals let go and drift out over the dark water as light motes).

export class Bloom {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rotation = 0;
    this.presence = 0;        // 0 hidden .. 1 fully present (springed)
    this.presenceV = 0;
    this.releaseAt = 0;       // timestamp of release start, 0 = none
    this.motes = [];          // drifting light after release
    this.colorA = [255, 214, 150];
    this.colorB = [150, 200, 235];
    this.dpr = 1;
    this.guide = false;       // the inhale's destination ring (sessions)
    this.fireflies = [];      // summer-night companions
    this.weatherKind = null;  // tomorrow's rain or snow overlay
    this.weather = [];
  }

  // Fireflies on warm nights: they wander low over the water, and a
  // steady breath draws them gently toward the bloom. steadiness 0..1.
  drawFireflies(on, steadiness, dt) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    if (on && this.fireflies.length === 0) {
      for (let i = 0; i < 11; i++) {
        this.fireflies.push({
          x: Math.random(), y: (this.horizonY ?? 0.6) - 0.02 - Math.random() * 0.12,
          vx: 0, vy: 0, ph: Math.random() * 7, rate: 0.6 + Math.random() * 1.1,
        });
      }
    }
    if (!on) { this.fireflies.length = 0; return; }
    const t = performance.now() / 1000;
    const cx = 0.5, cy = (this.horizonY ?? 0.6) - 0.05;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const f of this.fireflies) {
      // wander + gentle pull toward the bloom when the breath is steady
      f.vx += (Math.sin(t * 0.7 + f.ph * 3) * 0.004 + (cx - f.x) * 0.010 * steadiness) * dt;
      f.vy += (Math.cos(t * 0.5 + f.ph * 2) * 0.003 + (cy - f.y) * 0.010 * steadiness) * dt;
      f.vx *= 0.985; f.vy *= 0.985;
      f.x += f.vx * dt * 8; f.y += f.vy * dt * 8;
      const blink = Math.max(0, Math.sin(t * f.rate + f.ph));
      const a = 0.10 + blink * blink * 0.55;
      const r = (1.4 + blink * 1.6) * this.dpr;
      const g = ctx.createRadialGradient(f.x * W, f.y * H, 0, f.x * W, f.y * H, r * 4);
      g.addColorStop(0, `rgba(220, 255, 160, ${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(f.x * W, f.y * H, r * 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.dpr = dpr;
  }

  setColors(sunCol, skyLow) {
    this.colorA = sunCol.map((v) => Math.round(180 + v * 75));
    this.colorB = skyLow.map((v) => Math.round(120 + v * 135));
  }

  // Tomorrow's precipitation falls across the same canvas as the bloom.
  // Particles live in normalized coordinates, so a rotation or resize does
  // not restart the weather or change its density.
  drawWeather(kind, dt) {
    if (kind !== this.weatherKind) {
      this.weatherKind = kind;
      this.weather = [];
      const count = kind === 'rain' ? 68 : kind === 'snow' ? 46 : 0;
      for (let i = 0; i < count; i++) {
        this.weather.push({
          x: Math.random(), y: Math.random(),
          speed: kind === 'rain' ? 0.34 + Math.random() * 0.34 : 0.025 + Math.random() * 0.045,
          size: 0.45 + Math.random() * 0.9,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
    if (!this.weather.length) return;
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const t = performance.now() / 1000;
    ctx.save();
    if (kind === 'rain') {
      ctx.strokeStyle = 'rgba(210, 226, 238, 0.24)';
      ctx.lineCap = 'round';
      for (const p of this.weather) {
        p.y = (p.y + p.speed * dt) % 1.08;
        const x = p.x * W, y = p.y * H;
        ctx.lineWidth = Math.max(0.7, p.size * this.dpr);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 4 * p.size * this.dpr, y + 18 * p.size * this.dpr);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = 'rgba(246, 249, 252, 0.70)';
      for (const p of this.weather) {
        p.y = (p.y + p.speed * dt) % 1.04;
        const x = (p.x + Math.sin(t * 0.42 + p.phase) * 0.025) * W;
        const y = p.y * H;
        ctx.globalAlpha = 0.36 + p.size * 0.28;
        ctx.beginPath();
        ctx.arc(x, y, (1.1 + p.size * 1.7) * this.dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // The next anchor appears as a breathing emblem in the cloud field. The
  // jester cap is reserved for Festival of Fools; other anchors use one
  // small compass-star pennant. No event words enter the home screen.
  drawMaple(stage, maxStage, leafRgb) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const hy = H * (this.horizonY ?? 0.6);
    const t = stage / maxStage;
    const baseX = W * 0.86;
    const u = Math.min(W, H) / 400;
    ctx.save();
    // the spit of shore
    ctx.fillStyle = 'rgba(8, 11, 16, 0.85)';
    ctx.beginPath();
    ctx.ellipse(W * 0.97, hy + 6 * u, W * 0.22, 10 * u, 0, Math.PI, 0);
    ctx.fill();
    if (stage > 0) {
      const trunkH = (14 + t * 58) * u;
      const trunkW = (1.2 + t * 3.2) * u;
      ctx.strokeStyle = 'rgba(14, 12, 12, 0.9)';
      ctx.lineWidth = trunkW;
      ctx.beginPath();
      ctx.moveTo(baseX, hy + 4 * u);
      ctx.quadraticCurveTo(baseX + 2 * u, hy - trunkH * 0.55, baseX, hy - trunkH);
      ctx.stroke();
      // foliage: layered blobs, count grows with stage
      const blobs = Math.max(1, Math.round(t * 9));
      const crownY = hy - trunkH;
      const crownR = (7 + t * 26) * u;
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * Math.PI * 2 + 0.7;
        const bx = baseX + Math.cos(a) * crownR * 0.55 * (i % 3 === 0 ? 0.4 : 1);
        const by = crownY - Math.abs(Math.sin(a)) * crownR * 0.5 - crownR * 0.1;
        const br = crownR * (0.42 + ((i * 37) % 10) / 22);
        const sway = Math.sin(performance.now() / 1400 + i) * u * 0.8;
        ctx.fillStyle = `rgba(${leafRgb[0]},${leafRgb[1]},${leafRgb[2]},${0.5 + (i % 2) * 0.2})`;
        ctx.beginPath();
        ctx.arc(bx + sway, by, br, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Something is happening in town: a leaning pole with three small
  // pennants on the shore spit beside the maple, swaying on the same slow
  // clock the leaves do. kind 'fools' gets two-tone gold and violet with
  // one pennant swapped for a jester cap; anything else gets plain gold.
  // dim follows the maple so the night puts it away too. Deliberately
  // tiny: this should read as a flag on a shore, never as clipart.
  drawBubble(bub) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const u = Math.min(W, H);
    const cx = W * 0.5, cy = H * 0.5;
    const bx = cx + bub.x * u, by = cy + bub.y * u;
    const ringR = bub.r * u;
    // resting on a surface: the ring goes cold and the bubble dims. Dead
    // centre on a table is not home, and the picture should say so.
    const warm = bub.inRing && !bub.resting;
    const dim = bub.resting ? 0.45 : 1;
    // Doing well, shown without a number: the longer the light has been
    // home in a hand, the wider and warmer its halo (bub.calm 0..1), and
    // every half minute home a slow ring leaves the bubble and crosses
    // the water. Nothing dims, nothing scolds; the picture just warms.
    const calm = Math.max(0, Math.min(1, bub.calm || 0));
    ctx.save();
    if (calm > 0.01) {
      ctx.globalCompositeOperation = 'screen';
      const hr = u * (0.09 + calm * 0.16);
      const hg = ctx.createRadialGradient(bx, by, u * 0.03, bx, by, hr);
      hg.addColorStop(0, `rgba(${this.colorA[0]},${this.colorA[1]},${this.colorA[2]},${0.10 + calm * 0.16})`);
      hg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(bx, by, hr, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    const nowS = performance.now() / 1000;
    this.calmRings = (this.calmRings || []).filter((r) => nowS - r.t0 < 4);
    for (const r of this.calmRings) {
      const age = (nowS - r.t0) / 4;
      const rr = ringR + age * u * 0.55;
      ctx.strokeStyle = `rgba(240, 205, 140, ${0.30 * (1 - age) * (1 - age)})`;
      ctx.lineWidth = 1.2 * this.dpr;
      ctx.beginPath(); ctx.arc(bx, by, rr, 0, Math.PI * 2); ctx.stroke();
    }
    // the target ring
    ctx.strokeStyle = warm
      ? 'rgba(240, 205, 140, 0.42)'
      : 'rgba(228, 236, 245, 0.16)';
    ctx.lineWidth = 1.1 * this.dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.stroke();
    // the bubble
    ctx.globalCompositeOperation = 'screen';
    const col = warm ? this.colorA : this.colorB;
    const r = u * 0.052;
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, r * 2.2);
    g.addColorStop(0, `rgba(255, 252, 244, ${(warm ? 0.72 : 0.5) * dim})`);
    g.addColorStop(0.35, `rgba(${col[0]},${col[1]},${col[2]},${(warm ? 0.42 : 0.3) * dim})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx, by, r * 2.2, 0, Math.PI * 2); ctx.fill();
    // a thin meniscus edge so it reads as a bubble, not a blur
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = `rgba(255, 252, 244, ${(warm ? 0.34 : 0.22) * dim})`;
    ctx.lineWidth = 1 * this.dpr;
    ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // Paddle's canoe: a low silhouette crossing the water. Position and
  // motion live in app.js; this layer only paints the hull, paddler, wake,
  // and the brief blade dip after a stroke.
  drawCanoe(state) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const u = Math.min(W, H);
    const x = Math.max(0, Math.min(1, state.x));
    const edgeFade = Math.max(0, Math.min(1, (x - 0.08) / 0.04, (0.92 - x) / 0.04));
    if (!edgeFade || !u) return;

    const length = u * 0.16;
    const bob = (Math.max(0, Math.min(1, state.bob)) - 0.5) * u * 0.008;
    const stroke = Math.max(0, Math.min(1, state.stroke));
    const warm = this.colorA, cool = this.colorB;
    const cx = x * W, cy = state.y * H + bob;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(state.heading < 0 ? -1 : 1, 1);
    ctx.globalAlpha = edgeFade;

    // A wake stays close to the hull and brightens only briefly after the
    // blade enters the water.
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.7, this.dpr * 0.75);
    const coolWake = ctx.createLinearGradient(-length * 1.35, 0, -length * 0.25, 0);
    coolWake.addColorStop(0, `rgba(${cool[0]},${cool[1]},${cool[2]},0)`);
    coolWake.addColorStop(1, `rgba(${cool[0]},${cool[1]},${cool[2]},${0.07 + stroke * 0.10})`);
    ctx.strokeStyle = coolWake;
    ctx.beginPath();
    ctx.moveTo(-length * 0.34, u * 0.012);
    ctx.quadraticCurveTo(-length * 0.78, u * 0.006, -length * (1.05 + stroke * 0.30), u * 0.021);
    ctx.stroke();
    const warmWake = ctx.createLinearGradient(-length * 1.1, 0, -length * 0.20, 0);
    warmWake.addColorStop(0, `rgba(${warm[0]},${warm[1]},${warm[2]},0)`);
    warmWake.addColorStop(1, `rgba(${warm[0]},${warm[1]},${warm[2]},${0.035 + stroke * 0.055})`);
    ctx.strokeStyle = warmWake;
    ctx.beginPath();
    ctx.moveTo(-length * 0.28, u * 0.020);
    ctx.quadraticCurveTo(-length * 0.65, u * 0.029, -length * (0.86 + stroke * 0.22), u * 0.035);
    ctx.stroke();

    // Dark, side-on hull with a low palette reflection along its upper lip.
    ctx.fillStyle = 'rgba(8, 11, 16, 0.76)';
    ctx.beginPath();
    ctx.moveTo(-length * 0.52, -u * 0.010);
    ctx.quadraticCurveTo(-length * 0.26, u * 0.037, length * 0.31, u * 0.030);
    ctx.quadraticCurveTo(length * 0.48, u * 0.020, length * 0.53, -u * 0.008);
    ctx.quadraticCurveTo(0, u * 0.005, -length * 0.52, -u * 0.010);
    ctx.fill();
    ctx.fillStyle = `rgba(${warm[0]},${warm[1]},${warm[2]},0.075)`;
    ctx.beginPath();
    ctx.ellipse(0, -u * 0.004, length * 0.46, u * 0.006, 0, 0, Math.PI * 2);
    ctx.fill();

    // One small joined silhouette is enough to suggest the paddler.
    ctx.fillStyle = 'rgba(9, 11, 15, 0.70)';
    ctx.beginPath();
    ctx.arc(length * 0.05, -u * 0.072, u * 0.012, 0, Math.PI * 2);
    ctx.moveTo(length * 0.005, -u * 0.052);
    ctx.quadraticCurveTo(length * 0.04, -u * 0.078, length * 0.14, -u * 0.018);
    ctx.lineTo(length * 0.02, -u * 0.012);
    ctx.closePath();
    ctx.fill();

    if (stroke > 0.01) {
      ctx.save();
      ctx.translate(length * 0.08, -u * 0.042);
      ctx.rotate(-0.72 + (1 - stroke) * 0.42);
      ctx.strokeStyle = `rgba(8, 11, 16, ${0.30 + stroke * 0.40})`;
      ctx.lineWidth = Math.max(1, this.dpr * 1.15);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, u * 0.125);
      ctx.stroke();
      ctx.fillStyle = `rgba(${cool[0]},${cool[1]},${cool[2]},${0.08 + stroke * 0.16})`;
      ctx.beginPath();
      ctx.ellipse(0, u * 0.135, u * 0.010, u * 0.026, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  // One slow ring from the bubble, called by the owner every half minute
  // the light stays home.
  calmRing() { (this.calmRings = this.calmRings || []).push({ t0: performance.now() / 1000 }); }

  show(on) { this.presenceTarget = on ? 1 : 0; }

  release() {
    this.releaseAt = performance.now() / 1000;
    // petals keep the radius the bloom had at the moment of release —
    // the regrow cycle must not shrink what has already let go
    this.releaseR = Math.max(8, this.lastR || 30);
    const cx = 0.5, cy = this.horizonY ?? 0.55;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + this.rotation;
      this.motes.push({
        x: cx, y: cy, kind: 'petal', i,
        vx: Math.cos(a) * 0.030, vy: Math.sin(a) * 0.016 - 0.020,
        born: this.releaseAt, life: 7 + Math.random() * 2,
      });
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.008 + Math.random() * 0.045;
      this.motes.push({
        x: cx, y: cy, kind: 'mote',
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - 0.012 - Math.random() * 0.02,
        born: this.releaseAt, life: 4 + Math.random() * 5,
      });
    }
  }

  // breath: 0..1; horizonY: waterline in 0..1 from top; dt seconds.
  // resize() is the owner's job (init + resize events), not per-frame.
  draw(breath, horizonY, dt, idle) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    this.horizonY = horizonY;

    // presence spring (rises from the water on session start)
    const target = this.presenceTarget ?? 1;
    const k = 42, c = 9;
    this.presenceV += (-k * (this.presence - target) - c * this.presenceV) * dt;
    this.presence += this.presenceV * dt;

    const t = performance.now() / 1000;
    const releasing = this.releaseAt > 0 && t - this.releaseAt < 10;
    const sinceRelease = releasing ? t - this.releaseAt : 99;
    // after a release the bloom regrows quietly
    const regrow = releasing ? Math.max(0, Math.min(1, (sinceRelease - 5) / 4)) : 1;

    const b = idle ? 0.32 + breath * 0.30 : breath;
    this.rotation += dt * (0.05 + b * 0.10);

    const cx = W * 0.5;
    const cy = H * (horizonY - 0.028 - b * 0.02); // rides the waterline, lifts on the inhale
    const R = Math.min(W, H) * (0.062 + b * 0.05) * this.presence * (releasing ? regrow : 1);
    if (R > 1) this.lastR = R;

    if (R > 1) {
      ctx.save();
      // The guide ring: the inhale's destination. The bloom expands toward
      // it; watching the gap close tells you when to ease into the turn.
      if (this.guide) {
        const RMax = Math.min(W, H) * 0.112 * this.presence;
        const ringR = RMax * (0.30 + 0.85) + RMax * 0.9;
        const near = Math.max(0, 1 - (1 - b) * 3); // brightens as breath approaches full
        ctx.strokeStyle = `rgba(255, 250, 238, ${0.34 + near * 0.34})`;
        ctx.lineWidth = 1.8 * this.dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'screen';
      const petals = 6;
      const sep = (0.30 + b * 0.85) * R;     // petals translate apart
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2 + this.rotation;
        const px = cx + Math.cos(a) * sep;
        const py = cy + Math.sin(a) * sep * 0.5; // squashed: seen at an angle on the water
        const col = i % 2 ? this.colorA : this.colorB;
        // defined petal: bright small core, soft skirt, elongated along its angle
        const g = ctx.createRadialGradient(px, py, 0, px, py, R * 0.9);
        g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${0.55 * this.presence})`);
        g.addColorStop(0.45, `rgba(${col[0]},${col[1]},${col[2]},${0.22 * this.presence})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(px, py, R * 0.9, R * 0.55, a, 0, Math.PI * 2);
        ctx.fill();
      }
      // core light
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.62);
      g.addColorStop(0, `rgba(255,250,238,${0.65 * this.presence * (0.45 + b * 0.55)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2); ctx.fill();
      // reflection: an elliptical pool of light on the water below
      const ry = H * (horizonY + 0.035);
      const rg = ctx.createRadialGradient(cx, ry, 0, cx, ry, R * 1.5);
      rg.addColorStop(0, `rgba(${this.colorA[0]},${this.colorA[1]},${this.colorA[2]},${0.20 * this.presence})`);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.save();
      ctx.translate(cx, ry); ctx.scale(1, 0.32); ctx.translate(-cx, -ry);
      ctx.beginPath(); ctx.arc(cx, ry, R * 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.restore();
    }

    // ---- motes / released petals
    if (this.motes.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const alive = [];
      for (const m of this.motes) {
        const age = t - m.born;
        if (age > m.life) continue;
        const fade = 1 - age / m.life;
        m.x += m.vx * dt + Math.sin(t * 1.3 + m.born * 7) * 0.006 * dt;
        m.y += m.vy * dt;
        m.vy += -0.001 * dt; // gentle lift
        const col = m.kind === 'petal' ? (m.i % 2 ? this.colorA : this.colorB) : [255, 244, 220];
        const r = (m.kind === 'petal' ? (this.releaseR || 30) * 0.55 : Math.min(W, H) * 0.012) * (0.4 + fade * 0.6);
        const g = ctx.createRadialGradient(m.x * W, m.y * H, 0, m.x * W, m.y * H, Math.max(1, r));
        g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${0.5 * fade})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(m.x * W, m.y * H, Math.max(1, r), 0, Math.PI * 2); ctx.fill();
        alive.push(m);
      }
      this.motes = alive;
      ctx.restore();
    }
    if (!releasing && this.releaseAt && t - this.releaseAt >= 10) this.releaseAt = 0;
  }
}
