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
/**
 * Sixteen, not twelve, to match the bat that is actually drawn.
 *
 * The sprite's gold pivot boss is visibly wider than a 12 unit capsule, so a
 * ball aimed at the base of the flipper passed straight through the part of it
 * you can see. Reported as "the corner of the lever is just not hittable".
 *
 * It is also about right for a real bat: half an inch across the base at 1992
 * units per metre is 12.6 units of half-width, and a rubber sleeve takes it the
 * rest of the way.
 */
export const FLIPPER_RADIUS = 16;

/**
 * The bat's silhouette, measured off `flipper.png`.
 *
 * A real flipper is a wedge, not a rod: wide at the hinge and tapering to a
 * point. The collision was a capsule of one radius, so it was thinner than the
 * drawing at the base and fatter than it at the tip, and the ball bounced off
 * air near the tip and passed through paint near the hinge. Reported as "the two
 * flippers should be the exact shape, not a different shape".
 *
 * These are the half-height of the sprite's opaque pixels at ten points along
 * the bat, as a **fraction of its half-height at the hinge**. Both the collision
 * and the drawing are scaled from this one list, so the outline the ball hits
 * and the outline you can see are the same shape by construction. That is the
 * habitrail lesson applied to a moving part.
 *
 * Scanned by walking the alpha channel column by column. The sprite's own spine
 * droops 3.3 degrees inside its image, which is the artist drawing the bat at a
 * slight angle rather than anything the physics should inherit, so the renderer
 * takes it back out.
 */
const BAT_TAPER: readonly number[] = [
  1.00, 0.94, 0.87, 0.81, 0.76, 0.71, 0.64, 0.57, 0.49, 0.41, 0.36,
];

/** How the sprite maps onto the bat: hinge and tip, in fractions of its width. */
export const BAT_SPRITE = {
  /** Where the pivot boss sits in the image, as a fraction of width and height. */
  hingeX: 76 / 512,
  hingeY: 73.5 / 148,
  /** Where the tip sits, as a fraction of width. */
  tipX: 505 / 512,
  /** Half-height at the hinge, as a fraction of image height. Sets the scale. */
  hingeHalf: 73.5 / 148,
  /** The spine's droop inside the image, in radians, taken out when drawing. */
  droop: Math.atan2((111.5 - 73.5) / 148, ((485 - 76) / 512) * (512 / 429)),
} as const;

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

/**
 * The bat as the wedge it is drawn as: a chain of capsules that narrow.
 *
 * Ten short segments rather than one long one, each carrying the radius the
 * sprite is that wide at. The steps between neighbours are under two units, well
 * below anything a 54 unit ball can feel, and the radius only ever decreases
 * along the chain so the outline stays convex and nothing can catch on a joint.
 */
export function flipperSegments(f: Flipper): Segment[] {
  const dir = { x: Math.cos(f.angle), y: Math.sin(f.angle) };
  const steps = BAT_TAPER.length - 1;
  const out: Segment[] = [];
  for (let i = 0; i < steps; i++) {
    const t0 = (i / steps) * f.length;
    const t1 = ((i + 1) / steps) * f.length;
    // The radius at the middle of this piece, so the chain neither over nor
    // under-covers the drawn edge.
    const mid = (BAT_TAPER[i]! + BAT_TAPER[i + 1]!) / 2;
    out.push({
      a: { x: f.pivot.x + dir.x * t0, y: f.pivot.y + dir.y * t0 },
      b: { x: f.pivot.x + dir.x * t1, y: f.pivot.y + dir.y * t1 },
      radius: f.radius * mid,
    });
  }
  return out;
}

/**
 * Wrap a flipper as things the physics step knows how to collide with.
 *
 * Every piece shares the same pivot and the same angular rate, so a tip shot is
 * still faster than a base shot for exactly the reason it always was: the
 * surface velocity comes from `omega * r` at the contact point, and nothing here
 * treats the pieces differently.
 */
export function flipperColliders(f: Flipper): MovingCollider[] {
  const pivot = f.pivot;
  const omega = f.omega;
  return flipperSegments(f).map((seg) => ({
    id: `flipper-${f.side}`,
    seg,
    material: FLIPPER_MATERIAL,
    surfaceVelocity(point: Vec): Vec {
      return pointVelocity(point, pivot, omega);
    },
  }));
}

/** The whole bat as one capsule. Kept for the parts that only need its spine. */
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
