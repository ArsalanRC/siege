/**
 * The page: a canvas, a loop, and some input. No game logic anywhere in here.
 *
 * Everything this file knows about the table it reads back out of the engine,
 * including the shapes it draws. The walls on screen are the collider list
 * rendered directly, so what the player sees is what the ball hits, by
 * construction rather than by two descriptions being kept in step.
 *
 * That matters most right now, because the playfield art does not exist yet.
 * Until it does this drawing **is** the table. When the art arrives it goes
 * underneath as a single image and this becomes an overlay you can toggle.
 */

import { createGame, stepGame, readout, PLUNGER_CHARGE_TIME } from './lib/engine/game.js';
import { flipperSegment, flipperTip } from './lib/engine/flipper.js';
import { TABLE_W, TABLE_H, LANE_X, DRAIN_Y, CASTLE_LEFT, CASTLE_RIGHT, CASTLE_TOP, ROOF_FALL, RAIL_IMAGE_TOP, RAIL_IMAGE_H } from './lib/engine/table.js';
import { applyLanguage, toggleLanguage, currentLanguage, t } from './i18n.js';

const BEST_KEY = 'siege.best';

const canvas = document.getElementById('table');
const ctx = canvas.getContext('2d');

const el = {
  score: document.getElementById('score'),
  best: document.getElementById('best'),
  ball: document.getElementById('ball'),
  siege: document.getElementById('siege'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  overlaySub: document.getElementById('overlay-sub'),
  plungerFill: document.getElementById('plunger-fill'),
  lang: document.getElementById('lang'),
  debug: document.getElementById('debug'),
};

let game = createGame();
let showGeometry = false;
let best = Number(localStorage.getItem(BEST_KEY) ?? 0) || 0;

/*
 * Input, latched so a press always lasts at least one frame.
 *
 * `held` is the physical truth and `input` is what the game is shown. They are
 * not the same thing, because a quick tap delivers keydown and keyup between
 * two animation frames, and the loop in between sees neither. The table then
 * ignores the player completely, which reads as the game being broken rather
 * than as an input problem.
 *
 * So a release is never applied straight away. It is applied at the end of the
 * next frame, by which point the game has definitely seen the press.
 */
const held = { left: false, right: false, plunger: false };
const input = { left: false, right: false, plunger: false };

function pressAction(action) {
  held[action] = true;
  input[action] = true;
}

function releaseAction(action) {
  held[action] = false;
}

/** Called after each step: drop anything the player has actually let go of. */
function settleInput() {
  for (const action of ['left', 'right', 'plunger']) {
    if (!held[action]) input[action] = false;
  }
}

/** Short-lived visual flashes, each fading over its own lifetime. */
const flashes = [];
/** The last few ball positions, drawn as a fading tail. */
const trail = [];

/*
 * Art, if it is there.
 *
 * The playfield image is optional on purpose. A missing file is not an error
 * here, it is simply the state the project is in before the art lands, and the
 * table stays playable either way.
 */
/*
 * One flipper image, not two.
 *
 * The right bat is the left one mirrored, and the renderer already flips the
 * canvas to draw it. Generating a second image would only introduce a chance
 * that the two sides disagree, and they sit side by side where any difference
 * is immediately obvious.
 */
const art = { playfield: null, ball: null, flipper: null, habitrail: null };

function loadArt(name, file) {
  const img = new Image();
  img.onload = () => {
    art[name] = img;
  };
  img.src = `art/${file}`;
}

// The playfield is a JPEG and the sprites are PNGs, and the split is on
// purpose. The background covers the whole canvas and needs no transparency,
// where PNG cost 3.1 MB against 859 KB for the same image as JPEG. The sprites
// are drawn on top of it and their alpha is the entire point, so they stay PNG.
loadArt('playfield', 'playfield.jpg');
loadArt('ball', 'ball.png');
loadArt('flipper', 'flipper.png');
loadArt('habitrail', 'habitrail.png');

/* ---------- drawing ---------- */

/*
 * Pale maple, not dark walnut.
 *
 * The first pass was far too dark and the whole table sank into the page
 * behind it. A real playfield is light wood with the art printed onto it, and
 * the ball has to stay readable against it at speed, which a dark surface
 * makes impossible.
 */
const PALETTE = {
  wood: '#a9835a',
  woodDark: '#7d5c3c',
  stone: '#8b8079',
  stoneLight: '#b3a79c',
  gold: '#d8a842',
  crimson: '#8e2130',
  green: '#3f6b45',
  metal: '#cfd6dc',
  lane: '#e2c48a',
};

function strokeSegment(seg, colour, width, cap = 'round') {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width + seg.radius * 2;
  ctx.lineCap = cap;
  ctx.beginPath();
  ctx.moveTo(seg.a.x, seg.a.y);
  ctx.lineTo(seg.b.x, seg.b.y);
  ctx.stroke();
}

function fillCircle(c, colour) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(c.c.x, c.c.y, c.radius, 0, Math.PI * 2);
  ctx.fill();
}

/** Bare wood, the shooter lane, and the drain mouth. */
function drawSurface() {
  const grad = ctx.createLinearGradient(0, 0, 0, TABLE_H);
  grad.addColorStop(0, PALETTE.wood);
  grad.addColorStop(1, PALETTE.woodDark);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TABLE_W, TABLE_H);

  // A little grain, so the surface is not a flat field of colour. Deterministic
  // spacing rather than random, because a texture that reshuffles every frame
  // crawls horribly once the ball is moving.
  ctx.strokeStyle = 'rgb(60 38 22 / 0.09)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 34; i++) {
    const x = ((i * 137) % TABLE_W) + 6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 18, TABLE_H * 0.35, x - 14, TABLE_H * 0.7, x + 8, TABLE_H);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgb(0 0 0 / 0.28)';
  ctx.fillRect(LANE_X, 0, TABLE_W - LANE_X, TABLE_H);

  // Below the drain line the table has already lost the ball. Shading it makes
  // the boundary legible instead of invisible.
  ctx.fillStyle = 'rgb(0 0 0 / 0.45)';
  ctx.fillRect(0, DRAIN_Y, TABLE_W, TABLE_H - DRAIN_Y);
}

/**
 * The keep, drawn as a solid block rather than left as an outline.
 *
 * Its walls are colliders like everything else, but stroking them alone left a
 * grey rectangle on brown wood that read as an empty box. The structure is what
 * the whole table points at, so it has to look like somewhere to shoot.
 */
function drawCastle() {
  const left = 298;
  const right = 642;
  const top = 110;
  const bottom = 400;

  const apex = top - 46;
  const mid = (left + right) / 2;

  // Body plus the pitched roof, matching the two sloped colliders exactly.
  ctx.fillStyle = '#57514c';
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(mid, apex);
  ctx.lineTo(right, top);
  ctx.lineTo(right, bottom);
  ctx.lineTo(left, bottom);
  ctx.closePath();
  ctx.fill();

  // Course lines, to read as stone rather than as a painted panel.
  ctx.strokeStyle = 'rgb(0 0 0 / 0.22)';
  ctx.lineWidth = 2;
  for (let y = top + 28; y < bottom; y += 28) {
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

  // The roof edge picked out, so the pitch is visible rather than implied.
  ctx.strokeStyle = '#7a716a';
  ctx.lineWidth = 7;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(mid, apex);
  ctx.lineTo(right, top);
  ctx.stroke();

  // Two towers, one either end, so the silhouette is not a plain slab.
  for (const cx of [left + 6, right - 6]) {
    ctx.fillStyle = '#635b55';
    ctx.fillRect(cx - 30, top - 44, 60, bottom - top + 44);
    ctx.fillStyle = '#7a716a';
    ctx.fillRect(cx - 30, top - 44, 60, 18);
  }

  // The mouth, sunk into the wall so an open gate has somewhere to lead.
  const mouth = LANE_X / 2;
  ctx.fillStyle = '#241f1c';
  ctx.fillRect(mouth - 55, top + 40, 110, bottom - top - 40);
}

/**
 * The table, drawn from its own collision geometry.
 *
 * Each collider is styled by the prefix of its id, which is the same string the
 * scoring reads. One naming scheme, used by both, so a wall cannot be drawn as
 * a bumper without also scoring as one.
 */
function drawFurniture() {
  const t = game.table;

  for (const c of t.colliders) {
    if (!c.active || c.sensor) continue;

    if (c.type === 'circle') {
      const isBumper = c.id.startsWith('bumper');
      fillCircle(c.circle, isBumper ? PALETTE.crimson : PALETTE.stone);
      ctx.strokeStyle = isBumper ? PALETTE.gold : PALETTE.stoneLight;
      ctx.lineWidth = isBumper ? 5 : 3;
      ctx.beginPath();
      ctx.arc(c.circle.c.x, c.circle.c.y, c.circle.radius - 2, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }

    const seg = c.seg;
    if (!seg) continue;

    if (c.id.startsWith('sling')) strokeSegment(seg, PALETTE.crimson, 16);
    // Butt caps on the targets. Round ones overhang by half the line width and
    // close the 16 unit gaps, so three separate targets read as one long bar.
    else if (c.id.startsWith('target-')) strokeSegment(seg, PALETTE.green, 14, 'butt');
    else if (c.id.startsWith('guide')) strokeSegment(seg, PALETTE.lane, 6);
    else if (c.id === 'portcullis') strokeSegment(seg, PALETTE.metal, 12, 'butt');
    else if (c.id === 'lane-gate') strokeSegment(seg, PALETTE.metal, 5);
    // The castle body is already painted by drawCastle, so its walls are only
    // outlined here. Stroking them solid would cover the stonework.
    else if (c.id.startsWith('castle')) strokeSegment(seg, 'rgb(30 26 23 / 0.55)', 6);
    else if (c.id.startsWith('lane')) strokeSegment(seg, PALETTE.metal, 6);
    else strokeSegment(seg, PALETTE.stoneLight, 9);
  }

  // A knocked-down target still occupies its slot, so it is drawn dark rather
  // than removed. A shape that vanishes reads as a rendering fault.
  for (let i = 0; i < t.targets.length; i++) {
    const target = t.targets[i];
    if (target.active || !target.seg) continue;
    strokeSegment(target.seg, 'rgb(0 0 0 / 0.5)', 10);
  }
}

/**
 * State the painting cannot show, drawn over it.
 *
 * The playfield image is one flat picture of a table at rest, so a target it
 * paints standing stays standing forever. Without this the player knocks an
 * ogre down, hears it score, and watches nothing change, which reads as the
 * table not having registered the hit.
 *
 * The painted shields run a little above and below the collider line, so the
 * panel is drawn from the art rather than from the collider's own bounds.
 */
function drawStateOverArt() {
  const SHIELD_TOP = 518;
  const SHIELD_BOTTOM = 716;

  for (const target of game.table.targets) {
    if (target.active || !target.seg) continue;
    const { a, b } = target.seg;
    ctx.save();
    ctx.fillStyle = 'rgb(14 10 8 / 0.72)';
    ctx.fillRect(a.x - 6, SHIELD_TOP, b.x - a.x + 12, SHIELD_BOTTOM - SHIELD_TOP);
    // A slot where the target dropped into, so it reads as down rather than as
    // a black rectangle somebody forgot to draw.
    ctx.fillStyle = 'rgb(0 0 0 / 0.5)';
    ctx.fillRect(a.x - 6, SHIELD_BOTTOM - 16, b.x - a.x + 12, 16);
    ctx.restore();
  }

  // The portcullis lifting is the single most important thing the table can
  // tell the player, so it gets drawn rather than left to the glow alone.
  if (readout(game).gateOpen) {
    const seg = game.table.portcullis.seg;
    if (seg) {
      ctx.save();
      ctx.fillStyle = 'rgb(20 15 10 / 0.55)';
      ctx.fillRect(seg.a.x, seg.a.y - 96, seg.b.x - seg.a.x, 96);
      ctx.restore();
    }
  }
}

/**
 * The habitrail over the castle, drawn along the roof the ball actually rides.
 *
 * This exists because the ball travelling over the castle looked like it was
 * flying: the painted towers are underneath it and nothing showed what it was
 * running on. A raised wire rail is what a real machine uses for exactly this,
 * and once it is drawn the ball is on a rail rather than in mid-air.
 *
 * Placed from the collision, not traced onto the art, so it cannot drift: the
 * rail is drawn along the same two points the roof collider uses.
 */
function drawHabitrail() {
  const dx = CASTLE_RIGHT - CASTLE_LEFT;

  // The generated rail is drawn WITHOUT rotating it. The artwork already falls
  // left to right by its own 73 units, so rotating it as well would double the
  // slope and the ball would ride off the drawn rail at one end. `ROOF_FALL` was
  // set from the picture instead, which is the right way round: the ball has to
  // roll along the rail the player can see.
  if (art.habitrail) {
    // Same two numbers the collision is built from, so the drawn wire and the
    // surface the ball rolls on are the same line by construction.
    ctx.drawImage(art.habitrail, CASTLE_LEFT, RAIL_IMAGE_TOP, CASTLE_RIGHT - CASTLE_LEFT, RAIL_IMAGE_H);
    return;
  }

  const len = Math.hypot(dx, ROOF_FALL);
  ctx.save();
  ctx.translate(CASTLE_LEFT, CASTLE_TOP);
  ctx.rotate(Math.atan2(ROOF_FALL, dx));


  // Drawn rather than generated, and that is the better way round here. The
  // rail has to sit exactly on the surface the ball rolls along or it looks
  // wrong again, and drawing it from the same two points the collider uses
  // makes that true by construction instead of by careful placement.
  const GAUGE = 26;

  // Shadow first, offset down the table, so the rail reads as raised above the
  // castle rather than painted onto it. Without this it is just a line.
  ctx.strokeStyle = 'rgb(0 0 0 / 0.42)';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  for (const off of [-GAUGE, GAUGE]) {
    ctx.beginPath();
    ctx.moveTo(6, off + 18);
    ctx.lineTo(len - 6, off + 18);
    ctx.stroke();
  }

  // Posts holding the rail up, drawn under the wires.
  ctx.strokeStyle = '#8d8378';
  ctx.lineWidth = 7;
  for (let x = 40; x < len - 20; x += 96) {
    ctx.beginPath();
    ctx.moveTo(x, -GAUGE);
    ctx.lineTo(x, GAUGE);
    ctx.stroke();
    ctx.fillStyle = '#b9ad9d';
    for (const off of [-GAUGE, GAUGE]) {
      ctx.beginPath();
      ctx.arc(x, off, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The wires themselves: a warm body with a bright specular line along the top.
  for (const off of [-GAUGE, GAUGE]) {
    ctx.strokeStyle = '#6f6459';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(0, off);
    ctx.lineTo(len, off);
    ctx.stroke();

    ctx.strokeStyle = '#e6d9b8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, off - 2.5);
    ctx.lineTo(len, off - 2.5);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * The two lower walls, drawn.
 *
 * They close the outlanes, and until now they were real colliders sitting on
 * bare wood with nothing on them: a ball would turn in mid air against nothing.
 * Reported as "some transparent railing where the 2 levers are", and it is the
 * same defect as the ball flying over the castle.
 *
 * Drawn from the colliders rather than traced onto the art, for the reason the
 * habitrail proved: geometry the drawing is derived from cannot drift away from
 * it.
 */
function drawLowerRails() {
  for (const c of game.table.colliders) {
    if (!c.id.startsWith('lower') || !c.seg) continue;
    const { a, b } = c.seg;

    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgb(0 0 0 / 0.38)';
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.moveTo(a.x + 3, a.y + 9);
    ctx.lineTo(b.x + 3, b.y + 9);
    ctx.stroke();

    ctx.strokeStyle = '#6f6459';
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.strokeStyle = '#e6d9b8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 3);
    ctx.lineTo(b.x, b.y - 3);
    ctx.stroke();

    // A post at each end, so it reads as a fitted rail and not a painted stripe.
    for (const p of [a, b]) {
      ctx.fillStyle = '#b9ad9d';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Everything the geometry cannot say: lit inserts, the open gate, the siege. */
function drawLights(now) {
  const r = readout(game);

  if (r.gateOpen) {
    const pulse = 0.55 + 0.45 * Math.sin(now / 160);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgb(216 168 66 / ${0.35 * pulse})`;
    ctx.beginPath();
    ctx.arc(LANE_X / 2, 400, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const f of flashes) {
    const life = 1 - f.age / f.life;
    if (life <= 0) continue;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgb(${f.rgb} / ${0.55 * life})`;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.radius * (1.6 - life * 0.6), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawFlipper(f, image) {
  const seg = flipperSegment(f);

  if (image) {
    ctx.save();
    ctx.translate(f.pivot.x, f.pivot.y);

    // Rotating by the bat's own angle puts the sprite's +x along pivot-to-tip,
    // which is right for both sides, since `flipperTip` is defined the same way
    // for each. No horizontal mirroring is needed at all.
    ctx.rotate(f.angle);

    // The sprite carries its rubber edge along the bottom, and the ball always
    // arrives on the upper face. After the rotation above that edge already
    // faces the ball on the right hand bat, and faces away on the left, so only
    // the left one is flipped. Without this the ball visibly bounces off bare
    // iron while the rubber sits on the side nothing ever touches.
    if (f.side === 'left') ctx.scale(1, -1);

    const h = f.radius * 2 * 1.6;
    const w = f.length * 1.08;
    ctx.drawImage(image, -w * 0.06, -h / 2, w, h);
    ctx.restore();
    return;
  }

  strokeSegment(seg, PALETTE.crimson, f.radius * 2);
  ctx.strokeStyle = PALETTE.gold;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(seg.a.x, seg.a.y);
  ctx.lineTo(seg.b.x, seg.b.y);
  ctx.stroke();

  const tip = flipperTip(f);
  ctx.fillStyle = PALETTE.gold;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawBall() {
  const b = game.ball;

  for (let i = 0; i < trail.length; i++) {
    const p = trail[i];
    const life = (i + 1) / trail.length;
    ctx.fillStyle = `rgb(230 240 255 / ${0.16 * life})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, b.radius * (0.4 + 0.55 * life), 0, Math.PI * 2);
    ctx.fill();
  }

  if (art.ball) {
    const d = b.radius * 2;
    ctx.drawImage(art.ball, b.pos.x - b.radius, b.pos.y - b.radius, d, d);
    return;
  }

  const g = ctx.createRadialGradient(
    b.pos.x - b.radius * 0.35,
    b.pos.y - b.radius * 0.4,
    b.radius * 0.1,
    b.pos.x,
    b.pos.y,
    b.radius,
  );
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#cfd6dc');
  g.addColorStop(1, '#5c6469');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(b.pos.x, b.pos.y, b.radius, 0, Math.PI * 2);
  ctx.fill();
}

/** Every collider, exactly as the physics sees it. The check on the drawing. */
function drawGeometry() {
  ctx.save();
  for (const c of game.table.colliders) {
    const live = c.active;
    ctx.strokeStyle = c.sensor ? '#4bb3ff' : live ? '#5cff9d' : '#ff5c5c';
    ctx.setLineDash(c.sensor ? [10, 8] : []);
    ctx.lineWidth = 2;
    if (c.type === 'circle' && c.circle) {
      ctx.beginPath();
      ctx.arc(c.circle.c.x, c.circle.c.y, c.circle.radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (c.seg) {
      ctx.beginPath();
      ctx.moveTo(c.seg.a.x, c.seg.a.y);
      ctx.lineTo(c.seg.b.x, c.seg.b.y);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = '#ffd24b';
  ctx.lineWidth = 2;
  for (const f of [game.left, game.right]) {
    const seg = flipperSegment(f);
    ctx.beginPath();
    ctx.moveTo(seg.a.x, seg.a.y);
    ctx.lineTo(seg.b.x, seg.b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function render(now) {
  ctx.clearRect(0, 0, TABLE_W, TABLE_H);

  if (art.playfield) ctx.drawImage(art.playfield, 0, 0, TABLE_W, TABLE_H);
  else drawSurface();

  if (!art.playfield) {
    drawCastle();
    drawFurniture();
  } else {
    drawStateOverArt();
  }
  drawHabitrail();
  drawLowerRails();
  drawLights(now);
  drawFlipper(game.left, art.flipper);
  drawFlipper(game.right, art.flipper);
  drawBall();

  if (showGeometry) drawGeometry();
}

/* ---------- events into visuals ---------- */

function flash(x, y, radius, rgb, life = 320) {
  flashes.push({ x, y, radius, rgb, life, age: 0 });
}

function consume(events) {
  for (const e of events) {
    if (e.kind === 'bumper') flash(e.at.x, e.at.y, 52, '255 210 120');
    else if (e.kind === 'sling') flash(e.at.x, e.at.y, 40, '255 140 120');
    else if (e.kind === 'keepTaken') flash(LANE_X / 2, 300, 200, '255 225 150', 900);
    else if (e.kind === 'gateOpen') flash(LANE_X / 2, 400, 160, '216 168 66', 700);
    // A save that looks identical to losing a ball teaches the player nothing.
    else if (e.kind === 'ballSaved') flash(LANE_X / 2, 1300, 240, '120 255 170', 1100);
    else if (e.kind === 'gameOver') finish(e.score);
  }
}

function finish(score) {
  if (score > best) {
    best = score;
    localStorage.setItem(BEST_KEY, String(best));
  }
}

/* ---------- the loop ---------- */

let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  consume(stepGame(game, input, dt));
  settleInput();

  for (let i = flashes.length - 1; i >= 0; i--) {
    flashes[i].age += dt * 1000;
    if (flashes[i].age >= flashes[i].life) flashes.splice(i, 1);
  }

  const r = readout(game);
  if (r.phase === 'playing') {
    trail.push({ x: game.ball.pos.x, y: game.ball.pos.y });
    if (trail.length > 9) trail.shift();
  } else if (trail.length) {
    trail.length = 0;
  }

  render(now);
  updateHud(r);
  requestAnimationFrame(frame);
}

function updateHud(r) {
  el.score.textContent = r.score.toLocaleString(currentLanguage() === 'de' ? 'de-DE' : 'en-GB');
  el.best.textContent = best.toLocaleString(currentLanguage() === 'de' ? 'de-DE' : 'en-GB');
  el.ball.textContent = String(r.ballNumber);
  el.siege.textContent = String(r.siegeLevel);
  el.plungerFill.style.height = `${r.plungerCharge * 100}%`;

  if (r.phase === 'gameOver') {
    el.overlay.hidden = false;
    el.overlayTitle.textContent = t('overlay.over');
    el.overlaySub.textContent = t('overlay.again');
  } else if (r.phase === 'ready' && r.plungerCharge === 0) {
    el.overlay.hidden = false;
    el.overlayTitle.textContent = t('overlay.ready');
    el.overlaySub.textContent = t('overlay.hint');
  } else {
    el.overlay.hidden = true;
  }
}

/* ---------- input ---------- */

function restartIfOver() {
  if (readout(game).phase !== 'gameOver') return false;
  game = createGame();
  flashes.length = 0;
  trail.length = 0;
  return true;
}

const KEYS = {
  ArrowLeft: 'left',
  KeyA: 'left',
  KeyZ: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  KeyM: 'right',
  Space: 'plunger',
  ArrowDown: 'plunger',
};

addEventListener('keydown', (e) => {
  const action = KEYS[e.code];
  if (!action) return;
  e.preventDefault();
  if (e.repeat) return;
  if (action === 'plunger' && restartIfOver()) return;
  pressAction(action);
});

addEventListener('keyup', (e) => {
  const action = KEYS[e.code];
  if (!action) return;
  e.preventDefault();
  releaseAction(action);
});

function bindPad(id, action) {
  const node = document.getElementById(id);
  const down = (e) => {
    e.preventDefault();
    if (action === 'plunger' && restartIfOver()) return;
    pressAction(action);
  };
  const up = (e) => {
    e.preventDefault();
    releaseAction(action);
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('pointerleave', up);
}

bindPad('touch-left', 'left');
bindPad('touch-right', 'right');
bindPad('touch-plunger', 'plunger');

/*
 * Tapping the table itself works the flippers too, split down the middle.
 *
 * A phone player should not have to find a button. Which half decides which
 * flipper, and the bottom strip winds the plunger.
 */
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (restartIfOver()) return;
  const box = canvas.getBoundingClientRect();
  const x = (e.clientX - box.left) / box.width;
  const y = (e.clientY - box.top) / box.height;
  if (y > 0.88) pressAction('plunger');
  else if (x < 0.5) pressAction('left');
  else pressAction('right');
});

const release = () => {
  releaseAction('left');
  releaseAction('right');
  releaseAction('plunger');
};

canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
addEventListener('blur', release);

el.lang.addEventListener('click', () => {
  toggleLanguage();
  el.lang.textContent = currentLanguage() === 'de' ? 'EN' : 'DE';
  updateHud(readout(game));
});

el.debug.addEventListener('click', () => {
  showGeometry = !showGeometry;
  el.debug.setAttribute('aria-pressed', String(showGeometry));
});

/*
 * A handle on the running table, for the console.
 *
 * Two reasons it earns its place. The obvious one is that a physics demo with a
 * geometry overlay invites poking at, and reading `siege.game.ball` beats
 * guessing from pixels.
 *
 * The other is that this page cannot be driven by anything automated without
 * it. `requestAnimationFrame` does not fire in a background tab, by design, so
 * a browser that is screenshotting rather than watching sees a frozen table and
 * no error anywhere to explain why. `siege.step()` advances one frame by hand.
 */
window.siege = {
  get game() {
    return game;
  },
  press: pressAction,
  release: releaseAction,
  step(dt = 1 / 60) {
    consume(stepGame(game, input, dt));
    settleInput();
    render(performance.now());
    updateHud(readout(game));
    return readout(game);
  },
};

applyLanguage();
el.lang.textContent = currentLanguage() === 'de' ? 'EN' : 'DE';
requestAnimationFrame(frame);
