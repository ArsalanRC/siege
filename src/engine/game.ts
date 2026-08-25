/**
 * The game on top of the physics: three balls, a score, and a reason to aim.
 *
 * The physics knows nothing about any of this. It reports that the ball touched
 * something with an id and how hard, and everything here is a reading of that.
 * Keeping the split that clean is what lets a whole game be played out in a test
 * with no canvas anywhere.
 *
 * ## The siege
 *
 * Knock down all three targets and the castle gate opens. Shoot the open gate
 * and you take the keep, which scores, resets the targets and raises the siege
 * level. Every level is worth more than the last, so the table has a reason to
 * keep being played rather than a score that creeps up at a constant rate.
 *
 * ## Debouncing, and why it is not optional
 *
 * A substep is a fraction of a millisecond and a ball overlaps a sensor for
 * many of them. Without a cooldown, one pass through an inlane scores it forty
 * times, and the score becomes a measure of frame rate rather than of play.
 * Every scoring surface therefore has a cooldown, and the physics reporting a
 * hit is treated as "the ball is here", not "score this now".
 */

import type { Vec } from './vec.js';
import { vec, len } from './vec.js';
import type { Ball, Hit, World, Collider } from './physics.js';
import { step as stepPhysics, BALL_RADIUS, GRAVITY } from './physics.js';
import type { Flipper } from './flipper.js';
import { createFlipper, stepFlipper, flipperCollider } from './flipper.js';
import type { Table } from './table.js';
import { buildTable, DRAIN_Y, LANE_X, PLUNGER_REST, FLIPPER_PIVOT_LEFT, FLIPPER_PIVOT_RIGHT } from './table.js';

export const BALLS_PER_GAME = 3;

/**
 * Seconds of ball save from each launch.
 *
 * A drain inside this window returns the ball instead of taking it. Real
 * machines do this, and this table needs it more than most: the first thing a
 * new player does is launch, watch the ball go somewhere they had no chance of
 * reading, and lose it. Three balls of that is not a game, it is a slot machine
 * with worse odds.
 */
export const BALL_SAVE_SECONDS = 8;

/** Rolling resistance on the wood, per second. Tuned so a slow ball still drifts. */
const DRAG = 0.22;

/** Seconds a scoring surface ignores further hits after one counts. */
const COOLDOWN = 0.25;

/** Longer for targets, which are struck hard and can rattle. */
const TARGET_COOLDOWN = 0.4;

/** Slowest and fastest a full plunger pull can launch, in units per second. */
const PLUNGER_MIN = 3400;
const PLUNGER_MAX = 7200;

/** A full pull takes this long to wind up. */
export const PLUNGER_CHARGE_TIME = 1.1;

export type Phase = 'ready' | 'playing' | 'ballLost' | 'gameOver';

export type GameEvent =
  | { kind: 'score'; amount: number; at: Vec; label: string }
  | { kind: 'bumper'; at: Vec }
  | { kind: 'sling'; at: Vec }
  | { kind: 'target'; index: number }
  | { kind: 'gateOpen' }
  | { kind: 'keepTaken'; level: number }
  | { kind: 'drain' }
  | { kind: 'ballSaved' }
  | { kind: 'gameOver'; score: number };

export interface Input {
  readonly left: boolean;
  readonly right: boolean;
  /** Held to wind the plunger, released to fire. Only read while `ready`. */
  readonly plunger: boolean;
}

export const NO_INPUT: Input = { left: false, right: false, plunger: false };

export interface Game {
  table: Table;
  ball: Ball;
  left: Flipper;
  right: Flipper;
  phase: Phase;
  score: number;
  ballNumber: number;
  ballsLeft: number;
  /** How many of the three targets are down. */
  targetsDown: boolean[];
  gateOpen: boolean;
  siegeLevel: number;
  plungerCharge: number;
  /** Seconds remaining before each id can score again. */
  cooldowns: Map<string, number>;
  /** Counts down while the ball is lost, before the next one is served. */
  serveDelay: number;
  /** Seconds of ball save left on this ball. A drain inside it is forgiven. */
  ballSave: number;
  /** Whether this ball has already used its save. One per ball, not per serve. */
  saveSpent: boolean;
}

export function createGame(): Game {
  const table = buildTable();
  return {
    table,
    ball: { pos: PLUNGER_REST, vel: vec(0, 0), radius: BALL_RADIUS },
    left: createFlipper('left', FLIPPER_PIVOT_LEFT),
    right: createFlipper('right', FLIPPER_PIVOT_RIGHT),
    phase: 'ready',
    score: 0,
    ballNumber: 1,
    ballsLeft: BALLS_PER_GAME,
    targetsDown: [false, false, false],
    gateOpen: false,
    siegeLevel: 1,
    plungerCharge: 0,
    cooldowns: new Map(),
    serveDelay: 0,
    ballSave: 0,
    saveSpent: false,
  };
}

/** Park a fresh ball in the shooter lane and wait for the plunger. */
function serve(g: Game): void {
  g.ball = { pos: PLUNGER_REST, vel: vec(0, 0), radius: BALL_RADIUS };
  g.plungerCharge = 0;
  g.phase = 'ready';
  g.cooldowns.clear();
  // One save per ball, not per serve. Granting it on every serve made the save
  // return a saved ball with a fresh save, so the ball could never be lost: a
  // measured run took 79 saves and the game simply never ended.
  g.ballSave = g.saveSpent ? 0 : BALL_SAVE_SECONDS;
}

/** True if this id may score right now, and starts its cooldown if so. */
function claim(g: Game, id: string, seconds = COOLDOWN): boolean {
  if ((g.cooldowns.get(id) ?? 0) > 0) return false;
  g.cooldowns.set(id, seconds);
  return true;
}

function tickCooldowns(g: Game, dt: number): void {
  for (const [key, value] of g.cooldowns) {
    const next = value - dt;
    if (next <= 0) g.cooldowns.delete(key);
    else g.cooldowns.set(key, next);
  }
}

function award(g: Game, events: GameEvent[], amount: number, at: Vec, label: string): void {
  g.score += amount;
  events.push({ kind: 'score', amount, at, label });
}

/**
 * Open the gate once every target is down.
 *
 * The targets stay down until the keep is taken, so the player can see at a
 * glance that the shot is available. Resetting them the moment the gate opened
 * would leave nothing on the table saying why.
 */
function checkTargets(g: Game, events: GameEvent[]): void {
  if (g.gateOpen) return;
  if (!g.targetsDown.every(Boolean)) return;
  g.gateOpen = true;
  events.push({ kind: 'gateOpen' });
}

/** Taking the keep: score it, stand the targets back up, raise the siege. */
function takeKeep(g: Game, events: GameEvent[], at: Vec): void {
  const value = 10000 * g.siegeLevel;
  award(g, events, value, at, `keep ${g.siegeLevel}`);
  events.push({ kind: 'keepTaken', level: g.siegeLevel });
  g.siegeLevel += 1;
  g.gateOpen = false;
  g.targetsDown = [false, false, false];
  for (const t of g.table.targets) t.active = true;
}

/**
 * Turn one frame of physics hits into score.
 *
 * A hit on a drop target both scores and switches the target off, which is the
 * only place the game reaches back into the collider list. Everything else here
 * only reads.
 */
function applyHits(g: Game, hits: readonly Hit[], events: GameEvent[]): void {
  for (const hit of hits) {
    if (hit.id.startsWith('bumper')) {
      if (!claim(g, hit.id)) continue;
      award(g, events, 100 * g.siegeLevel, hit.point, 'bumper');
      events.push({ kind: 'bumper', at: hit.point });
      continue;
    }

    if (hit.id.startsWith('sling')) {
      if (!claim(g, hit.id)) continue;
      award(g, events, 50, hit.point, 'sling');
      events.push({ kind: 'sling', at: hit.point });
      continue;
    }

    if (hit.id.startsWith('target-')) {
      if (!claim(g, hit.id, TARGET_COOLDOWN)) continue;
      const index = Number(hit.id.slice('target-'.length));
      if (!Number.isInteger(index) || index < 0 || index >= g.targetsDown.length) continue;
      if (g.targetsDown[index]) continue;

      g.targetsDown[index] = true;
      const collider = g.table.targets[index];
      if (collider) collider.active = false;

      award(g, events, 500, hit.point, 'target');
      events.push({ kind: 'target', index });
      checkTargets(g, events);
      continue;
    }

    if (hit.id === 'gate') {
      // The portcullis should already have kept the ball out with the gate
      // shut. This guard stays anyway: it costs one comparison, and without it
      // any future hole in that geometry becomes free points rather than a bug
      // somebody notices.
      if (!g.gateOpen) continue;
      if (!claim(g, 'gate', 1)) continue;
      takeKeep(g, events, hit.point);
      continue;
    }

    if (hit.id.startsWith('inlane')) {
      if (!claim(g, hit.id, 0.6)) continue;
      award(g, events, 250 * g.siegeLevel, hit.point, 'inlane');
      continue;
    }

    if (hit.id.startsWith('outlane')) {
      if (!claim(g, hit.id, 0.6)) continue;
      award(g, events, 100, hit.point, 'outlane');
      continue;
    }
  }
}

/**
 * The two gates that are solid only some of the time.
 *
 * The **lane gate** is solid whenever the ball is out on the playfield, which
 * stops a ball rolling back down the shooter lane and sitting there with no
 * plunger left to move it. It is open while the ball is still in the lane, so
 * it never blocks the launch.
 *
 * The **portcullis** is solid until all three targets are down. A ball shot at
 * a shut castle bounces off it, which is the table saying no in a way the
 * player can see and hear.
 */
function updateGates(g: Game): void {
  // A real one-way gate: open ONLY while the ball is inside the lane and still
  // travelling upward. Every other moment it is solid.
  //
  // Keying it on position alone was not enough. A ball fired up a straight lane
  // comes straight back down the same lane, never crosses onto the playfield,
  // and drains in a second and a half having been unplayable. Now the gate is
  // solid on the way back down, and since it is angled the ball is turned out
  // onto the table instead, which is what the curved exit does on a real
  // machine.
  const climbingTheLane = g.ball.pos.x > LANE_X && g.ball.vel.y < 0;
  g.table.laneGate.active = !climbingTheLane;
  g.table.portcullis.active = !g.gateOpen;
}

function buildWorld(g: Game): World {
  return {
    colliders: g.table.colliders,
    moving: [flipperCollider(g.left), flipperCollider(g.right)],
    gravity: GRAVITY,
    drag: DRAG,
  };
}

/** Wind the plunger while held, fire it on release. */
function updatePlunger(g: Game, input: Input, dt: number): void {
  if (g.phase !== 'ready') return;

  if (input.plunger) {
    g.plungerCharge = Math.min(1, g.plungerCharge + dt / PLUNGER_CHARGE_TIME);
    return;
  }

  if (g.plungerCharge <= 0) return;

  const speed = PLUNGER_MIN + (PLUNGER_MAX - PLUNGER_MIN) * g.plungerCharge;
  g.ball = { ...g.ball, vel: vec(0, -speed) };
  g.plungerCharge = 0;
  g.phase = 'playing';
}

/** Lost down the middle, or out of a side lane. */
function checkDrain(g: Game, events: GameEvent[]): void {
  if (g.ball.pos.y <= DRAIN_Y) return;

  // Saved. The ball comes straight back and nothing else about the game moves:
  // same ball number, same siege level, same targets. Only the save is spent.
  if (g.ballSave > 0) {
    g.ballSave = 0;
    g.saveSpent = true;
    events.push({ kind: 'ballSaved' });
    g.phase = 'ballLost';
    g.serveDelay = 0.7;
    return;
  }

  events.push({ kind: 'drain' });
  g.ballsLeft -= 1;

  if (g.ballsLeft <= 0) {
    g.phase = 'gameOver';
    events.push({ kind: 'gameOver', score: g.score });
    return;
  }

  g.ballNumber += 1;
  g.saveSpent = false;
  g.gateOpen = false;
  g.siegeLevel = 1;
  g.targetsDown = [false, false, false];
  for (const t of g.table.targets) t.active = true;
  g.phase = 'ballLost';
  g.serveDelay = 1.2;
}

/**
 * Advance the whole game one frame.
 *
 * Returns the events the frame produced, which is everything the renderer and
 * the sound need. It never returns the state, because the state is the object
 * that was passed in and it has been updated in place.
 */
export function stepGame(g: Game, input: Input, dt: number): GameEvent[] {
  const events: GameEvent[] = [];

  if (g.phase === 'gameOver') return events;

  tickCooldowns(g, dt);

  // Flippers move whatever else is happening, so the player can flap them while
  // waiting for a ball. It costs nothing and a still table feels broken.
  g.left = stepFlipper(g.left, input.left, dt);
  g.right = stepFlipper(g.right, input.right, dt);

  if (g.phase === 'playing' && g.ballSave > 0) g.ballSave = Math.max(0, g.ballSave - dt);

  if (g.phase === 'ballLost') {
    g.serveDelay -= dt;
    if (g.serveDelay <= 0) serve(g);
    return events;
  }

  updatePlunger(g, input, dt);
  updateGates(g);

  // A parked ball is not simulated. Gravity would otherwise roll it out of the
  // shooter lane before the player has touched anything.
  if (g.phase === 'ready' && len(g.ball.vel) === 0) return events;

  const result = stepPhysics(g.ball, buildWorld(g), dt);
  g.ball = result.ball;

  applyHits(g, result.hits, events);
  checkDrain(g, events);

  return events;
}

/** Everything a scoreboard needs, without handing out the mutable game object. */
export interface Readout {
  readonly score: number;
  readonly ballNumber: number;
  readonly ballsLeft: number;
  readonly siegeLevel: number;
  readonly gateOpen: boolean;
  readonly targetsDown: readonly boolean[];
  readonly phase: Phase;
  readonly plungerCharge: number;
  /** Seconds of ball save left, for the scoreboard to show. */
  readonly ballSave: number;
}

export function readout(g: Game): Readout {
  return {
    score: g.score,
    ballNumber: g.ballNumber,
    ballsLeft: g.ballsLeft,
    siegeLevel: g.siegeLevel,
    gateOpen: g.gateOpen,
    targetsDown: [...g.targetsDown],
    phase: g.phase,
    plungerCharge: g.plungerCharge,
    ballSave: g.ballSave,
  };
}

export type { Collider };
