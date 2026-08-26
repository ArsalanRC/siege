/**
 * Print a table's whole collider set as stable JSON.
 *
 *     pnpm build:site && node tools/dump-table.mjs [id] > before.json
 *
 * This exists for refactors. Moving the castle table into a registry so a second
 * board can sit beside it touches every line of the file that a week of
 * measuring produced, and "the tests still pass" is a weaker claim than "not one
 * number moved". Diff two dumps and the second claim is the one you get.
 *
 * It dumps colliders and scoops only, because those are the geometry. Anything
 * the refactor adds around them is new by definition and would only make the
 * diff noisy.
 */

import { buildTable } from '../site/lib/engine/tables/index.js';

// Tolerant of arity on purpose, so the same script runs either side of the
// change that gives `buildTable` an id to take.
const table = buildTable.length === 0 ? buildTable() : buildTable(process.argv[2] ?? 'siege');

const round = (n) => Math.round(n * 1e6) / 1e6;
const place = (v) => (v ? { x: round(v.x), y: round(v.y) } : null);

const shape = (c) => {
  if (c.type === 'segment' && c.seg) {
    return { a: place(c.seg.a), b: place(c.seg.b), r: round(c.seg.radius) };
  }
  if (c.circle) return { c: place(c.circle.c), r: round(c.circle.radius) };
  return null;
};

console.log(JSON.stringify({
  lampCount: table.lampCount,
  scoops: table.scoops.map((s) => ({
    id: s.id, centre: place(s.centre), radius: round(s.radius),
    hold: place(s.hold), eject: place(s.eject), mouth: place(s.mouth),
  })),
  colliders: table.colliders.map((c) => ({
    id: c.id, type: c.type, sensor: c.sensor, active: c.active,
    kick: c.kick, material: c.material, shape: shape(c),
  })),
}, null, 1));
