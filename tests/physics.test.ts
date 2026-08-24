import { describe, it, expect } from 'vitest';
import type { Vec } from '../src/engine/vec.js';
import { vec, len } from '../src/engine/vec.js';
import { segment } from '../src/engine/shapes.js';
import type { Collider, World, Ball, MovingCollider } from '../src/engine/physics.js';
import {
  step,
  respond,
  substepsFor,
  pointVelocity,
  BALL_RADIUS,
  GRAVITY,
  MAX_SPEED,
  WOOD,
  RUBBER,
} from '../src/engine/physics.js';
import { ballVsSegment } from '../src/engine/shapes.js';

function wall(id: string, a: Vec, b: Vec, material = WOOD, kick = 0, sensor = false): Collider {
  return { id, type: 'segment', seg: segment(a, b), material, kick, sensor, active: true };
}

function makeWorld(colliders: Collider[], moving: MovingCollider[] = [], drag = 0): World {
  return { colliders, moving, gravity: GRAVITY, drag };
}

function ballAt(pos: Vec, vel: Vec = vec(0, 0)): Ball {
  return { pos, vel, radius: BALL_RADIUS };
}

describe('falling', () => {
  it('accelerates at the tilted-table gravity and nothing else', () => {
    const w = makeWorld([]);
    let b = ballAt(vec(500, 100));
    for (let i = 0; i < 240; i++) b = step(b, w, 1 / 240).ball;
    // One second of falling from rest.
    expect(b.vel.y).toBeCloseTo(GRAVITY, 0);
    expect(b.vel.x).toBe(0);
  });

  it('never exceeds the speed ceiling however long it falls', () => {
    const w = makeWorld([]);
    let b = ballAt(vec(500, 100));
    for (let i = 0; i < 2000; i++) b = step(b, w, 1 / 240).ball;
    expect(len(b.vel)).toBeLessThanOrEqual(MAX_SPEED + 1e-6);
  });

  it('slows to rest under drag rather than reversing through zero', () => {
    const w: World = { colliders: [], moving: [], gravity: 0, drag: 3 };
    let b = ballAt(vec(500, 500), vec(400, 0));
    for (let i = 0; i < 600; i++) b = step(b, w, 1 / 240).ball;
    expect(b.vel.x).toBeGreaterThanOrEqual(0);
    expect(b.vel.x).toBeLessThan(5);
  });
});

describe('substep sizing', () => {
  it('costs one substep for a resting ball', () => {
    expect(substepsFor(0, 1 / 60, BALL_RADIUS, GRAVITY)).toBe(1);
  });

  it('buys more substeps as the ball speeds up', () => {
    const slow = substepsFor(500, 1 / 60, BALL_RADIUS, GRAVITY);
    const fast = substepsFor(8000, 1 / 60, BALL_RADIUS, GRAVITY);
    expect(fast).toBeGreaterThan(slow);
  });

  it('keeps every substep under half a radius, which is the whole point', () => {
    for (const speed of [0, 100, 1000, 5000, MAX_SPEED]) {
      const dt = 1 / 60;
      const n = substepsFor(speed, dt, BALL_RADIUS, GRAVITY);
      const perStep = (speed + GRAVITY * dt) * (dt / n);
      expect(perStep).toBeLessThanOrEqual(BALL_RADIUS * 0.5 + 1e-9);
    }
  });

  it('is bounded, so a bad dt cannot hang the loop', () => {
    expect(substepsFor(MAX_SPEED, 10, BALL_RADIUS, GRAVITY)).toBeLessThanOrEqual(64);
  });
});

describe('bouncing', () => {
  const floor = segment(vec(0, 1000), vec(1000, 1000));

  it('reverses the normal component and keeps a fraction of it', () => {
    const b = ballAt(vec(500, 980), vec(0, 400));
    const c = ballVsSegment(b.pos, b.radius, floor)!;
    const out = respond(b, c, RUBBER, 0);
    expect(out.vel.y).toBeCloseTo(-400 * RUBBER.restitution, 6);
  });

  it('shaves the tangential component by friction', () => {
    const b = ballAt(vec(500, 980), vec(600, 400));
    const c = ballVsSegment(b.pos, b.radius, floor)!;
    const out = respond(b, c, RUBBER, 0);
    expect(out.vel.x).toBeCloseTo(600 * (1 - RUBBER.friction), 6);
  });

  it('separates the ball so it is no longer overlapping', () => {
    const b = ballAt(vec(500, 980), vec(0, 400));
    const c = ballVsSegment(b.pos, b.radius, floor)!;
    const out = respond(b, c, WOOD, 0);
    expect(ballVsSegment(out.pos, out.radius, floor)).toBeNull();
  });

  it('does not bounce a ball that is already leaving', () => {
    // Overlapping but travelling away. Kicking it here is how a ball wedged in
    // a corner gets fired out by two walls that both think it is arriving.
    const b = ballAt(vec(500, 980), vec(0, -400));
    const c = ballVsSegment(b.pos, b.radius, floor)!;
    const out = respond(b, c, RUBBER, 0);
    expect(out.vel.y).toBeCloseTo(-400, 6);
  });

  it('adds a kick along the normal, so a dead ball still gets thrown', () => {
    const crawling = ballAt(vec(500, 980), vec(0, 10));
    const c = ballVsSegment(crawling.pos, crawling.radius, floor)!;
    const plain = respond(crawling, c, RUBBER, 0);
    const kicked = respond(crawling, c, RUBBER, 900);
    expect(len(plain.vel)).toBeLessThan(100);
    expect(len(kicked.vel)).toBeGreaterThan(800);
    expect(kicked.vel.y).toBeLessThan(0);
  });
});

describe('a fast ball cannot leave the table', () => {
  // The one failure mode of discrete collision, and the reason the substep
  // count is derived from speed. Nothing errors when it happens: the ball just
  // silently is not there any more.
  const box = [
    wall('top', vec(0, 0), vec(1024, 0), RUBBER),
    wall('bottom', vec(0, 1536), vec(1024, 1536), RUBBER),
    wall('left', vec(0, 0), vec(0, 1536), RUBBER),
    wall('right', vec(1024, 0), vec(1024, 1536), RUBBER),
  ];

  it('stops a ball fired at the ceiling speed straight into a wall', () => {
    // 12000 units/s covers 200 units in a 60th of a second, and the ball starts
    // 109 units clear of the wall. Without substepping it lands 91 units past
    // the outside of the table.
    const w = makeWorld(box);
    const b = step(ballAt(vec(512, 1400), vec(0, MAX_SPEED)), w, 1 / 60);
    expect(b.ball.pos.y).toBeLessThan(1536);
    expect(b.ball.vel.y).toBeLessThan(0);
    expect(b.hits.map((h) => h.id)).toContain('bottom');
  });

  it('keeps it inside over thousands of frames from many angles', () => {
    const w = makeWorld(box);
    for (let a = 0; a < 16; a++) {
      const angle = (a / 16) * Math.PI * 2;
      let b = ballAt(vec(512, 768), vec(Math.cos(angle) * MAX_SPEED, Math.sin(angle) * MAX_SPEED));
      for (let i = 0; i < 1200; i++) {
        b = step(b, w, 1 / 60).ball;
        expect(b.pos.x).toBeGreaterThan(-BALL_RADIUS);
        expect(b.pos.x).toBeLessThan(1024 + BALL_RADIUS);
        expect(b.pos.y).toBeGreaterThan(-BALL_RADIUS);
        expect(b.pos.y).toBeLessThan(1536 + BALL_RADIUS);
      }
    }
  });

  it('survives a frame long enough to have come back from a backgrounded tab', () => {
    // `step` clamps dt itself rather than trusting the caller to. Before it did,
    // a four second frame worked out at 818 units per substep against a 27 unit
    // ball and went straight through the floor.
    const w = makeWorld(box);
    for (const dt of [1, 4, 30, 600]) {
      const b = step(ballAt(vec(512, 768), vec(3000, 3000)), w, dt);
      expect(b.ball.pos.x).toBeGreaterThan(-BALL_RADIUS);
      expect(b.ball.pos.x).toBeLessThan(1024 + BALL_RADIUS);
      expect(b.ball.pos.y).toBeGreaterThan(-BALL_RADIUS);
      expect(b.ball.pos.y).toBeLessThan(1536 + BALL_RADIUS);
    }
  });

  it('ignores a negative dt rather than running time backwards', () => {
    const w = makeWorld(box);
    const before = ballAt(vec(512, 768), vec(1000, 0));
    const after = step(before, w, -1);
    expect(after.ball.pos).toEqual(before.pos);
  });
});

describe('sensors and switched-off colliders', () => {
  it('reports a sensor without deflecting the ball', () => {
    const w = makeWorld([wall('lane', vec(0, 1000), vec(1000, 1000), WOOD, 0, true)]);
    const before = ballAt(vec(500, 980), vec(0, 2000));
    const after = step(before, w, 1 / 240);
    expect(after.hits.map((h) => h.id)).toContain('lane');
    expect(after.ball.vel.y).toBeGreaterThan(0);
  });

  it('lets the ball straight through an inactive collider', () => {
    const target = wall('target', vec(400, 1000), vec(600, 1000));
    target.active = false;
    const w = makeWorld([target]);
    const after = step(ballAt(vec(500, 990), vec(0, 3000)), w, 1 / 60);
    expect(after.hits).toHaveLength(0);
    expect(after.ball.pos.y).toBeGreaterThan(1030);
  });
});

describe('moving surfaces', () => {
  it('gives a point twice as far from the pivot twice the speed', () => {
    const pivot = vec(0, 0);
    const near = pointVelocity(vec(50, 0), pivot, 10);
    const far = pointVelocity(vec(100, 0), pivot, 10);
    expect(len(far)).toBeCloseTo(len(near) * 2, 6);
  });

  it('a still surface at the pivot has no speed at all', () => {
    expect(pointVelocity(vec(0, 0), vec(0, 0), 30)).toEqual(vec(-0, 0));
  });

  it('throws a ball harder than it arrived when the surface is moving into it', () => {
    const pivot = vec(500, 1000);
    const moving: MovingCollider = {
      id: 'bat',
      seg: segment(pivot, vec(650, 1000), 12),
      material: RUBBER,
      surfaceVelocity: (p) => pointVelocity(p, pivot, -30),
    };
    const w = makeWorld([], [moving]);
    const before = ballAt(vec(620, 963), vec(0, 200));
    const after = step(before, w, 1 / 240);
    expect(after.ball.vel.y).toBeLessThan(0);
    expect(len(after.ball.vel)).toBeGreaterThan(len(before.vel));
  });
});
