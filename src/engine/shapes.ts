/**
 * Collision primitives. There are exactly two, and that is on purpose.
 *
 * A pinball table looks like it needs a rich shape library: orbits curve,
 * ramps bend, slingshots are triangles, the apron is a polygon. It does not.
 * Every one of those is either a straight run or a round thing, so the whole
 * table is built from **segments** and **circles**, and curves are tessellated
 * into segments when the table is built rather than solved analytically at
 * runtime.
 *
 * The payoff is that the collision resolver has two cases instead of nine. Two
 * cases can be read in full and tested exhaustively. Nine cases is where the
 * bug that only happens on the left orbit at high speed comes from.
 *
 * A segment carries a radius, which turns it into a capsule. A wall has radius
 * zero. A rubber has a few pixels, so the ball rounds off its ends instead of
 * catching on a mathematical point.
 */

import type { Vec } from './vec.js';
import { sub, add, scale, dot, lenSq, norm, clamp } from './vec.js';

export interface Segment {
  readonly a: Vec;
  readonly b: Vec;
  /** Half-thickness. Zero is a bare line, which is what most walls are. */
  readonly radius: number;
}

export interface Circle {
  readonly c: Vec;
  readonly radius: number;
}

/**
 * One touch between the ball and something solid.
 *
 * `normal` points **from the surface towards the ball**, so moving the ball
 * along it by `depth` is exactly what separates them. Getting that direction
 * backwards is the single most common way to write a collision resolver that
 * sucks the ball into walls instead of pushing it out, so it is stated here
 * rather than left to be inferred at each call site.
 */
export interface Contact {
  readonly normal: Vec;
  readonly depth: number;
  /** Where on the surface the touch happened. Flippers need this for spin. */
  readonly point: Vec;
}

export function segment(a: Vec, b: Vec, radius = 0): Segment {
  return { a, b, radius };
}

export function circle(c: Vec, radius: number): Circle {
  return { c, radius };
}

/**
 * The point on segment `a`..`b` nearest to `p`.
 *
 * `t` is clamped to 0..1, which is what makes this a segment test rather than
 * an infinite-line test. Without the clamp a ball level with the middle of a
 * wall but far past its end would still be pushed sideways by it, and the
 * symptom is a ball that bounces off thin air near the flippers.
 */
export function closestPointOnSegment(a: Vec, b: Vec, p: Vec): Vec {
  const ab = sub(b, a);
  const l2 = lenSq(ab);
  if (l2 === 0) return a;
  const t = clamp(dot(sub(p, a), ab) / l2, 0, 1);
  return add(a, scale(ab, t));
}

/**
 * Ball against a segment, treated as a capsule of `seg.radius`.
 *
 * Returns null when they are apart. The degenerate case where the ball centre
 * sits exactly on the line has no defined normal, so it is nudged along the
 * segment's own perpendicular instead of returning a zero vector that would
 * quietly do nothing.
 */
export function ballVsSegment(pos: Vec, ballRadius: number, seg: Segment): Contact | null {
  const point = closestPointOnSegment(seg.a, seg.b, pos);
  const away = sub(pos, point);
  const d2 = lenSq(away);
  const reach = ballRadius + seg.radius;

  if (d2 > reach * reach) return null;

  if (d2 === 0) {
    // Dead centre on the line. Push along the wall's perpendicular, picking a
    // side arbitrarily, because any direction beats staying stuck inside it.
    const ab = norm(sub(seg.b, seg.a));
    const n: Vec = { x: -ab.y, y: ab.x };
    return { normal: n, depth: reach, point };
  }

  const d = Math.sqrt(d2);
  return {
    normal: { x: away.x / d, y: away.y / d },
    depth: reach - d,
    point,
  };
}

/** Ball against a static circle: posts, bumper bodies, the ends of things. */
export function ballVsCircle(pos: Vec, ballRadius: number, c: Circle): Contact | null {
  const away = sub(pos, c.c);
  const d2 = lenSq(away);
  const reach = ballRadius + c.radius;

  if (d2 > reach * reach) return null;

  if (d2 === 0) {
    // Concentric. Straight up is as good as any other direction here.
    return { normal: { x: 0, y: -1 }, depth: reach, point: c.c };
  }

  const d = Math.sqrt(d2);
  const normal: Vec = { x: away.x / d, y: away.y / d };
  return {
    normal,
    depth: reach - d,
    point: add(c.c, scale(normal, c.radius)),
  };
}

/**
 * Break an arc into segments.
 *
 * Called when the table is built, never in the loop. Angles are radians and
 * the arc runs from `from` to `to` the short way round unless you pass a range
 * greater than pi, which orbits do.
 *
 * `steps` trades accuracy for segment count. At 24 steps over a quarter turn
 * the flat spots are well under a pixel on a 1024 wide table, which is far
 * below the ball radius and therefore invisible in play.
 */
export function arcToSegments(
  centre: Vec,
  radius: number,
  from: number,
  to: number,
  steps: number,
  thickness = 0,
): Segment[] {
  const out: Segment[] = [];
  const span = to - from;
  let prev: Vec = {
    x: centre.x + Math.cos(from) * radius,
    y: centre.y + Math.sin(from) * radius,
  };
  for (let i = 1; i <= steps; i++) {
    const angle = from + (span * i) / steps;
    const next: Vec = {
      x: centre.x + Math.cos(angle) * radius,
      y: centre.y + Math.sin(angle) * radius,
    };
    out.push({ a: prev, b: next, radius: thickness });
    prev = next;
  }
  return out;
}

/** Chain a run of points into connected segments. Lane guides are built this way. */
export function polyline(points: readonly Vec[], thickness = 0): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    out.push({ a, b, radius: thickness });
  }
  return out;
}
