/**
 * The contract every board has to satisfy, run against every board there is.
 *
 * `game.test.ts` tests the castle and the rules on top of it. This file tests
 * the thing that has to be true of any playfield at all, and it loops over
 * `TABLE_IDS` so a third board is covered the day it is added rather than the
 * day somebody remembers to come back here.
 *
 * Every property below is one that was violated on the castle at some point and
 * found by playing rather than by a test. That is the whole reason they are
 * written as sweeps: a trap is not a wrong answer, it is a ball that stops, and
 * nothing asserts on a ball that stops unless something goes looking. The unit
 * suite was green through all twenty-one of them.
 */

import { describe, it, expect } from 'vitest';
import type { Game, GameEvent, Input } from '../src/engine/game.js';
import { createGame, stepGame, NO_INPUT, PLUNGER_CHARGE_TIME } from '../src/engine/game.js';
import { TABLE_IDS } from '../src/engine/tables/index.js';
import { TABLE_W, TABLE_H, BALL_ACROSS } from '../src/engine/table.js';
import { BALL_RADIUS } from '../src/engine/physics.js';
import { vec } from '../src/engine/vec.js';
import { flipperSegment, flipperTip } from '../src/engine/flipper.js';

const DT = 1 / 120;

function press(over: Partial<Input>): Input {
  return { ...NO_INPUT, ...over };
}

function launch(g: Game, charge = 1): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; t < PLUNGER_CHARGE_TIME * charge; t += DT) {
    events.push(...stepGame(g, press({ plunger: true }), DT));
  }
  events.push(...stepGame(g, NO_INPUT, DT));
  return events;
}

function rng(seed: number): () => number {
  let x = seed | 0;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  };
}

/**
 * Where a ball can actually be, by flood fill from the plunger.
 *
 * Needed because a board has sealed insides. The station on NOVA is hollow and
 * its base is level, so a ball dropped in there would rest on it forever, and a
 * grid sweep reports that as a trap. It is not one: the bay leads into a chamber
 * whose sides shut it off, so no ball can be in there at all.
 *
 * Deciding which grid reports to believe by eye is the judging-off-a-picture
 * habit this project exists to break, so reachability is computed instead. It
 * also turns "the hollow is sealed" from a claim into a measurement.
 */
function reachable(g: Game, step = 10): (x: number, y: number) => boolean {
  const solids = g.table.colliders.filter((c) => !c.sensor && c.active);
  const cols = Math.ceil(TABLE_W / step) + 1;
  // Stop at the drain line: past it the ball is gone, and running on lets the
  // fill round the bottom of the apron and come back up OUTSIDE the wall.
  const rows = Math.ceil(g.table.drainY / step) + 1;

  const clear = (x: number, y: number): boolean => {
    for (const c of solids) {
      if (c.type === 'circle' && c.circle) {
        if (Math.hypot(x - c.circle.c.x, y - c.circle.c.y) < c.circle.radius + BALL_RADIUS) return false;
      } else if (c.seg) {
        const { a, b, radius } = c.seg;
        const dx = b.x - a.x, dy = b.y - a.y;
        const l2 = dx * dx + dy * dy;
        const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
        if (Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)) < radius + BALL_RADIUS) return false;
      }
    }
    return true;
  };

  const seen = new Uint8Array(cols * rows);
  const stack: Array<[number, number]> = [
    [Math.round(g.table.plungerRest.x / step), Math.round(g.table.plungerRest.y / step)],
  ];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
    const k = j * cols + i;
    if (seen[k]) continue;
    if (!clear(i * step, j * step)) continue;
    seen[k] = 1;
    stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
  }

  return (x, y) => {
    const i = Math.round(x / step), j = Math.round(y / step);
    return i >= 0 && j >= 0 && i < cols && j < rows && seen[j * cols + i] === 1;
  };
}

/** True if the ball is sitting on a bat, which is the one place it may rest. */
function onAFlipper(g: Game): boolean {
  for (const f of [g.left, g.right]) {
    const s = flipperSegment(f);
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((g.ball.pos.x - s.a.x) * dx + (g.ball.pos.y - s.a.y) * dy) / l2));
    const d = Math.hypot(g.ball.pos.x - (s.a.x + t * dx), g.ball.pos.y - (s.a.y + t * dy));
    if (d <= BALL_RADIUS + f.radius + 6) return true;
  }
  return false;
}

/**
 * Park a still ball and report how far it moved over the last second.
 *
 * Displacement over a window, never speed at the final instant. Instantaneous
 * speed lies both ways: a ball bouncing hard around the corridor read as stuck
 * because the sample landed at the top of an arc at 10 units a second, and a
 * ball genuinely wedged can jitter above any threshold you pick.
 */
function dropAt(id: string, at: { x: number; y: number }, seconds = 12) {
  const g = createGame(id as never);
  g.phase = 'playing';
  g.ball = { ...g.ball, pos: vec(at.x, at.y), vel: vec(0, 1) };
  g.ballSave = 0;
  g.saveSpent = true;
  let drained = false;
  const recent: Array<{ x: number; y: number }> = [];
  for (let t = 0; t < seconds && !drained; t += DT) {
    drained = stepGame(g, NO_INPUT, DT).some((e) => e.kind === 'drain');
    recent.push({ x: g.ball.pos.x, y: g.ball.pos.y });
    if (recent.length > 120) recent.shift();
  }
  let travelled = 0;
  for (let i = 1; i < recent.length; i++) {
    travelled += Math.hypot(recent[i]!.x - recent[i - 1]!.x, recent[i]!.y - recent[i - 1]!.y);
  }
  return { g, drained, travelled };
}

describe.each(TABLE_IDS)('every board: %s', (id) => {
  it('serves a ball in the shooter lane and holds it there', () => {
    const g = createGame(id);
    expect(g.table.id).toBe(id);
    expect(g.ball.pos).toEqual(g.table.plungerRest);
    for (let t = 0; t < 3; t += DT) stepGame(g, NO_INPUT, DT);
    expect(g.ball.pos).toEqual(g.table.plungerRest);
  });

  it('passes a ball between the flipper tips rather than resting on both', () => {
    // At a bat length of 140 the clear gap measured 52.8 and the ball sat on
    // both tips at once and never fell through. The taper takes 9.4 off each
    // tip and both of those come out of the drain.
    const g = createGame(id);
    const left = flipperTip(g.left);
    const right = flipperTip(g.right);
    const tipRadius = g.left.radius * 0.36;
    const clear = Math.hypot(right.x - left.x, right.y - left.y) - tipRadius * 2;
    expect(clear, `drain between the tips is ${clear.toFixed(1)}`).toBeGreaterThan(BALL_ACROSS);
  });

  it('keeps a launched ball inside the board for a long unattended run', () => {
    const g = createGame(id);
    launch(g);
    for (let i = 0; i < 8000; i++) {
      stepGame(g, NO_INPUT, DT);
      expect(g.ball.pos.x).toBeGreaterThan(-BALL_RADIUS);
      expect(g.ball.pos.x).toBeLessThan(TABLE_W + BALL_RADIUS);
      expect(g.ball.pos.y).toBeGreaterThan(-BALL_RADIUS);
      expect(g.ball.pos.y).toBeLessThan(g.table.drainY + 120);
    }
  });

  it('keeps it inside while the flippers are hammered', () => {
    const g = createGame(id);
    launch(g);
    const next = rng(0x51e6e);
    let left = false, right = false;
    for (let i = 0; i < 12000; i++) {
      if (i % 12 === 0) { left = next() > 0.5; right = next() > 0.5; }
      stepGame(g, press({ left, right }), DT);
      expect(g.ball.pos.x).toBeGreaterThan(-BALL_RADIUS);
      expect(g.ball.pos.x).toBeLessThan(TABLE_W + BALL_RADIUS);
      expect(g.ball.pos.y).toBeGreaterThan(-BALL_RADIUS);
      expect(g.ball.pos.y).toBeLessThan(g.table.drainY + 120);
    }
  });

  it('has nowhere a ball can reach where a still ball is left', () => {
    const probe = reachable(createGame(id));
    const stuck: string[] = [];
    for (let x = 80; x <= 940; x += 20) {
      for (let y = 240; y <= 1340; y += 20) {
        if (!probe(x, y)) continue;
        const { g, drained, travelled } = dropAt(id, { x, y });
        if (drained || onAFlipper(g) || g.scoopHold !== null) continue;
        if (travelled > BALL_ACROSS) continue;
        stuck.push(`(${x}, ${y}) -> (${Math.round(g.ball.pos.x)}, ${Math.round(g.ball.pos.y)})`);
      }
    }
    expect(stuck, `balls came to rest off the flippers: ${stuck.join('; ')}`).toEqual([]);
  });

  it('always drains a ball left alone, whatever the launch strength', () => {
    // A flat horizontal wall is a permanent trap on a table seen from above,
    // and the castle roof was one. Left alone, every ball must drain.
    for (const charge of [0.2, 0.5, 0.8, 1]) {
      const g = createGame(id);
      launch(g, charge);
      let drained = false;
      for (let i = 0; i < 7200 && !drained; i++) {
        drained = stepGame(g, NO_INPUT, DT).some((e) => e.kind === 'drain');
      }
      expect(drained, `a ball launched at ${charge} charge never drained`).toBe(true);
    }
  });

  it('finishes a randomly played game rather than looping forever', () => {
    // NOVA failed this on its first build, and the total said nothing: sixteen
    // of sixty soaked games never reached game over, with the ball circulating
    // between the bumpers and the corridor above them. The gantry fell towards
    // the nest, the nest threw the ball back up, and the corridor handed it
    // back. Turning the gantry round gave the loop an exit.
    for (const seed of [0x51e6e, 0xa11ce, 0x7ab1e]) {
      const g = createGame(id);
      const next = rng(seed);
      launch(g, 0.3 + next() * 0.7);
      let left = false, right = false, over = false;
      for (let i = 0; i < 40000 && !over; i++) {
        if (i % 10 === 0) { left = next() > 0.45; right = next() > 0.45; }
        // Pulsed, never held: the plunger fires on RELEASE, so a held plunger
        // leaves every ball after the first sitting fully wound in the lane.
        const plunger = (i % 240) < 180;
        over = stepGame(g, press({ left, right, plunger }), DT).some((e) => e.kind === 'gameOver');
      }
      const at = `(${Math.round(g.ball.pos.x)}, ${Math.round(g.ball.pos.y)})`;
      expect(over, `seed ${seed.toString(16)}: never reached game over, ball at ${at}`).toBe(true);
    }
  });

  it('does not let the ball dribble back down the shooter lane', () => {
    const g = createGame(id);
    launch(g);
    for (let t = 0; t < 6; t += DT) stepGame(g, NO_INPUT, DT);
    if (g.phase === 'playing') {
      expect(g.ball.pos.x > g.table.laneX && g.ball.pos.y > 600).toBe(false);
    }
  });

  it('can be caught by BOTH scoops, counted per side', () => {
    // The castle's right scoop was sealed by a throat wired as a cross, and the
    // total across both said 67 catches, which reads as a working feature.
    // Split by side it was 67 and nought, and it was reported from play before
    // any test found it. So this counts each bowl separately, always.
    const caught = new Map<string, number>();
    const fired = new Map<string, number>();
    for (let x = 220; x <= 800; x += 96) {
      for (let y = 620; y <= 1240; y += 124) {
        for (let a = 0; a < 12; a++) {
          const angle = (a / 12) * Math.PI * 2;
          const g = createGame(id);
          g.phase = 'playing';
          g.ballSave = 0;
          g.saveSpent = true;
          g.ball = { ...g.ball, pos: vec(x, y), vel: vec(Math.cos(angle) * 5200, Math.sin(angle) * 5200) };
          let drained = false;
          for (let t = 0; t < 5 && !drained; t += DT) {
            for (const e of stepGame(g, NO_INPUT, DT)) {
              if (e.kind === 'drain') drained = true;
              const side = e.kind === 'scoopCaught' || e.kind === 'scoopFired'
                ? (e.at.x < TABLE_W / 2 ? 'left' : 'right') : '';
              if (e.kind === 'scoopCaught') caught.set(side, (caught.get(side) ?? 0) + 1);
              if (e.kind === 'scoopFired') fired.set(side, (fired.get(side) ?? 0) + 1);
            }
          }
        }
      }
    }
    for (const side of ['left', 'right']) {
      expect(caught.get(side) ?? 0, `nothing ever entered the ${side} scoop`).toBeGreaterThan(0);
      // A hole that takes the ball and does not give it back is the one shape
      // this engine has spent thirteen bugs learning to avoid.
      expect(fired.get(side) ?? 0, `the ${side} scoop never let a ball go`).toBeGreaterThan(0);
    }
  });

  it('opens its gate on the targets and pays for the shot through it', () => {
    const g = createGame(id);
    for (let i = 0; i < g.table.targets.length; i++) {
      const seg = g.table.targets[i]!.seg!;
      g.phase = 'playing';
      g.ball = {
        pos: vec((seg.a.x + seg.b.x) / 2, seg.a.y - BALL_RADIUS - 4),
        vel: vec(0, 1200),
        radius: BALL_RADIUS,
      };
      stepGame(g, NO_INPUT, DT);
    }
    expect(g.gateOpen, 'all targets down did not open the gate').toBe(true);

    const mouth = g.table.portcullis.seg!;
    g.phase = 'playing';
    g.ball = { pos: vec((mouth.a.x + mouth.b.x) / 2, mouth.a.y + 40), vel: vec(0, -900), radius: BALL_RADIUS };
    const events: GameEvent[] = [];
    for (let t = 0; t < 0.5; t += DT) events.push(...stepGame(g, NO_INPUT, DT));
    expect(events.some((e) => e.kind === 'keepTaken'), 'an open gate did not pay').toBe(true);
  });

  it('is the same size as every other board, so the physics transfers', () => {
    const g = createGame(id);
    expect(g.table.drainY).toBeGreaterThan(TABLE_H - 100);
    expect(g.table.plungerRest.x).toBeGreaterThan(g.table.laneX);
    expect(g.table.pivots.left.x).toBeLessThan(g.table.pivots.right.x);
    expect(g.table.lampCount).toBeGreaterThan(0);
    expect(g.table.scoops).toHaveLength(2);
  });
});
