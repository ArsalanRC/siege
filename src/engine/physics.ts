/**
 * The physics. One ball, many static surfaces, a few moving ones.
 *
 * Nothing here imports the DOM, reads the clock or touches a canvas. It takes a
 * world and a time step and returns a new ball plus the list of things it hit,
 * which is what lets the whole simulation run headless in the tests.
 *
 * ## Scale, and why the numbers are not arbitrary
 *
 * The table is 1024 units wide because the playfield art is 1024 pixels wide,
 * so one unit is one pixel of art and nothing ever needs converting. A real
 * playfield is 20.25 inches, or 0.514 metres, which makes 1024 units = 0.514 m
 * and therefore **1992 units per metre**.
 *
 * That one ratio fixes everything else from real measurements rather than from
 * taste:
 *
 * - A pinball is 1.0625 inches across, so its radius is **27 units**.
 * - A table is tilted about 6.5 degrees, so the ball feels `9.81 * sin(6.5°)`
 *   = 1.11 m/s² down the slope, which is **2213 units/s²**.
 *
 * Tuning by feel would have landed somewhere near these anyway. Deriving them
 * means that when the ball feels wrong, the constants are not the suspect.
 *
 * ## Why the substep count is computed rather than fixed
 *
 * Collision here is discrete: each substep moves the ball, then asks what it is
 * overlapping. That is simple and fast and it has one failure mode, which is a
 * ball moving further in a step than its own radius. It passes clean through a
 * wall, and since nothing errors, the symptom is a ball that silently leaves
 * the table.
 *
 * A ball off a strong flipper reaches roughly 6 m/s, about 12000 units/s. At a
 * fixed 240 Hz that is 50 units a step against a 27 unit radius, so it tunnels.
 * Stepping everything at 1000 Hz to survive the worst case would mean paying
 * for it constantly, while the ball spends most of its life slow.
 *
 * So the step count comes from the speed: never move more than half a radius at
 * a time. A resting ball costs one substep, a launched ball costs forty, and
 * the guarantee holds at both ends.
 */

import type { Vec } from './vec.js';
import type { Segment, Circle, Contact } from './shapes.js';
import { add, sub, scale, dot, len, norm, clampLen, ZERO } from './vec.js';
import { ballVsSegment, ballVsCircle } from './shapes.js';

/** Units per metre, from a 20.25 inch playfield drawn 1024 units wide. */
export const UNITS_PER_M = 1992;

/** Radius of a 1.0625 inch pinball at that scale. */
export const BALL_RADIUS = 27;

/** `9.81 * sin(6.5°)`, the slope component on a normally levelled table. */
export const GRAVITY = 2213;

/**
 * Hard ceiling on ball speed, about 6 m/s.
 *
 * Real balls do go faster off a hard shot, but past this the ball crosses the
 * whole table in a quarter second and stops being something a player can read.
 * It also keeps the substep count bounded, since that count is derived from
 * speed.
 */
export const MAX_SPEED = 12000;

/**
 * Never travel further than this fraction of a radius in one substep.
 *
 * Half, rather than a whole radius, because the ball has to be *overlapping* a
 * wall to be detected, not merely touching it. At a full radius a ball can
 * arrive exactly flush with a surface and be reported as clear.
 */
const MAX_STEP_FRACTION = 0.5;

/** Above this many substeps something has gone wrong, so stop rather than hang. */
const MAX_SUBSTEPS = 64;

/**
 * The longest frame this will simulate, whatever it is handed.
 *
 * A backgrounded tab hands back a `dt` of several seconds when it wakes. With
 * the substep count capped, a four second frame works out at 818 units per
 * substep against a 27 unit ball, so it tunnels straight out of the table.
 *
 * The first version of this said "the caller should cap dt" in a comment, which
 * is how a safety property quietly stops holding: the guarantee lived in prose,
 * in a different file from the code that depended on it. Clamping here makes it
 * unconditional. A long frame now costs the player a little lost time, which
 * nobody notices, instead of a ball that leaves the table, which everybody does.
 */
const MAX_DT = 1 / 30;

/**
 * Pushed this far past touching when separating a penetrating ball.
 *
 * Resolving to exactly zero overlap leaves the ball flush against the wall, so
 * the next step detects the same contact again with a depth of zero and burns
 * an impulse on it. The visible result is a ball that buzzes along a wall
 * instead of rolling down it.
 */
const SEPARATION_SLOP = 0.01;

export interface Material {
  /** 0 is dead, 1 returns all the speed. Wood is low, rubber is high. */
  readonly restitution: number;
  /** How much sideways speed a graze loses. 0 is ice, 1 grips completely. */
  readonly friction: number;
}

export const WOOD: Material = { restitution: 0.28, friction: 0.14 };
export const METAL: Material = { restitution: 0.45, friction: 0.05 };
export const RUBBER: Material = { restitution: 0.72, friction: 0.32 };
export const PLASTIC: Material = { restitution: 0.52, friction: 0.18 };

export interface Ball {
  readonly pos: Vec;
  readonly vel: Vec;
  readonly radius: number;
}

/**
 * Anything solid on the table.
 *
 * `kick` is extra speed added straight along the normal, which is how a bumper
 * or a slingshot throws a ball harder than it arrived. Restitution alone can
 * never do that, since restitution only ever returns a fraction of what came
 * in, and a ball that dribbles into a bumper has almost nothing to return.
 *
 * `active` exists for drop targets. A target that has been knocked down is
 * still on the table and still drawn, it just stops being solid.
 */
export interface Collider {
  readonly id: string;
  readonly type: 'segment' | 'circle';
  readonly seg?: Segment;
  readonly circle?: Circle;
  readonly material: Material;
  readonly kick: number;
  /** Detects the ball and reports it, but never changes its path. */
  readonly sensor: boolean;
  active: boolean;
}

/**
 * A surface that is moving, which for this table means a flipper.
 *
 * The ball has to bounce off where the bat *is* and be thrown by how fast that
 * part of the bat is *going*. A flipper tip travels far quicker than its base,
 * so `surfaceVelocity` takes the contact point rather than being one number for
 * the whole bat. That difference is the entire reason a tip shot is worth
 * aiming for.
 */
export interface MovingCollider {
  readonly id: string;
  readonly seg: Segment;
  readonly material: Material;
  surfaceVelocity(point: Vec): Vec;
}

export interface World {
  readonly colliders: readonly Collider[];
  readonly moving: readonly MovingCollider[];
  readonly gravity: number;
  /** Speed lost per second to rolling on the wood. */
  readonly drag: number;
}

/** One touch, reported upward so the game can score it and make a noise. */
export interface Hit {
  readonly id: string;
  /** Closing speed along the normal. Small taps and hard shots score alike otherwise. */
  readonly speed: number;
  readonly point: Vec;
}

export interface StepResult {
  readonly ball: Ball;
  readonly hits: readonly Hit[];
}

/**
 * How many substeps this frame needs, from how far the ball would otherwise go.
 *
 * The `+ gravity * dt` term matters. A ball at the top of its arc is momentarily
 * slow, and sizing the step from that speed alone under-counts the step it is
 * about to accelerate into.
 */
export function substepsFor(speed: number, dt: number, radius: number, gravity: number): number {
  const reach = (speed + gravity * dt) * dt;
  const limit = radius * MAX_STEP_FRACTION;
  if (reach <= limit) return 1;
  return Math.min(MAX_SUBSTEPS, Math.ceil(reach / limit));
}

/**
 * Bounce one ball off one contact.
 *
 * The order is: separate, then check whether they are actually closing, then
 * apply the impulse. Checking first is what stops a ball wedged in a corner
 * from being kicked twice by two walls that both think it is arriving.
 *
 * `surfaceVel` is the velocity of the thing being hit. For static geometry it
 * is zero and everything below reduces to a plain reflection.
 */
export function respond(
  ball: Ball,
  contact: Contact,
  material: Material,
  kick: number,
  surfaceVel: Vec = ZERO,
): Ball {
  const n = contact.normal;
  const pos = add(ball.pos, scale(n, contact.depth + SEPARATION_SLOP));

  // Everything from here is measured relative to the surface, so a moving
  // flipper and a static wall go through identical arithmetic.
  const rel = sub(ball.vel, surfaceVel);
  const vn = dot(rel, n);

  // Already moving apart. Separating it was the whole job.
  if (vn >= 0) {
    return kick > 0 ? { ...ball, pos, vel: add(ball.vel, scale(n, kick)) } : { ...ball, pos };
  }

  // Split into the part along the normal and the part across it.
  const normalPart = scale(n, vn);
  const tangentPart = sub(rel, normalPart);

  // Reverse and shrink the normal part; drag on the tangent part.
  const bounced = scale(n, -vn * material.restitution);
  const grazed = scale(tangentPart, 1 - material.friction);

  let vel = add(add(bounced, grazed), surfaceVel);
  if (kick > 0) vel = add(vel, scale(n, kick));

  return { ...ball, pos, vel: clampLen(vel, MAX_SPEED) };
}

function contactFor(ball: Ball, c: Collider): Contact | null {
  if (c.type === 'segment') {
    return c.seg ? ballVsSegment(ball.pos, ball.radius, c.seg) : null;
  }
  return c.circle ? ballVsCircle(ball.pos, ball.radius, c.circle) : null;
}

/**
 * Advance one substep: integrate, then resolve every overlap once.
 *
 * Resolving once per collider per substep rather than looping to convergence is
 * a deliberate limit. A proper solver would iterate until nothing overlaps,
 * which matters when bodies stack. Nothing stacks here, there is one ball, and
 * the substeps are short enough that a single pass leaves no visible
 * penetration. Iterating would cost time and buy nothing.
 */
function integrate(ball: Ball, world: World, dt: number, hits: Hit[]): Ball {
  const gravityStep: Vec = { x: 0, y: world.gravity * dt };
  let vel = add(ball.vel, gravityStep);

  // Rolling resistance, applied as a fraction rather than a subtraction so a
  // nearly stopped ball eases to rest instead of reversing through zero.
  if (world.drag > 0) vel = scale(vel, Math.max(0, 1 - world.drag * dt));

  vel = clampLen(vel, MAX_SPEED);
  let next: Ball = { ...ball, pos: add(ball.pos, scale(vel, dt)), vel };

  for (const c of world.colliders) {
    if (!c.active) continue;
    const contact = contactFor(next, c);
    if (!contact) continue;

    // A sensor reports simply for being overlapped, since that is the question
    // it exists to answer. A solid surface reports only when the ball is
    // actually arriving: a ball already on its way out is still momentarily
    // overlapping, and counting that would score the same target twice.
    if (c.sensor) {
      hits.push({ id: c.id, speed: 0, point: contact.point });
      continue;
    }
    const closing = -dot(next.vel, contact.normal);
    if (closing > 0) hits.push({ id: c.id, speed: closing, point: contact.point });

    next = respond(next, contact, c.material, c.kick);
  }

  for (const m of world.moving) {
    const contact = ballVsSegment(next.pos, next.radius, m.seg);
    if (!contact) continue;

    const surfaceVel = m.surfaceVelocity(contact.point);
    const closing = -dot(sub(next.vel, surfaceVel), contact.normal);
    if (closing > 0) hits.push({ id: m.id, speed: closing, point: contact.point });

    next = respond(next, contact, m.material, 0, surfaceVel);
  }

  return next;
}

/**
 * Advance one frame, split into as many substeps as the ball's speed demands.
 *
 * `dt` is real elapsed time and is clamped to `MAX_DT` here rather than being
 * trusted, so no caller can break the no-tunnelling guarantee by handing over a
 * frame that spent four seconds in a background tab.
 */
export function step(ball: Ball, world: World, dt: number): StepResult {
  const hits: Hit[] = [];
  const frame = Math.min(Math.max(dt, 0), MAX_DT);
  const n = substepsFor(len(ball.vel), frame, ball.radius, world.gravity);
  const slice = frame / n;

  let current = ball;
  for (let i = 0; i < n; i++) {
    current = integrate(current, world, slice, hits);
  }

  return { ball: current, hits };
}

/** Surface velocity of a point on a body rotating about `pivot` at `omega` rad/s. */
export function pointVelocity(point: Vec, pivot: Vec, omega: number): Vec {
  const r = sub(point, pivot);
  // The 2D cross product of the angular velocity with the radius, which for a
  // scalar omega is just the radius turned a quarter turn and scaled.
  return { x: -r.y * omega, y: r.x * omega };
}

/** Direction the ball is travelling, or zero when it is at rest. */
export function heading(ball: Ball): Vec {
  return norm(ball.vel);
}
