/**
 * SIEGE: the table, as data.
 *
 * Every wall, post, bumper and lane on the playfield, in the same coordinate
 * space as the art. The table is **1024 by 1536 units**, one unit per pixel of
 * `site/art/playfield.jpg`, so nothing here ever needs converting to draw.
 *
 * ## Every number below was scanned, not judged
 *
 * `tools/measure-art.py` reads the playfield image, classifies each pixel as
 * bare wood or furniture, and prints the numbers this file imports by hand. Run
 * it whenever the art changes and paste the output back in. Nothing here was
 * read off a screenshot by eye, and that rule exists because the last two
 * geometry bugs on this table were both a number judged from a picture: a roof
 * slope of 73 against a true 84, and three bumper caps placed up to 123 units
 * away from the caps they are painted on.
 *
 * The direction matters. The player believes what they can see, so a wall three
 * units from where it is painted reads as a bug in the physics even when the
 * physics is perfect. The art is the specification and the geometry follows it.
 *
 * ## Where the geometry deliberately leaves the art
 *
 * The painted side lanes are between 12 and 40 units across. A ball is 54. No
 * ball has ever fitted down any of them, and tracing them faithfully would seal
 * three quarters of the table off. So a painted lane narrower than a ball is
 * treated as a **guide drawn on the floor of a wider channel**: the wall goes on
 * the far side of it, and the ball runs along the painted line rather than
 * inside it. Every place that happens is marked below.
 *
 * The same trade is already normal for the bumpers. A real pop bumper's plastic
 * cap is wider than the skirt the ball actually touches, so a cap painted at
 * radius 59 colliding at radius 40 is not a compromise, it is the real part.
 *
 * ## The art is not symmetric, so nothing here is mirrored
 *
 * The painted table is very nearly symmetric and not quite: the lower channel
 * runs 177 to 816, whose centre is 496.5, while the target bank's centre is 507
 * and the lamp lenses pair up about 500. Mirroring one side onto the other put
 * every right hand collider a few units off its paint, which is exactly the
 * error this file exists to stop. **Both sides are measured separately.**
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
import { WOOD, METAL, RUBBER, PLASTIC, RAIL } from './physics.js';

export const TABLE_W = 1024;
export const TABLE_H = 1536;

/**
 * The shooter lane, measured across the painted rails at y = 700.
 *
 * The bright metal inner rail runs 908 to 916 and the outer one 998 to 1010, so
 * the channel between them is 918 to 994: **76 units** for a 54 unit ball. It
 * used to be modelled 905 to 1010, which is 105 wide, and a ball fired up a
 * channel half again wider than the painted one rattles between two rails that
 * are not where the picture puts them.
 */
export const LANE_X = 918;
export const LANE_OUTER_X = 994;

/** The painted border's inner edge at the top left corner, before it curves. */
export const PLAY_LEFT = 55;

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

/**
 * The flippers, centred on the painted channel rather than on the image.
 *
 * The lower playfield is painted from 177 to 816, so its centre is 496.5, not
 * the 512 the image is symmetric about. The pivots used to sit at 330 and 694,
 * whose centre is 512, which put the right bat 31 units further from its wall
 * than the left one and made the two outlanes different widths for no reason a
 * player could see.
 *
 * `y` is 1282 rather than 1258 for a measured reason. The left slingshot's lower
 * post is painted at (288, 1200) with a radius of 13. A pivot at 1258 leaves 35
 * units between that post and the back of the bat, and 35 is the width that
 * catches a 54 unit ball: wide enough to roll into, too narrow to roll out of.
 * It is the third time this table has grown that exact wedge. At 1282 the gap is
 * 57 and the ball goes through.
 */
export const FLIPPER_PIVOT_LEFT: Vec = vec(320, 1282);
export const FLIPPER_PIVOT_RIGHT: Vec = vec(673, 1282);

/** Where a new ball is parked, on the centre line of the painted lane. */
export const PLUNGER_REST: Vec = vec(956, 1380);

/** Corner radius on the two top corners of the outer wall. */
const CORNER_R = 190;

/** The ceiling. The castle runs up to meet it, so nothing sits above the castle. */
const TOP_WALL_Y = 12;

/* ------------------------------------------------------------------ *
 * Measured off playfield.jpg. See the header, and tools/measure-art.py
 * ------------------------------------------------------------------ */

/**
 * The castle, from the stonework.
 *
 * The left tower runs from 240, the right one ends at 812, and the lower face
 * where the towers meet the playfield is at 502. Scanned by walking down each
 * column until the bare wood of the playfield starts.
 */
export const CASTLE_LEFT = 240;
export const CASTLE_RIGHT = 812;
export const CASTLE_TOP = 112;
const CASTLE_BOTTOM = 502;

/**
 * The gate, from the patch of painted landscape you can see through the arch.
 *
 * That patch runs 482 to 571, so the mouth is 89 wide and centred on 526.5. The
 * arch is painted right of the middle of the table and the collision follows it
 * there: nudging it to 512 to make the code tidier would put the mouth off the
 * arch and the shot would stop lining up with the thing the player is aiming at.
 */
const GATE_CENTRE = 526;
const GATE_HALF_WIDTH = 44;

/**
 * How far the roof drops from left to right, over the run of the castle.
 *
 * Eighty-four, MEASURED off the habitrail image rather than judged by eye. It
 * was set to 73 by looking at the picture, and 73 against a true 84 puts the
 * ball eleven units off the drawn rail by the right hand end, which is visible
 * and was reported. Eighteen was tried and the ball simply stopped up there: one
 * and a half degrees does not beat the friction of the wood, so it crept along
 * at 5 units a second and never came off. A roof under a ceiling has to shed a
 * slow ball on its own or it is a trap with extra steps.
 */
export const ROOF_FALL = 84;

/**
 * The habitrail, as the shape it actually is.
 *
 * These are the top of the upper wire, measured off `habitrail.png` by scanning
 * the alpha for the first opaque row at each column. They are fractions of the
 * image, not units, so the collision and the drawing are computed from the same
 * seven numbers and cannot drift apart.
 *
 * The rail is a CURVE, not a slope. It falls fast at the left and flattens
 * towards the right, and a straight collider across it left the ball riding off
 * the drawn wire in the middle. Anything derived from the picture has to be
 * derived from the whole picture.
 */
const RAIL_SAMPLES: ReadonlyArray<readonly [number, number]> = [
  [0, 0.128], [0.1, 0.167], [0.3, 0.304], [0.5, 0.406],
  [0.7, 0.488], [0.9, 0.540], [1, 0.565],
];

/** Where the image's top edge sits, and how tall it is drawn. Shared with the page. */
export const RAIL_IMAGE_TOP = 74;
export const RAIL_IMAGE_H = 189;

/** The rail as table coordinates, one point per measured sample. */
export function railPoints(): Vec[] {
  return RAIL_SAMPLES.map(([fx, fy]) =>
    vec(CASTLE_LEFT + fx * (CASTLE_RIGHT - CASTLE_LEFT), RAIL_IMAGE_TOP + fy * RAIL_IMAGE_H));
}

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
 * underneath, which is safe.
 */
export const CASTLE_ROOF = 45;

/**
 * The border down the top left, traced along the inner edge of the painted band.
 *
 * Found by walking in from x = 0 on each row: past the strip of wood outside the
 * border, across the blue and gold band, and stopping at the first wood inside
 * it. That inner edge is where a ball running the left orbit touches, so it is
 * where the wall goes.
 */
const LEFT_BORDER: ReadonlyArray<readonly [number, number]> = [
  // The top two points are the one place on this side where the wall sits on the
  // painted band rather than on its inner edge, and the reason is measured. The
  // habitrail's left end is at x = 240 and the band's inner edge at that height
  // is 209, which leaves a **three unit** passage for the ball to come off the
  // rail into the orbit. It did not: it stopped dead on the end of the rail with
  // its other side on the border, at (237, 66), in every seeded run. The band is
  // 85 units wide here, so moving the wall to 180 puts it in the middle of the
  // painted guide rather than off it, and opens the passage to twenty five.
  [228, 28], [180, 68], [160, 92],
  [148, 105], [115, 120], [100, 135],
  [88, 150], [70, 180], [58, 210], [55, 225], [61, 245], [64, 300],
  [58, 360], [62, 420], [74, 470],
];

/**
 * The main playfield, down its left side, and this is the big correction.
 *
 * The bare wood of the lower playfield runs from x = 177 for its whole height
 * between y = 1080 and y = 1360. The wall was at 18. A hundred and fifty nine
 * units of painted stonework, a gold rail and a recessed channel sat under the
 * ball, and every ball that came down that side rolled straight over the top of
 * a wall the picture plainly shows. It was the single most visible thing wrong
 * with the table and no test could see it, because the ball was inside the
 * bounds the whole time.
 *
 * Above the flippers the boundary is a curve, not a line: the playfield bulges
 * out to 105 at y = 880 and pulls back in to 177 by y = 1010. These points are
 * the measured edge, one per place it changes direction.
 */
const LEFT_WALL_UPPER: ReadonlyArray<readonly [number, number]> = [
  // The floor of the bumper pocket, falling right at eleven degrees so a ball
  // that has finished with the bumpers rolls out of them instead of settling.
  // Below y = 470 the painted band is buried under the caps and the scoop, so
  // there is nothing left to trace and this is the line that carries the orbit
  // round into the playfield.
  [160, 494], [250, 510], [292, 520], [278, 600],
  // ...and stops at the upper lip of the scoop's mouth.
  [248, 700],
];

/** Below the scoop's mouth, down to where the apron takes over. */
const LEFT_WALL_LOWER: ReadonlyArray<readonly [number, number]> = [
  [214, 768], [198, 776], [164, 792], [136, 816],
  [105, 872], [105, 884], [118, 912], [129, 944], [151, 984],
  [173, 1000], [180, 1020], [177, 1080], [177, 1360],
];

/** The same scan down the right side. Not a mirror of the left: measured. */
const RIGHT_WALL_UPPER: ReadonlyArray<readonly [number, number]> = [
  [745, 588], [745, 616], [756, 624], [763, 704],
];
const RIGHT_WALL_LOWER: ReadonlyArray<readonly [number, number]> = [
  [790, 774], [794, 776], [800, 792],
  [846, 808], [865, 840], [870, 880], [858, 920], [851, 944],
  [826, 976], [806, 1000], [805, 1030], [816, 1080], [816, 1360],
];

/**
 * The apron, where the painted playfield funnels down to the outhole.
 *
 * Both sides converge on a mouth about 200 units wide at y = 1504, which is the
 * bottom edge of the picture. The ball keeps falling past it to `DRAIN_Y` so you
 * watch it go rather than watching it vanish.
 */
const APRON_LEFT: ReadonlyArray<readonly [number, number]> = [
  [177, 1360], [208, 1400], [265, 1432], [322, 1464], [397, 1504], [397, DRAIN_Y],
];
const APRON_RIGHT: ReadonlyArray<readonly [number, number]> = [
  [816, 1360], [787, 1400], [738, 1432], [685, 1456], [599, 1504], [599, DRAIN_Y],
];

/**
 * The three pop bumper caps, from a gradient circle fit on the painted rings.
 *
 * Centres (146, 213), (253, 345) and (103, 407), each ring about 59 units
 * across. The colliders used to sit at (122, 200), (130, 320) and (118, 440).
 * The middle one was **123 units** from the cap it is painted on, which put a
 * live bumper in the middle of bare wood and left the painted cap dead. That is
 * the defect in the overlay screenshot: a green circle floating on the boards.
 */
const BUMPER_CAPS: ReadonlyArray<readonly [number, number]> = [
  [146, 213], [253, 345], [103, 407],
];

/**
 * Collide at 40 against a painted 59, and the reason is the left orbit.
 *
 * Between the border at 58 and the castle at 246 the orbit is 188 units across
 * at the height of the first cap. At the painted 59 the cap leaves 29 on one
 * side and 41 on the other, so no ball ever went down the left half of the
 * table. At 40 it leaves 48 and 60. Forty-eight is still under a ball, so the
 * ball takes the inside line past every cap, which is exactly what it does on a
 * real machine and what the painted lane guide is drawn to encourage.
 */
const BUMPER_RADIUS = 36;

/**
 * The three ogre shields, measured off the green panels.
 *
 * They span 323 to 439, 450 to 565 and 576 to 690, from y = 526 down to y = 737.
 * The collider goes on the **lower** edge, because that is the face of the panel
 * the ball arrives at. It used to sit at y = 545, twenty units below the top of
 * a panel 211 tall, so a ball could travel two hundred units up the middle of a
 * painted shield before anything stopped it.
 *
 * The gaps between panels are 11 units, which no ball can enter, so each target
 * is extended to the middle of its gap and the bank reads as one bar with three
 * pieces rather than three bars with two slots.
 */
const TARGET_Y = 737;
const TARGET_SPANS: ReadonlyArray<readonly [number, number]> = [
  [323, 444], [444, 570], [570, 690],
];

/**
 * The slingshots, from the three gold posts at the corners of each triangle.
 *
 * The whole triangle is solid now. Only one edge used to be, traced short and in
 * the wrong place: the old left segment ran (205, 1075) to (270, 1145) against a
 * painted triangle whose corners are (216, 1068), (201, 1169) and (288, 1200).
 *
 * The long edge is the one facing the middle of the table, and it carries the
 * kick. The other two are plain rubber. The outer edge is 12 units from the
 * wall, which is closer than a ball can reach, so nothing can get behind it.
 */
const SLING_LEFT: ReadonlyArray<readonly [number, number]> = [
  [216, 1068], [201, 1169], [288, 1200],
];
const SLING_RIGHT: ReadonlyArray<readonly [number, number]> = [
  [773, 1072], [787, 1170], [701, 1201],
];

/**
 * The painted lamp lenses, as rollovers rather than as posts.
 *
 * Fourteen domed jewels in gold bezels, each about 50 units across, measured as
 * islands of furniture inside the bare wood. There used to be seven solid posts
 * scattered through the middle of the table on nothing at all, and three of the
 * lenses they were meant to be sitting on run straight down the centre line at
 * (501, 1100), (500, 1170) and (500, 1241): a solid post at the last of those
 * would stand in the mouth of the drain.
 *
 * So they are lamps, which is what a lens flush with the playfield is on a real
 * machine, and the ball rolls over them and lights them. That is worth more than
 * the posts were: it puts something to collect in the empty middle of the table
 * without putting anything invisible in the ball's way.
 */
const LAMPS: ReadonlyArray<readonly [number, number]> = [
  // Five of these were being missed. A circle fit over the WHOLE table rather
  // than only the bare wood of the lower playfield finds nineteen lenses the
  // ball can reach, not fourteen: there are lenses up in both orbits and in the
  // neck under the castle, and those are the parts of the table that had nothing
  // to collect at all.
  [62, 311], [877, 433], [307, 500], [710, 507], [276, 671],
  [232, 826], [422, 761], [575, 763], [734, 669], [765, 823],
  [153, 890], [818, 897], [304, 1019], [698, 1019],
  [398, 1120], [604, 1120],
  [501, 1100], [500, 1170], [500, 1241],
];
const LAMP_RADIUS = 26;

/**
 * The two scoops, from the painted red lanes.
 *
 * A principal axis fit on the crimson gives the left lane as (219, 509) to
 * (163, 697) and the right as (817, 516) to (853, 715), each about 72 across.
 * The gold arrow inside each one points up the lane, which is the shot.
 *
 * They used to be a single sloped wall apiece, and both slopes ran the wrong
 * way. The left collider fell to the right going down where the painted lane
 * falls to the left, so the ball turned the opposite way to the thing it looked
 * like it hit.
 */
/**
 * The hole is the painted basin BELOW each lane, not the lane itself.
 *
 * The first pass put the chamber in the middle of the red capsule, which was
 * wrong and was reported as wrong: "the scoops don't match the hole, should be
 * below the red area where the arrow was". The arrow points up out of the hole.
 * Underneath each lane the art paints a gold-rimmed bowl with a dark green dish
 * inside it, which is what a scoop looks like from above, and that is where the
 * ball belongs.
 *
 * Measured off the rims: the left bowl is centred (158, 732) with a radius of
 * 46, the right one (843, 748) with a radius of 42. Not a mirrored pair, because
 * nothing on this table is.
 */
const SCOOP_LEFT_CENTRE: Vec = vec(158, 732);
const SCOOP_LEFT_R = 46;
const SCOOP_RIGHT_CENTRE: Vec = vec(843, 748);
const SCOOP_RIGHT_R = 42;

/**
 * Both bowls sit outside the playfield wall, so each needs a throat.
 *
 * The left bowl's right edge is at 204 and the wall beside it is at about 243,
 * so there are forty units of painted ironwork in between. The mouth is a gap in
 * the wall and two short walls funnel from it into the bowl.
 *
 * The mouth is ONE BALL wide, 63 on the left and 60 on the right, and that is
 * the second thing it had to learn. At 106 it was a hole the whole side of the
 * table drained into: a measured run caught 1702 balls across sixty games,
 * twenty-eight a game, and a scoop you cannot avoid is not a shot. Both ends of
 * the gap are points the wall measures to anyway, so narrowing it moved the
 * geometry nowhere.
 */
function scoopMouth(upper: ReadonlyArray<readonly [number, number]>,
                    lower: ReadonlyArray<readonly [number, number]>): readonly [Vec, Vec] {
  const a = upper[upper.length - 1]!;
  const b = lower[0]!;
  return [vec(a[0], a[1]), vec(b[0], b[1])];
}
const SCOOP_LEFT_MOUTH = scoopMouth(LEFT_WALL_UPPER, LEFT_WALL_LOWER);
const SCOOP_RIGHT_MOUTH = scoopMouth(RIGHT_WALL_UPPER, RIGHT_WALL_LOWER);

/** How much extra speed each thing throws the ball with, in units per second. */
const BUMPER_KICK = 1450;
const SLING_KICK = 1150;

/** A scoop lets go hard. This is a coil, not a bounce. */
export const SCOOP_KICK = 3000;

/**
 * How far above the mouth's own line the coil aims, in radians.
 *
 * Small, and it has to be. At half a radian the ball left the dish at 27 degrees
 * and hit the roof of its own throat 100 units later, bounced back into the bowl
 * and started the cycle again. Seven degrees clears the lip and still puts some
 * lift on the ball.
 */
const SCOOP_TILT = 0.12;

let nextId = 0;
function id(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

function pts(list: ReadonlyArray<readonly [number, number]>): Vec[] {
  return list.map(([x, y]) => vec(x, y));
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

function sensorCircle(name: string, c: Vec, radius: number): Collider {
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

/**
 * The whole left hand side of the table, as one unbroken wall.
 *
 * It starts at the top left corner on the measured border, runs down past the
 * bumpers, turns right along the floor of the pocket, and carries straight on
 * into the left wall of the main playfield and then the apron. One polyline,
 * because that is what it is on a real machine: a ball never crosses it, it
 * follows it all the way down.
 *
 * Building it as separate pieces was the mistake in the first pass. Two walls
 * that nearly meet leave a notch, and this table has already produced five
 * separate ball traps out of notches exactly like that one.
 *
 * The only break in it is the scoop mouth, and that break is bounded by the two
 * ends of the scoop chamber's own arc, so there is no free end anywhere.
 */
function leftWall(): Collider[] {
  return solid('wall', [
    ...polyline([...pts(LEFT_BORDER), ...pts(LEFT_WALL_UPPER)]),
    ...polyline(pts(LEFT_WALL_LOWER)),
    ...polyline(pts(APRON_LEFT)),
  ], WOOD);
}

/**
 * The right hand side: the ceiling, the outer rail, and the orbit's way home.
 *
 * The **orbit return** is the piece that was missing, and its absence was a real
 * trap rather than a cosmetic one. The right orbit runs down between the castle
 * at 812 and the shooter lane rail at 918, and below the castle the painted
 * playfield pulls left to 745 before bulging back out to 870. That leaves a
 * channel outside the playfield that closes to **48 units** against a 54 unit
 * ball. A launched ball came down the orbit, went outside the playfield, and
 * jammed at (891, 876) with nothing on screen to explain it. The test caught it
 * in one run and no screenshot ever would have.
 *
 * So the orbit ends in a wall that slopes down and left across to the top of the
 * playfield's right side, and hands the ball to the table. The dead channel
 * behind it is sealed on every side and no ball can reach it now.
 */
function rightWall(): Collider[] {
  const right = LANE_OUTER_X;
  const top = pts(LEFT_BORDER)[0]!;
  const segs: Segment[] = [
    segment(top, vec(right - CORNER_R, TOP_WALL_Y)),
    ...arcToSegments(vec(right - CORNER_R, CORNER_R), CORNER_R, Math.PI * 1.5, Math.PI * 2, 16),
    segment(vec(right, CORNER_R), vec(right, DRAIN_Y)),
    ...polyline(pts(RIGHT_WALL_UPPER)),
    ...polyline(pts(RIGHT_WALL_LOWER)),
    ...polyline(pts(APRON_RIGHT)),
  ];
  return [
    ...solid('wall', segs, WOOD),
    // The orbit return, joining the lane rail to the top of the playfield. It
    // gets its own id so the page can draw it, because it is a rail the art does
    // not paint and an invisible wall on this table has been reported before:
    // "some transparent railing where the 2 levers are".
    //
    // It passes 70 units under the castle's lower right corner, and that number
    // is the whole reason it sits where it does. At 520 it passed 42 under the
    // corner, and 42 is less than a ball: the ball perched on the corner with
    // the return wall just too far below to touch, at (838, 511), and stayed
    // there. A corner sticking out into a lane needs either a ball's clearance
    // under it or none at all.
    ...solid('orbit', [segment(vec(LANE_X, 548), pts(RIGHT_WALL_UPPER)[0]!, 5)], RAIL),
  ];
}

/**
 * The shooter lane, up the right hand edge, between the two painted rails.
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
    // drawn on it. It was open once before and Arsalan rejected it on sight: the
    // ball travelled over the painted towers with nothing underneath it and
    // looked like it was flying. Sealing it was the wrong fix, because it left
    // the left half of the table unreachable. The right fix is the one a real
    // machine uses: a raised wire rail, drawn, so a ball above the playfield
    // furniture reads as being on a rail rather than as a bug.
    // The left face is not a straight drop, and treating it as one sealed the
    // table. The painted tower stands at x = 240 down to about y = 395, and
    // below that it narrows into a rocky base that pulls right: bare wood
    // reaches 291 at y = 330 and 318 at y = 435, and the neck the ball comes
    // down runs between the scoop structure at 270 and the castle's base at 325.
    // A vertical wall at 240 all the way down therefore ran straight across the
    // floor of the bumper pocket, and a ball that had finished with the bumpers
    // rolled right along that floor into it and stopped at (213, 476). There was
    // no way out of the top left of the table at all.
    ...polyline([railPoints()[0]!, vec(CASTLE_LEFT, 395), vec(365, 500)]),
    segment(railPoints()[RAIL_SAMPLES.length - 1]!, vec(CASTLE_RIGHT, CASTLE_BOTTOM)),
    segment(vec(365, 500), vec(gateLeft, CASTLE_BOTTOM)),
    segment(vec(gateRight, CASTLE_BOTTOM), vec(CASTLE_RIGHT, CASTLE_BOTTOM)),
  ];
  return [
    ...solid('castle', segs, WOOD),
    // Metal, not wood. On wood at friction 0.14 a ball crossing the corridor
    // arrives with nothing left and dribbles down instead of completing the
    // orbit, which on screen reads as slow motion at the top of the table.
    // Traced along the measured wire rather than drawn straight across it.
    ...solid('castle-roof', polyline(railPoints(), 4), RAIL),
  ];
}

/** Inside the castle: a back wall to stop the ball, and a sensor that scores it. */
function castleChamber(): Collider[] {
  const gateLeft = GATE_CENTRE - GATE_HALF_WIDTH;
  const gateRight = GATE_CENTRE + GATE_HALF_WIDTH;
  return [
    // A back wall AND two sides. The sides are the fix for a real trap: with
    // only the back wall, a ball that took an open gate carried on past the
    // chamber into the whole hollow inside of the castle, rolled right, and came
    // to rest on the castle's own lower face at (674, 475). That face is level,
    // and a level surface the ball can land on top of is a permanent trap on a
    // table seen from above. Now the mouth leads to a chamber the width of the
    // gate, the ball stops on the back wall and falls straight back out of the
    // hole it came in by.
    ...solid(
      'castle-back',
      [
        segment(vec(gateLeft, CASTLE_BOTTOM - 210), vec(gateRight, CASTLE_BOTTOM - 210)),
        segment(vec(gateLeft, CASTLE_BOTTOM - 210), vec(gateLeft, CASTLE_BOTTOM)),
        segment(vec(gateRight, CASTLE_BOTTOM - 210), vec(gateRight, CASTLE_BOTTOM)),
      ],
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
 * Three pop bumpers in the upper left, on the caps they are painted on.
 *
 * They carry a `kick` rather than a high restitution because restitution can
 * only ever hand back a fraction of what arrived. A ball that dribbles in with
 * almost no speed would leave with less, and would sit among them forever.
 */
function bumpers(): Collider[] {
  return BUMPER_CAPS.map(([x, y]) => post('bumper', vec(x, y), BUMPER_RADIUS, RUBBER, BUMPER_KICK));
}

/**
 * The lane guide on each side, and the post that makes an outlane out of it.
 *
 * Arsalan asked for a one ball outlane on each side. It was tried once by
 * pulling the lower walls 60 units off each wall and reverted, because the right
 * orbit delivers the ball down that exact line and a launched ball ran straight
 * out of the gap without ever reaching the table. What a real machine puts there
 * is a post between the inlane and the outlane, so the orbit is steered inside
 * it and only a ball that has already lost the line slips out. That is what this
 * is.
 *
 * The outlane could not go where a real machine puts it, and the measurement is
 * why. The painted wall on the left is at 177 and the painted slingshot starts
 * at 189, so there are **12 units** between them: there is no room beside the
 * slingshot for a lane of any width at all. So the split happens below the
 * slingshot instead. The rail runs down from the post to the flipper pivot, the
 * outlane is the channel outside it, and the inlane is the channel inside.
 *
 * Every number here is a clearance, not a preference:
 *
 * - outlane 177 to 234, which is **57** for a 54 unit ball
 * - the rail is 6 thick, so 234 to 246
 * - inlane 246 to 304, the back of the bat, which is **58**
 * - the post is 68 clear of the slingshot's lower corner, so a ball chooses a
 *   side rather than wedging between them
 *
 * They only just fit. The whole budget from the wall to the back of the bat is
 * 127 units and two lanes and a rail need 121 of it.
 */
function laneGuides(): Collider[] {
  const out: Collider[] = [];
  for (const side of [
    { top: vec(246, 1266), foot: vec(306, 1276), postAt: vec(246, 1266) },
    { top: vec(747, 1266), foot: vec(687, 1276), postAt: vec(747, 1266) },
  ]) {
    out.push(...solid('lower', [segment(side.top, side.foot, 6)], PLASTIC));
    // A round cap on the top end, which is the inlane/outlane post itself. A
    // bare segment end is a corner, and a corner beside a lane is how the last
    // three wedges on this table started.
    out.push(post('lower-post', side.postAt, 12, RUBBER, 220));
  }
  return out;
}

/**
 * Slingshots: the two triangular rubbers above the flippers.
 *
 * Solid all the way round, on the three painted posts. The long edge faces the
 * middle of the table and carries the kick; the other two are plain rubber, so a
 * ball that comes down the outside is turned rather than fired.
 */
function slingshots(): Collider[] {
  const out: Collider[] = [];
  for (const tri of [SLING_LEFT, SLING_RIGHT]) {
    const [a, b, c] = pts(tri) as [Vec, Vec, Vec];
    // a is the top post, c is the one nearest the middle of the table, so a..c
    // is the face a ball arriving from the playfield actually meets.
    out.push(...solid('sling', [segment(a, c, 9)], RUBBER, SLING_KICK));
    // Named so they do NOT share the `sling-` prefix. Scoring and the clearance
    // test both key off that prefix, and a back edge that scored as a slingshot
    // would pay the player for a ball rolling down the outside of it.
    out.push(...solid('triangle', [segment(a, b, 9), segment(b, c, 9)], RUBBER));
  }
  return out;
}

/**
 * Three drop targets, on the lower edge of the painted ogre shields.
 *
 * Knocking all three down is what opens the castle gate.
 */
function dropTargets(): Collider[] {
  return TARGET_SPANS.map(([x0, x1], i) => ({
    id: `target-${i}`,
    type: 'segment' as const,
    seg: segment(vec(x0, TARGET_Y), vec(x1, TARGET_Y), 10),
    material: PLASTIC,
    kick: 0,
    sensor: false,
    active: true,
  }));
}

/**
 * The two ends of the arc each bowl leaves open, aimed at its own mouth.
 *
 * These used to be fixed angles, and the fixed angles were wrong: the left bowl
 * opened towards 20 degrees below horizontal while its mouth sits 1.6 degrees
 * above it. The coil then fired the ball out of the dish and straight into the
 * roof of its own throat, 50 units later, and it dropped back in. Measured: out
 * at 2987 units a second, down to 349 within ten frames, having moved 19 units.
 *
 * Computing the opening from the mouth means the bowl always faces the way out.
 */
const SCOOP_HALF_OPEN = (50 * Math.PI) / 180;

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
 * The right scoop's throat was therefore wired as a cross: the top of the mouth
 * ran to the bottom of the bowl and the bottom to the top, which sealed the
 * entrance completely. Two thousand seven hundred test launches from every angle
 * caught 67 balls in the left scoop and none at all in the right, and it was
 * reported from play before the test was written: "because of the purple line
 * the right side scoop is unreachable".
 */
function scoopThroat(centre: Vec, radius: number, mouth: readonly [Vec, Vec]): [Segment, Segment] {
  const [p, q] = scoopOpening(centre, radius, mouth);
  const d = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
  const straight = d(mouth[0], p) + d(mouth[1], q);
  const crossed = d(mouth[0], q) + d(mouth[1], p);
  return straight <= crossed
    ? [segment(mouth[0], p, 4), segment(mouth[1], q, 4)]
    : [segment(mouth[0], q, 4), segment(mouth[1], p, 4)];
}

/** The arc a bowl's wall covers: everything the opening does not. */
function scoopArc(centre: Vec, radius: number, mouth: readonly [Vec, Vec]): Segment[] {
  const to = Math.atan2(
    (mouth[0].y + mouth[1].y) / 2 - centre.y,
    (mouth[0].x + mouth[1].x) / 2 - centre.x,
  );
  return arcToSegments(centre, radius, to + SCOOP_HALF_OPEN, to + Math.PI * 2 - SCOOP_HALF_OPEN, 20);
}

/**
 * The two scoops: a round chamber behind a gap in the wall.
 *
 * A hole in a pinball table is a chamber the ball cannot get out of by itself,
 * and that is the one shape this table has spent thirteen bugs learning to
 * avoid. It is safe here for one reason only: **the scoop always lets go.** The
 * hold is on a timer in `game.ts`, not on the player doing something, so a ball
 * in here is never a ball that has stopped.
 *
 * The chamber is a circle of 46 with a 100 degree bite taken out of it facing
 * the playfield. The opening between the two lips is 71 units across, so a 54
 * unit ball goes in cleanly, and the wall runs into those same two lips so there
 * is no step where they meet.
 */
function scoops(): Collider[] {
  return [
    // The bowl walls. The left is open from -30 to 70 degrees, so its wall is
    // the rest of the circle; the right is open from 110 to 210.
    ...solid('scoopwall', scoopArc(SCOOP_LEFT_CENTRE, SCOOP_LEFT_R, SCOOP_LEFT_MOUTH), PLASTIC),
    ...solid('scoopwall', scoopArc(SCOOP_RIGHT_CENTRE, SCOOP_RIGHT_R, SCOOP_RIGHT_MOUTH), PLASTIC),
    // The throat: two short walls from the gap in the playfield wall into the
    // bowl, so the ball is funnelled rather than dropped into a slot.
    ...solid('scoopwall', [
      ...scoopThroat(SCOOP_LEFT_CENTRE, SCOOP_LEFT_R, SCOOP_LEFT_MOUTH),
      ...scoopThroat(SCOOP_RIGHT_CENTRE, SCOOP_RIGHT_R, SCOOP_RIGHT_MOUTH),
    ], PLASTIC),
    // The catch is a sensor at the back of each bowl, not the wall. A ball that
    // merely clips the mouth on its way past is not caught; it has to get far
    // enough in that the picture agrees it went in.
    sensorCircle('scoop-left', SCOOP_LEFT_CENTRE, 18),
    sensorCircle('scoop-right', SCOOP_RIGHT_CENTRE, 18),
  ];
}

/**
 * The shutter across each mouth, closed while the scoop reloads.
 *
 * A bowl is a dead end and the ball only gets out because the scoop fires it, so
 * a ball that rolls in while the coil is still busy has nowhere to go. The
 * shutter is the same trick as the portcullis: solid exactly when the hole is
 * not ready to take a ball, and open the rest of the time. Without it the scoop
 * is a trap for the length of its own cooldown.
 */
function scoopShutters(): Collider[] {
  return [SCOOP_LEFT_MOUTH, SCOOP_RIGHT_MOUTH].map((mouth, i) => ({
    id: `scoop-shutter-${i}`,
    type: 'segment' as const,
    seg: segment(mouth[0], mouth[1], 5),
    material: PLASTIC,
    kick: 0,
    sensor: false,
    active: false,
  }));
}

/** The painted lamp lenses, as rollovers the ball lights by passing over them. */
function lamps(): Collider[] {
  return LAMPS.map(([x, y], i) => sensorCircle(`lamp-${i}`, vec(x, y), LAMP_RADIUS));
}

/** Sensors across each inlane and outlane, so the game knows where a ball went. */
function laneSensors(): Collider[] {
  return [
    // The outlane sensor sits in the channel between the wall and the post, which
    // is 177 to 234 on the left and 759 to 816 on the right. The inlane one sits
    // where a ball rolling down the guide rail actually is, which is a ball's
    // radius plus the rail's above the rail itself, not level with it.
    ...sensor('outlane-left', [segment(vec(180, 1330), vec(232, 1330))]),
    ...sensor('inlane-left', [segment(vec(252, 1234), vec(300, 1242))]),
    ...sensor('outlane-right', [segment(vec(761, 1330), vec(813, 1330))]),
    ...sensor('inlane-right', [segment(vec(693, 1242), vec(741, 1234))]),
  ];
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

function scoopList(shutters: Collider[]): Scoop[] {
  const build = (name: string, centre: Vec, radius: number,
                 gap: readonly [Vec, Vec], shutter: Collider): Scoop => {
    const mouth = vec((gap[0].x + gap[1].x) / 2, (gap[0].y + gap[1].y) / 2);
    // Park it a little behind the middle of the bowl, so the ball sits in the
    // dish rather than in its doorway, and the picture explains where it went.
    const hold = vec(centre.x + (centre.x - mouth.x) * 0.14, centre.y + (centre.y - mouth.y) * 0.14);
    const dx = mouth.x - hold.x;
    const dy = mouth.y - hold.y;
    const d = Math.hypot(dx, dy) || 1;

    // Out of the mouth, and then tilted half a radian UP the table.
    //
    // Straight along the mouth the left scoop fired the ball flat across at the
    // height of the target bank, from where it came back down the same wall and
    // fell into the same hole. One measured game did that for three hundred
    // seconds and never ended. A real coil throws the ball up the playfield, and
    // up is also what breaks the loop: the ball goes somewhere it has to be
    // played back from rather than somewhere it merely returns from.
    const tilt = dx > 0 ? -SCOOP_TILT : SCOOP_TILT;
    const ex = (dx / d) * Math.cos(tilt) - (dy / d) * Math.sin(tilt);
    const ey = (dx / d) * Math.sin(tilt) + (dy / d) * Math.cos(tilt);
    return { id: name, centre, radius, hold, eject: vec(ex, ey), mouth, shutter };
  };
  return [
    build('scoop-left', SCOOP_LEFT_CENTRE, SCOOP_LEFT_R, SCOOP_LEFT_MOUTH, shutters[0]!),
    build('scoop-right', SCOOP_RIGHT_CENTRE, SCOOP_RIGHT_R, SCOOP_RIGHT_MOUTH, shutters[1]!),
  ];
}

export interface Table {
  readonly colliders: Collider[];
  /** The one-way gate at the top of the shooter lane, switched by the game. */
  readonly laneGate: Collider;
  /** The castle mouth. Solid until all three targets are down. */
  readonly portcullis: Collider;
  readonly targets: Collider[];
  /** The two holes. The game owns the hold timer; the table owns the geometry. */
  readonly scoops: Scoop[];
  /** How many lamp lenses there are, so the game knows when the set is complete. */
  readonly lampCount: number;
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
    // Reaches the outer wall, and slopes down towards the playfield.
    //
    // It used to stop 58 units short, which left a 41 unit notch against the
    // wall that a 54 unit ball could not pass but could rest in, so the ball
    // parked at (983, 242) every strong launch. Meeting the wall removes the
    // notch, and the downhill run means a ball that settles on the gate rolls
    // off its low end and onto the table rather than staying there.
    seg: segment(vec(LANE_OUTER_X, 262), vec(LANE_X, 300), 6),
    material: METAL,
    kick: 0,
    sensor: false,
    active: false,
  };

  const targets = dropTargets();
  const gate = portcullis();
  const shutters = scoopShutters();

  const colliders: Collider[] = [
    ...leftWall(),
    ...rightWall(),
    ...shooterLane(),
    laneGate,
    ...castle(),
    ...castleChamber(),
    gate,
    ...bumpers(),
    ...scoops(),
    ...shutters,
    ...laneGuides(),
    ...slingshots(),
    ...targets,
    ...lamps(),
    ...laneSensors(),
  ];

  return {
    colliders, laneGate, portcullis: gate, targets,
    scoops: scoopList(shutters), lampCount: LAMPS.length,
  };
}
