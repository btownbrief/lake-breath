// Lake Breath — skipping stones on the water you calmed. The play is
// earned: after a completed session the lake lies flatter, and a flat
// lake skips better. Flick with a finger; physics does the rest.
//
// Owns no canvas — the app hands it the bloom's 2D context each frame
// and forwards pointer events while stone mode is open.

export class Stones {
  constructor(onSplash, onSkip) {
    this.onSplash = onSplash;   // (xUv, yUv, strength) → scene ripple
    this.onSkip = onSkip;       // (skips) → sound plunk
    this.reset();
  }

  reset() {
    this.mode = false;
    this.stone = null;          // {x, y, vx, vy} in px, px/s
    this.drag = null;
    this.skips = 0;
    this.done = false;          // stone has sunk; result is showable
    this.calm = 0;              // 0..1, set from the finished session
  }

  open(calm) {
    this.reset();
    this.mode = true;
    this.calm = calm;
  }
  close() { this.mode = false; }

  pointerDown(x, y) {
    if (!this.mode || this.stone) return;
    this.drag = { x0: x, y0: y, x, y, t0: performance.now(), moved: false };
  }
  pointerMove(x, y) {
    if (!this.drag) return;
    this.drag.x = x; this.drag.y = y; this.drag.moved = true;
  }
  pointerUp(W) {
    const d = this.drag;
    this.drag = null;
    if (!d || !d.moved || this.stone) return;
    const dt = Math.max(0.03, (performance.now() - d.t0) / 1000);
    let vx = (d.x - d.x0) / dt, vy = (d.y - d.y0) / dt;
    if (Math.abs(vx) < 60) return;              // a real flick, not a tap
    const speed = Math.hypot(vx, vy);
    const cap = W * 2.2;                         // don't rocket off-world
    if (speed > cap) { vx *= cap / speed; vy *= cap / speed; }
    this.stone = { x: d.x0, y: d.y0, vx, vy: Math.min(vy, 40) };
    this.skips = 0; this.done = false;
  }

  // step + draw; horizonPx = waterline y in px. Returns true while busy.
  frame(ctx, W, H, horizonPx, dt) {
    if (!this.mode) return false;
    const dpr = 1; // ctx is already in device px; positions arrive in device px

    // the waiting stone, resting near the lower right
    if (!this.stone) {
      const sx = this.drag ? this.drag.x : W * 0.78;
      const sy = this.drag ? this.drag.y : H * 0.86;
      ctx.save();
      ctx.fillStyle = 'rgba(212, 205, 190, 0.95)';
      ctx.strokeStyle = 'rgba(30, 28, 24, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(sx, sy, W * 0.022, W * 0.015, 0.3, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      if (this.drag && this.drag.moved) {
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(this.drag.x0, this.drag.y0);
        ctx.lineTo(this.drag.x, this.drag.y);
        ctx.stroke();
      }
      ctx.restore();
      return true;
    }

    const s = this.stone;
    s.vy += 1900 * dt;              // gravity, tuned for feel not physics class
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    // meeting the water
    if (s.y >= horizonPx && s.vy > 0) {
      const shallow = Math.abs(s.vy) < Math.abs(s.vx) * (0.55 + this.calm * 0.35);
      const fast = Math.abs(s.vx) > W * (0.38 - this.calm * 0.12);
      if (shallow && fast) {
        this.skips += 1;
        s.y = horizonPx - 1;
        s.vy = -Math.abs(s.vy) * (0.46 + this.calm * 0.10);
        s.vx *= 0.72;
        this.onSplash(s.x / W, horizonPx / H, 0.5);
        this.onSkip(this.skips);
      } else {
        this.onSplash(s.x / W, horizonPx / H, 1.2);
        this.onSkip(0); // the sink plunk
        this.stone = null;
        this.done = true;
        return true;
      }
    }
    if (s.x < -40 || s.x > W + 40) { this.stone = null; this.done = true; return true; }

    ctx.save();
    ctx.fillStyle = 'rgba(212, 205, 190, 0.95)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, W * 0.018, W * 0.012, Math.atan2(s.vy, s.vx), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return true;
  }
}
