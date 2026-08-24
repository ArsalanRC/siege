import { describe, it, expect } from 'vitest';
import { vec, len, dist } from '../src/engine/vec.js';
import {
  createFlipper,
  stepFlipper,
  flipperSegment,
  flipperTip,
  flipperCollider,
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
