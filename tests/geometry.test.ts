import { describe, it, expect } from 'vitest';
import { vec, add, sub, scale, dot, cross, len, norm, perp, rotate, clampLen } from '../src/engine/vec.js';
import {
  segment,
  circle,
  closestPointOnSegment,
  ballVsSegment,
  ballVsCircle,
  arcToSegments,
  polyline,
} from '../src/engine/shapes.js';

describe('vectors', () => {
  it('adds, subtracts and scales without mutating', () => {
    const a = vec(3, 4);
    const b = vec(1, 2);
    expect(add(a, b)).toEqual(vec(4, 6));
    expect(sub(a, b)).toEqual(vec(2, 2));
    expect(scale(a, 2)).toEqual(vec(6, 8));
    expect(a).toEqual(vec(3, 4));
  });

  it('measures length and dot products', () => {
    expect(len(vec(3, 4))).toBe(5);
    expect(dot(vec(1, 0), vec(0, 1))).toBe(0);
    expect(dot(vec(2, 3), vec(4, 5))).toBe(23);
  });

  it('uses the cross product sign to tell which side a vector falls', () => {
    expect(cross(vec(1, 0), vec(0, 1))).toBeGreaterThan(0);
    expect(cross(vec(1, 0), vec(0, -1))).toBeLessThan(0);
    expect(cross(vec(1, 0), vec(2, 0))).toBe(0);
  });

  it('normalises a zero vector to zero rather than NaN', () => {
    // A NaN here does not throw. It spreads into the ball position and the ball
    // silently disappears, so this case is worth pinning down.
    const n = norm(vec(0, 0));
    expect(Number.isNaN(n.x)).toBe(false);
    expect(Number.isNaN(n.y)).toBe(false);
    expect(n).toEqual(vec(0, 0));
  });

  it('turns a quarter turn with perp and rotate alike', () => {
    const p = perp(vec(1, 0));
    const r = rotate(vec(1, 0), Math.PI / 2);
    expect(p.x).toBeCloseTo(r.x, 10);
    expect(p.y).toBeCloseTo(r.y, 10);
  });

  it('clamps long vectors and leaves short ones alone', () => {
    expect(len(clampLen(vec(30, 40), 10))).toBeCloseTo(10, 10);
    expect(clampLen(vec(3, 4), 10)).toEqual(vec(3, 4));
    expect(clampLen(vec(0, 0), 10)).toEqual(vec(0, 0));
  });
});

describe('closest point on a segment', () => {
  it('finds the perpendicular foot when it lands on the segment', () => {
    expect(closestPointOnSegment(vec(0, 0), vec(10, 0), vec(4, 5))).toEqual(vec(4, 0));
  });

  it('clamps to an endpoint when the foot falls past the end', () => {
    // Without the clamp this would be an infinite line, and a ball level with a
    // wall but far beyond its end would bounce off nothing.
    expect(closestPointOnSegment(vec(0, 0), vec(10, 0), vec(40, 5))).toEqual(vec(10, 0));
    expect(closestPointOnSegment(vec(0, 0), vec(10, 0), vec(-40, 5))).toEqual(vec(0, 0));
  });

  it('handles a zero length segment', () => {
    expect(closestPointOnSegment(vec(5, 5), vec(5, 5), vec(9, 9))).toEqual(vec(5, 5));
  });
});

describe('ball against a segment', () => {
  const wall = segment(vec(0, 100), vec(200, 100));

  it('misses when it is clear', () => {
    expect(ballVsSegment(vec(100, 40), 27, wall)).toBeNull();
  });

  it('touches when it overlaps, with the normal pointing back at the ball', () => {
    const c = ballVsSegment(vec(100, 80), 27, wall);
    expect(c).not.toBeNull();
    // Ball is above the wall, so the normal must point up the screen.
    expect(c!.normal.y).toBeLessThan(0);
    expect(c!.depth).toBeCloseTo(7, 6);
    expect(c!.point).toEqual(vec(100, 100));
  });

  it('points the normal the other way for a ball underneath', () => {
    const c = ballVsSegment(vec(100, 120), 27, wall);
    expect(c!.normal.y).toBeGreaterThan(0);
  });

  it('counts the segment radius as thickness', () => {
    const thick = segment(vec(0, 100), vec(200, 100), 10);
    expect(ballVsSegment(vec(100, 65), 27, thick)).not.toBeNull();
    expect(ballVsSegment(vec(100, 65), 27, wall)).toBeNull();
  });

  it('never returns a zero normal, even dead on the line', () => {
    const c = ballVsSegment(vec(100, 100), 27, wall);
    expect(c).not.toBeNull();
    expect(len(c!.normal)).toBeCloseTo(1, 10);
  });

  it('rounds off the ends instead of catching on a point', () => {
    // Just past the end of the wall, diagonally. The capsule end should catch it.
    const c = ballVsSegment(vec(205, 95), 27, wall);
    expect(c).not.toBeNull();
    expect(c!.point).toEqual(vec(200, 100));
  });
});

describe('ball against a circle', () => {
  const post = circle(vec(100, 100), 15);

  it('misses when it is clear', () => {
    expect(ballVsCircle(vec(100, 20), 27, post)).toBeNull();
  });

  it('touches with a unit normal and a contact on the post surface', () => {
    const c = ballVsCircle(vec(100, 70), 27, post);
    expect(c).not.toBeNull();
    expect(len(c!.normal)).toBeCloseTo(1, 10);
    expect(c!.normal.y).toBeLessThan(0);
    expect(c!.depth).toBeCloseTo(12, 6);
    expect(c!.point).toEqual(vec(100, 85));
  });

  it('survives a concentric ball', () => {
    const c = ballVsCircle(vec(100, 100), 27, post);
    expect(c).not.toBeNull();
    expect(len(c!.normal)).toBeCloseTo(1, 10);
  });
});

describe('building curves', () => {
  it('tessellates an arc into connected segments on the circle', () => {
    const segs = arcToSegments(vec(0, 0), 100, 0, Math.PI / 2, 8);
    expect(segs).toHaveLength(8);
    for (const s of segs) {
      expect(len(s.a)).toBeCloseTo(100, 6);
      expect(len(s.b)).toBeCloseTo(100, 6);
    }
    // Each segment starts where the last one ended, so there are no gaps a ball
    // could slip through.
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i]!.a).toEqual(segs[i - 1]!.b);
    }
  });

  it('keeps the flat spots far below the ball radius', () => {
    // The sagitta of a chord: how far the straight segment cuts inside the true
    // curve. Well under a pixel here, so a 27 unit ball cannot feel it.
    const segs = arcToSegments(vec(0, 0), 240, 0, Math.PI / 2, 24);
    const first = segs[0]!;
    const midChord = scale(add(first.a, first.b), 0.5);
    const sagitta = 240 - len(midChord);
    expect(sagitta).toBeLessThan(1);
  });

  it('chains a polyline into one segment per gap', () => {
    const segs = polyline([vec(0, 0), vec(10, 0), vec(10, 10)]);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.b).toEqual(segs[1]!.a);
  });

  it('returns nothing for a polyline of one point', () => {
    expect(polyline([vec(0, 0)])).toHaveLength(0);
  });
});
