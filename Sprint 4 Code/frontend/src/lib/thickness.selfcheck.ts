/**
 * Self-check for the thickness maths. No test framework — run it directly:
 *   node --experimental-strip-types frontend/src/lib/thickness.selfcheck.ts
 */
import assert from "node:assert/strict";
import type { Annotation, ImagePoint } from "../components/oct/OctCanvas";
import {
  avgStdRange,
  boundaryPolyline,
  buildThicknessGrid,
  isBoundary,
  sampleY,
  sliceThickness,
  thicknessColor,
  thicknessMatrix,
  thicknessRgb,
  thicknessStats,
  sectorStats,
  interpolateRows,
  DEFAULT_SECTOR_RADII_UM,
} from "./thickness.ts";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

const W = 10;
const H = 400;
const AXIAL = 1.61; // um per axial pixel, the Bioptigen value

const layer = (id: string, labelId: string, pts: [number, number][]): Annotation => ({
  id,
  labelId,
  type: "layer",
  points: pts.map(([x, y]) => ({ x, y })),
});

const spline = (id: string, labelId: string, pts: [number, number][]): Annotation => ({
  id,
  labelId,
  type: "spline",
  name: id,
  points: pts.map(([x, y]) => ({ x, y })),
});

// ── 1. Worked numeric case ──────────────────────────────────────────────────
// Two flat boundaries 100 px apart: every column is 100 * 1.61 = 161 um exactly.
{
  const flatTop = layer("a", "ilm", [[2, 100], [5, 100], [8, 100]]);
  const flatBot = layer("b", "rpe", [[2, 200], [5, 200], [8, 200]]);

  const t = sliceThickness([flatTop, flatBot], "ilm", "rpe", W, H, AXIAL);
  assert.ok(t, "both boundaries present -> a profile");
  assert.equal(t!.length, W);
  for (let x = 0; x < W; x++) {
    assert.ok(near(t![x]!, 161), `column ${x} is 161um, got ${t![x]}`);
  }

  const stats = thicknessStats([{ slice: 0, values: t! }]);
  assert.equal(stats.count, W);
  assert.ok(near(stats.mean, 161));
  assert.ok(near(stats.min, 161));
  assert.ok(near(stats.max, 161));
  assert.ok(near(stats.stdev, 0));
}

// ── 2. Order independence ───────────────────────────────────────────────────
// |yA - yB| means the dropdown order cannot change the answer.
{
  const top = layer("a", "ilm", [[0, 120], [9, 140]]);
  const bot = layer("b", "rpe", [[0, 260], [9, 250]]);

  const ab = sliceThickness([top, bot], "ilm", "rpe", W, H, AXIAL)!;
  const ba = sliceThickness([top, bot], "rpe", "ilm", W, H, AXIAL)!;
  for (let x = 0; x < W; x++) assert.ok(near(ab[x]!, ba[x]!), `column ${x} order-independent`);
}

// ── 3. Tilted boundary ──────────────────────────────────────────────────────
// Top slopes 100 -> 110 across x=0..9 against a flat 200: thickness shrinks
// linearly from 100px (161um) to 90px (144.9um), losing 1px (1.61um) per column.
{
  const tilted = layer("a", "ilm", [[0, 100], [9, 109]]);
  const flat = layer("b", "rpe", [[0, 200], [9, 200]]);
  const t = sliceThickness([tilted, flat], "ilm", "rpe", W, H, AXIAL)!;

  assert.ok(near(t[0]!, 100 * AXIAL), `x=0 is 161um, got ${t[0]}`);
  assert.ok(near(t[9]!, 91 * AXIAL), `x=9 is ${91 * AXIAL}um, got ${t[9]}`);
  for (let x = 1; x < W; x++) {
    assert.ok(t[x]! < t[x - 1]!, `strictly decreasing at column ${x}`);
    assert.ok(near(t[x - 1]! - t[x]!, AXIAL), `loses exactly 1px per column at ${x}`);
  }
}

// ── 4. Gaps stay NaN ────────────────────────────────────────────────────────
{
  // A slice missing one label yields no row at all.
  const onlyOne = layer("a", "ilm", [[0, 100], [9, 100]]);
  assert.equal(sliceThickness([onlyOne], "ilm", "rpe", W, H, AXIAL), null);

  // A spline spans only its control points; columns outside are NaN.
  const shortSpline = spline("s", "ilm", [[3, 100], [6, 100]]);
  const poly = boundaryPolyline(shortSpline, W, H)!;
  const ys = sampleY(poly, W);
  assert.ok(Number.isNaN(ys[0]!), "column 0 outside the spline is NaN");
  assert.ok(Number.isNaN(ys[9]!), "column 9 outside the spline is NaN");
  assert.ok(Number.isFinite(ys[4]!), "column 4 inside the spline is a number");

  // A layer always spans the full width — that is what extendToEdges is for.
  const full = boundaryPolyline(layer("l", "ilm", [[3, 100], [6, 100]]), W, H)!;
  const yf = sampleY(full, W);
  for (let x = 0; x < W; x++) assert.ok(Number.isFinite(yf[x]!), `layer covers column ${x}`);

  // Non-boundary annotations are not measurable.
  const pt: Annotation = { id: "p", labelId: "ilm", type: "point", points: [{ x: 1, y: 1 }] };
  assert.equal(boundaryPolyline(pt, W, H), null);
  const region: Annotation = {
    id: "g",
    labelId: "ilm",
    type: "polygon",
    points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }],
    closed: true,
  };
  assert.equal(boundaryPolyline(region, W, H), null, "a closed region is not a boundary");
}

// ── Line and Freehand are boundaries too ────────────────────────────────────
// A boundary traced with the Line or Freehand tool is still a boundary; refusing
// them made the view claim nothing was annotated when it plainly was.
{
  const line = (id: string, labelId: string, pts: [number, number][]): Annotation => ({
    id,
    labelId,
    type: "line",
    points: [
      { x: pts[0]![0], y: pts[0]![1] },
      { x: pts[1]![0], y: pts[1]![1] },
    ] as [ImagePoint, ImagePoint],
  });
  const freehand = (id: string, labelId: string, pts: [number, number][]): Annotation => ({
    id,
    labelId,
    type: "freehand",
    points: pts.map(([x, y]) => ({ x, y })),
  });

  assert.ok(isBoundary(line("l", "ilm", [[0, 1], [9, 1]])), "line is a boundary");
  assert.ok(isBoundary(freehand("f", "ilm", [[0, 1], [9, 1]])), "freehand is a boundary");

  // Two flat lines 100px apart measure the same 161um as two flat layers.
  const t = sliceThickness(
    [line("a", "ilm", [[0, 100], [9, 100]]), line("b", "rpe", [[0, 200], [9, 200]])],
    "ilm",
    "rpe",
    W,
    H,
    AXIAL,
  )!;
  for (let x = 0; x < W; x++) assert.ok(near(t[x]!, 161), `line column ${x}`);

  // Freehand mixes fine with a layer.
  const mixed = sliceThickness(
    [freehand("a", "ilm", [[0, 100], [4, 100], [9, 100]]), layer("b", "rpe", [[0, 200], [9, 200]])],
    "ilm",
    "rpe",
    W,
    H,
    AXIAL,
  )!;
  assert.ok(near(mixed[5]!, 161), "freehand against layer");

  // Unlike a layer, a line does NOT extend to the edges — it spans only what was
  // drawn, so the uncovered columns stay NaN instead of being invented.
  const partial = sliceThickness(
    [line("a", "ilm", [[3, 100], [6, 100]]), layer("b", "rpe", [[0, 200], [9, 200]])],
    "ilm",
    "rpe",
    W,
    H,
    AXIAL,
  )!;
  assert.ok(Number.isNaN(partial[0]!), "column left of the line is NaN");
  assert.ok(Number.isNaN(partial[9]!), "column right of the line is NaN");
  assert.ok(near(partial[4]!, 161), "column under the line measures");

  // Drawn right-to-left is the same boundary.
  const reversed = sliceThickness(
    [line("a", "ilm", [[9, 100], [0, 100]]), line("b", "rpe", [[9, 200], [0, 200]])],
    "ilm",
    "rpe",
    W,
    H,
    AXIAL,
  )!;
  for (let x = 0; x < W; x++) assert.ok(near(reversed[x]!, 161), `reversed column ${x}`);
}

// ── 5. NaN never counts as zero ─────────────────────────────────────────────
// The bug this guards: a gap contributing 0um would make min 0 and drag the mean.
{
  const gappy = spline("s", "ilm", [[3, 100], [6, 100]]);
  const flat = layer("b", "rpe", [[0, 200], [9, 200]]);
  const t = sliceThickness([gappy, flat], "ilm", "rpe", W, H, AXIAL)!;

  assert.ok(Number.isNaN(t[0]!), "gap column is NaN, not 0");
  const stats = thicknessStats([{ slice: 0, values: t }]);
  assert.ok(stats.count < W, "gaps are excluded from the sample count");
  assert.ok(stats.count > 0, "the covered columns still count");
  assert.ok(near(stats.min, 161), `min is the smallest REAL thickness, got ${stats.min}`);
  assert.ok(near(stats.mean, 161), `mean ignores gaps, got ${stats.mean}`);

  // Empty input is honest rather than zero.
  const none = thicknessStats([]);
  assert.equal(none.count, 0);
  assert.ok(Number.isNaN(none.mean) && Number.isNaN(none.min) && Number.isNaN(none.max));
}

// ── 6. thicknessMatrix picks only fully-annotated slices, in order ───────────
{
  const bySlice: Record<number, Annotation[]> = {
    5: [layer("a", "ilm", [[0, 100], [9, 100]]), layer("b", "rpe", [[0, 200], [9, 200]])],
    2: [layer("c", "ilm", [[0, 100], [9, 100]]), layer("d", "rpe", [[0, 250], [9, 250]])],
    3: [layer("e", "ilm", [[0, 100], [9, 100]])], // no RPE -> omitted
  };
  const rows = thicknessMatrix(bySlice, "ilm", "rpe", { width: W, height: H, sliceCount: 10 }, AXIAL);
  assert.deepEqual(rows.map((r) => r.slice), [2, 5], "ascending, and slice 3 omitted");
  assert.ok(near(rows[0]!.values[0]!, 150 * AXIAL));
  assert.ok(near(rows[1]!.values[0]!, 100 * AXIAL));

  const stats = thicknessStats(rows);
  assert.equal(stats.count, 2 * W);
  assert.ok(near(stats.min, 100 * AXIAL));
  assert.ok(near(stats.max, 150 * AXIAL));
}

// ── 7. Colour ramp is total and clamped ─────────────────────────────────────
{
  for (const t of [0, 0.25, 0.5, 0.75, 1, -5, 5]) {
    assert.match(thicknessColor(t), /^#[0-9a-f]{6}$/, `valid hex at ${t}`);
  }
  assert.equal(thicknessColor(-5), thicknessColor(0), "clamps below 0");
  assert.equal(thicknessColor(5), thicknessColor(1), "clamps above 1");
  assert.notEqual(thicknessColor(0), thicknessColor(1), "the ramp actually ramps");
  // NaN is the "no data" grey, deliberately outside the ramp.
  assert.deepEqual(thicknessRgb(NaN), [60, 60, 60]);
}

// ── Perpendicular mode ──────────────────────────────────────────────────────
{
  const LAT = 1.8; // um per lateral pixel
  const wide = 40;

  // Two PARALLEL FLAT boundaries: perpendicular == axial, exactly.
  {
    const top = layer("a", "ilm", [[0, 100], [wide - 1, 100]]);
    const bot = layer("b", "rpe", [[0, 200], [wide - 1, 200]]);
    const ax = sliceThickness([top, bot], "ilm", "rpe", wide, H, AXIAL, "axial", LAT)!;
    const pp = sliceThickness([top, bot], "ilm", "rpe", wide, H, AXIAL, "perpendicular", LAT)!;
    for (let x = 0; x < wide; x++) {
      assert.ok(near(pp[x]!, ax[x]!, 1e-9), `flat: perpendicular == axial at ${x}`);
    }
  }

  // TILTED parallel boundaries: perpendicular must be strictly SMALLER than axial
  // in the interior (the whole point of the mode), and never larger anywhere.
  {
    const top = layer("a", "ilm", [[0, 100], [wide - 1, 300]]);
    const bot = layer("b", "rpe", [[0, 200], [wide - 1, 400]]);
    const ax = sliceThickness([top, bot], "ilm", "rpe", wide, H, AXIAL, "axial", LAT)!;
    const pp = sliceThickness([top, bot], "ilm", "rpe", wide, H, AXIAL, "perpendicular", LAT)!;

    for (let x = 0; x < wide; x++) {
      assert.ok(pp[x]! <= ax[x]! + 1e-9, `perpendicular never exceeds axial at ${x}`);
    }
    const mid = Math.floor(wide / 2);
    assert.ok(pp[mid]! < ax[mid]! - 1e-6, "under tilt the perpendicular distance is shorter");

    // Closed form: for parallel lines of slope m (px/px), the perpendicular
    // distance in physical units is  (dy*umAxial) / sqrt(1 + (m*umAxial/umLateral)^2).
    const m = 200 / (wide - 1);
    const expected = (100 * AXIAL) / Math.sqrt(1 + (m * AXIAL / LAT) ** 2);
    assert.ok(near(pp[mid]!, expected, 0.5), `mid ${pp[mid]} vs closed form ${expected}`);
  }

  // Order independence holds in perpendicular mode too: the measurement is taken
  // from whichever boundary is on top at that column, not from the first dropdown.
  {
    const top = layer("a", "ilm", [[0, 100], [wide - 1, 260]]);
    const bot = layer("b", "rpe", [[0, 210], [wide - 1, 330]]);
    const ab = sliceThickness([top, bot], "ilm", "rpe", wide, H, AXIAL, "perpendicular", LAT)!;
    const ba = sliceThickness([top, bot], "rpe", "ilm", wide, H, AXIAL, "perpendicular", LAT)!;
    for (let x = 0; x < wide; x++) assert.ok(near(ab[x]!, ba[x]!, 1e-9), `perp order-free at ${x}`);
  }

  // Gaps stay gaps — a missing column is not silently filled by a nearby one.
  {
    const gappy = spline("s", "ilm", [[10, 100], [20, 100]]);
    const flat = layer("b", "rpe", [[0, 200], [wide - 1, 200]]);
    const pp = sliceThickness([gappy, flat], "ilm", "rpe", wide, H, AXIAL, "perpendicular", LAT)!;
    assert.ok(Number.isNaN(pp[0]!), "column outside the spline stays NaN in perpendicular mode");
    assert.ok(Number.isFinite(pp[15]!), "column inside it measures");
  }

  // The anisotropy actually matters: a wider lateral pitch pulls the perpendicular
  // result back toward the axial one, because horizontal travel costs more.
  {
    const top = layer("a", "ilm", [[0, 100], [wide - 1, 300]]);
    const bot = layer("b", "rpe", [[0, 200], [wide - 1, 400]]);
    const narrow = sliceThickness([top, bot], "ilm", "rpe", wide, H, AXIAL, "perpendicular", 1)!;
    const broad = sliceThickness([top, bot], "ilm", "rpe", wide, H, AXIAL, "perpendicular", 40)!;
    const mid = Math.floor(wide / 2);
    assert.ok(broad[mid]! > narrow[mid]!, "a coarser lateral pitch raises the perpendicular result");
  }
}

// ── ETDRS sector grid ───────────────────────────────────────────────────────
{
  // A 1200x1200 um square volume so the 600um outer circle is inscribed exactly.
  const w = 120;
  const n = 120;
  const LAT = 10; // um per column  -> 1200 um wide
  const SLICE = 10; // um per slice -> 1200 um deep
  const d = { width: w, height: 400, sliceCount: n };

  // Uniform 100um everywhere: every sector must read exactly 100.
  const flat = Array.from({ length: n }, (_, slice) => ({
    slice,
    values: new Float64Array(w).fill(100),
  }));
  const secs = sectorStats(flat, d, LAT, SLICE);

  assert.equal(secs.length, 9, "one centre disc plus two rings of four");
  assert.equal(secs.filter((x) => x.ring === 0).length, 1);
  assert.equal(secs.filter((x) => x.ring === 1).length, 4);
  assert.equal(secs.filter((x) => x.ring === 2).length, 4);
  for (const sec of secs) {
    assert.ok(sec.total > 0, `sector ring${sec.ring} q${sec.quadrant} covers some grid`);
    assert.ok(near(sec.mean, 100), `uniform volume -> every sector reads 100, got ${sec.mean}`);
    assert.ok(near(sec.coverage, 1), "fully measured -> coverage 1");
  }

  // Areas must scale like the annuli they represent: outer ring quadrants are much
  // larger than inner ones, and the four quadrants of a ring are equal by symmetry.
  const [r0, r1, r2] = DEFAULT_SECTOR_RADII_UM;
  const inner = secs.filter((x) => x.ring === 1);
  const outer = secs.filter((x) => x.ring === 2);
  for (let i = 1; i < 4; i++) {
    assert.ok(
      Math.abs(inner[i]!.total - inner[0]!.total) / inner[0]!.total < 0.05,
      "inner quadrants are equal in area",
    );
    assert.ok(
      Math.abs(outer[i]!.total - outer[0]!.total) / outer[0]!.total < 0.05,
      "outer quadrants are equal in area",
    );
  }
  const cellArea = LAT * SLICE;
  const centre = secs.find((x) => x.ring === 0)!;
  assert.ok(
    Math.abs(centre.total * cellArea - Math.PI * r0 ** 2) / (Math.PI * r0 ** 2) < 0.05,
    "centre disc area matches pi*r0^2",
  );
  const outerArea = outer.reduce((a, x) => a + x.total, 0) * cellArea;
  assert.ok(
    Math.abs(outerArea - Math.PI * (r2 ** 2 - r1 ** 2)) / (Math.PI * (r2 ** 2 - r1 ** 2)) < 0.05,
    "outer ring area matches the annulus",
  );

  // Coverage grades how much of the sector was MEASURED — half the slices missing
  // must read about half, not 100% of whatever happened to be present.
  const half = flat.filter((r) => r.slice % 2 === 0);
  for (const sec of sectorStats(half, d, LAT, SLICE)) {
    assert.ok(near(sec.coverage, 0.5, 0.05), `half the slices -> coverage ~0.5, got ${sec.coverage}`);
    assert.ok(near(sec.mean, 100), "mean is unaffected by the missing slices");
  }

  // A sector with nothing in it reports NaN and zero coverage, never 0 um.
  const none = sectorStats([], d, LAT, SLICE);
  for (const sec of none) {
    assert.ok(Number.isNaN(sec.mean), "no data -> NaN mean, not 0");
    assert.equal(sec.count, 0);
    assert.equal(sec.coverage, 0);
  }

  // A left/right thickness gradient must show up as differing quadrant means, and
  // the two horizontal quadrants must straddle the vertical ones.
  const graded = Array.from({ length: n }, (_, slice) => ({
    slice,
    values: Float64Array.from({ length: w }, (_, x) => 100 + x),
  }));
  const g = sectorStats(graded, d, LAT, SLICE);
  const gInner = g.filter((x) => x.ring === 1);
  const right = gInner.find((x) => x.quadrant === 0)!;
  const left = gInner.find((x) => x.quadrant === 2)!;
  assert.ok(right.mean > left.mean, "the thicker side reads higher");
}

// ── Interpolation between measured slices ───────────────────────────────────
{
  const row = (slice: number, v: number) => ({ slice, values: new Float64Array(4).fill(v) });

  // Halfway between 100 and 200 is 150, and the measured rows are untouched.
  const filled = interpolateRows([row(0, 100), row(4, 200)]);
  assert.deepEqual(filled.map((r) => r.slice), [0, 1, 2, 3, 4], "gap rows are filled");
  assert.ok(near(filled[0]!.values[0]!, 100), "measured start preserved");
  assert.ok(near(filled[2]!.values[0]!, 150), "midpoint interpolates linearly");
  assert.ok(near(filled[4]!.values[0]!, 200), "measured end preserved");
  assert.ok(near(filled[1]!.values[0]!, 125) && near(filled[3]!.values[0]!, 175), "even spacing");

  // It never invents data outside the measured span.
  const bounded = interpolateRows([row(10, 100), row(12, 100)]);
  assert.deepEqual(bounded.map((r) => r.slice), [10, 11, 12], "no extrapolation past the ends");

  // Too little to interpolate from is returned untouched.
  assert.equal(interpolateRows([]).length, 0);
  assert.equal(interpolateRows([row(3, 100)]).length, 1, "a single row cannot be interpolated");

  // A column missing at either end stays a gap — half a bracket is not a measurement.
  const a = { slice: 0, values: Float64Array.from([100, NaN, 100]) };
  const b = { slice: 2, values: Float64Array.from([200, 200, NaN]) };
  const mid = interpolateRows([a, b])[1]!;
  assert.ok(near(mid.values[0]!, 150), "bracketed column interpolates");
  assert.ok(Number.isNaN(mid.values[1]!), "missing at the start stays NaN");
  assert.ok(Number.isNaN(mid.values[2]!), "missing at the end stays NaN");

  // Interpolating must not shift the statistics of the real measurements.
  const measured = [row(0, 100), row(10, 200)];
  const before = thicknessStats(measured);
  const after = thicknessStats(interpolateRows(measured));
  assert.ok(near(after.min, before.min) && near(after.max, before.max), "range unchanged");
  assert.ok(after.count > before.count, "but there are more samples, which is why");
  assert.ok(near(before.mean, 150) && near(after.mean, 150), "symmetric fill keeps the mean");
}

// ── Heat map grid + range (Module 11.5) ─────────────────────────────────────
{
  const row = (slice: number, v: number) => ({ slice, values: Float64Array.from([v, NaN]) });
  const grid = buildThicknessGrid([row(0, 10), row(2, 20)], 3, 2);
  assert.equal(grid.length, 3, "one row per slice, including the unmeasured one");
  assert.ok(near(grid[0]![0]!, 10), "measured slice keeps its values");
  assert.ok(Number.isNaN(grid[1]![0]!), "unmeasured slice is all-NaN, not zero");
  assert.ok(Number.isNaN(grid[0]![1]!), "gap column carried through from the row");
  assert.ok(near(grid[2]![0]!, 20));

  const stats = thicknessStats([
    { slice: 0, values: Float64Array.from([220]) },
    { slice: 1, values: Float64Array.from([224]) },
  ]);
  const [lo, hi] = avgStdRange(stats);
  assert.ok(lo < stats.mean && hi > stats.mean, "range straddles the mean");
  assert.ok(near(hi - lo, 4 * stats.stdev), "spans exactly +/-2 STD");

  const empty = avgStdRange({ count: 0, mean: NaN, min: NaN, max: NaN, stdev: NaN });
  assert.deepEqual(empty, [0, 1], "no data falls back to a non-degenerate range");

  const flat = avgStdRange({ count: 1, mean: 5, min: 5, max: 5, stdev: 0 });
  assert.ok(flat[0]! < flat[1]!, "zero spread still yields a drawable range");
}

console.log("thickness.selfcheck: all assertions passed");
