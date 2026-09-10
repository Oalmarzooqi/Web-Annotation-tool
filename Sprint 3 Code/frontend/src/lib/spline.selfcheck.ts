/**
 * Self-check for splinePath / nextSplineName. No test framework — run it directly:
 *   node --experimental-strip-types frontend/src/lib/spline.selfcheck.ts
 */
import assert from "node:assert/strict";
import { collectSplines, nextSplineName, splinePath } from "./spline.ts";

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// Too few points to curve — passed straight through.
assert.deepEqual(splinePath([]), []);
assert.deepEqual(splinePath([{ x: 1, y: 2 }]), [{ x: 1, y: 2 }]);
assert.deepEqual(
  splinePath([
    { x: 0, y: 0 },
    { x: 10, y: 5 },
  ]),
  [
    { x: 0, y: 0 },
    { x: 10, y: 5 },
  ],
);

{
  const ctrl = [
    { x: 0, y: 10 },
    { x: 10, y: 30 },
    { x: 20, y: 5 },
    { x: 30, y: 25 },
  ];
  const path = splinePath(ctrl, 8);

  // Every control point lies on the curve — that is the whole reason for
  // Catmull-Rom over midpoint smoothing.
  for (const c of ctrl) {
    assert.ok(
      path.some((p) => near(p.x, c.x) && near(p.y, c.y)),
      `control point ${JSON.stringify(c)} is not on the sampled curve`,
    );
  }

  // Endpoints are exact and ordered.
  assert.deepEqual(path[0], ctrl[0]);
  assert.deepEqual(path[path.length - 1], ctrl[ctrl.length - 1]);
  assert.equal(path.length, (ctrl.length - 1) * 8 + 1);

  // Smooth: no sample jumps further than the widest control gap.
  for (let i = 1; i < path.length; i++) {
    const d = Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
    assert.ok(d < 15, `sample ${i} jumped ${d}`);
  }
}

// A straight run of control points stays straight (no overshoot wobble).
{
  const path = splinePath(
    [
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 30, y: 10 },
    ],
    4,
  );
  for (const p of path) assert.ok(near(p.y, 10), `straight line bowed to y=${p.y}`);
}

// Naming fills the first free slot rather than counting entries.
assert.equal(nextSplineName([]), "Spline 1");
assert.equal(nextSplineName(["Spline 1", "Spline 2"]), "Spline 3");
assert.equal(nextSplineName(["Spline 2"]), "Spline 1");
assert.equal(nextSplineName(["ILM trace"]), "Spline 1");

// Export: many splines per frame, each carrying its own name, image and frame.
{
  const pts = [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ];
  const files = {
    "b.tif": { 3: [{ id: "s3", labelId: "l1", type: "spline", name: "RPE trace", points: pts }] },
    "a.tif": {
      0: [
        { id: "s1", labelId: "l1", type: "spline", name: "Spline 2", points: pts },
        { id: "s2", labelId: "l2", type: "spline", name: "Spline 1", points: pts },
        { id: "p1", labelId: "l1", type: "point", points: [{ x: 9, y: 9 }] },
      ],
      // Legacy/empty shapes in stored projects must not throw.
      7: [],
    },
    "empty.tif": [],
  };
  const rows = collectSplines(
    files as unknown as Parameters<typeof collectSplines>[0],
    [
      { id: "l1", name: "ILM" },
      { id: "l2", name: "RPE" },
    ],
  );

  assert.equal(rows.length, 3, "non-spline annotations must be filtered out");
  assert.deepEqual(
    rows.map((r) => [r.image, r.frame, r.name, r.label]),
    [
      ["a.tif", 0, "Spline 1", "RPE"],
      ["a.tif", 0, "Spline 2", "ILM"],
      ["b.tif", 3, "RPE trace", "ILM"],
    ],
  );
  assert.deepEqual(rows[0]!.points, pts);
  assert.equal(typeof rows[2]!.frame, "number", "frame keys survive JSON as numbers");
  assert.deepEqual(collectSplines({}, []), []);
}

console.log("spline.selfcheck: all assertions passed");
