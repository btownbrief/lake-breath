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

  // The maple on your shore — the growing thing. A quiet silhouette on a
  // spit of land at the right edge of the water, filling in with practice.
  // stage 0..11 from engine.mapleStage; leafColor follows the season.
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
  drawPennants(kind, dim = 1) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const hy = H * (this.horizonY ?? 0.6);
    const u = Math.min(W, H) / 400;
    const baseX = W * 0.755, baseY = hy + 3 * u;
    const poleH = 30 * u, lean = 3.4 * u;
    const tipX = baseX + lean, tipY = baseY - poleH;
    const t = performance.now() / 1400;
    const fools = kind === 'fools';
    const GOLD = [230, 188, 108], VIOLET = [150, 112, 196];
    const rgba = (c, a) => `rgba(${Math.round(c[0] * dim)},${Math.round(c[1] * dim)},${Math.round(c[2] * dim)},${a})`;

    ctx.save();
    ctx.strokeStyle = `rgba(${Math.round(18 * dim)},${Math.round(16 * dim)},${Math.round(16 * dim)},0.9)`;
    ctx.lineWidth = Math.max(1, 1.1 * u);
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // three flags down the pole, the top one nearest the tip
    for (let i = 0; i < 3; i++) {
      const f = 0.10 + i * 0.26;                       // how far down the pole
      const px = tipX + (baseX - tipX) * f;
      const py = tipY + (baseY - tipY) * f;
      const sway = Math.sin(t + i * 0.8) * 1.6 * u;
      const len = (9 - i * 0.8) * u, h = 5.2 * u;
      // the top flag is the one that becomes a cap: crowning the pole reads
      // as a shape, where a cap tucked between two flags reads as a smudge
      if (fools && i === 0) { this._jesterCap(tipX, tipY, u, sway, rgba, GOLD, VIOLET); continue; }
      const col = fools && i === 2 ? VIOLET : GOLD;
      ctx.fillStyle = rgba(col, 0.82);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + len * 0.6 + sway * 0.5, py + h * 0.18, px + len + sway, py + h * 0.5);
      ctx.lineTo(px, py + h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // The jester cap: a small band with three slim points, each ending in a
  // dot, about fourteen pixels across. Drawn as separate spikes rather than
  // one filled shape because at this size a solid triangle is just a smudge.
  _jesterCap(px, py, u, sway, rgba, gold, violet) {
    const ctx = this.ctx;
    const bx = px, by = py + 0.6 * u;
    // three points fanning up from the pole's tip, each with a dot on it
    const spikes = [[-2.35, 7.6, violet], [-1.57, 8.6, gold], [-0.78, 7.6, violet]];
    for (const [ang, len, col] of spikes) {
      const wob = sway * 0.25;
      const tx = bx + Math.cos(ang) * len * u + wob;
      const ty = by + Math.sin(ang) * len * u;
      const nx = Math.cos(ang + Math.PI / 2) * 1.3 * u;
      const ny = Math.sin(ang + Math.PI / 2) * 1.3 * u;
      ctx.fillStyle = rgba(col, 0.85);
      ctx.beginPath();
      ctx.moveTo(bx + nx, by + ny);
      ctx.lineTo(tx, ty);
      ctx.lineTo(bx - nx, by - ny);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tx, ty, Math.max(0.9, 1.25 * u), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Steady's bubble: a spirit level drawn as light. bub.x / bub.y / bub.r
  // are in units of min(W, H) from the screen centre, so the caller does
  // the physics and this only paints. Inside the ring the ring warms to
  // gold and the bubble takes the warm palette colour; outside, both go
  // cool and quiet. No red, no buzzing, nothing that reads as failure.
  drawBubble(bub) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const u = Math.min(W, H);
    const cx = W * 0.5, cy = H * 0.5;
    const bx = cx + bub.x * u, by = cy + bub.y * u;
    const ringR = bub.r * u;
    const warm = bub.inRing;
    ctx.save();
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
    g.addColorStop(0, `rgba(255, 252, 244, ${warm ? 0.72 : 0.5})`);
    g.addColorStop(0.35, `rgba(${col[0]},${col[1]},${col[2]},${warm ? 0.42 : 0.3})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx, by, r * 2.2, 0, Math.PI * 2); ctx.fill();
    // a thin meniscus edge so it reads as a bubble, not a blur
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = `rgba(255, 252, 244, ${warm ? 0.34 : 0.22})`;
    ctx.lineWidth = 1 * this.dpr;
    ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

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
        ctx.strokeStyle = `rgba(255, 250, 238, ${0.10 + near * 0.22})`;
        ctx.lineWidth = 1.2 * this.dpr;
        ctx.beginPath();
        ctx.ellipse(cx, cy, ringR, ringR * 0.62, 0, 0, Math.PI * 2);
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
