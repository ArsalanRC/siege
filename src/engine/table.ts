/**
 * SIEGE: the table, as data.
 *
 * Every wall, post, bumper and lane on the playfield, in the same coordinate
 * space as the art. The table is **1024 by 1536 units**, one unit per pixel of
 * the playfield image, so nothing here ever needs converting to draw.
 *
 * ## These numbers are provisional and that is deliberate
 *
 * The layout below was written before the playfield art existed, from the same
 * description the art was generated from. When the image comes back this file
 * gets re-traced against it, because the physics has to match what the player
 * can see. A wall three units left of where it is painted reads as a bug in the
 * physics even though the physics is behaving perfectly.
 *
 * So: the constants are named and grouped, and none of them is buried in an
 * expression. Re-tracing should be a matter of changing numbers here and
 * nothing else anywhere.
 *
 * ## Why the playfield is 940 wide inside a 1024 wide image
 *
 * The shooter lane runs up the right hand edge and is not part of the play
 * area. That puts the centre line of play at 470 rather than 512, so the
 * flippers, the drain and the castle gate are all centred on 470.
 *
 * ## Angles
 *
 * y points down the screen. An angle of zero points right, and it increases
 * clockwise as it is drawn. Every arc below is written with that in mind.
 */

import type { Vec } from './vec.js';
import { vec } from './vec.js';
import type { Segment } from './shapes.js';
import { arcToSegments, polyline, segment } from './shapes.js';
import type { Collider, Material } from './physics.js';
import { WOOD, METAL, RUBBER, PLASTIC } from './physics.js';

export const TABLE_W = 1024;
export const TABLE_H = 1536;

/** The shooter lane's inner rail. Everything left of this is play area. */
export const LANE_X = 940;

/** Centre line of play, which is not the centre of the image. */
export const CENTRE_X = LANE_X / 2;

/** Past this the ball is gone. Below the flipper tips, above the image edge. */
export const DRAIN_Y = 1440;

export const FLIPPER_PIVOT_LEFT: Vec = vec(288, 1330);
export const FLIPPER_PIVOT_RIGHT: Vec = vec(652, 1330);

/** Where a new ball is parked before the plunger sends it up the lane. */
export const PLUNGER_REST: Vec = vec((LANE_X + TABLE_W) / 2, 1380);

/** Corner radius on the two top corners of the outer wall. */
const CORNER_R = 200;

/** The castle sits across the top, with a gap in its lower face to shoot into. */
const CASTLE_LEFT = 298;
const CASTLE_RIGHT = 642;
const CASTLE_TOP = 110;
const CASTLE_BOTTOM = 400;
const GATE_HALF_WIDTH = 55;

/**
 * The apex of the castle roof, and it is not decoration.
 *
 * The roof was flat in the first version, and a flat horizontal wall is a
 * permanent ball trap on a table seen from above. Gravity pulls down the
 * screen, so a ball that lands on a level ledge settles there and stays,
 * forever, with nothing thrown and nothing logged. It cost ten seconds of
 * simulation to find and it would have looked like the game freezing at random.
 *
 * Fifteen degrees of pitch is enough to roll any ball straight back off into
 * the orbit. The rule this stands for: **no horizontal surface the ball can
 * land on top of.** Every other level run on this table is a ceiling, struck
 * from underneath, which is safe.
 */
export const CASTLE_ROOF = CASTLE_TOP - 46;

/** How much extra speed each thing throws the ball with, in units per second. */
const BUMPER_KICK = 1450;
const SLING_KICK = 1150;

let nextId = 0;
function id(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
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
 * table is not a wall. It is the drain, and leaving it open is what makes the
 * game a game.
 */
function outerWalls(): Collider[] {
  const segs: Segment[] = [
    segment(vec(0, DRAIN_Y), vec(0, CORNER_R)),
    ...arcToSegments(vec(CORNER_R, CORNER_R), CORNER_R, Math.PI, Math.PI * 1.5, 16),
    segment(vec(CORNER_R, 0), vec(TABLE_W - CORNER_R, 0)),
    ...arcToSegments(vec(TABLE_W - CORNER_R, CORNER_R), CORNER_R, Math.PI * 1.5, Math.PI * 2, 16),
    segment(vec(TABLE_W, CORNER_R), vec(TABLE_W, DRAIN_Y)),
  ];
  return solid('wall', segs, WOOD);
}

/**
 * The shooter lane, up the right hand edge.
 *
 * The rail stops at `laneTop` so the ball is thrown out into the horseshoe at
 * the top of the table. The one-way gate that stops it coming back down the
 * lane is not here: it is switched on and off per frame by the game, since
 * whether it is solid depends on which way the ball is going.
 */
function shooterLane(): Collider[] {
  const laneTop = 300;
  return solid('lane', [segment(vec(LANE_X, DRAIN_Y), vec(LANE_X, laneTop))], METAL);
}

/**
 * The castle. Three solid faces and a lower face with a gap shot through it.
 *
 * The gap is the whole point of the structure. Everything else about the castle
 * exists to make hitting that gap difficult and worth doing.
 */
function castle(): Collider[] {
  const gateLeft = CENTRE_X - GATE_HALF_WIDTH;
  const gateRight = CENTRE_X + GATE_HALF_WIDTH;
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
  const gateLeft = CENTRE_X - GATE_HALF_WIDTH;
  const gateRight = CENTRE_X + GATE_HALF_WIDTH;
  return [
    ...solid('castle-back', [segment(vec(gateLeft, CASTLE_TOP + 40), vec(gateRight, CASTLE_TOP + 40))], WOOD),
    ...sensor('gate', [segment(vec(gateLeft, CASTLE_BOTTOM - 20), vec(gateRight, CASTLE_BOTTOM - 20))]),
  ];
}

/**
 * The portcullis across the castle mouth.
 *
 * Solid while the siege is not ready, so a ball shot at a shut gate bounces off
 * it. The first version left the mouth permanently open and only withheld the
 * score, which is defensible but reads as the table ignoring a good shot. A
 * player needs to be told no by something they can see and hear.
 */
function portcullis(): Collider {
  const gateLeft = CENTRE_X - GATE_HALF_WIDTH;
  const gateRight = CENTRE_X + GATE_HALF_WIDTH;
  return {
    id: 'portcullis',
    type: 'segment',
    seg: segment(vec(gateLeft, CASTLE_BOTTOM), vec(gateRight, CASTLE_BOTTOM), 6),
    material: METAL,
    kick: 0,
    sensor: false,
    active: true,
  };
}

/**
 * Three pop bumpers in the upper left, where the orbit spits the ball out.
 *
 * They carry a `kick` rather than a high restitution because restitution can
 * only ever hand back a fraction of what arrived. A ball that dribbles in with
 * almost no speed would leave with less, and would sit among them forever.
 */
function bumpers(): Collider[] {
  return [
    post('bumper', vec(150, 300), 42, RUBBER, BUMPER_KICK),
    post('bumper', vec(250, 370), 42, RUBBER, BUMPER_KICK),
    post('bumper', vec(140, 440), 42, RUBBER, BUMPER_KICK),
  ];
}

/**
 * Slingshots: the two angled rubbers just above the flippers.
 *
 * Only the inward face is modelled. The back of a slingshot is buried in the
 * lane guide and no ball ever reaches it, so giving it geometry would cost
 * collision checks every substep to guard a place the ball cannot be.
 */
function slingshots(): Collider[] {
  const left = segment(vec(196, 1078), vec(300, 1202), 8);
  const right = segment(vec(LANE_X - 196, 1078), vec(LANE_X - 300, 1202), 8);
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
function laneGuides(): Collider[] {
  const left = polyline([vec(105, 1080), vec(180, 1240), vec(258, 1332)], 7);
  const right = polyline(
    [vec(LANE_X - 105, 1080), vec(LANE_X - 180, 1240), vec(LANE_X - 258, 1332)],
    7,
  );
  return solid('guide', [...left, ...right], PLASTIC);
}

/** Three drop targets. Knocking all three down is what opens the castle gate. */
function dropTargets(): Collider[] {
  const y = 620;
  const width = 62;
  const gap = 16;
  const startX = 176;
  const out: Collider[] = [];
  for (let i = 0; i < 3; i++) {
    const x = startX + i * (width + gap);
    out.push({
      id: `target-${i}`,
      type: 'segment',
      seg: segment(vec(x, y), vec(x + width, y), 9),
      material: PLASTIC,
      kick: 0,
      sensor: false,
      active: true,
    });
  }
  return out;
}

/** Round posts the ball rattles off on its way down. Pure texture, no scoring. */
function posts(): Collider[] {
  return [
    post('post', vec(CENTRE_X, 760), 16, RUBBER, 120),
    post('post', vec(320, 900), 16, RUBBER, 120),
    post('post', vec(LANE_X - 320, 900), 16, RUBBER, 120),
    post('post', vec(430, 1040), 14, RUBBER, 120),
    post('post', vec(LANE_X - 430, 1040), 14, RUBBER, 120),
  ];
}

/** Sensors across each inlane and outlane, so the game knows where a ball went. */
function laneSensors(): Collider[] {
  return [
    ...sensor('outlane-left', [segment(vec(0, 1330), vec(150, 1330))]),
    ...sensor('inlane-left', [segment(vec(200, 1330), vec(280, 1330))]),
    ...sensor('outlane-right', [segment(vec(LANE_X, 1330), vec(LANE_X - 150, 1330))]),
    ...sensor('inlane-right', [segment(vec(LANE_X - 200, 1330), vec(LANE_X - 280, 1330))]),
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
    seg: segment(vec(LANE_X, 300), vec(LANE_X + 60, 268), 6),
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
    ...slingshots(),
    ...laneGuides(),
    ...targets,
    ...posts(),
    ...laneSensors(),
  ];

  return { colliders, laneGate, portcullis: gate, targets };
}
