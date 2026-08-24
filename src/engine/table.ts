/**
 * SIEGE: the table, as data.
 *
 * Every wall, post, bumper and lane on the playfield, in the same coordinate
 * space as the art. The table is **1024 by 1536 units**, one unit per pixel of
 * `site/art/playfield.png`, so nothing here ever needs converting to draw.
 *
 * ## These numbers are traced from the art, not invented
 *
 * The first version of this file was written before the playfield existed, from
 * the same description the art was generated from, and every number in it was
 * provisional. The art exists now and these are measured off it.
 *
 * That direction matters. The player believes what they can see, so a wall three
 * units from where it is painted reads as a bug in the physics even when the
 * physics is perfect. The art is the specification and the geometry follows it.
 *
 * ## Two things the art decided differently
 *
 * **The painted table is symmetric about x = 512**, the centre of the image,
 * rather than about the centre of the play area. The shooter lane eats into the
 * right hand side, so the left wall sits further from the middle than the lane
 * rail does. Every mirrored pair below is therefore mirrored through
 * `CENTRE_X`, not through the midpoint of the walls.
 *
 * **The castle gate is not on the centre line.** It is painted slightly right
 * of it, at `GATE_CENTRE`. Nudging the collision to 512 to make the code tidier
 * would put the mouth off the arch, and the shot would stop lining up with the
 * thing the player is aiming at.
 *
 * ## Angles
 *
 * y points down the screen. An angle of zero points right, and it increases
 * clockwise as it is drawn.
 */

import type { Vec } from './vec.js';
import { vec } from './vec.js';
import type { Segment } from './shapes.js';
import { arcToSegments, polyline, segment } from './shapes.js';
import type { Collider, Material } from './physics.js';
import { WOOD, METAL, RUBBER, PLASTIC } from './physics.js';

export const TABLE_W = 1024;
export const TABLE_H = 1536;

/** The shooter lane's inner rail, traced off the painted metal rail. */
export const LANE_X = 905;

/** Outer wall on the left, where the painted blue and gold border sits. */
export const PLAY_LEFT = 18;

/** The art is symmetric about the centre of the image, so mirror through this. */
export const CENTRE_X = 512;

/** Past this the ball is gone. Level with the bottom of the painted apron well. */
export const DRAIN_Y = 1450;

export const FLIPPER_PIVOT_LEFT: Vec = vec(330, 1258);
export const FLIPPER_PIVOT_RIGHT: Vec = vec(694, 1258);

/** Where a new ball is parked before the plunger sends it up the lane. */
export const PLUNGER_REST: Vec = vec(962, 1380);

/** Corner radius on the two top corners of the outer wall. */
const CORNER_R = 190;

/* The castle, traced off the stonework. */
const CASTLE_LEFT = 232;
const CASTLE_RIGHT = 800;
const CASTLE_TOP = 95;
const CASTLE_BOTTOM = 495;

/**
 * The apex of the painted gable, and it is not decoration.
 *
 * A flat horizontal wall is a permanent ball trap on a table seen from above.
 * Gravity pulls down the screen, so a ball that lands on a level ledge settles
 * there and stays, forever, with nothing thrown and nothing logged. It cost ten
 * seconds of simulation to find, and on screen it would have looked like the
 * game freezing at random.
 *
 * The rule this stands for: **no horizontal surface the ball can land on top
 * of.** Every other level run on this table is a ceiling, struck from
 * underneath, which is safe. The art was prompted with the pitch for the same
 * reason, so the collision and the painting agree.
 */
export const CASTLE_ROOF = 45;

/** The arch is painted right of centre, so the collision follows it there. */
const GATE_CENTRE = 524;
const GATE_HALF_WIDTH = 48;

/** How much extra speed each thing throws the ball with, in units per second. */
const BUMPER_KICK = 1450;
const SLING_KICK = 1150;

let nextId = 0;
function id(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

/** Mirror an x coordinate through the painted centre line. */
function mx(x: number): number {
  return CENTRE_X * 2 - x;
}

function solid(prefix: string, segs: Segment[], material: Material, kick = 0): Collider[] {
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

function post(prefix: string, c: Vec, radius: number, material: Material, kick = 0): Collider {
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

function sensor(name: string, segs: Segment[]): Collider[] {
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

/**
 * The outer wall: two straight sides, two rounded top corners, a flat top.
 *
 * It stops short of the bottom on both sides, because the bottom of a pinball
 * table is not a wall. It is the drain, and leaving it open is the game.
 */
function outerWalls(): Collider[] {
  const right = TABLE_W - 14;
  const segs: Segment[] = [
    segment(vec(PLAY_LEFT, DRAIN_Y), vec(PLAY_LEFT, CORNER_R)),
    ...arcToSegments(vec(PLAY_LEFT + CORNER_R, CORNER_R), CORNER_R, Math.PI, Math.PI * 1.5, 16),
    segment(vec(PLAY_LEFT + CORNER_R, 12), vec(right - CORNER_R, 12)),
    ...arcToSegments(vec(right - CORNER_R, CORNER_R), CORNER_R, Math.PI * 1.5, Math.PI * 2, 16),
    segment(vec(right, CORNER_R), vec(right, DRAIN_Y)),
  ];
  return solid('wall', segs, WOOD);
}

/**
 * The shooter lane, up the right hand edge.
 *
 * The rail stops at `laneTop` so the ball is thrown out into the horseshoe at
 * the top. The one-way gate that stops it dribbling back down is not here: it
 * is switched on and off per frame by the game, since whether it is solid
 * depends on which way the ball is going.
 */
function shooterLane(): Collider[] {
  const laneTop = 300;
  return solid('lane', [segment(vec(LANE_X, DRAIN_Y), vec(LANE_X, laneTop))], METAL);
}

/**
 * The castle. Pitched roof, two solid sides, and a lower face with a gap.
 *
 * The gap is the whole point of the structure. Everything else about the castle
 * exists to make hitting it difficult and worth doing.
 */
function castle(): Collider[] {
  const gateLeft = GATE_CENTRE - GATE_HALF_WIDTH;
  const gateRight = GATE_CENTRE + GATE_HALF_WIDTH;
  const segs: Segment[] = [
    segment(vec(CASTLE_LEFT, CASTLE_TOP), vec(CASTLE_LEFT, CASTLE_BOTTOM)),
    segment(vec(CASTLE_RIGHT, CASTLE_TOP), vec(CASTLE_RIGHT, CASTLE_BOTTOM)),
    // Two slopes rather than one level run. See CASTLE_ROOF.
    segment(vec(CASTLE_LEFT, CASTLE_TOP), vec(CENTRE_X, CASTLE_ROOF)),
    segment(vec(CENTRE_X, CASTLE_ROOF), vec(CASTLE_RIGHT, CASTLE_TOP)),
    segment(vec(CASTLE_LEFT, CASTLE_BOTTOM), vec(gateLeft, CASTLE_BOTTOM)),
    segment(vec(gateRight, CASTLE_BOTTOM), vec(CASTLE_RIGHT, CASTLE_BOTTOM)),
  ];
  return solid('castle', segs, WOOD);
}

/** Inside the castle: a back wall to stop the ball, and a sensor that scores it. */
function castleChamber(): Collider[] {
  const gateLeft = GATE_CENTRE - GATE_HALF_WIDTH;
  const gateRight = GATE_CENTRE + GATE_HALF_WIDTH;
  return [
    ...solid(
      'castle-back',
      [segment(vec(gateLeft, CASTLE_BOTTOM - 210), vec(gateRight, CASTLE_BOTTOM - 210))],
      WOOD,
    ),
    ...sensor('gate', [
      segment(vec(gateLeft, CASTLE_BOTTOM - 30), vec(gateRight, CASTLE_BOTTOM - 30)),
    ]),
  ];
}

/**
 * The portcullis across the castle mouth.
 *
 * Solid until all three targets are down, so a ball shot at a shut gate bounces
 * off it. The first version left the mouth permanently open and only withheld
 * the score, which is defensible but reads as the table ignoring a good shot. A
 * player needs to be told no by something they can see and hear.
 */
function portcullis(): Collider {
  return {
    id: 'portcullis',
    type: 'segment',
    seg: segment(
      vec(GATE_CENTRE - GATE_HALF_WIDTH, CASTLE_BOTTOM),
      vec(GATE_CENTRE + GATE_HALF_WIDTH, CASTLE_BOTTOM),
      6,
    ),
    material: METAL,
    kick: 0,
    sensor: false,
    active: true,
  };
}

/**
 * Three pop bumpers in the upper left, traced onto the painted shield caps.
 *
 * They carry a `kick` rather than a high restitution because restitution can
 * only ever hand back a fraction of what arrived. A ball that dribbles in with
 * almost no speed would leave with less, and would sit among them forever.
 */
function bumpers(): Collider[] {
  return [
    post('bumper', vec(148, 212), 78, RUBBER, BUMPER_KICK),
    post('bumper', vec(255, 352), 78, RUBBER, BUMPER_KICK),
    post('bumper', vec(112, 402), 78, RUBBER, BUMPER_KICK),
  ];
}

/**
 * The two ramp structures, as plain deflectors.
 *
 * They are painted as raised ramps with arrows, and a real one would carry the
 * ball up and over. That is a second elevation and a whole extra mode of
 * travel, so for now they are solid angled walls: the ball cannot pass through
 * something drawn as solid, which is the part that would look broken.
 */
function ramps(): Collider[] {
  const left = polyline([vec(178, 700), vec(196, 560), vec(258, 470)], 10);

  // The right ramp is NOT the mirror of the left, and that is deliberate.
  //
  // The art is symmetric about the centre of the image, but the shooter lane
  // eats into the right hand side, so the painted right orbit is only about 30
  // units wide. A ball is 54. Mirroring the ramp exactly left a 49 unit gap
  // between it and the lane rail, and the ball wedged in it and hung there
  // forever, at (883, 694) every single time.
  //
  // So the collision on this side sits inside the painting by about 30 units.
  // The ball clips a little under the painted ramp edge, which nobody will
  // notice, instead of jamming in a slot it cannot fit through, which everybody
  // would.
  const right = polyline([vec(815, 700), vec(828, 560), vec(766, 470)], 10);

  return solid('ramp', [...left, ...right], PLASTIC);
}

/**
 * Slingshots: the two triangular rubbers above the flippers.
 *
 * Only the inward face is modelled, traced along the painted red band. The back
 * of a slingshot is buried in the lane guide and no ball reaches it, so giving
 * it geometry would cost collision checks every substep to guard a place the
 * ball cannot be.
 */
function slingshots(): Collider[] {
  // The slingshot sits entirely ABOVE the inlane and does not reach down into
  // it. The first tracing ran the tip to (292, 1192), which left 45.7 units of
  // clearance to the lane guide for a 54 unit ball. The ball could enter that
  // pocket and then not fit through it, so it stopped there and the game was
  // over without ever ending.
  //
  // The thinner radius is part of the same fix: the slingshot and the guide
  // both have to funnel towards the same flipper, so they converge, and every
  // unit of padding on either one comes straight out of the gap between them.
  const left = segment(vec(205, 1075), vec(270, 1145), 7);
  const right = segment(vec(mx(205), 1075), vec(mx(270), 1145), 7);
  return solid('sling', [left, right], RUBBER, SLING_KICK);
}

/**
 * The lane guides that split each side into an inlane and an outlane.
 *
 * The inlane, on the inside, feeds the flipper. The outlane, hugging the wall,
 * drains. A guide that ends level with the flipper pivot delivers the ball onto
 * the base of the bat; ending it lower would drop the ball past the flipper
 * entirely, which reads as the table cheating.
 */
/*
 * There are no lane guides, and removing them was the fix rather than a
 * simplification I got away with.
 *
 * A guide splits each side into an inlane and an outlane, which is how a real
 * machine is built. The trouble is that the guide and the slingshot above it
 * both have to funnel towards the same flipper, so the channel between them
 * narrows, and anywhere it narrows below 54 units the ball can enter and then
 * not fit. That produced three separate traps in a row:
 *
 * 1. Ball pinched between the slingshot tip and the guide, at (716, 1223).
 * 2. Moved the guide, and it wedged between the guide and the back of the
 *    flipper instead, at (731, 1245).
 * 3. Straightened the guide and ended it above the pivot, and it wedged
 *    against the guide's own end cap, at (709, 1222).
 *
 * Each fix moved the pinch rather than removing it, because the convergence is
 * inherent to the shape. Without the guides the lower playfield is simply open:
 * the ball falls to the flippers or it drains down the side, which is what the
 * outlanes did anyway. The scoring sensors stay, so the game still knows which
 * side a ball went down.
 *
 * If guides ever come back, they need a channel of constant width that is
 * comfortably wider than a ball for its whole length, not two lines that meet.
 */

/**
 * Three drop targets, traced onto the painted ogre shields.
 *
 * Knocking all three down is what opens the castle gate.
 */
function dropTargets(): Collider[] {
  const y = 545;
  const spans: Array<[number, number]> = [
    [330, 425],
    [455, 550],
    [580, 675],
  ];
  return spans.map(([x0, x1], i) => ({
    id: `target-${i}`,
    type: 'segment' as const,
    seg: segment(vec(x0, y), vec(x1, y), 10),
    material: PLASTIC,
    kick: 0,
    sensor: false,
    active: true,
  }));
}

/** Sensors across each inlane and outlane, so the game knows where a ball went. */
function laneSensors(): Collider[] {
  return [
    ...sensor('outlane-left', [segment(vec(PLAY_LEFT, 1300), vec(150, 1300))]),
    ...sensor('inlane-left', [segment(vec(232, 1300), vec(310, 1300))]),
    ...sensor('outlane-right', [segment(vec(mx(PLAY_LEFT), 1300), vec(mx(150), 1300))]),
    ...sensor('inlane-right', [segment(vec(mx(232), 1300), vec(mx(310), 1300))]),
  ];
}

export interface Table {
  readonly colliders: Collider[];
  /** The one-way gate at the top of the shooter lane, switched by the game. */
  readonly laneGate: Collider;
  /** The castle mouth. Solid until all three targets are down. */
  readonly portcullis: Collider;
  readonly targets: Collider[];
}

/**
 * Build the table.
 *
 * Called once per game rather than once per frame. The colliders carry mutable
 * `active` flags, which is the one place this engine keeps state outside the
 * ball, and it is why each game gets its own copy rather than sharing a module
 * level constant.
 */
export function buildTable(): Table {
  nextId = 0;

  const laneGate: Collider = {
    id: 'lane-gate',
    type: 'segment',
    seg: segment(vec(LANE_X, 300), vec(LANE_X + 58, 268), 6),
    material: METAL,
    kick: 0,
    sensor: false,
    active: false,
  };

  const targets = dropTargets();
  const gate = portcullis();

  const colliders: Collider[] = [
    ...outerWalls(),
    ...shooterLane(),
    laneGate,
    ...castle(),
    ...castleChamber(),
    gate,
    ...bumpers(),
    ...ramps(),
    ...slingshots(),
    ...targets,
    ...laneSensors(),
  ];

  return { colliders, laneGate, portcullis: gate, targets };
}
