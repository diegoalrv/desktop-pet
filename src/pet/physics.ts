export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Y (esquina sup. de la ventana) para que apoye en el borde inferior del work area. */
export const groundY = (area: Rect, winH: number, offset = 0) => area.y + area.h - winH + offset;

/** Avanza hacia `target` a `speed` px/s. */
export function walkStep(x: number, target: number, speed: number, dt: number) {
  const d = target - x;
  const step = speed * dt;
  return Math.abs(d) <= step
    ? { x: target, dir: Math.sign(d) || 1, arrived: true }
    : { x: x + Math.sign(d) * step, dir: Math.sign(d), arrived: false };
}

/** Caída con gravedad `g` px/s². */
export function fallStep(y: number, vy: number, dt: number, floor: number, g: number) {
  const v = vy + g * dt;
  const ny = y + v * dt;
  return ny >= floor ? { y: floor, vy: 0, landed: true } : { y: ny, vy: v, landed: false };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
