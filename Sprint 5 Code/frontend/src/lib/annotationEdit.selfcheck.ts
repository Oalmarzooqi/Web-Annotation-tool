/**
 * Self-check for annotationEdit insert-point helpers. No test framework — run it directly:
 *   node --experimental-strip-types frontend/src/lib/annotationEdit.selfcheck.ts
 */
import assert from "node:assert/strict";
import { findInsertSegment, insertAnnotationPoint } from "./annotationEdit.ts";
import type { Annotation } from "../components/oct/OctCanvas.ts";

const frame = { width: 100, height: 100 };

const layer: Annotation = {
  id: "a1",
  labelId: "l1",
  type: "layer",
  points: [
    { x: 10, y: 10 },
    { x: 50, y: 10 },
    { x: 90, y: 10 },
  ],
};

// A point and a fixed-length line have no body to extend.
assert.equal(
  findInsertSegment({ id: "p", labelId: "l", type: "point", points: [{ x: 5, y: 5 }] }, { x: 5, y: 5 }, 5, 5),
  null,
);
assert.equal(
  findInsertSegment(
    { id: "l", labelId: "l", type: "line", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
    { x: 5, y: 5 },
    5,
    5,
  ),
  null,
);

// Clicking near the first segment (10,10)-(50,10) picks segment 0.
assert.equal(findInsertSegment(layer, { x: 30, y: 10 }, 5, 5), 0);
// Clicking near the second segment (50,10)-(90,10) picks segment 1.
assert.equal(findInsertSegment(layer, { x: 70, y: 10 }, 5, 5), 1);
// Far from any segment: no match.
assert.equal(findInsertSegment(layer, { x: 30, y: 80 }, 5, 5), null);

// Insert lands between the two points of the hit segment.
{
  const next = insertAnnotationPoint(layer, 0, { x: 30, y: 12 }, frame);
  assert.equal(next.points.length, 4);
  assert.deepEqual(next.points[1], { x: 30, y: 12 });
  assert.deepEqual(next.points[0], layer.points[0]);
  assert.deepEqual(next.points[3], layer.points[2]);
  // Original annotation is untouched.
  assert.equal(layer.points.length, 3);
}

// Insert clamps into the frame bounds.
{
  const next = insertAnnotationPoint(layer, 1, { x: 200, y: -50 }, frame);
  const inserted = next.points[2]!;
  assert.ok(inserted.x <= frame.width);
  assert.equal(inserted.y, 0);
}

// Polygon wraps its last segment back to the first point.
{
  const poly: Annotation = {
    id: "poly",
    labelId: "l",
    type: "polygon",
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
  };
  assert.equal(findInsertSegment(poly, { x: 5, y: 5 }, 2, 2), 2);
  const next = insertAnnotationPoint(poly, 2, { x: 5, y: 5 }, frame);
  assert.equal(next.points.length, 4);
  assert.deepEqual(next.points[3], { x: 5, y: 5 });
}

console.log("annotationEdit self-check passed");
