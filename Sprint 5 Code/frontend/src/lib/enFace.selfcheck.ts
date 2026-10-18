/**
 * Self-check for the top-view (en-face) projection helpers. No test framework — run it directly:
 *   node --experimental-strip-types frontend/src/lib/enFace.selfcheck.ts
 */
import assert from "node:assert/strict";
import { buildEnFaceFrame, columnAverages, resampleRows } from "./enFace.ts";

// A 2x2 RGBA frame: left column bright, right column dark.
const W = 2;
const H = 2;
const rgba = new Uint8ClampedArray([
  255, 255, 255, 255, 0, 0, 0, 255, // row 0: bright, dark
  255, 255, 255, 255, 0, 0, 0, 255, // row 1: bright, dark
]);

{
  const row = columnAverages(rgba, W, H);
  assert.equal(row.length, W);
  assert.ok(row[0]! > row[1]!, "left column should average brighter than right");
  assert.ok(Math.abs(row[0]! - 255) < 1e-6);
  assert.ok(Math.abs(row[1]! - 0) < 1e-6);
}

// Zero-height frame doesn't divide by zero.
{
  const row = columnAverages(new Uint8ClampedArray(0), 3, 0);
  assert.deepEqual(Array.from(row), [0, 0, 0]);
}

// Stacking rows into a frame: min/max stretch spans the full 0-255 range.
{
  const rows = [new Float32Array([10, 50]), new Float32Array([90, 10])];
  const frame = buildEnFaceFrame(rows, 2);
  assert.equal(frame.width, 2);
  assert.equal(frame.height, 2);
  // row 0 col 0 (value 10, the overall min) -> 0
  assert.equal(frame.rgba[0], 0);
  // row 1 col 0 (value 90, the overall max) -> 255
  assert.equal(frame.rgba[(1 * 2 + 0) * 4], 255);
  // alpha is always opaque
  for (let i = 3; i < frame.rgba.length; i += 4) assert.equal(frame.rgba[i], 255);
}

// A single constant value doesn't blow up the span (division by zero guard).
{
  const rows = [new Float32Array([7, 7]), new Float32Array([7, 7])];
  const frame = buildEnFaceFrame(rows, 2);
  for (const v of frame.rgba) assert.ok(Number.isFinite(v));
}

// No slices -> an empty frame, not a crash.
{
  const frame = buildEnFaceFrame([], 10);
  assert.equal(frame.height, 0);
  assert.equal(frame.rgba.length, 0);
}

// resampleRows: a sparse slice axis stretches up to the target row count,
// linearly interpolating between the two nearest source rows.
{
  const rows = [new Float32Array([0, 0]), new Float32Array([10, 20])];
  const out = resampleRows(rows, 5);
  assert.equal(out.length, 5);
  assert.deepEqual(Array.from(out[0]!), [0, 0]); // first row unchanged
  assert.deepEqual(Array.from(out[4]!), [10, 20]); // last row unchanged
  assert.ok(out[2]![0]! > out[0]![0]! && out[2]![0]! < out[4]![0]!, "middle row interpolates");
}

// resampleRows: matching length is returned as-is (no distortion).
{
  const rows = [new Float32Array([1]), new Float32Array([2])];
  assert.equal(resampleRows(rows, 2), rows);
}

// resampleRows: a single slice repeats flat across every output row.
{
  const rows = [new Float32Array([5, 6])];
  const out = resampleRows(rows, 3);
  assert.equal(out.length, 3);
  for (const row of out) assert.deepEqual(Array.from(row), [5, 6]);
}

// buildEnFaceFrame always comes out square (slice axis resampled to width),
// which is what actually matches a square scan's real field of view —
// stacking raw per-slice rows 1:1 would render a square cube scan as a flat
// strip, since it's sampled far more densely across a B-scan than along the
// slice axis.
{
  const narrowRows = [new Float32Array([1, 2, 3, 4]), new Float32Array([5, 6, 7, 8])]; // 2 slices
  const frame = buildEnFaceFrame(narrowRows, 4); // 4 columns
  assert.equal(frame.width, 4);
  assert.equal(frame.height, 4);
}

console.log("enFace self-check passed");
