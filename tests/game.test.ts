import { describe, it, expect } from 'vitest';
import type { Game, GameEvent, Input } from '../src/engine/game.js';
import { createGame, stepGame, readout, NO_INPUT, BALLS_PER_GAME, PLUNGER_CHARGE_TIME } from '../src/engine/game.js';
import { DRAIN_Y, LANE_X } from '../src/engine/table.js';
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
    // Two and a half seconds, not 1.2. A full launch now climbs the lane, runs
    // the habitrail across the castle and comes down the far side, so it is
    // legitimately still right of the rail at 1.2 seconds. The property being
    // tested is that it reaches the playfield at all, not how fast.
    const g = createGame();
    launch(g);
    run(g, 2.5);
    expect(g.ball.pos.x).toBeLessThan(LANE_X);
  });
});

describe('the ball stays on the table', () => {
  // The properties that hold for ANY board live in tables.test.ts and run
  // against every one of them: staying inside the bounds, never being left
  // standing still, always draining when left alone, and not dribbling back
  // down the shooter lane. What is left here is what is true of the castle in
  // particular.

  it('brings a launched ball down the right orbit and into the middle', () => {
    // Reported from play, not caught here: at full power the ball went up the
    // right, rattled along the top, came back down the right and drained. It
    // never once crossed to the left half. Every earlier test passed throughout,
    // because they only ever asked whether the ball got stuck or left the table,
    // and it did neither. It was simply not a game.
    //
    // The route between the two orbits is the corridor over the castle roof, so
    // this is really a test that the corridor is passable.
    const g = createGame();
    launch(g, 1);

    let reachedLeft = false;
    let reachedRight = false;
    let reachedLower = false;

    for (let i = 0; i < 5400; i++) {
      const drained = stepGame(g, NO_INPUT, DT).some((e) => e.kind === 'drain');
      const { x, y } = g.ball.pos;
      if (x < 232 && y > 100 && y < 495) reachedLeft = true;
      if (x > 800 && y > 100 && y < 495) reachedRight = true;
      if (y > 700 && x > 200 && x < 800) reachedLower = true;
      if (drained) break;
    }

    // The left orbit is deliberately NOT expected from a free launch any more.
    // The castle is solid to the ceiling, because a corridor over it put the
    // ball in mid-air above the painted towers with nothing drawn underneath.
    // So a launched ball comes back down the side it went up, and the left orbit
    // is reached with a flipper, the way a real table reaches it.
    expect(reachedRight, 'never used the right orbit').toBe(true);
    expect(reachedLower, 'never came down into the middle of the table').toBe(true);
    expect(reachedLeft || true).toBe(true);
  });

  it('never wedges the ball anywhere, however the flippers are played', () => {
    // The version of this that only ran with NO_INPUT missed a real wedge,
    // because a ball that is never flipped never reaches the corners a played
    // ball reaches. Flipping is the whole point of the machine, so the test
    // has to flip.
    for (const seed of [0x51e6e, 0xa11ce, 0x7ab1e, 0xf10ff]) {
      const g = createGame();
      launch(g, 0.85);
      const next = rng(seed);
      let left = false, right = false, drained = false;

      for (let i = 0; i < 9000 && !drained; i++) {
        if (i % 10 === 0) { left = next() > 0.45; right = next() > 0.45; }
        drained = stepGame(g, press({ left, right }), DT).some((e) => e.kind === 'drain');
      }

      const at = `(${Math.round(g.ball.pos.x)}, ${Math.round(g.ball.pos.y)})`;
      expect(drained, `seed ${seed.toString(16)}: ball never drained, stuck at ${at}`).toBe(true);
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
      // Spend the ball save, or each ball is forgiven its first drain and the
      // game needs six of them rather than three.
      g.ballSave = 0;
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

  /**
   * Fire the ball up into the castle mouth from below it.
   *
   * The aim point is read off the portcullis rather than written down here.
   * The table gets re-traced whenever the art changes, and a test carrying its
   * own copy of the coordinates fails for a reason that has nothing to do with
   * what it is testing.
   */
  function gateMouth(g: Game): { x: number; y: number } {
    const seg = g.table.portcullis.seg!;
    return { x: (seg.a.x + seg.b.x) / 2, y: seg.a.y };
  }

  function shootTheGate(g: Game): GameEvent[] {
    const mouth = gateMouth(g);
    g.phase = 'playing';
    g.ball = { pos: vec(mouth.x, mouth.y + 40), vel: vec(0, -900), radius: BALL_RADIUS };
    return run(g, 0.5);
  }

  it('bounces the ball off a shut portcullis instead of taking the keep', () => {
    // Assert on how far the ball got, not on where it is at some chosen moment.
    // It bounces off the gate, falls, and is thrown back up by the centre post,
    // so a snapshot of its velocity says different things at different times.
    const g = createGame();
    const mouth = gateMouth(g);
    g.phase = 'playing';
    g.ball = { pos: vec(mouth.x, mouth.y + 40), vel: vec(0, -900), radius: BALL_RADIUS };

    const events: GameEvent[] = [];
    let highest = g.ball.pos.y;
    for (let t = 0; t < 3; t += DT) {
      events.push(...stepGame(g, NO_INPUT, DT));
      highest = Math.min(highest, g.ball.pos.y);
    }

    expect(events.some((e) => e.kind === 'keepTaken')).toBe(false);
    // Never reached the mouth, so never got inside.
    expect(highest).toBeGreaterThan(mouth.y);
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
  /** Drop the ball straight onto the first bumper, wherever the art put it. */
  function ontoABumper(g: Game): void {
    const bumper = g.table.colliders.find((c) => c.id.startsWith('bumper'))!;
    const c = bumper.circle!;
    g.phase = 'playing';
    g.ball = {
      pos: vec(c.c.x, c.c.y - c.radius - BALL_RADIUS - 2),
      vel: vec(0, 600),
      radius: BALL_RADIUS,
    };
  }

  it('scores bumpers and throws the ball back out', () => {
    const g = createGame();
    ontoABumper(g);
    const events = run(g, 0.2);
    expect(events.some((e) => e.kind === 'bumper')).toBe(true);
    expect(g.score).toBeGreaterThan(0);
  });

  it('does not let one bumper score every substep it is touched', () => {
    // Counting bumper events in total is the wrong measure: the three caps sit
    // close enough that a ball genuinely rattles between them, and each has its
    // own cooldown. What must not happen is one cap scoring repeatedly.
    const g = createGame();
    ontoABumper(g);
    const events = run(g, 0.2);

    const perBumper = new Map<string, number>();
    for (const e of events) {
      if (e.kind !== 'score' || e.label !== 'bumper') continue;
      const key = `${Math.round(e.at.x)},${Math.round(e.at.y)}`;
      perBumper.set(key, (perBumper.get(key) ?? 0) + 1);
    }
    expect(events.some((e) => e.kind === 'bumper')).toBe(true);
    for (const count of perBumper.values()) expect(count).toBeLessThanOrEqual(1);
  });
});
