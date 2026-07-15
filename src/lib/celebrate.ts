"use client";

// ============================================
// קונפטי + רטט בסיום משימה — אפס תלויות, canvas זמני
// ============================================

let active = false;

export function celebrate() {
  if (typeof window === "undefined" || active) return;
  try { navigator.vibrate?.([15, 40, 20]); } catch { /* לא נתמך */ }
  active = true;

  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  Object.assign(canvas.style, {
    position: "fixed", inset: "0", width: "100%", height: "100%",
    pointerEvents: "none", zIndex: "9998",
  } as CSSStyleDeclaration);
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) { canvas.remove(); active = false; return; }
  ctx.scale(dpr, dpr);

  const colors = ["#2563EB", "#0FA47E", "#F59E0B", "#EC4899", "#8B5CF6", "#EF4444"];
  const parts = Array.from({ length: 110 }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.7;
    const speed = 7 + Math.random() * 9;
    return {
      x: W / 2, y: H * 0.62,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      s: 4 + Math.random() * 5, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      c: colors[(Math.random() * colors.length) | 0],
    };
  });

  const t0 = performance.now();
  const DURATION = 1500;
  function frame(t: number) {
    const el = t - t0;
    ctx!.clearRect(0, 0, W, H);
    const alpha = Math.max(0, 1 - el / (DURATION - 100));
    for (const p of parts) {
      p.vy += 0.25;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx!.save();
      ctx!.translate(p.x, p.y);
      ctx!.rotate(p.r);
      ctx!.globalAlpha = alpha;
      ctx!.fillStyle = p.c;
      ctx!.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx!.restore();
    }
    if (el < DURATION) requestAnimationFrame(frame);
    else { canvas.remove(); active = false; }
  }
  requestAnimationFrame(frame);
}
