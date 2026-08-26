import { describe, it, expect } from 'vitest';
import { vec, len, dist } from '../src/engine/vec.js';
import type { Ball, World } from '../src/engine/physics.js';
import { step as stepPhysics, substepsFor, BALL_RADIUS, GRAVITY } from '../src/engine/physics.js';
import type { Flipper } from '../src/engine/flipper.js';
import {
  createFlipper,
  stepFlipper,
  flipperSegment,
  flipperTip,
  flipperCollider,
  flipperColliders,
  flipperSweep,
  angleAt,
  restAngle,
  flippedAngle,
  FLIPPER_LENGTH,
  FLIP_SPEED,
  RETURN_SPEED,
} from '../src/engine/flipper.js';

describe('flipper geometry', () => {
  it('rests pointing down and inwards on both sides', () => {
    const left = createFlipper('left', vec(300, 1300));
    const right = createFlipper('right', vec(700, 1300));
    // y grows downwards, so a resting bat has its tip below its pivot.
    expect(flipperTip(left).y).toBeGreaterThan(300 + 1000);
    expect(flipperTip(right).y).toBeGreaterThan(300 + 1000);
    // And each points towards the middle of the table.
    expect(flipperTip(left).x).toBeGreaterThan(300);
    expect(flipperTip(right).x).toBeLessThan(700);
  });

  it('mirrors the two sides through the vertical', () => {
    expect(Math.sin(restAngle('left'))).toBeCloseTo(Math.sin(restAngle('right')), 10);
    expect(Math.cos(restAngle('left'))).toBeCloseTo(-Math.cos(restAngle('right')), 10);
    expect(Math.sin(flippedAngle('left'))).toBeCloseTo(Math.sin(flippedAngle('right')), 10);
  });

  it('starts its capsule at the pivot, so nothing slips behind the hinge', () => {
    const f = createFlipper('left', vec(300, 1300));
    expect(flipperSegment(f).a).toEqual(vec(300, 1300));
    expect(dist(flipperSegment(f).a, flipperSegment(f).b)).toBeCloseTo(FLIPPER_LENGTH, 6);
  });
});

describe('flipper movement', () => {
  it('swings up when pressed and comes back when released', () => {
    let f = createFlipper('left', vec(300, 1300));
    const restY = flipperTip(f).y;

    for (let i = 0; i < 30; i++) f = stepFlipper(f, true, 1 / 240);
    expect(flipperTip(f).y).toBeLessThan(restY);
    expect(f.angle).toBeCloseTo(flippedAngle('left'), 6);

    for (let i = 0; i < 120; i++) f = stepFlipper(f, false, 1 / 240);
    expect(f.angle).toBeCloseTo(restAngle('left'), 6);
  });

  it('takes about 35 milliseconds to complete the sweep', () => {
    let f = createFlipper('left', vec(300, 1300));
    let elapsed = 0;
    const dt = 1 / 2000;
    while (Math.abs(f.angle - flippedAngle('left')) > 1e-6 && elapsed < 1) {
      f = stepFlipper(f, true, dt);
      elapsed += dt;
    }
    expect(elapsed).toBeGreaterThan(0.02);
    expect(elapsed).toBeLessThan(0.05);
  });

  it('comes back slower than it goes, because that way is only a spring', () => {
    expect(RETURN_SPEED).toBeLessThan(FLIP_SPEED);
  });

  it('reports no rotation once it has reached the stop', () => {
    // A bat against its stop is not moving. Reporting FLIP_SPEED here would let
    // a ball resting on a fully raised flipper be launched by a still surface.
    let f = createFlipper('left', vec(300, 1300));
    for (let i = 0; i < 60; i++) f = stepFlipper(f, true, 1 / 240);
    expect(f.angle).toBeCloseTo(flippedAngle('left'), 6);
    expect(f.omega).toBeCloseTo(0, 6);
  });
});

describe('what the ball feels', () => {
  it('gives the tip far more speed than the base', () => {
    let f = createFlipper('left', vec(300, 1300));
    f = stepFlipper(f, true, 1 / 2000);
    const c = flipperCollider(f);

    const nearPivot = c.surfaceVelocity(vec(325, 1314));
    const nearTip = c.surfaceVelocity(flipperTip(f));

    expect(len(nearTip)).toBeGreaterThan(len(nearPivot) * 3);
  });

  it('gives a still flipper no surface speed anywhere along it', () => {
    const f = createFlipper('left', vec(300, 1300));
    const c = flipperCollider(f);
    expect(len(c.surfaceVelocity(flipperTip(f)))).toBeCloseTo(0, 10);
  });

  it('moves the tip at roughly length times omega', () => {
    let f = createFlipper('left', vec(300, 1300));
    f = stepFlipper(f, true, 1 / 2000);
    const speed = len(flipperCollider(f).surfaceVelocity(flipperTip(f)));
    expect(speed).toBeCloseTo(FLIPPER_LENGTH * FLIP_SPEED, -2);
  });
});

/**
 * The bat has to hit the ball at every point along itself, at the frame rate it
 * is actually played at.
 *
 * This is the test that was missing while the outer half of both bats was
 * passing straight through the ball. The unit suite was green throughout,
 * because every test in it either held the bat still or stepped it at 1/2000,
 * and at 1/2000 the bat moves 2 units a frame and no hole opens up. The bug only
 * exists at 60 Hz, so the test runs at 60 Hz.
 *
 * Reported from play as two separate things, "the corners of the levers have no
 * hitbox" and "it seems to go through the back entirely". One cause: the sweep
 * grows with distance from the pivot, so the tip is where the bat gets past the
 * ball, and a ball the bat has got past is a ball behind the bat.
 */
describe('a swung bat cannot pass through the ball', () => {
  const DT = 1 / 60;

  /** A ball parked on the bat at `t` units along it, just clear of the surface. */
  function restingOn(f: Flipper, t: number): Ball {
    const dir = vec(Math.cos(f.angle), Math.sin(f.angle));
    // The perpendicular that points up the screen, which is the side a ball
    // rests on. Which of the two perpendiculars that is flips between the sides,
    // because the right bat points the other way along its own axis, so it is
    // chosen by its sign rather than written down once and mirrored.
    const across = vec(dir.y, -dir.x);
    const up = across.y < 0 ? across : vec(-across.x, -across.y);
    const clear = BALL_RADIUS + f.radius + 1;
    return {
      pos: vec(f.pivot.x + dir.x * t + up.x * clear, f.pivot.y + dir.y * t + up.y * clear),
      vel: vec(0, 0),
      radius: BALL_RADIUS,
    };
  }

  function swing(side: 'left' | 'right', t: number) {
    let f = createFlipper(side, vec(339, 1288));
    const ball = restingOn(f, t);
    f = stepFlipper(f, true, DT);
    const world: World = {
      colliders: [], moving: flipperColliders(f), gravity: GRAVITY, drag: 0.22,
    };
    return stepPhysics(ball, world, DT);
  }

  for (const t of [10, 30, 50, 70, 90, 110, 130]) {
    it(`throws a ball resting ${t} units along it, rather than sweeping past it`, () => {
      for (const side of ['left', 'right'] as const) {
        const { ball, hits } = swing(side, t);
        expect(hits.filter((h) => h.id.startsWith('flipper')).length).toBeGreaterThan(0);
        // Up the screen, which is the only direction a flipped bat should send it.
        expect(ball.vel.y).toBeLessThan(0);
      }
    });
  }

  it('reads the bat across the frame it just took, not only at the end of it', () => {
    let f = createFlipper('left', vec(339, 1288));
    const started = f.angle;
    f = stepFlipper(f, true, DT);
    expect(f.prevAngle).toBeCloseTo(started, 10);
    expect(angleAt(f, 0)).toBeCloseTo(f.prevAngle, 10);
    expect(angleAt(f, 1)).toBeCloseTo(f.angle, 10);
    expect(angleAt(f, 0.5)).toBeCloseTo((f.prevAngle + f.angle) / 2, 10);
    // A still bat sweeps nothing, so it costs no extra substeps.
    expect(flipperSweep(createFlipper('left', vec(339, 1288)))).toBe(0);
  });

  it('gives the tip a harder shot than the base, which is why aiming pays', () => {
    const base = swing('left', 30).ball.vel;
    const tip = swing('left', 120).ball.vel;
    expect(len(tip)).toBeGreaterThan(len(base) * 1.5);
  });

  it('cuts the frame fine enough for the bat even when the ball is crawling', () => {
    let f = createFlipper('left', vec(339, 1288));
    f = stepFlipper(f, true, DT);
    // A dawdling ball asks for one substep on its own account. The bat's own
    // travel is what has to raise that, and 69 units against a 13.5 unit limit
    // is six.
    const crawling = substepsFor(200, DT, BALL_RADIUS, GRAVITY, flipperSweep(f));
    expect(crawling).toBeGreaterThanOrEqual(5);
    expect(substepsFor(200, DT, BALL_RADIUS, GRAVITY, 0)).toBe(1);
  });
});
