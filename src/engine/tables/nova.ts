/**
 * NOVA: the space board, as data.
 *
 * The second machine in the cabinet. Same engine, same physics, same 1024 by
 * 1536 units, and every trap rule the castle paid for is applied here from the
 * first line rather than discovered.
 *
 * ## This board was authored, not measured, and that is the whole point
 *
 * The castle's geometry had to be scanned out of a single flat painting, because
 * the painting came first and the colliders had to go where the paint already
 * was. Every bad number on that board came from judging one off a picture, and
 * `tools/measure-art.py` exists to stop it happening again.
 *
 * This board is built the other way round. The art is a set of separate pieces
 * with no absolute positions of their own, so the numbers below are chosen
 * against the clearance rules and each piece of art is then placed FROM its
 * collider. The paint follows the geometry instead of the geometry chasing the
 * paint, which removes the entire class of defect the castle spent a week on.
 *
 * Two consequences worth stating, because they are the opposite of the castle's:
 *
 * - **The lower playfield is exactly symmetric about x = 512.** The castle's
 *   never was, because its painting was not, and mirroring one side onto the
 *   other put every right hand collider a few units off its paint. Here there is
 *   no paint to be off, so symmetry is free and is used.
 * - **Nothing here needs re-tracing when the art changes.** The art is fitted to
 *   these numbers.
 *
 * What is NOT symmetric is the outer boundary, and it cannot be: the shooter
 * lane takes 106 units out of the right hand side and no amount of wanting it
 * otherwise puts them back. Both sides are therefore written out in full.
 *
 * ## The clearance budget, decided before anything was drawn
 *
 * A ball is 54 units across. Every channel a ball is meant to pass is at least
 * 56, and every gap it must not enter is under 54 along its whole length. The
 * lower playfield is the tightest part of any table, so it was budgeted first:
 *
 * - wall to the back of the bat: 136 units, the castle's proven figure
 * - left wall 190, right wall 834, so the channel is 644 and centred on 512
 * - pivots (352, 1288) and (672, 1288), bat 130 long and 26 at the hinge
 * - between the tips: centres 94.5 apart, less 9.4 of tip radius each, so
 *   **75.7 clear** against a 54 unit ball
 *
 * ## Angles
 *
 * y points down the screen. An angle of zero points right, and it increases
 * clockwise as it is drawn.
 */

import type { Vec } from '../vec.js';
import { vec } from '../vec.js';
import type { Segment } from '../shapes.js';
import { arcToSegments, polyline, segment } from '../shapes.js';
import type { Collider } from '../physics.js';
import { WOOD, METAL, RUBBER, PLASTIC, RAIL } from '../physics.js';
import type { Scoop, Table } from '../table.js';
import {
  LANE_X, LANE_OUTER_X, DRAIN_Y,
  resetIds, pts, solid, post, sensor, sensorCircle,
  shooterLane, laneGate,
  scoopMouth, scoopThroat, scoopArc, scoopShutter, buildScoop,
} from '../table.js';

/* ------------------------------------------------------------------ *
 * The lower playfield, budgeted first
 * ------------------------------------------------------------------ */

const WALL_LEFT = 190;
const WALL_RIGHT = 834;

const FLIPPER_PIVOT_LEFT: Vec = vec(352, 1288);
const FLIPPER_PIVOT_RIGHT: Vec = vec(672, 1288);

/**
 * y = 1288 rather than something rounder, and it is the castle's number.
 *
 * The left slingshot's lower post sits at y = 1200. A pivot at 1258 leaves 35
 * units between that post and the back of the bat, and 35 is exactly the width
 * that catches a 54 unit ball: wide enough to roll into, too narrow to roll out
 * of. The castle grew that same wedge three separate times. At 1288 the gap is
 * 57 and the ball goes through, so the number is inherited rather than
 * rediscovered.
 */
const PLUNGER_REST: Vec = vec(956, 1380);

/** Corner radius on the two top corners of the outer wall. */
const CORNER_R = 190;
const TOP_WALL_Y = 12;

/* ------------------------------------------------------------------ *
 * The station: the structure this board is aimed at
 * ------------------------------------------------------------------ */

const STATION_BOTTOM = 486;

/**
 * The bay, centred on the table because there is no painting telling it not to.
 *
 * The castle's arch is at 526 rather than 512, and the collision follows it
 * there, because nudging it to the middle would put the mouth off the arch and
 * the shot would stop lining up with the thing the player aims at. Here the art
 * will be placed on this number, so the middle is simply available.
 *
 * 92 units across for a 54 unit ball. Wide enough to be a shot rather than a
 * miracle, narrow enough to be worth aiming.
 */
const BAY_CENTRE = 512;
const BAY_HALF_WIDTH = 46;

/**
 * The station outline, as ONE closed loop with no free ends anywhere.
 *
 * Three separate balls balanced on free segment ends on the castle: the end of
 * the habitrail, the castle's lower right corner, and a wall's own upper end.
 * A closed loop cannot produce that failure at all, so the gantry runs into the
 * left face, the left face into the base, the base into the right face and the
 * right face back into the gantry. The only break is the bay, and the bay is
 * closed by its own chamber and shutter.
 */
const STATION_LEFT_FACE: ReadonlyArray<readonly [number, number]> = [
  [258, 130], [250, 330], [268, 430], [300, STATION_BOTTOM],
];
const STATION_RIGHT_X = 780;
const STATION_RIGHT_TOP = 220;

/**
 * The gantry over the station, falling to the RIGHT, and the direction was
 * measured rather than chosen.
 *
 * It ran the other way first, on the reasoning that the castle's roof falls the
 * same side the plunger throws the ball up, so a launched ball there comes back
 * down the side it went up and never crosses. Falling left, the launch would
 * cross the table on its own.
 *
 * It does, and it creates a loop that never ends. The gantry's low end is over
 * the bumpers, the bumpers throw the ball straight back up into the corridor,
 * and the corridor hands it back to the gantry. Sixty soaked games: **sixteen
 * never reached game over**, every one of them with the ball still in the nest,
 * and 80,000 bumper hits against 15,000 lamps. The board had one feature.
 *
 * Falling right, a ball kicked out of the nest enters the corridor, runs down
 * and away into the right orbit, and the loop has an exit. The flow that gives
 * is the good one: left orbit into the nest, nest up into the corridor, corridor
 * across and down the right. The left orbit is then reached with a flipper, the
 * way a real machine reaches it.
 *
 * The fall is 90 over a run of 522, which is 9.8 degrees. The floor for RAIL is
 * 6: at 1.5 degrees the castle's roof simply parked the ball and it crept along
 * at 5 units a second forever. A roof under a ceiling has to shed a slow ball on
 * its own or it is a trap with extra steps.
 */
const GANTRY_LEFT: Vec = vec(258, 130);
const GANTRY_RIGHT: Vec = vec(STATION_RIGHT_X, STATION_RIGHT_TOP);

/* ------------------------------------------------------------------ *
 * The boundary, both sides written out separately
 * ------------------------------------------------------------------ */

/**
 * Down the left: the orbit's outer wall, then the floor of the bumper pocket.
 *
 * The floor falls right at 19 and then 28 degrees. Bare wood parks a ball under
 * 8 degrees, so a pocket floor that merely looks downhill is not enough: a ball
 * that has finished with the bumpers has almost no speed left and has to be
 * given somewhere to go.
 */
const LEFT_UPPER: ReadonlyArray<readonly [number, number]> = [
  [60, CORNER_R], [60, 500], [128, 524], [196, 560],
  [206, 610], [200, 655], [196, 700],
];

/**
 * Below the left scoop's mouth, down to where the apron takes over.
 *
 * The first point is the lower lip of the mouth, and the mouth is **75 units**
 * rather than the 59 it started at. That is not a preference, it is forced by
 * the bowl: an opening of 50 degrees either side of a 46 unit bowl is a chord of
 * 70.5, and a mouth narrower than its own bowl's opening puts the lips OUTSIDE
 * the gap they are supposed to funnel into. The throat then reverses direction
 * at the lip and makes a V, and the drop sweep found a ball sitting in it on the
 * right hand side within a second of looking.
 *
 * A mouth wider than the opening converges instead, which is what a funnel is.
 * The castle's are 76 and 75 for the same reason, and it catches 35 balls in
 * sixty games at that width, so this is not a hole the side of the table drains
 * into either.
 */
const LEFT_LOWER: ReadonlyArray<readonly [number, number]> = [
  [174, 772], [168, 810], [166, 865], [172, 940],
  [182, 1020], [WALL_LEFT, 1080], [WALL_LEFT, 1360],
];

/**
 * Down the right there is no wall above the scoop's mouth: the orbit rail IS it.
 *
 * Two goes at having both taught the same thing twice on the castle. A rail
 * aimed at the far end of a wall makes a V that closes from 73 units to nothing,
 * and a ball found the 54 unit point of it. Aimed at the near end it makes a
 * corner instead, and the wall's own free upper end became a bare post the ball
 * perched on. One line doing the job of two has neither.
 */
const RIGHT_UPPER: ReadonlyArray<readonly [number, number]> = [
  [812, 690],
];
const RIGHT_LOWER: ReadonlyArray<readonly [number, number]> = [
  [802, 764], [808, 810], [810, 865], [804, 940],
  [814, 1020], [WALL_RIGHT, 1080], [WALL_RIGHT, 1360],
];

/** Where the orbit hands the ball back to the table. */
const ORBIT_RETURN_TOP: Vec = vec(LANE_X, 530);

/**
 * The apron, funnelling to a mouth 204 units wide at the bottom edge.
 *
 * The ball keeps falling past it to `DRAIN_Y` so you watch it go rather than
 * watching it vanish in the middle of the picture.
 */
const APRON_LEFT: ReadonlyArray<readonly [number, number]> = [
  [WALL_LEFT, 1360], [221, 1400], [278, 1432], [335, 1464], [410, 1504], [410, DRAIN_Y],
];
const APRON_RIGHT: ReadonlyArray<readonly [number, number]> = [
  [WALL_RIGHT, 1360], [803, 1400], [746, 1432], [689, 1464], [614, 1504], [614, DRAIN_Y],
];

/* ------------------------------------------------------------------ *
 * Furniture
 * ------------------------------------------------------------------ */

/**
 * Three asteroids in the left orbit, set to alternate sides.
 *
 * The channel is 194 wide here and a cap is 72 across, so a cap on the centre
 * line would leave 61 either side and the ball would have to choose at random.
 * Offset, each cap leaves under a ball on one side and 90 or more on the other,
 * so the ball is steered from one to the next instead of rattling. That is what
 * the castle's caps do once they were moved onto the paint, and it plays far
 * better than a symmetric row.
 */
const BUMPER_CAPS: ReadonlyArray<readonly [number, number]> = [
  [130, 250], [185, 355], [112, 415],
];

/**
 * Collide at 36 against art that will be drawn wider.
 *
 * A real pop bumper's plastic cap is wider than the skirt the ball actually
 * touches, so this is the real part rather than a compromise. It is also what
 * keeps the orbit passable: at a drawn 59 the caps would leave 29 on one side
 * and no ball would ever go down the left half of the table.
 */
const BUMPER_RADIUS = 36;
const BUMPER_KICK = 1450;
const SLING_KICK = 1150;

/** Three shield generators across the middle, symmetric about 512. */
const TARGET_Y = 720;
const TARGET_SPANS: ReadonlyArray<readonly [number, number]> = [
  [330, 451], [451, 573], [573, 694],
];

/**
 * The slingshots, and the left one is the castle's triangle moved 13 units out.
 *
 * The shape is inherited on purpose. The castle's was traced short and in the
 * wrong place first, and the corrected triangle is the one that stopped
 * producing wedges against the flipper. The right one is this mirrored about
 * 512, which is legitimate HERE and was not there: the castle had paint to be
 * wrong about and this board does not.
 */
const SLING_LEFT: ReadonlyArray<readonly [number, number]> = [
  [229, 1068], [214, 1169], [301, 1200],
];
const SLING_RIGHT: ReadonlyArray<readonly [number, number]> = [
  [795, 1068], [810, 1169], [723, 1200],
];

/**
 * Nav beacons, as rollovers rather than posts.
 *
 * The castle had seven solid posts scattered through the middle of the table on
 * nothing at all, one of them standing in the mouth of the drain. A lens flush
 * with the playfield is a lamp on a real machine, and a lamp puts something to
 * collect in the empty middle without putting anything in the ball's way. Two of
 * these sit on the centre line low down, which would be unthinkable as posts and
 * costs nothing as sensors.
 */
const LAMPS: ReadonlyArray<readonly [number, number]> = [
  [108, 220], [100, 380],
  [860, 250], [872, 400], [856, 560],
  [330, 560], [694, 560], [420, 620], [604, 620], [512, 600],
  [260, 620], [764, 620],
  [280, 880], [744, 880], [380, 960], [644, 960], [512, 940],
  [300, 1120], [724, 1120], [512, 1120], [512, 1240],
];
const LAMP_RADIUS = 26;

/**
 * The two holes, and they are NOT a mirrored pair.
 *
 * The shooter lane takes the right hand side, so the pocket behind the right
 * wall is 106 units against the left's 176. The left bowl is 46 and the right
 * one 44, each sized to its own pocket and each clearing the lane rail. Trying
 * to make them the same size is how the right one ends up overlapping the
 * shooter lane.
 *
 * ## Each centre sits on its own mouth's normal, 36 units behind it
 *
 * That rule is the fix for a trap the drop sweep found on the first run, and it
 * is worth writing down because it is not obvious. A bowl placed by eye, at
 * (120, 740), put its upper throat wall dead level: a segment from (196, 700) to
 * (143, 700). A level surface the ball can land on top of is a permanent trap,
 * and this one had open playfield above it, so balls that came down the left
 * orbit rounded the end of the wall, settled on the throat's roof and stayed
 * there. Twenty-odd starts on the grid ended at y = 669, which is exactly one
 * ball radius plus the throat's own on top of y = 700.
 *
 * Putting the centre on the mouth's normal makes the throat symmetric and short,
 * 9 units a side rather than 53, so there is no roof to land on. It also closes
 * the gap between the bowl and the wall above it: the widest that passage gets
 * is 45 units on the left and 24 on the right, both under a ball, so the sealed
 * pocket behind the wall stays sealed.
 */
const SCOOP_LEFT_CENTRE: Vec = vec(151, 726);
const SCOOP_LEFT_R = 46;
const SCOOP_RIGHT_CENTRE: Vec = vec(843, 732);
const SCOOP_RIGHT_R = 44;

const SCOOP_LEFT_MOUTH = scoopMouth(LEFT_UPPER, LEFT_LOWER);
const SCOOP_RIGHT_MOUTH = scoopMouth(RIGHT_UPPER, RIGHT_LOWER);

/* ------------------------------------------------------------------ *
 * Assemblies
 * ------------------------------------------------------------------ */

/**
 * The whole left hand side as one unbroken wall, top corner to apron.
 *
 * Building it as separate pieces was the mistake on the castle's first pass. Two
 * walls that nearly meet leave a notch, and that board produced five separate
 * ball traps out of notches exactly like it. The only break is the scoop mouth,
 * and that break is bounded by the two ends of the bowl's own throat, so there
 * is no free end anywhere on this side.
 */
function leftWall(): Collider[] {
  return solid('wall', [
    ...arcToSegments(vec(60 + CORNER_R, CORNER_R), CORNER_R, Math.PI, Math.PI * 1.5, 16),
    ...polyline(pts(LEFT_UPPER)),
    ...polyline(pts(LEFT_LOWER)),
    ...polyline(pts(APRON_LEFT)),
  ], WOOD);
}

/** The ceiling, the outer rail, and the orbit's way home. */
function rightWall(): Collider[] {
  const segs: Segment[] = [
    segment(vec(60 + CORNER_R, TOP_WALL_Y), vec(LANE_OUTER_X - CORNER_R, TOP_WALL_Y)),
    ...arcToSegments(vec(LANE_OUTER_X - CORNER_R, CORNER_R), CORNER_R, Math.PI * 1.5, Math.PI * 2, 16),
    segment(vec(LANE_OUTER_X, CORNER_R), vec(LANE_OUTER_X, DRAIN_Y)),
    ...polyline(pts(RIGHT_LOWER)),
    ...polyline(pts(APRON_RIGHT)),
  ];
  return [
    // The orbit return gets its own id so the page can draw it, because it is a
    // rail the board's art does not otherwise imply, and an invisible wall has
    // been reported on the castle before.
    ...solid('wall', segs, WOOD),
    ...solid('orbit', [segment(ORBIT_RETURN_TOP, pts(RIGHT_UPPER)[0]!, 5)], RAIL),
  ];
}

/**
 * The station: a closed outline with a gap at the bay.
 *
 * The gantry is RAIL and the rest is WOOD. On wood at friction 0.14 a ball
 * crossing the top arrives with nothing left and dribbles down, which on screen
 * reads as slow motion at the top of the table.
 */
function station(): Collider[] {
  const bayLeft = BAY_CENTRE - BAY_HALF_WIDTH;
  const bayRight = BAY_CENTRE + BAY_HALF_WIDTH;
  return [
    ...solid('station', [
      ...polyline(pts(STATION_LEFT_FACE)),
      segment(vec(300, STATION_BOTTOM), vec(bayLeft, STATION_BOTTOM)),
      segment(vec(bayRight, STATION_BOTTOM), vec(STATION_RIGHT_X, STATION_BOTTOM)),
      segment(vec(STATION_RIGHT_X, STATION_BOTTOM), GANTRY_RIGHT),
    ], WOOD),
    ...solid('gantry', [segment(GANTRY_RIGHT, GANTRY_LEFT, 4)], RAIL),
  ];
}

/**
 * Inside the station: a chamber the width of the bay, and a sensor that scores.
 *
 * A back wall alone is not enough, and that is a trap the castle grew. With only
 * a back wall a ball that took an open gate carried on past it into the whole
 * hollow inside, rolled sideways and came to rest on the structure's own level
 * base. A level surface the ball can land on top of is a permanent trap on a
 * table seen from above. With sides, the ball stops on the back wall and falls
 * straight back out of the hole it came in by.
 */
function chamber(): Collider[] {
  const bayLeft = BAY_CENTRE - BAY_HALF_WIDTH;
  const bayRight = BAY_CENTRE + BAY_HALF_WIDTH;
  const back = STATION_BOTTOM - 210;
  return [
    ...solid('station-back', [
      segment(vec(bayLeft, back), vec(bayRight, back)),
      segment(vec(bayLeft, back), vec(bayLeft, STATION_BOTTOM)),
      segment(vec(bayRight, back), vec(bayRight, STATION_BOTTOM)),
    ], WOOD),
    ...sensor('gate', [
      segment(vec(bayLeft, STATION_BOTTOM - 30), vec(bayRight, STATION_BOTTOM - 30)),
    ]),
  ];
}

/**
 * The bay shutter, solid until all three targets are down.
 *
 * The same part as the castle's portcullis and for the same reason: a player
 * needs to be told no by something they can see and hear, not by a score that
 * quietly does not arrive.
 */
function bayShutter(): Collider {
  return {
    id: 'portcullis',
    type: 'segment',
    seg: segment(
      vec(BAY_CENTRE - BAY_HALF_WIDTH, STATION_BOTTOM),
      vec(BAY_CENTRE + BAY_HALF_WIDTH, STATION_BOTTOM),
      6,
    ),
    material: METAL,
    kick: 0,
    sensor: false,
    active: true,
  };
}

function bumpers(): Collider[] {
  return BUMPER_CAPS.map(([x, y]) => post('bumper', vec(x, y), BUMPER_RADIUS, RUBBER, BUMPER_KICK));
}

/**
 * One post per side, overlapping the back of the bat, and no rail.
 *
 * The rail's absence is the fix rather than a simplification. A rail has to come
 * down to the bat, and where its side emerges from the bat's 26 unit back it
 * makes a notch of about 60 degrees. A ball sat in that notch in nineteen games
 * of sixty on the castle, and it sat there however the flippers were played,
 * because the back of a bat is the one part that does not move: surface speed is
 * omega times radius and the radius at the pivot is nothing.
 *
 * A post overlapping the bat has no notch to sit in and still does the rail's
 * real job, which is to stop the ball slipping behind the bat. The post spans
 * 288 to 328 and the bat's back reaches 326, so the gap between them is
 * negative and there is nothing to slip through.
 */
function laneGuides(): Collider[] {
  return [
    post('lower-post', vec(308, 1290), 20, RUBBER, 220),
    post('lower-post', vec(716, 1290), 20, RUBBER, 220),
  ];
}

function slingshots(): Collider[] {
  const out: Collider[] = [];
  for (const tri of [SLING_LEFT, SLING_RIGHT]) {
    const [a, b, c] = pts(tri) as [Vec, Vec, Vec];
    // a is the top post and c the one nearest the middle, so a..c is the face a
    // ball arriving from the playfield actually meets, and it carries the kick.
    out.push(...solid('sling', [segment(a, c, 9)], RUBBER, SLING_KICK));
    // Named so they do NOT share the `sling-` prefix. Scoring keys off that
    // prefix, and a back edge that scored as a slingshot would pay the player
    // for a ball rolling down the outside of it.
    out.push(...solid('triangle', [segment(a, b, 9), segment(b, c, 9)], RUBBER));
  }
  return out;
}

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

function scoops(): Collider[] {
  return [
    ...solid('scoopwall', scoopArc(SCOOP_LEFT_CENTRE, SCOOP_LEFT_R, SCOOP_LEFT_MOUTH), PLASTIC),
    ...solid('scoopwall', scoopArc(SCOOP_RIGHT_CENTRE, SCOOP_RIGHT_R, SCOOP_RIGHT_MOUTH), PLASTIC),
    ...solid('scoopwall', [
      ...scoopThroat(SCOOP_LEFT_CENTRE, SCOOP_LEFT_R, SCOOP_LEFT_MOUTH),
      ...scoopThroat(SCOOP_RIGHT_CENTRE, SCOOP_RIGHT_R, SCOOP_RIGHT_MOUTH),
    ], PLASTIC),
    // The catch is a sensor at the back of each bowl, not the wall, so a ball
    // that merely clips the mouth on its way past is not caught.
    sensorCircle('scoop-left', SCOOP_LEFT_CENTRE, 18),
    sensorCircle('scoop-right', SCOOP_RIGHT_CENTRE, 18),
  ];
}

function scoopShutters(): Collider[] {
  return [SCOOP_LEFT_MOUTH, SCOOP_RIGHT_MOUTH].map((mouth, i) => scoopShutter(i, mouth));
}

function lamps(): Collider[] {
  return LAMPS.map(([x, y], i) => sensorCircle(`lamp-${i}`, vec(x, y), LAMP_RADIUS));
}

/** Sensors across each inlane and outlane, so the game knows where a ball went. */
function laneSensors(): Collider[] {
  return [
    ...sensor('outlane-left', [segment(vec(193, 1330), vec(245, 1330))]),
    ...sensor('inlane-left', [segment(vec(271, 1237), vec(321, 1250))]),
    ...sensor('outlane-right', [segment(vec(779, 1330), vec(831, 1330))]),
    ...sensor('inlane-right', [segment(vec(753, 1237), vec(703, 1250))]),
  ];
}

function scoopList(shutters: Collider[]): Scoop[] {
  return [
    buildScoop('scoop-left', SCOOP_LEFT_CENTRE, SCOOP_LEFT_R, SCOOP_LEFT_MOUTH, shutters[0]!),
    buildScoop('scoop-right', SCOOP_RIGHT_CENTRE, SCOOP_RIGHT_R, SCOOP_RIGHT_MOUTH, shutters[1]!),
  ];
}

/** Build the space board. One fresh copy per game: colliders carry mutable state. */
export function buildNova(): Table {
  resetIds();

  const gateAtTopOfLane = laneGate();
  const targets = dropTargets();
  const shutter = bayShutter();
  const shutters = scoopShutters();

  const colliders: Collider[] = [
    ...leftWall(),
    ...rightWall(),
    ...shooterLane(),
    gateAtTopOfLane,
    ...station(),
    ...chamber(),
    shutter,
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
    id: 'nova',
    colliders,
    laneGate: gateAtTopOfLane,
    portcullis: shutter,
    targets,
    scoops: scoopList(shutters),
    lampCount: LAMPS.length,
    plungerRest: PLUNGER_REST,
    drainY: DRAIN_Y,
    laneX: LANE_X,
    pivots: { left: FLIPPER_PIVOT_LEFT, right: FLIPPER_PIVOT_RIGHT },
  };
}

/* Exported for the renderer, which places each piece of art from its collider. */
export const NOVA_ART = {
  station: {
    leftFace: STATION_LEFT_FACE,
    rightX: STATION_RIGHT_X,
    rightTop: STATION_RIGHT_TOP,
    bottom: STATION_BOTTOM,
    bayCentre: BAY_CENTRE,
    bayHalfWidth: BAY_HALF_WIDTH,
  },
  gantry: { left: GANTRY_LEFT, right: GANTRY_RIGHT },
  bumpers: BUMPER_CAPS,
  bumperRadius: BUMPER_RADIUS,
  targets: { y: TARGET_Y, spans: TARGET_SPANS },
  lamps: LAMPS,
  lampRadius: LAMP_RADIUS,
  scoops: [
    { centre: SCOOP_LEFT_CENTRE, radius: SCOOP_LEFT_R },
    { centre: SCOOP_RIGHT_CENTRE, radius: SCOOP_RIGHT_R },
  ],
  slings: [SLING_LEFT, SLING_RIGHT],
  walls: { left: [...LEFT_UPPER, ...LEFT_LOWER], right: RIGHT_LOWER },
} as const;
