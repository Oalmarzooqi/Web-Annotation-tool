/**
 * Self-check for extendToEdges. No test framework — run it directly:
 *   node --experimental-strip-types frontend/src/lib/layerLine.selfcheck.ts
 */
import assert from "node:assert/strict";
import { extendToEdges } from "./layerLine.ts";

const W = 100;
const H = 50;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// Empty in, empty out.
assert.deepEqual(extendToEdges([], W, H), []);

// A single point has no slope — it runs flat edge to edge.
{
  const r = extendToEdges([{ x: 40, y: 20 }], W, H);
  assert.deepEqual(r, [
    { x: 0, y: 20 },
    { x: 100, y: 20 },
  ]);
}

// Flat pair spans the width at the same y.
{
  const r = extendToEdges(
    [
      { x: 20, y: 30 },
      { x: 60, y: 30 },
    ],
    W,
    H,
  );
  assert.equal(r.length, 4);
  assert.deepEqual(r[0], { x: 0, y: 30 });
  assert.deepEqual(r[r.length - 1], { x: 100, y: 30 });
}

// Sloped ends extrapolate along their own segment.
{
  // (20,10)->(60,30) is slope 0.5: at x=0 => 0, at x=100 => 50.
  const r = extendToEdges(
    [
      { x: 20, y: 10 },
      { x: 60, y: 30 },
    ],
    W,
    H,
  );
  assert.ok(near(r[0]!.y, 0), `left end ${r[0]!.y}`);
  assert.ok(near(r[r.length - 1]!.y, 50), `right end ${r[r.length - 1]!.y}`);
}

// A steep slope would shoot off-image; y clamps into [0, height].
{
  const r = extendToEdges(
    [
      { x: 40, y: 10 },
      { x: 50, y: 40 },
    ],
    W,
    H,
  );
  for (const p of r) {
    assert.ok(p.y >= 0 && p.y <= H, `y out of range: ${p.y}`);
  }
  assert.equal(r[0]!.x, 0);
  assert.equal(r[r.length - 1]!.x, W);
}

// Points clicked out of order are sorted by x, so the span is still monotonic.
{
  const r = extendToEdges(
    [
      { x: 70, y: 25 },
      { x: 10, y: 15 },
      { x: 40, y: 20 },
    ],
    W,
    H,
  );
  for (let i = 1; i < r.length; i++) {
    assert.ok(r[i]!.x >= r[i - 1]!.x, `not sorted at ${i}`);
  }
  assert.equal(r[0]!.x, 0);
  assert.equal(r[r.length - 1]!.x, W);
}

// Points already touching the edges are not duplicated.
{
  const r = extendToEdges(
    [
      { x: 0, y: 10 },
      { x: 50, y: 20 },
      { x: 100, y: 30 },
    ],
    W,
    H,
  );
  assert.equal(r.length, 3);
}

// A vertical end segment holds its y rather than dividing by zero.
{
  const r = extendToEdges(
    [
      { x: 30, y: 10 },
      { x: 30, y: 40 },
      { x: 60, y: 40 },
    ],
    W,
    H,
  );
  assert.ok(Number.isFinite(r[0]!.y), "left end not finite");
  assert.equal(r[0]!.x, 0);
}

console.log("layerLine self-check passed");
