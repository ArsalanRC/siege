import { describe, it, expect } from 'vitest';
import type { Game, GameEvent, Input } from '../src/engine/game.js';
import { createGame, stepGame, readout, NO_INPUT, BALLS_PER_GAME, PLUNGER_CHARGE_TIME } from '../src/engine/game.js';
import { TABLE_W, TABLE_H, DRAIN_Y, LANE_X } from '../src/engine/table.js';
import { BALL_RADIUS } from '../src/engine/physics.js';
import { vec } from '../src/engine/vec.js';

const DT = 1 / 120;

function press(over: Partial<Input>): Input {
  return { ...NO_INPUT, ...over };
}

/** Wind the plunger fully, then release it, and return the events that fell out. */
function launch(g: Game, charge = 1): GameEvent[] {
  const events: GameEvent[] = [];
  const holdFor = PLUNGER_CHARGE_TIME * charge;
  for (let t = 0; t < holdFor; t += DT) {
    events.push(...stepGame(g, press({ plunger: true }), DT));
  }
  events.push(...stepGame(g, NO_INPUT, DT));
  return events;
}

/** Run the game forward, optionally driving the flippers, collecting events. */
function run(g: Game, seconds: number, input: (t: number) => Input = () => NO_INPUT): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; t < seconds; t += DT) {
    events.push(...stepGame(g, input(t), DT));
  }
  return events;
}

/** A tiny reproducible generator, so a failing run can be replayed exactly. */
function rng(seed: number): () => number {
  let x = seed | 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  };
}

describe('starting a game', () => {
  it('parks a ball in the shooter lane with three to play', () => {
    const r = readout(createGame());
    expect(r.phase).toBe('ready');
    expect(r.score).toBe(0);
    expect(r.ballNumber).toBe(1);
    expect(r.ballsLeft).toBe(BALLS_PER_GAME);
    expect(r.siegeLevel).toBe(1);
    expect(r.gateOpen).toBe(false);
  });

  it('leaves the parked ball alone until the plunger is used', () => {
    const g = createGame();
    const start = g.ball.pos;
    run(g, 3);
    expect(g.ball.pos).toEqual(start);
    expect(readout(g).phase).toBe('ready');
  });
});

describe('the plunger', () => {
  it('winds up while held and fires on release', () => {
    const g = createGame();
    for (let t = 0; t < 0.5; t += DT) stepGame(g, press({ plunger: true }), DT);
    expect(readout(g).plungerCharge).toBeGreaterThan(0);
    expect(readout(g).phase).toBe('ready');

    stepGame(g, NO_INPUT, DT);
    expect(readout(g).phase).toBe('playing');
    expect(g.ball.vel.y).toBeLessThan(0);
  });

  it('sends the ball harder the longer it is held', () => {
    const soft = createGame();
    launch(soft, 0.1);
    const hard = createGame();
    launch(hard, 1);
    expect(Math.abs(hard.ball.vel.y)).toBeGreaterThan(Math.abs(soft.ball.vel.y));
  });

  it('caps the wind-up so holding forever is no better than holding a second', () => {
    const g = createGame();
    for (let t = 0; t < 8; t += DT) stepGame(g, press({ plunger: true }), DT);
    expect(readout(g).plungerCharge).toBe(1);
  });

  it('carries the ball up the lane and out onto the playfield', () => {
    const g = createGame();
    launch(g);
    run(g, 1.2);
    expect(g.ball.pos.x).toBeLessThan(LANE_X);
  });
});

describe('the ball stays on the table', () => {
  // The table geometry is written by hand, so a gap between two walls is a
  // typo rather than a physics failure, and it looks identical from the outside.
  it('never leaves the bounds over a long unattended ball', () => {
    const g = createGame();
    launch(g);
    for (let i = 0; i < 8000; i++) {
      stepGame(g, NO_INPUT, DT);
      expect(g.ball.pos.x).toBeGreaterThan(-BALL_RADIUS);
      expect(g.ball.pos.x).toBeLessThan(TABLE_W + BALL_RADIUS);
      expect(g.ball.pos.y).toBeGreaterThan(-BALL_RADIUS);
      expect(g.ball.pos.y).toBeLessThan(TABLE_H + BALL_RADIUS);
    }
  });

  it('stays inside while the flippers are being hammered', () => {
    const g = createGame();
    launch(g);
    const next = rng(0x51e6e);
    let left = false;
    let right = false;
    for (let i = 0; i < 12000; i++) {
      if (i % 12 === 0) {
        left = next() > 0.5;
        right = next() > 0.5;
      }
      stepGame(g, press({ left, right, plunger: true }), DT);
      expect(g.ball.pos.x).toBeGreaterThan(-BALL_RADIUS);
      expect(g.ball.pos.x).toBeLessThan(TABLE_W + BALL_RADIUS);
      expect(g.ball.pos.y).toBeGreaterThan(-BALL_RADIUS);
      expect(g.ball.pos.y).toBeLessThan(TABLE_H + BALL_RADIUS);
    }
  });

  it('never lets the ball come to rest somewhere it cannot leave', () => {
    // A flat horizontal wall is a permanent trap on a table seen from above,
    // and the castle roof was one. The ball settled on it and stayed, with
    // nothing thrown and nothing to see. Left alone, every ball must drain.
    for (const charge of [0.2, 0.5, 0.8, 1]) {
      const g = createGame();
      launch(g, charge);

      let drained = false;
      for (let i = 0; i < 7200 && !drained; i++) {
        drained = stepGame(g, NO_INPUT, DT).some((e) => e.kind === 'drain');
      }

      expect(drained, `a ball launched at ${charge} charge never drained`).toBe(true);
    }
  });

  it('does not let the ball dribble back down the shooter lane', () => {
    // The one-way gate exists for this. A ball that gets back into the lane
    // with no plunger left to hit it is a game that cannot continue.
    const g = createGame();
    launch(g);
    run(g, 6);
    if (readout(g).phase === 'playing') {
      const inLane = g.ball.pos.x > LANE_X && g.ball.pos.y > 600;
      expect(inLane).toBe(false);
    }
  });
});

describe('losing balls', () => {
  it('takes a ball away when it drains and serves the next one', () => {
    const g = createGame();
    g.phase = 'playing';
    g.ball = { pos: vec(470, DRAIN_Y + 5), vel: vec(0, 500), radius: BALL_RADIUS };
    const events = stepGame(g, NO_INPUT, DT);

    expect(events.some((e) => e.kind === 'drain')).toBe(true);
    expect(readout(g).ballsLeft).toBe(BALLS_PER_GAME - 1);
    expect(readout(g).ballNumber).toBe(2);

    run(g, 2);
    expect(readout(g).phase).toBe('ready');
  });

  it('ends the game after the last ball, and then stays ended', () => {
    const g = createGame();
    for (let i = 0; i < BALLS_PER_GAME; i++) {
      g.phase = 'playing';
      g.ball = { pos: vec(470, DRAIN_Y + 5), vel: vec(0, 500), radius: BALL_RADIUS };
      stepGame(g, NO_INPUT, DT);
      if (readout(g).phase === 'ballLost') run(g, 2);
    }
    expect(readout(g).phase).toBe('gameOver');

    const after = run(g, 5, () => press({ left: true, right: true, plunger: true }));
    expect(after).toHaveLength(0);
    expect(readout(g).phase).toBe('gameOver');
  });

  it('resets the siege when a ball is lost', () => {
    const g = createGame();
    g.phase = 'playing';
    g.siegeLevel = 4;
    g.gateOpen = true;
    g.targetsDown = [true, true, true];
    g.ball = { pos: vec(470, DRAIN_Y + 5), vel: vec(0, 500), radius: BALL_RADIUS };
    stepGame(g, NO_INPUT, DT);

    expect(readout(g).siegeLevel).toBe(1);
    expect(readout(g).gateOpen).toBe(false);
    expect(readout(g).targetsDown).toEqual([false, false, false]);
    expect(g.table.targets.every((t) => t.active)).toBe(true);
  });
});

describe('the siege', () => {
  function knockDown(g: Game, index: number): GameEvent[] {
    const target = g.table.targets[index]!;
    const seg = target.seg!;
    const midX = (seg.a.x + seg.b.x) / 2;
    g.phase = 'playing';
    g.ball = { pos: vec(midX, seg.a.y - BALL_RADIUS - 4), vel: vec(0, 1200), radius: BALL_RADIUS };
    return stepGame(g, NO_INPUT, DT);
  }

  it('drops a target when it is hit and scores it', () => {
    const g = createGame();
    const events = knockDown(g, 0);
    expect(events.some((e) => e.kind === 'target')).toBe(true);
    expect(readout(g).targetsDown[0]).toBe(true);
    expect(g.table.targets[0]!.active).toBe(false);
    expect(readout(g).score).toBeGreaterThan(0);
  });

  it('opens the gate only once all three are down', () => {
    const g = createGame();
    knockDown(g, 0);
    expect(readout(g).gateOpen).toBe(false);
    knockDown(g, 1);
    expect(readout(g).gateOpen).toBe(false);
    const events = knockDown(g, 2);
    expect(readout(g).gateOpen).toBe(true);
    expect(events.some((e) => e.kind === 'gateOpen')).toBe(true);
  });

  it('scores the same target once however many substeps it is touched for', () => {
    // Without the cooldown this scores forty times for one hit, and the score
    // becomes a measure of frame rate rather than of play.
    const g = createGame();
    const events = knockDown(g, 0);
    expect(events.filter((e) => e.kind === 'target')).toHaveLength(1);
  });

  /** Fire the ball up into the castle mouth from below it. */
  function shootTheGate(g: Game): GameEvent[] {
    g.phase = 'playing';
    g.ball = { pos: vec(470, 430), vel: vec(0, -900), radius: BALL_RADIUS };
    return run(g, 0.4);
  }

  it('bounces the ball off a shut portcullis instead of taking the keep', () => {
    // Assert on how far the ball got, not on where it is at some chosen moment.
    // It bounces off the gate, falls, and is thrown back up by the centre post,
    // so a snapshot of its velocity says different things at different times.
    const g = createGame();
    g.phase = 'playing';
    g.ball = { pos: vec(470, 430), vel: vec(0, -900), radius: BALL_RADIUS };

    const events: GameEvent[] = [];
    let highest = g.ball.pos.y;
    for (let t = 0; t < 3; t += DT) {
      events.push(...stepGame(g, NO_INPUT, DT));
      highest = Math.min(highest, g.ball.pos.y);
    }

    expect(events.some((e) => e.kind === 'keepTaken')).toBe(false);
    // The castle mouth is at 400. Never reached it, so never got inside.
    expect(highest).toBeGreaterThan(400);
  });

  it('takes the keep through an open gate, then stands the targets back up', () => {
    const g = createGame();
    g.gateOpen = true;
    g.targetsDown = [true, true, true];
    for (const t of g.table.targets) t.active = false;

    const events = shootTheGate(g);

    expect(events.some((e) => e.kind === 'keepTaken')).toBe(true);
    expect(readout(g).siegeLevel).toBe(2);
    expect(readout(g).gateOpen).toBe(false);
    expect(readout(g).targetsDown).toEqual([false, false, false]);
    expect(g.table.targets.every((t) => t.active)).toBe(true);
  });

  it('pays more for the keep at every level of the siege', () => {
    const first = createGame();
    first.gateOpen = true;
    shootTheGate(first);

    const later = createGame();
    later.gateOpen = true;
    later.siegeLevel = 3;
    shootTheGate(later);

    expect(first.score).toBeGreaterThan(0);
    expect(later.score).toBeGreaterThan(first.score * 2);
  });
});

describe('scoring surfaces', () => {
  it('scores bumpers and throws the ball back out', () => {
    const g = createGame();
    g.phase = 'playing';
    g.ball = { pos: vec(150, 300 - 42 - BALL_RADIUS - 2), vel: vec(0, 600), radius: BALL_RADIUS };
    const events = run(g, 0.2);
    expect(events.some((e) => e.kind === 'bumper')).toBe(true);
    expect(g.score).toBeGreaterThan(0);
  });

  it('does not let one bumper score every substep it is touched', () => {
    const g = createGame();
    g.phase = 'playing';
    g.ball = { pos: vec(150, 300 - 42 - BALL_RADIUS - 2), vel: vec(0, 600), radius: BALL_RADIUS };
    const events = run(g, 0.2);
    expect(events.filter((e) => e.kind === 'bumper').length).toBeLessThanOrEqual(2);
  });
});
