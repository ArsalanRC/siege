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

/**
 * Past this the ball is gone, and it is below the bottom edge of the board.
 *
 * It used to be 1450 on a 1536 tall table, which put it a hundred units under
 * the flippers and well inside the picture. The ball simply blinked out of
 * existence in the middle of the apron and a new one appeared, which reads as
 * the game glitching rather than as losing a ball. At 1580 the ball is fully
 * past the bottom edge, radius included, before anything counts it as lost, so
 * you watch it go.
 */
export const DRAIN_Y = 1580;

export const FLIPPER_PIVOT_LEFT: Vec = vec(330, 1258);
export const FLIPPER_PIVOT_RIGHT: Vec = vec(694, 1258);

/** Where a new ball is parked before the plunger sends it up the lane. */
export const PLUNGER_REST: Vec = vec(962, 1380);

/** Corner radius on the two top corners of the outer wall. */
const CORNER_R = 190;

/** The ceiling. The castle runs up to meet it, so nothing sits above the castle. */
const TOP_WALL_Y = 12;

/* The castle, traced off the stonework. */
export const CASTLE_LEFT = 232;
export const CASTLE_RIGHT = 800;
export const CASTLE_TOP = 112;
const CASTLE_BOTTOM = 495;

/**
 * How far the roof drops from left to right, over 568 units of run.
 *
 * Sixty, which is about six degrees. Eighteen was tried first and the ball
 * simply stopped up there: one and a half degrees does not beat the friction of
 * the wood, so it crept along at 5 units a second and never came off. A roof
 * under a ceiling has to shed a slow ball on its own or it is a trap with extra
 * steps.
 */
export const ROOF_FALL = 60;

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
    segment(vec(PLAY_LEFT + CORNER_R, TOP_WALL_Y), vec(right - CORNER_R, TOP_WALL_Y)),
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
  return solid(
    'lane',
    [segment(vec(LANE_X, DRAIN_Y), vec(LANE_X, laneTop))],
    METAL,
  );
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
    // The corridor over the castle is open, and this time there is a habitrail
    // drawn on it.
    //
    // It was open once before and Arsalan rejected it on sight: the ball
    // travelled over the painted towers with nothing underneath it and looked
    // like it was flying. Sealing it was the wrong fix, because it left the
    // left half of the table unreachable. The right fix is the one a real
    // machine uses: a raised wire rail, drawn, so a ball above the playfield
    // furniture reads as being on a rail rather than as a bug.
    //
    // Clearance is 100 units at the left and 160 at the right against a 54 unit
    // ball, and the roof is metal so a crossing ball keeps its speed instead of
    // grinding to a halt between roof and ceiling.
    segment(vec(CASTLE_LEFT, CASTLE_TOP), vec(CASTLE_LEFT, CASTLE_BOTTOM)),
    segment(vec(CASTLE_RIGHT, CASTLE_TOP + ROOF_FALL), vec(CASTLE_RIGHT, CASTLE_BOTTOM)),
    segment(vec(CASTLE_LEFT, CASTLE_BOTTOM), vec(gateLeft, CASTLE_BOTTOM)),
    segment(vec(gateRight, CASTLE_BOTTOM), vec(CASTLE_RIGHT, CASTLE_BOTTOM)),
  ];
  return [
    ...solid('castle', segs, WOOD),
    // Metal, not wood. On wood at friction 0.14 a ball crossing the corridor
    // arrives with nothing left and dribbles down instead of completing the
    // orbit, which on screen reads as slow motion at the top of the table.
    ...solid(
      'castle-roof',
      [segment(vec(CASTLE_LEFT, CASTLE_TOP), vec(CASTLE_RIGHT, CASTLE_TOP + ROOF_FALL))],
      METAL,
    ),
  ];
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
  // Radius 42, not the 78 the painted shield caps measure.
  //
  // The left orbit is 214 units wide, between the outer wall and the castle. A
  // ball is 54. At radius 78 every bumper left under 54 on both sides, so the
  // left half of the table was sealed off and no ball ever went down it. The
  // caps are still painted at their full size, which is normal: on a real
  // machine the plastic cap is wider than the skirt the ball actually hits.
  //
  // At 42 each of these leaves about 60 units clear on either side, so the ball
  // weaves past them instead of being stopped by them.
  return [
    post('bumper', vec(122, 200), 42, RUBBER, BUMPER_KICK),
    post('bumper', vec(130, 320), 42, RUBBER, BUMPER_KICK),
    post('bumper', vec(118, 440), 42, RUBBER, BUMPER_KICK),
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
/**
 * The lower walls, converging towards the flippers.
 *
 * Below the slingshots the table used to be open for its whole 887 unit width,
 * so a ball had far more ways to be lost than to be saved and a game lasted a
 * few seconds. These bring each side in to about 60 units of outlane beside the
 * flipper, which is a gap a ball fits through but only when it is genuinely
 * beaten, rather than a pair of open doors.
 *
 * They replace the orbit deflectors, which did the same steering job less well
 * and met the old outer wall at an angle that made a corner.
 */
function lowerWalls(): Collider[] {
  // Both start BELOW the slingshots, not beside them. Starting at y=1000 put
  // the right hand wall 28 units from the right slingshot, and 28 is a gap a
  // 54 unit ball can reach into and not fit through.
  // They end close enough to the flipper pivots to CLOSE the outlanes rather
  // than merely narrow them: about 24 units of gap, which a 54 unit ball cannot
  // get through. That is deliberate. With the outlanes open a ball was lost in
  // one to five seconds and the game was miserable, and an outlane drain is the
  // least interesting way to lose anyway. The centre drain between the flipper
  // tips is still 104 units wide, so there is still a real way to lose, and it
  // is the one the player can actually do something about.
  // Each ends ABOVE its flipper pivot, never below it. Ending at y=1290, under
  // the pivots at 1258, made a V between the wall's end and the rounded back of
  // the bat and the ball parked in it at (729, 1242). Ending above means the
  // wall delivers onto the top of the bat instead, which is the same lesson the
  // lane guides taught three times before they were removed.
  const left = segment(vec(PLAY_LEFT, 1175), vec(304, 1235), 8);
  const right = segment(vec(LANE_X, 1175), vec(mx(304), 1235), 8);
  return solid('lower', [left, right], PLASTIC);
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

/**
 * The two painted ramp entrances, as their inner edges only.
 *
 * The art puts a raised red ramp with a gold arrow on each side, and until now
 * nothing was there at all: the ball fell straight through them, which looks
 * broken because the picture plainly shows something solid.
 *
 * Only the inner edge is modelled, and that is forced. The painted right ramp
 * runs from 760 to 860 across an orbit that is 800 to 905, so making the whole
 * shape solid leaves 45 units for a 54 unit ball and seals the right orbit
 * completely. Modelling the inner edge gives the ball something to hit from the
 * middle of the table, where it is visible and useful, while the orbit still
 * runs behind it.
 *
 * They start below the castle so there is no corner where the two meet.
 */
function ramps(): Collider[] {
  const left = segment(vec(250, 560), vec(268, 720), 10);
  const right = segment(vec(mx(250), 560), vec(mx(268), 720), 10);
  return solid('ramp', [left, right], PLASTIC, 260);
}

/**
 * Small posts through the middle of the table, on the painted lamp lenses.
 *
 * Chasing wedges took out the lane guides and the ramp structures, and between
 * the targets at 545 and the slingshots at 1075 that left five hundred units of
 * bare wood with nothing in it. The table was playable and dull: a ball lasted
 * thirty seconds and scored two hundred, because it spent its life falling
 * through empty space.
 *
 * These are round, isolated and far apart, which is the shape that cannot trap.
 * A wedge needs two surfaces converging on a gap narrower than a ball, and
 * single posts with a hundred units of clear air around them never make one.
 * The small kick keeps a tiring ball moving instead of letting it die in the
 * middle of the table.
 */
function posts(): Collider[] {
  const at: Array<[number, number]> = [
    [300, 800], [724, 800],
    [512, 890],
    [400, 980], [624, 980],
    [286, 1030], [738, 1030],
  ];
  return at.map(([x, y]) => post('post', vec(x, y), 16, RUBBER, 190));
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
    // Reaches the right wall, and slopes down towards the playfield.
    //
    // It used to stop 58 units short, which left a 41 unit notch against the
    // wall that a 54 unit ball could not pass but could rest in, so the ball
    // parked at (983, 242) every strong launch. Meeting the wall removes the
    // notch, and the downhill run means a ball that settles on the gate rolls
    // off its low end and onto the table rather than staying there.
    seg: segment(vec(TABLE_W - 14, 262), vec(LANE_X, 300), 6),
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
    ...lowerWalls(),
    ...slingshots(),
    ...ramps(),
    ...posts(),
    ...targets,
    ...laneSensors(),
  ];

  return { colliders, laneGate, portcullis: gate, targets };
}
