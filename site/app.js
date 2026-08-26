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

import { createGame, stepGame, readout, PLUNGER_CHARGE_TIME } from './lib/engine/game.js?v=24';
import { flipperSegment, flipperSegments, flipperTip, BAT_SPRITE, batDroop } from './lib/engine/flipper.js?v=24';
import { TABLE_W, TABLE_H, LANE_X, DRAIN_Y } from './lib/engine/table.js?v=24';
import { CASTLE_LEFT, CASTLE_RIGHT, CASTLE_TOP, ROOF_FALL, RAIL_IMAGE_TOP, RAIL_IMAGE_H } from './lib/engine/tables/siege.js?v=24';
import { NOVA_ART } from './lib/engine/tables/nova.js?v=24';
import { TABLES } from './lib/engine/tables/index.js?v=24';
import { applyLanguage, toggleLanguage, currentLanguage, t } from './i18n.js?v=24';

/**
 * Which board is on, remembered.
 *
 * The best score is stored per board, because two boards do not share a high
 * score any more than two machines in an arcade do. One key each.
 */
const BOARD_KEY = 'siege.board';
const bestKeyFor = (id) => `siege.best.${id}`;

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
  board: document.getElementById('board'),
  wordmark: document.querySelector('.wordmark'),
  levelLabel: document.getElementById('level-label'),
  geokey: document.getElementById('geokey'),
};

const KNOWN_BOARDS = TABLES.map((b) => b.id);
let boardId = localStorage.getItem(BOARD_KEY) ?? 'siege';
if (!KNOWN_BOARDS.includes(boardId)) boardId = 'siege';

let game = createGame(boardId);
let showGeometry = false;
let best = Number(localStorage.getItem(bestKeyFor(boardId)) ?? 0) || 0;

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
const art = {
  // Shared across both boards: the ball and the bat are the same parts in the
  // same cabinet, so they are loaded once and never cleared on a switch.
  ball: null,
  // Board specific, replaced whenever the board changes. The bat is in here too
  // now: the two machines do not share one, and the sprite carries its own
  // hinge and tip fractions in BAT_SPRITES.
  flipper: null,
  playfield: null, habitrail: null, railRise: null, railFall: null,
  station: null, bumper: null, target: null, scoopRim: null, sling: null,
  gantry: null, lens: null,
};

/**
 * Which files each board wants, by the key the drawing reads them back out of.
 *
 * A board is allowed to be missing any of them. That is not an error state, it
 * is simply where the art has got to, and every draw path below falls back to
 * something drawn from the colliders. NOVA shipped playable with two of its nine
 * pieces done.
 */
const BOARD_ART = {
  siege: {
    flipper: 'flipper.png',
    playfield: 'siege/playfield.jpg',
    habitrail: 'siege/habitrail.png',
    railRise: 'siege/rail-rise.png',
    railFall: 'siege/rail-fall.png',
  },
  nova: {
    flipper: 'nova/flipper.png',
    playfield: 'nova/playfield.jpg',
    station: 'nova/station.png',
    bumper: 'nova/bumper.png',
    target: 'nova/target.png',
    scoopRim: 'nova/scoop.png',
    sling: 'nova/sling.png',
    gantry: 'nova/gantry.png',
    lens: 'nova/lens.png',
  },
};

/**
 * Where each supplied rail's own axis runs inside its image, in image pixels.
 *
 * Measured by fitting a principal axis to the opaque alpha: the mounting feet at
 * each end are what the numbers are, and they are what gets mapped onto the two
 * ends of a collider. Same trick as the habitrail: the drawing is placed from
 * the geometry, so a rail cannot be drawn anywhere except along the thing the
 * ball actually runs on.
 */
const RAIL_ART = {
  rise: { p0: [1640, 121], p1: [25, 828] },
  fall: { p0: [28, 115], p1: [1666, 854] },
};

/** Draw a rail image so its own axis lands exactly on `a`..`b`. */
function drawRailArt(image, spec, a, b) {
  const [ax, ay] = spec.p0;
  const [bx, by] = spec.p1;
  const imgLen = Math.hypot(bx - ax, by - ay);
  const imgAngle = Math.atan2(by - ay, bx - ax);
  const segLen = Math.hypot(b.x - a.x, b.y - a.y);
  const scale = segLen / imgLen;

  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
  ctx.scale(scale, scale);
  ctx.rotate(-imgAngle);
  ctx.translate(-ax, -ay);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

/**
 * Which set of board art is current. Bumped on every switch.
 *
 * Without it, changing board twice quickly leaves the two boards' art mixed.
 * `loadBoardArt` clears the keys and starts fresh loads, but the OUTGOING
 * board's images are still in flight, and whichever decodes last wins the key
 * it was asked for. Swiping siege to nova and straight back drew nova's deck
 * and nova's bats under siege's wordmark, with the castle's habitrail over the
 * top, which is exactly what it sounds like: two machines at once.
 *
 * A load now checks it is still wanted before it writes anything.
 */
let artEpoch = 0;

/** `epoch: null` for art that belongs to no board and must never be discarded. */
function loadArt(name, file, epoch = artEpoch) {
  const img = new Image();
  img.onload = () => {
    if (epoch !== null && epoch !== artEpoch) return;
    art[name] = img;
  };
  img.src = `art/${file}`;
}

// The playfield is a JPEG and the sprites are PNGs, and the split is on
// purpose. The background covers the whole canvas and needs no transparency,
// where PNG cost 3.1 MB against 859 KB for the same image as JPEG. The sprites
// are drawn on top of it and their alpha is the entire point, so they stay PNG.
loadArt('ball', 'ball.png', null);

/** Drop the outgoing board's art and fetch the incoming board's. */
function loadBoardArt(id) {
  artEpoch += 1;
  for (const key of ['playfield', 'habitrail', 'railRise', 'railFall', 'flipper',
                    'station', 'bumper', 'target', 'scoopRim', 'sling', 'gantry', 'lens']) art[key] = null;
  for (const [key, file] of Object.entries(BOARD_ART[id] ?? {})) loadArt(key, file);
}

loadBoardArt(boardId);

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
  // Measured off the art: the painted ogre panels run from 526 down to 737.
  const SHIELD_TOP = 526;
  const SHIELD_BOTTOM = 737;

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
/**
 * The two scoop mouths, drawn as holes in the wall with a lit lip.
 *
 * The chamber behind each one is real geometry and the ball really goes into it,
 * so it has to look like somewhere a ball can go. A mouth that is shut is drawn
 * dark and unlit, which is the table telling the player the coil has not
 * reloaded yet rather than the shot simply not working.
 */
function drawScoops() {
  for (const s of game.table.scoops) {
    const ready = !game.cooldowns.has(s.id);
    const dx = s.mouth.x - s.centre.x;
    const dy = s.mouth.y - s.centre.y;
    const facing = Math.atan2(dy, dx);

    ctx.save();
    // The throat, sunk into the playfield.
    ctx.fillStyle = 'rgb(12 8 6 / 0.88)';
    ctx.beginPath();
    ctx.arc(s.centre.x, s.centre.y, s.radius - 5, 0, Math.PI * 2);
    ctx.fill();

    // The lip, drawn only across the opening so the chamber reads as a mouth
    // rather than as a ring painted on the wood.
    ctx.strokeStyle = ready ? '#e8c886' : '#6d5f45';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(s.centre.x, s.centre.y, s.radius, facing - 0.95, facing + 0.95);
    ctx.stroke();

    if (ready) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgb(216 168 66 / 0.16)';
      ctx.beginPath();
      ctx.arc(s.centre.x, s.centre.y, s.radius - 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/**
 * The lamp lenses that have been rolled over, drawn lit.
 *
 * A rollover on a real machine lights its insert and it stays lit until the set
 * is collected. Without that the nineteen lenses are nineteen identical noises
 * and the player has no way to see which ones are left, which was the note:
 * "there should be a backlight in them when they are rolled over".
 *
 * Drawn under the ball and over the art, with the glow sized from the collider
 * so a lit lens can never be lit in the wrong place.
 */
function drawLamps() {
  const lit = readout(game).lampsLit;
  if (!lit.size) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const c of game.table.colliders) {
    if (!c.circle || !lit.has(c.id)) continue;
    const { x, y } = c.circle.c;
    const r = c.circle.radius;
    const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r * 1.35);
    g.addColorStop(0, 'rgb(255 236 170 / 0.85)');
    g.addColorStop(0.55, 'rgb(255 196 90 / 0.42)');
    g.addColorStop(1, 'rgb(255 170 60 / 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLowerRails() {
  for (const c of game.table.colliders) {
    // The orbit return is a wire rail like the lower ones, so it is drawn the
    // same way rather than being left as a wall nobody can see.
    if (c.id.startsWith('orbit') && c.seg) {
      const { a, b } = c.seg;
      // The orbit return falls to the LEFT, so it is the rising image: its own
      // axis runs from the top right foot to the bottom left one.
      if (art.railRise) {
        drawRailArt(art.railRise, RAIL_ART.rise, a, b);
        continue;
      }
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgb(0 0 0 / 0.38)';
      ctx.lineWidth = 13;
      ctx.beginPath();
      ctx.moveTo(a.x + 3, a.y + 9);
      ctx.lineTo(b.x + 3, b.y + 9);
      ctx.stroke();
      ctx.strokeStyle = '#6f6459';
      ctx.lineWidth = 12;
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
      for (const p of [a, b]) {
        ctx.fillStyle = '#b9ad9d';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }
    if (c.id.startsWith('lower-post') && c.circle) {
      ctx.fillStyle = '#6f6459';
      ctx.beginPath();
      ctx.arc(c.circle.c.x, c.circle.c.y, c.circle.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e6d9b8';
      ctx.beginPath();
      ctx.arc(c.circle.c.x - 2, c.circle.c.y - 3, c.circle.radius * 0.45, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
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
/**
 * The middle of whatever this board's main gate is, and how big to light it.
 *
 * Both boards have one: the castle's portcullis and NOVA's bay shutter are the
 * same part. Sizing the glow from the gate's own width means it frames the shot
 * on either board instead of being a disc somebody chose once.
 */
function gateCentre() {
  const seg = game.table.portcullis.seg;
  if (!seg) return { x: TABLE_W / 2, y: 400, radius: 110 };
  const width = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
  return {
    x: (seg.a.x + seg.b.x) / 2,
    y: (seg.a.y + seg.b.y) / 2,
    radius: Math.max(70, width * 0.85),
  };
}

function drawLights(now) {
  const r = readout(game);

  if (r.gateOpen) {
    // Read off the gate itself rather than written down here.
    //
    // It used to be a fixed (LANE_X / 2, 400) with a radius of 120, which is
    // roughly over the castle's arch and nowhere near NOVA's docking bay. On the
    // space board it put a 240 unit amber disc across the middle of the station
    // hull, pulsing, for as long as the bay was open. A hardcoded coordinate in
    // shared drawing code is the same defect as a hardcoded collider, and it is
    // caught the same way: ask the table.
    const gate = gateCentre();
    const pulse = 0.55 + 0.45 * Math.sin(now / 160);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgb(216 168 66 / ${0.30 * pulse})`;
    ctx.beginPath();
    ctx.arc(gate.x, gate.y, gate.radius, 0, Math.PI * 2);
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

/**
 * Each board's bat, in fractions of its own sprite.
 *
 * Measured off the alpha, never guessed, exactly as the castle's was. NOVA's bat
 * is the better behaved of the two: its spine runs almost dead level inside its
 * image, two units of drop across 512, where the castle's is drawn at 3.3
 * degrees and has to have that taken back out. The droop is computed from the
 * drawn size either way, because the image is scaled by different factors across
 * and down, so the angle its spine makes on screen depends on how big it is
 * drawn. Treating it as a constant put the castle's right bat visibly off its
 * pivot.
 */
const BAT_SPRITES = {
  siege: BAT_SPRITE,
  nova: { hingeX: 0.100, hingeY: 0.486, tipX: 0.998, farX: 0.900, farY: 0.505, hingeHalf: 0.486 },
};

function batDroopFor(spec, w, h) {
  return Math.atan2((spec.farY - spec.hingeY) * h, (spec.farX - spec.hingeX) * w);
}

function drawFlipper(f, image) {
  const seg = flipperSegment(f);
  const spec = BAT_SPRITES[game.table.id] ?? BAT_SPRITE;

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

    // The sprite is placed from the same numbers the collision is built from, so
    // the bat you can see and the bat the ball hits are one shape.
    //
    // It used to be `w = length * 1.08` and `h = radius * 2 * 1.6`, two fudges
    // chosen to make the picture look right against a capsule it did not match.
    // The result was a drawn bat half again fatter than the collision at the
    // hinge and twice as fat at the tip, which is the "different shape" that got
    // reported. Now the hinge lands on the pivot, the tip lands on the tip, and
    // the half-height at the hinge is exactly the collision radius.
    const span = spec.tipX - spec.hingeX;
    const w = f.length / span;
    const h = f.radius / spec.hingeHalf;

    // The artist drew the bat at a slight angle inside its own image. That is a
    // property of the picture, not of the machine, so it comes back out here
    // rather than being inherited by the physics.
    //
    // The same sign on both sides, and the mirror does NOT change it. Reasoning
    // that a vertical flip reverses the rotation sense gave the left bat +droop,
    // and measuring where the sprite's tip actually landed said otherwise: 26.9
    // units off with the sign flipped, 1.3 units off without. The flip is
    // applied to the frame the rotation is measured in, so the two cancel.
    ctx.rotate(-batDroopFor(spec, w, h));

    ctx.drawImage(image, -spec.hingeX * w, -spec.hingeY * h, w, h);
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

/**
 * Every collider, exactly as the physics sees it. The check on the drawing.
 *
 * This is the tool the table is audited with, so it has to be legible on top of
 * a busy painting rather than merely correct. It used to be 2 pixel lines in one
 * colour, which over stonework and gold leaf is close to invisible: the overlay
 * was switched on and the honest answer to "where is the physics" was still
 * nowhere.
 *
 * Two things fix that. Every line is drawn twice, a black casing first and the
 * colour on top, which is the trick a map legend uses to stay readable over both
 * pale and dark ground. And each kind of part has its own colour, so the
 * question stops being "is there a line here" and becomes "is that line on the
 * thing it is painted as".
 */
const GEOMETRY_COLOURS = [
  ['bumper', '#ff8a1f', 'Bumpers'],
  ['sling', '#ff2d55', 'Slingshot faces'],
  ['triangle', '#ff7a95', 'Slingshot backs'],
  ['target', '#ffd400', 'Drop targets'],
  ['scoop-shutter', '#b0006f', 'Scoop shutters'],
  ['scoop', '#ff35ff', 'Scoops'],
  ['lamp', '#00b7ff', 'Lamp rollovers'],
  ['lower', '#00e5c0', 'Inlane/outlane post'],
  ['orbit', '#a45cff', 'Orbit return'],
  ['castle-back', '#7a5cff', 'Keep chamber'],
  ['castle', '#00d0ff', 'Castle'],
  ['portcullis', '#ff9a3c', 'Portcullis'],
  ['lane', '#dfe6ec', 'Shooter lane'],
  ['gate', '#7a5cff', null],
  ['inlane', '#66ff33', 'Lane sensors'],
  ['outlane', '#66ff33', null],
  ['wall', '#00ff6a', 'Walls'],
];

function geometryColour(id) {
  for (const [prefix, colour] of GEOMETRY_COLOURS) {
    if (id.startsWith(prefix)) return colour;
  }
  return '#00ff6a';
}

function drawGeometry() {
  ctx.save();
  ctx.lineCap = 'round';

  // Pass 0 lays a black casing under everything, pass 1 puts the colour on top.
  for (const pass of [0, 1]) {
    for (const c of game.table.colliders) {
      ctx.setLineDash(c.sensor ? [14, 10] : []);
      ctx.strokeStyle = pass === 0
        ? 'rgb(0 0 0 / 0.85)'
        : c.active ? geometryColour(c.id) : '#ff3b30';
      ctx.lineWidth = pass === 0 ? 11 : 6;
      ctx.beginPath();
      if (c.type === 'circle' && c.circle) {
        ctx.arc(c.circle.c.x, c.circle.c.y, c.circle.radius, 0, Math.PI * 2);
      } else if (c.seg) {
        ctx.moveTo(c.seg.a.x, c.seg.a.y);
        ctx.lineTo(c.seg.b.x, c.seg.b.y);
      } else {
        continue;
      }
      ctx.stroke();
    }

    ctx.setLineDash([]);
    // The bat is OUTLINED, not filled, and it is the only collider that is.
    //
    // Filled, it covered its own sprite completely and the only way to compare
    // the two shapes was to switch the overlay off, which is the opposite of
    // what an overlay is for. A wash was the next attempt and it read as fog
    // rather than as geometry. An outline gives the true edge of the collision
    // AND leaves the bat visible inside it, which is the whole question being
    // asked here: does the shape the ball hits sit on the shape you can see.
    //
    // The bat is straight, so the union of its ten narrowing capsules is exactly
    // one tapered capsule: two circles and the external tangents between them.
    if (pass === 1) {
      for (const f of [game.left, game.right]) {
        const segs = flipperSegments(f);
        const first = segs[0];
        const last = segs[segs.length - 1];
        const a = first.a;
        const b = last.b;
        const ra = first.radius;
        const rb = last.radius;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        // The tangents lean by this much because the two ends differ in radius.
        const lean = Math.asin(Math.max(-1, Math.min(1, (ra - rb) / len)));
        const base = Math.atan2(uy, ux);

        for (const width of [9, 5]) {
          ctx.strokeStyle = width === 9 ? 'rgb(0 0 0 / 0.85)' : '#ffffff';
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.arc(a.x, a.y, ra, base + Math.PI / 2 - lean, base - Math.PI / 2 + lean, true);
          ctx.arc(b.x, b.y, rb, base - Math.PI / 2 + lean, base + Math.PI / 2 - lean, true);
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
  }

  // Where each scoop parks the ball. Nothing else on the table moves the ball
  // without touching it, so it is worth being able to see where it goes.
  for (const s of game.table.scoops) {
    ctx.fillStyle = 'rgb(0 0 0 / 0.85)';
    ctx.beginPath();
    ctx.arc(s.hold.x, s.hold.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff35ff';
    ctx.beginPath();
    ctx.arc(s.hold.x, s.hold.y, 9, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Fill the key in the page margin once, the first time the overlay is used.
 *
 * Built from the same list the drawing uses, so a part cannot be given a colour
 * on the board and a different one in the legend.
 */
function buildGeometryKey() {
  if (el.geokey.childElementCount) return;
  const rows = GEOMETRY_COLOURS
    .filter(([, , label]) => label)
    .map(([, colour, label]) =>
      `<span style="color:${colour}"><i></i>${label}</span>`)
    .join('');
  el.geokey.innerHTML =
    `<b>Geometry</b>${rows}` +
    `<span style="color:#ffffff"><i></i>Flippers</span>` +
    `<small>dashed = sensor · red = switched off</small>`;
}

/* ---------- NOVA ---------- */

/**
 * The space board is drawn as lit parts on a dark deck, from its colliders.
 *
 * The castle's drawing is a painting with state layered over it, because its art
 * is one flat image that came first. NOVA is the other way round: the geometry
 * was authored and the art is separate pieces fitted to it, so anything without
 * a piece yet is drawn from the collider that is already there. Nothing here
 * needs a coordinate of its own, which is why the board was playable and looked
 * finished with two of its nine pieces done.
 *
 * The look is a consequence of that rather than a style choice. A lit edge is
 * the honest way to draw a shape whose only definition is a line the ball
 * bounces off.
 */
const NOVA = {
  rail: '#5fd0ff',
  railGlow: 'rgb(95 208 255 / 0.20)',
  amber: '#ffb648',
  amberGlow: 'rgb(255 182 72 / 0.22)',
  violet: '#c39bff',
  violetGlow: 'rgb(195 155 255 / 0.22)',
  rose: '#ff7ea8',
  roseGlow: 'rgb(255 126 168 / 0.22)',
  dead: 'rgb(120 140 160 / 0.30)',
};

/** A lit line: a wide soft pass for the bloom, then a bright core on top. */
function glowSegment(seg, colour, glow, width) {
  strokeSegment(seg, glow, width * 3.2);
  strokeSegment(seg, colour, width);
}

/**
 * Lay a sprite along a collider, so its own middle runs down the line the ball
 * actually touches.
 *
 * The image is drawn with its horizontal centreline mapped onto `a`..`b`, which
 * means a part can only ever appear along the thing it collides with. Same rule
 * as the castle's habitrail and its two supplied rails: the drawing is placed
 * from the geometry, never traced next to it.
 */
function drawSpriteAlong(image, a, b, thickness) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  ctx.save();
  ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
  ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
  ctx.drawImage(image, -len / 2, -thickness / 2, len, thickness);
  ctx.restore();
}

/**
 * A sprite centred on a circular collider, drawn `spread` times its radius.
 *
 * `spread` is above one for the bumpers on purpose. A real pop bumper's plastic
 * cap is wider than the skirt the ball actually touches, so a cap painted at 59
 * against a collider of 36 is the real part rather than a mismatch. The castle
 * measured that ratio at 1.64 off its own art.
 */
function drawSpriteOn(image, circle, spread) {
  const r = circle.radius * spread;
  ctx.drawImage(image, circle.c.x - r, circle.c.y - r, r * 2, r * 2);
}

function novaDeck() {
  if (art.playfield) {
    ctx.drawImage(art.playfield, 0, 0, TABLE_W, TABLE_H);
    return;
  }
  const g = ctx.createLinearGradient(0, 0, 0, TABLE_H);
  g.addColorStop(0, '#0a1220');
  g.addColorStop(1, '#050a12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TABLE_W, TABLE_H);
}

/**
 * The station hull, scaled onto the box its own colliders occupy.
 *
 * The sprite is cropped to its silhouette, so its bounds ARE this box and there
 * is no offset for anyone to get wrong. Its painted docking bay sits at centre
 * fraction 0.499 of that silhouette and the collision bay is at 0.494, so the
 * two land within three units of each other without a number being chosen.
 */
function novaStation() {
  const s = NOVA_ART.station;
  const left = Math.min(...s.leftFace.map(([x]) => x));
  const top = Math.min(s.rightTop, ...s.leftFace.map(([, y]) => y));
  const w = s.rightX - left;
  const h = s.bottom - top;

  if (art.station) {
    ctx.drawImage(art.station, left, top, w, h);
    return;
  }
  ctx.save();
  ctx.fillStyle = 'rgb(22 32 46 / 0.92)';
  ctx.strokeStyle = NOVA.rail;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(...s.leftFace[0]);
  for (const [x, y] of s.leftFace.slice(1)) ctx.lineTo(x, y);
  ctx.lineTo(s.rightX, s.bottom);
  ctx.lineTo(s.rightX, s.rightTop);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawNova(now) {
  novaDeck();

  // Walls and rails first, so everything solid sits on top of them.
  for (const c of game.table.colliders) {
    if (!c.active || c.sensor || !c.seg) continue;
    const id = c.id;
    if (id.startsWith('wall')) glowSegment(c.seg, NOVA.rail, NOVA.railGlow, 6);
    else if (id.startsWith('orbit') || id.startsWith('lane')) glowSegment(c.seg, NOVA.rail, NOVA.railGlow, 5);
  }

  novaStation();

  for (const c of game.table.colliders) {
    if (!c.active || c.sensor) continue;

    if (c.type === 'circle') {
      const { c: p, radius } = c.circle;
      const isBumper = c.id.startsWith('bumper');
      if (isBumper && art.bumper) {
        drawSpriteOn(art.bumper, c.circle, 1.55);
        continue;
      }
      ctx.save();
      ctx.fillStyle = isBumper ? 'rgb(38 26 12 / 0.9)' : 'rgb(18 30 44 / 0.9)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isBumper ? NOVA.amber : NOVA.rail;
      ctx.lineWidth = isBumper ? 7 : 5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius - 3, 0, Math.PI * 2);
      ctx.stroke();
      if (isBumper) {
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(p.x, p.y, radius * 0.2, p.x, p.y, radius * 1.5);
        g.addColorStop(0, 'rgb(255 190 90 / 0.42)');
        g.addColorStop(1, 'rgb(255 170 60 / 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      continue;
    }

    const seg = c.seg;
    if (!seg) continue;
    const id = c.id;
    if (id.startsWith('gantry')) {
      if (art.gantry) drawSpriteAlong(art.gantry, seg.a, seg.b, 46);
      else glowSegment(seg, NOVA.rail, NOVA.railGlow, 7);
    } else if (id.startsWith('sling')) {
      if (art.sling) drawSpriteAlong(art.sling, seg.a, seg.b, 54);
      else glowSegment(seg, NOVA.rose, NOVA.roseGlow, 13);
    }
    else if (id.startsWith('triangle')) strokeSegment(seg, 'rgb(255 126 168 / 0.45)', 11);
    // Butt caps, so three targets read as one bar rather than closing their gaps.
    else if (id.startsWith('target-')) {
      if (art.target) drawSpriteAlong(art.target, seg.a, seg.b, 76);
      else glowSegment(seg, NOVA.amber, NOVA.amberGlow, 13);
    }
    else if (id === 'portcullis') glowSegment(seg, NOVA.rail, NOVA.railGlow, 11);
    else if (id.startsWith('scoopwall')) strokeSegment(seg, 'rgb(195 155 255 / 0.55)', 5);
    else if (id.startsWith('station')) strokeSegment(seg, 'rgb(95 208 255 / 0.35)', 3);
  }

  // A knocked-down target still occupies its slot, so it is drawn dark rather
  // than removed. A shape that vanishes reads as a rendering fault.
  for (const target of game.table.targets) {
    if (target.active || !target.seg) continue;
    if (art.target) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      drawSpriteAlong(art.target, target.seg.a, target.seg.b, 76);
      ctx.restore();
    } else {
      strokeSegment(target.seg, NOVA.dead, 13, 'butt');
    }
  }

  novaScoops();
  novaLamps();
  drawLights(now);
}

/**
 * NOVA's wormholes, drawn on the bowl the ball is actually caught in.
 *
 * The castle's version paints a gold lip across the opening only, because its
 * bowls are painted into the playfield image underneath and all that is missing
 * is the state. There is no painting under these, so the whole collar is drawn,
 * centred on the collider and sized from its radius.
 *
 * Dimmed while the coil reloads, which is the one thing the player needs to know
 * about a hole: whether it will take the ball right now.
 */
function novaScoops() {
  if (!art.scoopRim) {
    drawScoops();
    return;
  }
  for (const s of game.table.scoops) {
    const ready = !game.cooldowns.has(s.id);
    ctx.save();
    ctx.globalAlpha = ready ? 1 : 0.45;
    drawSpriteOn(art.scoopRim, { c: s.centre, radius: s.radius }, 1.3);
    ctx.restore();
  }
}

/**
 * NOVA's nav beacons, drawn as lenses rather than as glows.
 *
 * The castle's `drawLamps` cannot be reused here and the reason is the deck it
 * assumes. It paints a bright radial gradient in `lighter` mode, which reads as
 * a warm glow on pale maple and saturates to a near-white disc on a dark one.
 * Sixteen of those lit at once covered half the board in pale blobs, and the
 * board looked broken rather than lit.
 *
 * The unlit ones are drawn too, which the castle never needed. Its lenses are
 * painted into the playfield image, so the player can see where they are before
 * collecting them. NOVA has no paint under these, so without a ring there is
 * nothing on the board saying what is left to go and get.
 */
function novaLamps() {
  const lit = readout(game).lampsLit;
  for (const c of game.table.colliders) {
    if (!c.circle || !c.id.startsWith('lamp-')) continue;
    const { x, y } = c.circle.c;
    // Inside the collider, so a lens is never drawn wider than the thing that
    // actually catches the ball.
    const r = c.circle.radius * 0.7;
    const on = lit.has(c.id);

    // The painted lens, when there is one. Unlit it is dimmed rather than
    // hidden, because the player needs to see which beacons are left to collect
    // and this board has no lenses printed into the deck underneath.
    if (art.lens) {
      ctx.save();
      // No additive bloom on top. The painted lens already has a lit dome and a
      // specular highlight in it, and adding a `lighter` gradient over twenty-one
      // of them turned the board back into the field of pale discs the drawn
      // version produced. Lit is the sprite at full strength, unlit is the same
      // sprite dimmed, and that is the whole difference.
      ctx.globalAlpha = on ? 1 : 0.32;
      drawSpriteOn(art.lens, c.circle, 0.95);
      ctx.restore();
      continue;
    }

    ctx.save();
    ctx.fillStyle = on ? 'rgb(255 206 118 / 0.13)' : 'rgb(120 165 200 / 0.05)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = on ? 'rgb(255 204 112 / 0.80)' : 'rgb(130 175 210 / 0.24)';
    ctx.lineWidth = on ? 3 : 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    if (on) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 1.6);
      g.addColorStop(0, 'rgb(255 200 110 / 0.15)');
      g.addColorStop(1, 'rgb(255 170 60 / 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function render(now) {
  ctx.clearRect(0, 0, TABLE_W, TABLE_H);

  if (game.table.id === 'nova') {
    drawNova(now);
  } else {
    if (art.playfield) ctx.drawImage(art.playfield, 0, 0, TABLE_W, TABLE_H);
    else drawSurface();

    if (!art.playfield) {
      drawCastle();
      drawFurniture();
    } else {
      drawStateOverArt();
    }
    drawHabitrail();
    drawLamps();
    drawScoops();
    drawLowerRails();
    drawLights(now);
  }

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
    // The lamp lenses are the one thing on this table the ball passes straight
    // over, so lighting them is the only way the player learns they are there.
    else if (e.kind === 'lamp') flash(e.at.x, e.at.y, 34, '255 236 170', 420);
    else if (e.kind === 'scoopCaught') flash(e.at.x, e.at.y, 70, '255 200 110', 900);
    else if (e.kind === 'scoopFired') flash(e.at.x, e.at.y, 90, '255 240 190', 500);
    else if (e.kind === 'keepTaken') flash(gateCentre().x, gateCentre().y, 200, '255 225 150', 900);
    else if (e.kind === 'gateOpen') flash(gateCentre().x, gateCentre().y, 160, '216 168 66', 700);
    // A save that looks identical to losing a ball teaches the player nothing.
    else if (e.kind === 'ballSaved') flash(TABLE_W / 2, 1300, 240, '120 255 170', 1100);
    else if (e.kind === 'gameOver') finish(e.score);
  }
}

function finish(score) {
  if (score > best) {
    best = score;
    localStorage.setItem(bestKeyFor(boardId), String(best));
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
  game = createGame(boardId);
  flashes.length = 0;
  trail.length = 0;
  return true;
}

/**
 * Change machine.
 *
 * A fresh game rather than carrying the ball across, because the two boards do
 * not share a drain line, a plunger rest or a pair of flipper pivots, and a ball
 * mid-flight on one of them is nowhere in particular on the other.
 */
function selectBoard(id) {
  if (!KNOWN_BOARDS.includes(id) || id === boardId) return;
  boardId = id;
  localStorage.setItem(BOARD_KEY, boardId);
  best = Number(localStorage.getItem(bestKeyFor(boardId)) ?? 0) || 0;
  loadBoardArt(boardId);
  game = createGame(boardId);
  flashes.length = 0;
  trail.length = 0;
  applyBoardChrome();
  if (showGeometry) buildGeometryKey();
  updateHud(readout(game));
}

/** The wordmark, the picker's label and the level caption all name the board. */
function applyBoardChrome() {
  const here = TABLES.find((b) => b.id === boardId);
  const next = TABLES[(TABLES.findIndex((b) => b.id === boardId) + 1) % TABLES.length];
  if (el.wordmark) el.wordmark.textContent = here.name;
  if (el.board) {
    // The glyph matters. A button whose whole label is the other board's name
    // reads as "you are on NOVA" just as easily as "switch to NOVA", and those
    // are opposite meanings. An arrow settles it.
    el.board.textContent = `\u21c4 ${next.name}`;
    el.board.setAttribute('aria-label', `${t('nav.board')}: ${next.name}`);
  }
  if (el.levelLabel) el.levelLabel.textContent = t(boardId === 'nova' ? 'hud.wave' : 'hud.siege');
  document.title = `${here.name} · ${t('meta.tagline')}`;
}

/** Move `step` boards along the list, wrapping. The button is just step = 1. */
function stepBoard(step) {
  const i = TABLES.findIndex((b) => b.id === boardId);
  const next = (i + step + TABLES.length) % TABLES.length;
  selectBoard(TABLES[next].id);
}

function cycleBoard() {
  stepBoard(1);
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
/**
 * Swipe across the board to change machine, which is the phone's version of the
 * header button.
 *
 * It has to share the canvas with the flippers, and the flippers cannot wait:
 * a bat that fires on pointerUP is a bat that arrives after the ball has gone,
 * so tapping still flips on pointerDOWN exactly as before. A swipe is therefore
 * recognised at the END of the gesture and simply undoes the flip it caused.
 * A stray flick of a bat with no ball near it costs nothing; a late flipper
 * costs the ball.
 *
 * The bar is set deliberately high. Switching starts a fresh game, so an
 * accidental swipe would throw away whatever was in progress: it wants a third
 * of the board's width, mostly sideways, and inside three quarters of a second.
 * Nobody does that by accident while playing, and nobody fails to do it on
 * purpose.
 */
const SWIPE_FRACTION = 0.33;
const SWIPE_SLOPE = 1.8;
const SWIPE_MS = 750;

let gesture = null;

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (restartIfOver()) return;
  const box = canvas.getBoundingClientRect();
  const x = (e.clientX - box.left) / box.width;
  const y = (e.clientY - box.top) / box.height;
  gesture = { x: e.clientX, y: e.clientY, at: performance.now(), width: box.width };
  if (y > 0.88) pressAction('plunger');
  else if (x < 0.5) pressAction('left');
  else pressAction('right');
});

const release = () => {
  releaseAction('left');
  releaseAction('right');
  releaseAction('plunger');
};

/** True if this gesture was a deliberate sideways swipe rather than a tap. */
function swipeDirection(e) {
  if (!gesture) return 0;
  const dx = e.clientX - gesture.x;
  const dy = e.clientY - gesture.y;
  if (performance.now() - gesture.at > SWIPE_MS) return 0;
  if (Math.abs(dx) < gesture.width * SWIPE_FRACTION) return 0;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_SLOPE) return 0;
  return dx < 0 ? 1 : -1;
}

canvas.addEventListener('pointerup', (e) => {
  const swipe = swipeDirection(e);
  gesture = null;
  release();
  if (swipe) stepBoard(swipe);
});

canvas.addEventListener('pointercancel', () => {
  gesture = null;
  release();
});
addEventListener('blur', () => {
  gesture = null;
  release();
});

el.lang.addEventListener('click', () => {
  toggleLanguage();
  el.lang.textContent = currentLanguage() === 'de' ? 'EN' : 'DE';
  applyBoardChrome();
  updateHud(readout(game));
});

if (el.board) el.board.addEventListener('click', cycleBoard);

function toggleGeometry() {
  showGeometry = !showGeometry;
  el.debug.setAttribute('aria-pressed', String(showGeometry));
  if (showGeometry) buildGeometryKey();
  el.geokey.hidden = !showGeometry;
}

el.debug.addEventListener('click', toggleGeometry);

// G, as well as the button. Auditing the table means turning this on and off
// dozens of times against the same frame, and reaching for a button in the
// corner every time is enough friction to stop you checking.
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyG' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  toggleGeometry();
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
applyBoardChrome();
el.lang.textContent = currentLanguage() === 'de' ? 'EN' : 'DE';
requestAnimationFrame(frame);
