# SIEGE

A pinball table with physics written by hand. No game engine, no physics
library, no bundler, no dependencies. It opens in a browser and it plays.

[Deutsch](README.de.md)

---

## What it is

Three balls and one castle. Knock all three targets down and the portcullis
lifts. Shoot the open mouth and you take the keep. The targets stand back up,
the siege goes up a level, and everything on the table is worth more than it
was. Lose a ball and the siege resets to one.

The table is 1024 by 1536 units, which is one unit per pixel of the playfield.
Nothing in the code ever converts between two coordinate systems.

## The physics

The whole simulation is a ball, a list of line segments, and a list of circles.
Curves are broken into segments when the table is built, so the collision
resolver has two cases rather than nine. Two cases fit in your head.

Nothing is tuned by feel. The numbers come from a real machine:

| | |
|---|---|
| Playfield width | 20.25 inches, drawn 1024 units wide, so **1992 units per metre** |
| Ball | 1.0625 inches across, so a radius of **27 units** |
| Gravity | `9.81 · sin(6.5°)`, the slope of a levelled table, so **2213 units/s²** |
| Flipper | 3 inches long, sweeping 60 degrees in 35 milliseconds, so **32 rad/s** |

A flipper is a capsule turning about a pivot, and the physics adds the surface
speed at the point of contact before working out the bounce. Nothing favours
the tip. It falls out of `omega · r` on its own, which is why a tip shot is
worth aiming for and why nobody had to write that down.

### Why the substep count is computed

Collision is discrete. Each substep moves the ball, then asks what it overlaps.
That has exactly one failure mode: a ball moving further in a step than its own
radius passes clean through a wall. Nothing errors. The ball is simply gone.

A ball off a hard flipper does about 6 m/s, or 12000 units a second. At a fixed
240 Hz that is 50 units a step against a 27 unit ball, so it tunnels. Running
everything at 1000 Hz instead would pay for the worst case constantly, while
the ball spends most of its life slow.

So the step count comes from the speed, and never moves more than half a radius
at a time. A resting ball costs one substep. A launched ball costs forty.

The frame length is clamped inside `step` rather than by whoever calls it. A
backgrounded tab hands back four seconds when it wakes, and the guarantee used
to live in a comment asking callers to be careful. That is how a safety
property quietly stops holding.

## Running it

```sh
pnpm install
pnpm test        # 77 tests, all headless
pnpm typecheck
pnpm build:site  # emits the engine into site/lib
```

Then serve `site/` with anything. There is no build beyond `tsc`, and the page
imports the compiled engine directly, so the table you play is the code the
tests run against.

## Layout

```
src/engine/   pure TypeScript. No DOM, no framework, no dependency
  vec.ts        2D vectors
  shapes.ts     segments, circles, contacts, curve tessellation
  physics.ts    integration, collision response, substepping
  flipper.ts    the two moving surfaces
  table.ts      SIEGE, as data
  game.ts       balls, scoring, the siege
tests/        vitest
site/         hand-written HTML, CSS and JS
```

`src` writes `.js` on its own imports, so `tsc` output loads in a browser
untouched.

## A note on the art

The playfield art is optional and loads from `site/art/` if it is there. The
table draws itself from its own collision geometry otherwise, which means the
walls on screen are the walls the ball hits, by construction rather than by two
descriptions being kept in step.

---

MIT. Built by [Arsalan Khadim](https://github.com/ArsalanRC).
