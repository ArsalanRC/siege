/**
 * The flippers.
 *
 * A flipper is a capsule that turns about a fixed pivot. Two numbers describe
 * it at any moment: where it is pointing, and how fast it is turning. The
 * second one is what makes it a flipper rather than a moving wall, because the
 * physics adds the surface speed at the contact point before working out the
 * bounce.
 *
 * ## Why a tip shot is worth aiming for
 *
 * Every point on the bat turns at the same angular rate, so a point twice as
 * far from the pivot moves twice as fast. The tip of a 150 unit bat at 32 rad/s
 * is travelling 4800 units a second, while a point a third of the way along is
 * doing 1600. Nothing in the code favours the tip. It falls out of `omega * r`
 * on its own, which is the good kind of game mechanic: the player learns it by
 * feel and it was never written down anywhere.
 *
 * ## The numbers, again from a real machine
 *
 * A bat is about 3 inches on a 20.25 inch playfield, so 150 units at this
 * scale. It sweeps roughly 60 degrees, and it gets there in about 35
 * milliseconds, which is 1.05 radians in 0.035 seconds, so **32 rad/s** going
 * up. Coming back down it is only a spring, so it is set at less than half that.
 */

import type { Vec } from './vec.js';
import type { Segment } from './shapes.js';
import type { MovingCollider, Material } from './physics.js';
import { pointVelocity } from './physics.js';

export type Side = 'left' | 'right';

/** Half the sweep, in radians. The bat sits this far below level and swings to this far above. */
const HALF_SWEEP = 0.52;

export const FLIPPER_LENGTH = 150;
export const FLIPPER_RADIUS = 12;

/** Radians per second on the way up, from 60 degrees in 35 milliseconds. */
export const FLIP_SPEED = 32;

/** Coming back is spring driven only, so it is much slower. */
export const RETURN_SPEED = 13;

/**
 * Flippers are livelier than plain rubber.
 *
 * Real bats have a rubber sleeve, but a lot of what a player reads as "the
 * flipper is alive" is the coil, and the coil arrives through `surfaceVelocity`
 * rather than through restitution. This is nudged above plain rubber so a dead
 * ball dropped onto a still flipper does not simply die on it.
 */
export const FLIPPER_MATERIAL: Material = { restitution: 0.55, friction: 0.42 };

export interface Flipper {
  readonly side: Side;
  readonly pivot: Vec;
  readonly length: number;
  readonly radius: number;
  /** Radians, measured from the positive x axis. y points down the screen. */
  readonly angle: number;
  /** Radians per second, as actually travelled last step, not as requested. */
  readonly omega: number;
  readonly pressed: boolean;
}

/**
 * Rest and flipped angles for a side.
 *
 * With y pointing down the screen, a positive angle points downward. The left
 * bat therefore rests at `+HALF_SWEEP`, pointing right and down, and flips to
 * `-HALF_SWEEP`, pointing right and up. The right bat is the mirror of that
 * through the vertical, which is `pi` minus the left angle.
 */
export function restAngle(side: Side): number {
  return side === 'left' ? HALF_SWEEP : Math.PI - HALF_SWEEP;
}

export function flippedAngle(side: Side): number {
  return side === 'left' ? -HALF_SWEEP : Math.PI + HALF_SWEEP;
}

export function createFlipper(side: Side, pivot: Vec): Flipper {
  return {
    side,
    pivot,
    length: FLIPPER_LENGTH,
    radius: FLIPPER_RADIUS,
    angle: restAngle(side),
    omega: 0,
    pressed: false,
  };
}

/**
 * Advance a flipper one step towards wherever the button says it should be.
 *
 * `omega` is set from the distance actually covered rather than from
 * `FLIP_SPEED`, and the difference matters at the ends of the sweep. A bat that
 * has reached the stop is not turning at all, and reporting that it still is
 * would let a ball resting against a fully raised flipper be launched by a
 * surface that is standing still.
 */
export function stepFlipper(f: Flipper, pressed: boolean, dt: number): Flipper {
  const target = pressed ? flippedAngle(f.side) : restAngle(f.side);
  const rate = pressed ? FLIP_SPEED : RETURN_SPEED;
  const delta = target - f.angle;
  const maxTravel = rate * dt;

  if (Math.abs(delta) <= maxTravel) {
    return { ...f, angle: target, omega: delta / dt, pressed };
  }

  const travel = Math.sign(delta) * maxTravel;
  return { ...f, angle: f.angle + travel, omega: travel / dt, pressed };
}

/** Where the tip currently is. */
export function flipperTip(f: Flipper): Vec {
  return {
    x: f.pivot.x + Math.cos(f.angle) * f.length,
    y: f.pivot.y + Math.sin(f.angle) * f.length,
  };
}

/**
 * The bat as a capsule.
 *
 * It starts at the pivot rather than a little way along it, so the rounded end
 * of the capsule covers the pivot itself. A ball that reaches the gap between
 * the bat and its own hinge would otherwise slip behind the flipper, which
 * looks exactly like a physics bug even when the ball came in legitimately.
 */
export function flipperSegment(f: Flipper): Segment {
  return { a: f.pivot, b: flipperTip(f), radius: f.radius };
}

/** Wrap a flipper as something the physics step knows how to collide with. */
export function flipperCollider(f: Flipper): MovingCollider {
  const seg = flipperSegment(f);
  const pivot = f.pivot;
  const omega = f.omega;
  return {
    id: `flipper-${f.side}`,
    seg,
    material: FLIPPER_MATERIAL,
    surfaceVelocity(point: Vec): Vec {
      return pointVelocity(point, pivot, omega);
    },
  };
}
