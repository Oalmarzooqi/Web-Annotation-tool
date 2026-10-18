import type { Annotation, ImagePoint } from "../components/oct/OctCanvas";
import type { FileDims } from "./projectData.ts";
import { extendToEdges } from "./layerLine.ts";
import { splinePath } from "./spline.ts";

/**
 * Layer-to-layer thickness for the Measurements view. Two modes:
 *
 * - AXIAL (default): at each A-scan column x, `|yTop - yBottom| * umPerPxAxial`.
 *   What Bioptigen/Spectralis thickness maps report. Overestimates on a tilted retina.
 * - PERPENDICULAR: the shortest physical distance from the boundary point at x to
 *   the other boundary, in anisotropic pixel space —
 *   `L^2 = (dx * umPerPxLateral)^2 + (dy * umPerPxAxial)^2`.
 *   Correct under tilt, and always <= the axial figure.
 *
 * Boundaries are reconstructed with the SAME functions OctCanvas paints with
 * (extendToEdges / splinePath), so the measured curve is the curve on screen.
 *
 * Missing data is NaN, never 0. A 0 would silently drag the mean and minimum down
 * and quietly corrupt the report.
 */

/**
 * Annotation types that trace a boundary.
 *
 * `layer` and `spline` are the purpose-built ones, but a boundary drawn with the
 * Line or Freehand tool is just as real a boundary — both are open polylines that
 * read as a function of x. `polygon` (a closed region) and `point` are not.
 */
export function isBoundary(a: Annotation): boolean {
  return (
    a.type === "layer" || a.type === "spline" || a.type === "line" || a.type === "freehand"
  );
}

/**
 * Boundary annotation -> dense polyline in image pixels, or null if not a boundary.
 *
 * Only `layer` runs edge to edge (that is what extendToEdges is for). `spline`,
 * `line` and `freehand` span only what the user actually drew — columns outside
 * that range read as NaN rather than being invented by extrapolation.
 *
 * Points are sorted by x because a boundary is a function of x and users do not
 * always draw left-to-right.
 */
export function boundaryPolyline(
  a: Annotation,
  width: number,
  height: number,
): ImagePoint[] | null {
  if (a.type === "layer") {
    return a.points.length ? extendToEdges(a.points, width, height) : null;
  }
  if (a.type === "spline") {
    if (a.points.length < 2) return null;
    return splinePath([...a.points].sort((p, q) => p.x - q.x));
  }
  if (a.type === "line" || a.type === "freehand") {
    if (a.points.length < 2) return null;
    return [...a.points].sort((p, q) => p.x - q.x);
  }
  return null;
}

/**
 * Sample a polyline onto integer columns 0..width-1.
 *
 * One forward pass over columns and segments together, O(width + segments). A
 * per-column search would be ~60M operations on a 1000x100 volume; this is ~200k.
 *
 * Columns the polyline does not span are NaN.
 *
 * ponytail: first segment spanning a column wins. A Catmull-Rom curve through
 * x-sorted control points can still overshoot backwards in x, making one column
 * ambiguous; a real arrangement sweep is only worth it if boundaries ever fold back.
 */
export function sampleY(poly: ImagePoint[], width: number): Float64Array {
  const out = new Float64Array(width).fill(NaN);
  if (poly.length === 0 || width <= 0) return out;

  if (poly.length === 1) {
    const only = poly[0]!;
    const col = Math.round(only.x);
    if (col >= 0 && col < width) out[col] = only.y;
    return out;
  }

  let seg = 0;
  for (let x = 0; x < width; x++) {
    // Advance past segments that end before this column.
    while (seg < poly.length - 1 && Math.max(poly[seg]!.x, poly[seg + 1]!.x) < x) seg++;
    if (seg >= poly.length - 1) break;

    const a = poly[seg]!;
    const b = poly[seg + 1]!;
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    if (x < lo || x > hi) continue; // gap before this segment starts

    const dx = b.x - a.x;
    // Vertical segment: hold the endpoint, matching extrapolateY in layerLine.
    out[x] = Math.abs(dx) < 1e-9 ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / dx;
  }
  return out;
}

export type ThicknessMode = "axial" | "perpendicular";

/**
 * Shortest physical distance from one point to a sampled boundary.
 *
 * ponytail: runs on the main thread — ~270ms for a 1000x100 volume, re-run whenever
 * the mode, scale or labels change. Move to a worker if that starts to feel slow.
 *
 * Exact, not windowed: columns are visited outwards from `x`, and the search stops
 * as soon as the horizontal term alone (`d * umPerPxLateral`) exceeds the best
 * distance found — no further column can beat it. That bound makes this near-O(1)
 * per column in practice while still finding the true minimum.
 */
function minDistanceTo(
  x: number,
  y0: number,
  other: Float64Array,
  umPerPxLateral: number,
  umPerPxAxial: number,
): number {
  const width = other.length;
  let best = Infinity;
  for (let d = 0; d < width; d++) {
    if (d * umPerPxLateral >= best) break;
    for (const j of d === 0 ? [x] : [x - d, x + d]) {
      if (j < 0 || j >= width) continue;
      const y1 = other[j]!;
      if (!Number.isFinite(y1)) continue;
      const dx = (j - x) * umPerPxLateral;
      const dy = (y1 - y0) * umPerPxAxial;
      const dist = Math.hypot(dx, dy);
      if (dist < best) best = dist;
    }
  }
  return best === Infinity ? NaN : best;
}

/** First boundary annotation carrying this label, or null. */
function findBoundary(annotations: Annotation[], labelId: string): Annotation | null {
  // Nothing enforces one boundary per label per slice, so take the first match.
  return annotations.find((a) => a.labelId === labelId && isBoundary(a)) ?? null;
}

/**
 * Per-column thickness in micrometres for one slice.
 *
 * Returns null when either label has no boundary on this slice — that is a slice
 * with no measurement, distinct from a slice measured as zero.
 *
 * Uses |yA - yB|, so the order of the two labels never changes the result.
 */
export function sliceThickness(
  annotations: Annotation[],
  labelIdA: string,
  labelIdB: string,
  width: number,
  height: number,
  umPerPxAxial: number,
  mode: ThicknessMode = "axial",
  umPerPxLateral = 1,
): Float64Array | null {
  const a = findBoundary(annotations, labelIdA);
  const b = findBoundary(annotations, labelIdB);
  if (!a || !b) return null;

  const polyA = boundaryPolyline(a, width, height);
  const polyB = boundaryPolyline(b, width, height);
  if (!polyA || !polyB) return null;

  const ya = sampleY(polyA, width);
  const yb = sampleY(polyB, width);
  const out = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    const va = ya[x]!;
    const vb = yb[x]!;
    if (mode === "axial") {
      // NaN propagates through the subtraction, which is exactly what we want.
      out[x] = Math.abs(va - vb) * umPerPxAxial;
      continue;
    }
    if (!Number.isFinite(va) || !Number.isFinite(vb)) {
      out[x] = NaN;
      continue;
    }
    // Measure from whichever boundary is on top AT THIS COLUMN, so the result does
    // not depend on which label the user picked first (min-distance is asymmetric).
    const fromTop = va <= vb;
    out[x] = minDistanceTo(
      x,
      fromTop ? va : vb,
      fromTop ? yb : ya,
      umPerPxLateral,
      umPerPxAxial,
    );
  }
  return out;
}

export type ThicknessRow = { slice: number; values: Float64Array };

/** One row per slice carrying both boundaries, ascending. Slices without both are omitted. */
export function thicknessMatrix(
  annotationsBySlice: Record<number, Annotation[]>,
  labelIdA: string,
  labelIdB: string,
  dims: FileDims,
  umPerPxAxial: number,
  mode: ThicknessMode = "axial",
  umPerPxLateral = 1,
): ThicknessRow[] {
  const rows: ThicknessRow[] = [];
  // JSON.parse gives string keys; Number() them and sort numerically, not lexically.
  const slices = Object.keys(annotationsBySlice)
    .map(Number)
    .filter((n) => Number.isInteger(n))
    .sort((p, q) => p - q);

  for (const slice of slices) {
    const values = sliceThickness(
      annotationsBySlice[slice] ?? [],
      labelIdA,
      labelIdB,
      dims.width,
      dims.height,
      umPerPxAxial,
      mode,
      umPerPxLateral,
    );
    if (values) rows.push({ slice, values });
  }
  return rows;
}

/**
 * Fill the rows between measured slices by linear interpolation.
 *
 * A thickness map is normally built from a fully segmented volume. When only a few
 * B-scans are annotated the raw map is mostly empty, so this estimates the slices in
 * between — strictly BETWEEN the first and last measured slice; it never extrapolates
 * past either end, because there is nothing to extrapolate from.
 *
 * A column is interpolated only when BOTH bracketing slices measured it. Interpolated
 * values are estimates, not measurements: keep them out of the statistics and out of
 * sector coverage, and label any map drawn from them.
 */
export function interpolateRows(rows: ThicknessRow[]): ThicknessRow[] {
  if (rows.length < 2) return rows;
  const sorted = [...rows].sort((a, b) => a.slice - b.slice);
  const width = sorted[0]!.values.length;
  const out: ThicknessRow[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i]!;
    const hi = sorted[i + 1]!;
    out.push(lo);
    const span = hi.slice - lo.slice;
    for (let s = lo.slice + 1; s < hi.slice; s++) {
      const t = (s - lo.slice) / span;
      const values = new Float64Array(width);
      for (let x = 0; x < width; x++) {
        const a = lo.values[x]!;
        const b = hi.values[x]!;
        // One missing end means this column is not bracketed — leave it a gap.
        values[x] = Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * t : NaN;
      }
      out.push({ slice: s, values });
    }
  }
  out.push(sorted[sorted.length - 1]!);
  return out;
}

export type ThicknessStats = {
  count: number;
  mean: number;
  min: number;
  max: number;
  /** Population standard deviation (divided by N). */
  stdev: number;
};

/** Summary over every valid sample. NaN gaps are skipped, never counted as zero. */
export function thicknessStats(rows: ThicknessRow[]): ThicknessStats {
  let count = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const row of rows) {
    for (let i = 0; i < row.values.length; i++) {
      const v = row.values[i]!;
      if (!Number.isFinite(v)) continue;
      count++;
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (count === 0) return { count: 0, mean: NaN, min: NaN, max: NaN, stdev: NaN };

  const mean = sum / count;
  let sq = 0;
  for (const row of rows) {
    for (let i = 0; i < row.values.length; i++) {
      const v = row.values[i]!;
      if (!Number.isFinite(v)) continue;
      sq += (v - mean) ** 2;
    }
  }
  return { count, mean, min, max, stdev: Math.sqrt(sq / count) };
}

/** ETDRS-style ring radii in micrometres, as used by the Bioptigen report. */
export const DEFAULT_SECTOR_RADII_UM: [number, number, number] = [100, 300, 600];

export type Sector = {
  /** 0 = central disc, 1 = inner ring, 2 = outer ring. */
  ring: 0 | 1 | 2;
  /** null for the central disc; otherwise 0=right, 1=inferior, 2=left, 3=superior. */
  quadrant: 0 | 1 | 2 | 3 | null;
  /** Mean thickness over the valid samples in this sector, NaN if there are none. */
  mean: number;
  /** Valid samples found. */
  count: number;
  /** Grid cells falling inside this sector, measured or not. */
  total: number;
  /** count / total — the report colours sectors by this, not by thickness. */
  coverage: number;
};

/**
 * Average thickness per ETDRS-style sector on the en-face plane.
 *
 * The grid is physical: column x sits at `(x + 0.5) * umPerPxLateral`, slice s at
 * `(s + 0.5) * umPerSlice`, measured from the volume centre. Sectors are a central
 * disc plus two rings of four quadrants — nine in total.
 *
 * `total` counts every grid cell inside the sector, including slices that were never
 * annotated, so `coverage` answers "how much of this sector did we actually measure"
 * rather than "how much of what we measured was valid".
 *
 * Quadrants are geometric (right/inferior/left/superior), deliberately not named
 * nasal/temporal: that mapping depends on which eye this is, which the app does not know.
 */
export function sectorStats(
  rows: ThicknessRow[],
  dims: FileDims,
  umPerPxLateral: number,
  umPerSlice: number,
  radii: [number, number, number] = DEFAULT_SECTOR_RADII_UM,
): Sector[] {
  const out: Sector[] = [
    { ring: 0, quadrant: null, mean: NaN, count: 0, total: 0, coverage: 0 },
  ];
  for (const ring of [1, 2] as const) {
    for (const q of [0, 1, 2, 3] as const) {
      out.push({ ring, quadrant: q, mean: NaN, count: 0, total: 0, coverage: 0 });
    }
  }
  const sums = new Array(out.length).fill(0);

  const indexOf = (ring: number, q: number) => (ring === 0 ? 0 : 1 + (ring - 1) * 4 + q);

  const cx = (dims.width * umPerPxLateral) / 2;
  const cy = (dims.sliceCount * umSliceGuard(umPerSlice)) / 2;
  const byslice = new Map(rows.map((r) => [r.slice, r.values]));

  for (let s = 0; s < dims.sliceCount; s++) {
    const values = byslice.get(s);
    const py = (s + 0.5) * umSliceGuard(umPerSlice) - cy;
    for (let x = 0; x < dims.width; x++) {
      const px = (x + 0.5) * umPerPxLateral - cx;
      const r = Math.hypot(px, py);
      let ring: 0 | 1 | 2;
      if (r < radii[0]) ring = 0;
      else if (r < radii[1]) ring = 1;
      else if (r < radii[2]) ring = 2;
      else continue; // outside the outermost circle

      // Rotate by 45 degrees so the quadrants are diagonal-split, as in the report.
      const a = Math.atan2(py, px) + Math.PI / 4;
      const norm = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const q = Math.min(3, Math.floor(norm / (Math.PI / 2))) as 0 | 1 | 2 | 3;

      const i = indexOf(ring, ring === 0 ? 0 : q);
      out[i]!.total++;
      const v = values?.[x];
      if (v !== undefined && Number.isFinite(v)) {
        out[i]!.count++;
        sums[i] += v;
      }
    }
  }

  for (let i = 0; i < out.length; i++) {
    const sec = out[i]!;
    sec.mean = sec.count > 0 ? sums[i] / sec.count : NaN;
    sec.coverage = sec.total > 0 ? sec.count / sec.total : 0;
  }
  return out;
}

/** A zero slice pitch would collapse every slice onto one row. */
function umSliceGuard(umPerSlice: number): number {
  return umPerSlice > 0 ? umPerSlice : 1;
}

/**
 * Full slice x column grid for the en-face heat map — one row per slice 0..sliceCount-1,
 * unlike ThicknessRow[] which omits unmeasured slices entirely. Pixel (s, x) always lines
 * up with slice s, column x, and unmeasured cells are NaN so a heat map can tell "no data"
 * from "measured as low".
 */
export function buildThicknessGrid(
  rows: ThicknessRow[],
  sliceCount: number,
  width: number,
): Float64Array[] {
  const bySlice = new Map(rows.map((r) => [r.slice, r.values]));
  const grid: Float64Array[] = [];
  for (let s = 0; s < sliceCount; s++) {
    grid.push(bySlice.get(s) ?? new Float64Array(width).fill(NaN));
  }
  return grid;
}

/**
 * AVG +/- 2 STD, the contrast-stretched range the Bioptigen report's second heat map
 * uses so local variation shows up even when a few outliers span a much wider range.
 */
export function avgStdRange(stats: ThicknessStats): [number, number] {
  if (!Number.isFinite(stats.mean) || !Number.isFinite(stats.stdev)) return [0, 1];
  if (stats.stdev === 0) return [stats.mean - 1, stats.mean + 1];
  return [stats.mean - 2 * stats.stdev, stats.mean + 2 * stats.stdev];
}

/** Five-stop ramp: navy -> cyan -> green -> yellow -> red, matching the report's heat map. */
const RAMP: [number, number, number][] = [
  [0, 0, 80],
  [0, 200, 255],
  [0, 190, 60],
  [255, 230, 0],
  [220, 30, 30],
];

/** t in [0,1] -> [r,g,b]. Clamped, so it is total on all finite input. */
export function thicknessRgb(t: number): [number, number, number] {
  if (!Number.isFinite(t)) return [60, 60, 60];
  const clamped = Math.max(0, Math.min(1, t));
  const pos = clamped * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = RAMP[i]!;
  const b = RAMP[i + 1]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** t in [0,1] -> "#rrggbb". */
export function thicknessColor(t: number): string {
  const [r, g, b] = thicknessRgb(t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
