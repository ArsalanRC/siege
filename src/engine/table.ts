/**
 * What a table IS, and the parts every table is built out of.
 *
 * There are two boards now, the castle and the space machine, and they run on
 * the same physics at the same scale. This file is the line between them: the
 * shape of a table, the builders that make colliders, and the handful of
 * assemblies that are genuinely the same part on both machines. Everything with
 * a castle or a starfield in it lives in `tables/`.
 *
 * ## The size is a constraint, not a coincidence
 *
 * Both boards are **1024 by 1536 units**. That is not laziness, it is what keeps
 * the ball radius, the gravity, the substep budget, the renderer and the whole
 * test suite transferable. A real manufacturer builds different playfields into
 * the same cabinet for the same reason.
 *
 * ## Why the constants moved onto the table
 *
 * They used to be module-level exports: one `DRAIN_Y`, one `PLUNGER_REST`, one
 * pair of flipper pivots. With one board that reads fine. With two it is a
 * silent bug waiting to happen, because the second board would be simulated
 * using the first board's drain line and nothing would say so. So anything that
 * differs between boards is a field on `Table` and is read from the table the
 * game is actually playing.
 *
 * ## Angles
 *
 * y points down the screen. An angle of zero points right, and it increases
 * clockwise as it is drawn.
 */

import type { Vec } from './vec.js';
import { vec } from './vec.js';
import type { Segment } from './shapes.js';
import { arcToSegments, segment } from './shapes.js';
import type { Collider, Material } from './physics.js';
import { WOOD, METAL } from './physics.js';

export const TABLE_W = 1024;
export const TABLE_H = 1536;

/** A 54 unit ball. Any channel narrower than this is one no ball has ever gone down. */
export const BALL_ACROSS = 54;

export type TableId = 'siege' | 'nova';

/**
 * The shooter lane, up the right hand edge. The same part on both boards.
 *
 * Measured once, on the castle's painted rails at y = 700: the bright metal
 * inner rail runs 908 to 916 and the outer one 998 to 1010, so the channel
 * between them is 76 units for a 54 unit ball. It was modelled 105 wide once and
 * a ball fired up a channel half again wider than the painted one rattles
 * between two rails that are not where the picture puts them.
 *
 * The space board is drawn to this rather than measured from it, which is the
 * whole advantage of authoring the geometry first.
 */
export const LANE_X = 918;
export const LANE_OUTER_X = 994;

/**
 * Past this the ball is gone, and it is below the bottom edge of the board.
 *
 * It used to be 1450 on a 1536 tall table, which put it a hundred units under
 * the flippers and well inside the picture. The ball blinked out of existence in
 * the middle of the apron and a new one appeared, which reads as the game
 * glitching rather than as losing a ball. At 1580 the ball is fully past the
 * bottom edge, radius included, before anything counts it as lost.
 */
export const DRAIN_Y = 1580;

/** A scoop lets go hard. This is a coil, not a bounce. */
export const SCOOP_KICK = 3000;

/* ------------------------------------------------------------------ *
 * Collider builders
 * ------------------------------------------------------------------ */

let nextId = 0;

/** Called at the top of every board builder, so ids are stable per table. */
export function resetIds(): void {
  nextId = 0;
}

function id(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

export function pts(list: ReadonlyArray<readonly [number, number]>): Vec[] {
  return list.map(([x, y]) => vec(x, y));
}

export function solid(prefix: string, segs: Segment[], material: Material, kick = 0): Collider[] {
  return segs.map((seg) => ({
    id: id(prefix),
    type: 'segment' as const,
    seg,
    material,
    kick,
    sensor: false,
    active: true,
  }));
}

export function post(prefix: string, c: Vec, radius: number, material: Material, kick = 0): Collider {
  return {
    id: id(prefix),
    type: 'circle',
    circle: { c, radius },
    material,
    kick,
    sensor: false,
    active: true,
  };
}

export function sensor(name: string, segs: Segment[]): Collider[] {
  return segs.map((seg) => ({
    id: name,
    type: 'segment' as const,
    seg,
    material: WOOD,
    kick: 0,
    sensor: true,
    active: true,
  }));
}

export function sensorCircle(name: string, c: Vec, radius: number): Collider {
  return {
    id: name,
    type: 'circle',
    circle: { c, radius },
    material: WOOD,
    kick: 0,
    sensor: true,
    active: true,
  };
}

/* ------------------------------------------------------------------ *
 * The shooter lane, which is one assembly on both boards
 * ------------------------------------------------------------------ */

/**
 * The rail up the right hand edge, stopping short so the ball is thrown out
 * into the horseshoe at the top.
 */
export function shooterLane(): Collider[] {
  const laneTop = 300;
  return solid('lane', [segment(vec(LANE_X, DRAIN_Y), vec(LANE_X, laneTop))], METAL);
}

/**
 * The one-way gate at the top of the lane.
 *
 * Not solid all the time: the game switches it per frame, because whether it
 * should stop the ball depends on which way the ball is going.
 *
 * It reaches the outer wall and slopes down towards the playfield. It used to
 * stop 58 units short, which left a 41 unit notch against the wall that a 54
 * unit ball could not pass but could rest in, so the ball parked at (983, 242)
 * on every strong launch. Meeting the wall removes the notch, and the downhill
 * run means a ball that settles on the gate rolls off its low end onto the table
 * rather than staying there.
 */
export function laneGate(): Collider {
  return {
    id: 'lane-gate',
    type: 'segment',
    seg: segment(vec(LANE_OUTER_X, 262), vec(LANE_X, 300), 6),
    material: METAL,
    kick: 0,
    sensor: false,
    active: false,
  };
}

/* ------------------------------------------------------------------ *
 * Scoops
 * ------------------------------------------------------------------ */

/**
 * How wide a bite each bowl has taken out of itself, facing the playfield.
 *
 * These used to be fixed angles and the fixed angles were wrong: the castle's
 * left bowl opened towards 20 degrees below horizontal while its mouth sits 1.6
 * degrees above it. The coil then fired the ball out of the dish straight into
 * the roof of its own throat, 50 units later, and it dropped back in. Measured:
 * out at 2987 units a second, down to 349 within ten frames, having moved 19
 * units. Computing the opening from the mouth means the bowl always faces the
 * way out.
 */
const SCOOP_HALF_OPEN = (50 * Math.PI) / 180;

/**
 * How far above the mouth's own line the coil aims, in radians.
 *
 * Small, and it has to be. At half a radian the ball left the dish at 27 degrees
 * and hit the roof of its own throat 100 units later, bounced back into the bowl
 * and started the cycle again. Seven degrees clears the lip and still puts some
 * lift on the ball.
 */
const SCOOP_TILT = 0.12;

/** The gap a wall leaves for a bowl: the end of the run above it and the start of the run below. */
export function scoopMouth(
  upper: ReadonlyArray<readonly [number, number]>,
  lower: ReadonlyArray<readonly [number, number]>,
): readonly [Vec, Vec] {
  const a = upper[upper.length - 1]!;
  const b = lower[0]!;
  return [vec(a[0], a[1]), vec(b[0], b[1])];
}

function scoopOpening(centre: Vec, radius: number, mouth: readonly [Vec, Vec]): [Vec, Vec] {
  const to = Math.atan2(
    (mouth[0].y + mouth[1].y) / 2 - centre.y,
    (mouth[0].x + mouth[1].x) / 2 - centre.x,
  );
  const at = (a: number): Vec => vec(centre.x + Math.cos(a) * radius, centre.y + Math.sin(a) * radius);
  return [at(to - SCOOP_HALF_OPEN), at(to + SCOOP_HALF_OPEN)];
}

/**
 * Pair each end of the mouth with the lip on its own side.
 *
 * By NEAREST, never by name. The two lips come back in the order the angles run,
 * which reverses between a bowl that opens right and one that opens left, so
 * naming them "upper" and "lower" was true on one side and a lie on the other.
 * The castle's right scoop was therefore wired as a cross: the top of the mouth
 * ran to the bottom of the bowl and the bottom to the top, which sealed the
 * entrance completely. Two thousand seven hundred test launches from every angle
 * caught 67 balls in the left scoop and none at all in the right, and it was
 * reported from play before the test was written.
 *
 * This is the single most transferable lesson on the whole machine, which is why
 * it is here rather than in either board.
 */
export function scoopThroat(centre: Vec, radius: number, mouth: readonly [Vec, Vec]): [Segment, Segment] {
  const [p, q] = scoopOpening(centre, radius, mouth);
  const d = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
  const straight = d(mouth[0], p) + d(mouth[1], q);
  const crossed = d(mouth[0], q) + d(mouth[1], p);
  return straight <= crossed
    ? [segment(mouth[0], p, 4), segment(mouth[1], q, 4)]
    : [segment(mouth[0], q, 4), segment(mouth[1], p, 4)];
}

/** The arc a bowl's wall covers: everything the opening does not. */
export function scoopArc(centre: Vec, radius: number, mouth: readonly [Vec, Vec]): Segment[] {
  const to = Math.atan2(
    (mouth[0].y + mouth[1].y) / 2 - centre.y,
    (mouth[0].x + mouth[1].x) / 2 - centre.x,
  );
  return arcToSegments(centre, radius, to + SCOOP_HALF_OPEN, to + Math.PI * 2 - SCOOP_HALF_OPEN, 20);
}

/**
 * A scoop, as the game needs to see it.
 *
 * `hold` is where the ball is parked while it is caught, which is inside the
 * painted lane so the picture explains what happened to it. `eject` is a unit
 * vector from the hold point out through the middle of the mouth, so the ball
 * always leaves through the gap rather than into the side of its own chamber.
 */
export interface Scoop {
  readonly id: string;
  readonly centre: Vec;
  readonly radius: number;
  readonly hold: Vec;
  readonly eject: Vec;
  readonly mouth: Vec;
  /** Solid while the coil reloads, so a ball cannot enter a bowl it cannot leave. */
  readonly shutter: Collider;
}

/**
 * The shutter across a mouth, closed while the scoop reloads.
 *
 * A bowl is a dead end and the ball only gets out because the scoop fires it, so
 * a ball that rolls in while the coil is still busy has nowhere to go. Solid
 * exactly when the hole is not ready to take a ball, and open the rest of the
 * time.
 */
export function scoopShutter(index: number, mouth: readonly [Vec, Vec]): Collider {
  return {
    id: `scoop-shutter-${index}`,
    type: 'segment',
    seg: segment(mouth[0], mouth[1], 5),
    material: { restitution: 0.52, friction: 0.18 },
    kick: 0,
    sensor: false,
    active: false,
  };
}

export function buildScoop(
  name: string, centre: Vec, radius: number, gap: readonly [Vec, Vec], shutter: Collider,
): Scoop {
  const mouth = vec((gap[0].x + gap[1].x) / 2, (gap[0].y + gap[1].y) / 2);
  // Park it a little behind the middle of the bowl, so the ball sits in the dish
  // rather than in its doorway, and the picture explains where it went.
  const hold = vec(centre.x + (centre.x - mouth.x) * 0.14, centre.y + (centre.y - mouth.y) * 0.14);
  const dx = mouth.x - hold.x;
  const dy = mouth.y - hold.y;
  const d = Math.hypot(dx, dy) || 1;

  // Out of the mouth, then tilted up the table. Straight along the mouth the
  // castle's left scoop fired the ball flat across at the height of the target
  // bank, from where it came back down the same wall and fell into the same
  // hole. One measured game did that for three hundred seconds and never ended.
  const tilt = dx > 0 ? -SCOOP_TILT : SCOOP_TILT;
  const ex = (dx / d) * Math.cos(tilt) - (dy / d) * Math.sin(tilt);
  const ey = (dx / d) * Math.sin(tilt) + (dy / d) * Math.cos(tilt);
  return { id: name, centre, radius, hold, eject: vec(ex, ey), mouth, shutter };
}

/* ------------------------------------------------------------------ *
 * The table itself
 * ------------------------------------------------------------------ */

export interface Table {
  readonly id: TableId;
  readonly colliders: Collider[];
  /** The one-way gate at the top of the shooter lane, switched by the game. */
  readonly laneGate: Collider;
  /**
   * The bar across the main shot, solid until the targets are down.
   *
   * Named for the castle's portcullis because that is what it was built as. On
   * the space board it is the docking bay shutter. Same part, same rule: the
   * table says no with something the player can see and hear.
   */
  readonly portcullis: Collider;
  readonly targets: Collider[];
  /** The holes. The game owns the hold timer; the table owns the geometry. */
  readonly scoops: Scoop[];
  /** How many lamps there are, so the game knows when the set is complete. */
  readonly lampCount: number;
  /** Where a new ball is parked, on the centre line of the shooter lane. */
  readonly plungerRest: Vec;
  /** Below this the ball is lost. */
  readonly drainY: number;
  /** Inside this is the shooter lane, for the one-way gate. */
  readonly laneX: number;
  readonly pivots: { readonly left: Vec; readonly right: Vec };
}
