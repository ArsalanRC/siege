/**
 * Drive a board hard and report what it does. The harnesses, kept.
 *
 *     pnpm build:site && node tools/sweep.mjs [id] [which...]
 *     node tools/sweep.mjs nova drop reach soak
 *
 * Three of these paid for themselves many times over on the castle, and the
 * reason they exist rather than more unit tests is blunt: the unit suite was
 * green through every single one of twenty-one ball traps. A trap is not a wrong
 * answer, it is a ball that stops, and nothing asserts on a ball that stops
 * unless something goes looking.
 *
 * - **drop**  park a still ball on a grid over the whole playfield and ask
 *             whether it ever gets out. This is the trap finder.
 * - **reach** fire from a spread of points in every direction and count what
 *             gets hit, which is the only way to prove a scoop or a lane is
 *             reachable at all. The castle's right scoop took 2772 launches to
 *             prove unreachable: 67 caught left, 0 right.
 * - **soak**  randomised full games, reporting any that never reach game over,
 *             plus an event tally so you can see whether a feature is ever used.
 *
 * Everything here reads the table it is given. Nothing is written down twice.
 */

import { createGame, stepGame } from '../site/lib/engine/game.js';
import { BALL_RADIUS } from '../site/lib/engine/physics.js';
import { flipperSegment } from '../site/lib/engine/flipper.js';
import { TABLE_IDS } from '../site/lib/engine/tables/index.js';

const DT = 1 / 120;
const NO_INPUT = { left: false, right: false, plunger: false };

const id = process.argv[2] ?? 'siege';
const which = process.argv.slice(3);
const run = (name) => which.length === 0 || which.includes(name);

if (!TABLE_IDS.includes(id)) {
  console.error(`no such table: ${id}. known: ${TABLE_IDS.join(', ')}`);
  process.exit(2);
}

function rng(seed) {
  let x = seed | 0;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  };
}

function launch(g, charge = 1) {
  const events = [];
  for (let t = 0; t < 1.1 * charge; t += DT) events.push(...stepGame(g, { ...NO_INPUT, plunger: true }, DT));
  events.push(...stepGame(g, NO_INPUT, DT));
  return events;
}

/** True if the ball is sitting on a bat, which is the one place it may rest. */
function onAFlipper(g) {
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

/** What the stopped ball is touching, near misses included, so a trap explains itself. */
function touching(g, slack = 3) {
  const out = [];
  const p = g.ball.pos;
  for (const c of g.table.colliders) {
    if (c.sensor) continue;
    let d = Infinity;
    if (c.type === 'circle' && c.circle) {
      d = Math.hypot(p.x - c.circle.c.x, p.y - c.circle.c.y) - c.circle.radius;
    } else if (c.seg) {
      const { a, b, radius } = c.seg;
      const dx = b.x - a.x, dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) - radius;
    }
    if (d - BALL_RADIUS <= slack) out.push(`${c.id}@${(d - BALL_RADIUS).toFixed(1)}`);
  }
  return out;
}

/**
 * Which parts of the board a ball can actually be in, by flood fill.
 *
 * Without this the drop sweep reports the inside of the station as a trap, and
 * it is right that a ball in there would never get out: the base is level and a
 * level surface the ball can land on top of is permanent. But no ball can be in
 * there, because the bay leads into a chamber whose sides seal it off from the
 * rest of the hollow.
 *
 * Reporting it anyway means reading 300 lines of output and deciding by eye
 * which entries are real, which is the judging-off-a-picture habit this whole
 * project exists to break. So reachability is computed instead: a cell is open
 * if a ball centred there overlaps nothing solid, and the fill starts from the
 * plunger. Anything the fill does not reach is not a trap, it is somewhere no
 * ball can be, and this also proves the station's hollow is sealed.
 */
function reachable(step = 10) {
  const g = createGame(id);
  const solids = g.table.colliders.filter((c) => !c.sensor && c.active);
  const cols = Math.ceil(1024 / step) + 1;
  // Stop at the drain line. Past it the ball is gone, and letting the fill run
  // on lets it round the bottom of the apron and come back up the OUTSIDE of the
  // playfield wall, which marks the whole sealed left pocket reachable. That is
  // a leak in the tool, not in the board.
  const rows = Math.ceil(g.table.drainY / step) + 1;

  const clear = (x, y) => {
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

  const open = new Uint8Array(cols * rows);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) open[j * cols + i] = clear(i * step, j * step) ? 1 : 0;
  }

  const seen = new Uint8Array(cols * rows);
  const start = [Math.round(g.table.plungerRest.x / step), Math.round(g.table.plungerRest.y / step)];
  const stack = [start];
  while (stack.length) {
    const [i, j] = stack.pop();
    if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
    const k = j * cols + i;
    if (seen[k] || !open[k]) continue;
    seen[k] = 1;
    stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
  }

  return (x, y) => {
    const i = Math.round(x / step), j = Math.round(y / step);
    return i >= 0 && j >= 0 && i < cols && j < rows && seen[j * cols + i] === 1;
  };
}

/**
 * Park a still ball and report whether it ever gets out.
 *
 * Twelve seconds, not five, so a ball waiting on a scoop's eight second reload
 * is not mistaken for a ball that has stopped.
 *
 * Stuck is measured as **how far it moved over the last second**, not as its
 * speed at the final instant. Instantaneous speed lies in both directions: a
 * ball bouncing hard around the corridor was reported stuck because the sample
 * landed at the top of one of its arcs, at 10 units a second, and a ball
 * genuinely wedged can jitter above any speed threshold you pick. Displacement
 * over a window cannot be fooled by either.
 */
function drop(at, seconds = 12) {
  const g = createGame(id);
  g.phase = 'playing';
  g.ball = { ...g.ball, pos: { x: at.x, y: at.y }, vel: { x: 0, y: 1 } };
  g.ballSave = 0;
  g.saveSpent = true;
  let drained = false;
  const recent = [];
  for (let t = 0; t < seconds && !drained; t += DT) {
    drained = stepGame(g, NO_INPUT, DT).some((e) => e.kind === 'drain');
    recent.push({ x: g.ball.pos.x, y: g.ball.pos.y });
    if (recent.length > 120) recent.shift();
  }
  let travelled = 0;
  for (let i = 1; i < recent.length; i++) {
    travelled += Math.hypot(recent[i].x - recent[i - 1].x, recent[i].y - recent[i - 1].y);
  }
  return { g, drained, travelled };
}

/* ------------------------------------------------------------------ */

if (run('drop')) {
  console.log(`\n=== drop: a still ball on a grid over ${id}, does it get out ===`);
  const canBeAt = reachable();
  const stuck = [];
  let tried = 0;
  let sealed = 0;
  for (let x = 80; x <= 940; x += 20) {
    for (let y = 240; y <= 1340; y += 20) {
      if (!canBeAt(x, y)) { sealed += 1; continue; }
      tried += 1;
      const { g, drained, travelled } = drop({ x, y });
      if (drained || onAFlipper(g) || g.scoopHold !== null) continue;
      // Moved more than a ball's width over the last second, so it is still in
      // play whatever its speed happened to be at the final sample.
      if (travelled > 54) continue;
      stuck.push({ from: [x, y], at: [Math.round(g.ball.pos.x), Math.round(g.ball.pos.y)], on: touching(g) });
    }
  }
  console.log(`  ${tried} reachable starts, ${sealed} skipped as sealed or solid`);
  console.log(`  ${stuck.length} came to rest off a bat`);
  const seen = new Set();
  for (const s of stuck) {
    const key = `${s.at[0]},${s.at[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  from (${s.from}) -> rests at (${s.at})  touching: ${s.on.join(' ') || 'nothing'}`);
  }
}

if (run('reach')) {
  console.log(`\n=== reach: what a ball fired from all over ${id} actually finds ===`);
  const tally = new Map();
  let shots = 0;
  for (let x = 220; x <= 800; x += 60) {
    for (let y = 560; y <= 1280; y += 90) {
      for (let a = 0; a < 14; a++) {
        const angle = (a / 14) * Math.PI * 2;
        const g = createGame(id);
        g.phase = 'playing';
        g.ballSave = 0;
        g.saveSpent = true;
        g.ball = { ...g.ball, pos: { x, y }, vel: { x: Math.cos(angle) * 5200, y: Math.sin(angle) * 5200 } };
        shots += 1;
        let drained = false;
        for (let t = 0; t < 6 && !drained; t += DT) {
          for (const e of stepGame(g, NO_INPUT, DT)) {
            if (e.kind === 'drain') drained = true;
            // Scoops are counted per side, never as one number. The castle's
            // right scoop was sealed by a crossed throat and the total said 67
            // catches, which looks like a working feature. Split, it was 67 and
            // nought.
            const side = (e.kind === 'scoopCaught' || e.kind === 'scoopFired')
              ? (e.at.x < 512 ? ':left' : ':right') : '';
            const key = (e.kind === 'score' ? `score:${e.label}` : e.kind) + side;
            tally.set(key, (tally.get(key) ?? 0) + 1);
          }
        }
      }
    }
  }
  console.log(`  ${shots} shots`);
  for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`);
  for (const k of ['scoopCaught:left', 'scoopCaught:right', 'scoopFired:left', 'scoopFired:right', 'gateOpen']) {
    if (!tally.has(k)) console.log(`  ZERO       ${k}  <-- never happened in ${shots} shots`);
  }
}

if (run('soak')) {
  console.log(`\n=== soak: ${id}, randomised full games ===`);
  const tally = new Map();
  const never = [];
  const GAMES = 60;
  for (let n = 0; n < GAMES; n++) {
    const g = createGame(id);
    const next = rng(0x51e6e + n * 7919);
    launch(g, 0.3 + next() * 0.7);
    let left = false, right = false, over = false;
    for (let i = 0; i < 60000 && !over; i++) {
      if (i % 10 === 0) { left = next() > 0.45; right = next() > 0.45; }
      // The plunger has to be RELEASED to fire, so it is pulsed rather than
      // held. Held down forever, every ball after the first sits in the lane
      // fully wound and the game never gets going: sixty games reported stuck at
      // the plunger rest, which was the harness and not the board.
      const plunger = (i % 240) < 180;
      for (const e of stepGame(g, { left, right, plunger }, DT)) {
        const key = e.kind === 'score' ? `score:${e.label}` : e.kind;
        tally.set(key, (tally.get(key) ?? 0) + 1);
        if (e.kind === 'gameOver') over = true;
      }
    }
    if (!over) never.push(`game ${n}: stuck at (${Math.round(g.ball.pos.x)}, ${Math.round(g.ball.pos.y)}) phase ${g.phase}`);
  }
  console.log(`  ${GAMES} games, ${never.length} never reached game over`);
  for (const n of never) console.log(`  ${n}`);
  for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`);
}
