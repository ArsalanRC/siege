/**
 * Two-dimensional vectors, immutable, as plain objects.
 *
 * Floating point throughout, and that is a deliberate departure from `rally`,
 * where every value was an integer scaled by 1000. There the reason was
 * rollback: two browsers had to land on byte-identical state or the ball was in
 * a different place on each screen. Nothing here is networked and nothing is
 * replayed, so there is no second simulation to agree with, and doubles buy
 * readable collision maths at no cost.
 *
 * Every function returns a new object rather than mutating its argument. At
 * 240 steps a second with a handful of live vectors that is a few thousand
 * short-lived allocations, which a generational collector handles without
 * noticing. Readability is worth more here than the allocations are.
 */

export interface Vec {
  readonly x: number;
  readonly y: number;
}

export function vec(x: number, y: number): Vec {
  return { x, y };
}

export const ZERO: Vec = { x: 0, y: 0 };

export function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec, k: number): Vec {
  return { x: a.x * k, y: a.y * k };
}

export function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * The 2D cross product, which is a scalar rather than a vector.
 *
 * Its sign says which side of `a` the vector `b` falls on, and that is what
 * makes it useful here: it decides whether the ball is inside or outside a
 * lane guide without any trigonometry.
 */
export function cross(a: Vec, b: Vec): number {
  return a.x * b.y - a.y * b.x;
}

export function len(a: Vec): number {
  return Math.hypot(a.x, a.y);
}

/** Squared length. Use it for comparisons, since it skips the square root. */
export function lenSq(a: Vec): number {
  return a.x * a.x + a.y * a.y;
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distSq(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * A unit vector in the same direction.
 *
 * A zero vector has no direction, so there is no correct answer for it. It
 * returns zero rather than `NaN`, because a `NaN` here does not throw: it
 * spreads silently into the ball position and the ball simply vanishes from the
 * screen with nothing logged. A zero normal makes the collision a no-op
 * instead, which is wrong in a way you can see and debug.
 */
export function norm(a: Vec): Vec {
  const l = Math.hypot(a.x, a.y);
  if (l === 0) return ZERO;
  return { x: a.x / l, y: a.y / l };
}

/** Rotated a quarter turn. With y pointing down the screen, this turns left. */
export function perp(a: Vec): Vec {
  return { x: -a.y, y: a.x };
}

export function rotate(a: Vec, radians: number): Vec {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** Reflect `a` about a surface with unit normal `n`. */
export function reflect(a: Vec, n: Vec): Vec {
  return sub(a, scale(n, 2 * dot(a, n)));
}

/**
 * Shorten a vector to at most `max`, leaving shorter ones alone.
 *
 * The ball speed is clamped with this every step. Collision here is discrete
 * rather than swept, so a ball that travels further than its own radius in one
 * step can pass clean through a wall and end up outside the table. The
 * substep is small enough that this cannot happen below the clamp, so the clamp
 * is what makes that guarantee hold.
 */
export function clampLen(a: Vec, max: number): Vec {
  const l = Math.hypot(a.x, a.y);
  if (l <= max || l === 0) return a;
  return { x: (a.x / l) * max, y: (a.y / l) * max };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
