import type { Annotation, ImagePoint } from "../components/oct/OctCanvas";

/** A spline needs at least two control points to be a curve. */
export const SPLINE_MIN_POINTS = 2;

/** Samples per segment — smooth enough at the zoom levels the canvas allows. */
const SAMPLES_PER_SEGMENT = 16;

function catmullRom(
  p0: ImagePoint,
  p1: ImagePoint,
  p2: ImagePoint,
  p3: ImagePoint,
  t: number,
): ImagePoint {
  const t2 = t * t;
  const t3 = t2 * t;
  const axis = (a: number, b: number, c: number, d: number) =>
    0.5 *
    (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return {
    x: axis(p0.x, p1.x, p2.x, p3.x),
    y: axis(p0.y, p1.y, p2.y, p3.y),
  };
}

/**
 * Uniform Catmull-Rom through the control points, sampled to a polyline.
 *
 * The curve passes exactly through every clicked point (unlike midpoint-quadratic
 * smoothing) — for tracing an anatomical boundary the clicked point is the datum,
 * so it has to be on the curve. End tangents come from duplicating the endpoints.
 */
export function splinePath(points: ImagePoint[], samples = SAMPLES_PER_SEGMENT): ImagePoint[] {
  if (points.length < 3) return points.slice();
  const out: ImagePoint[] = [points[0]!];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    for (let s = 1; s <= samples; s++) {
      out.push(catmullRom(p0, p1, p2, p3, s / samples));
    }
  }
  return out;
}

/** One exported curve: enough on its own to say which image and frame it belongs to. */
export type SplineExport = {
  image: string;
  frame: number;
  name: string;
  label: string | null;
  points: ImagePoint[];
};

/**
 * Flatten every spline in the project's file→frame→annotations map for export.
 * Sorted by image, then frame, then name so diffs between exports stay readable.
 */
export function collectSplines(
  files: Record<string, Record<number, Annotation[]>>,
  labels: { id: string; name: string }[],
): SplineExport[] {
  const labelName = new Map(labels.map((l) => [l.id, l.name]));
  const out: SplineExport[] = [];
  for (const [image, frames] of Object.entries(files ?? {})) {
    if (!frames || typeof frames !== "object") continue;
    for (const [frameKey, list] of Object.entries(frames)) {
      if (!Array.isArray(list)) continue;
      for (const a of list) {
        if (a?.type !== "spline") continue;
        out.push({
          image,
          frame: Number(frameKey),
          name: a.name,
          label: labelName.get(a.labelId) ?? null,
          points: a.points,
        });
      }
    }
  }
  return out.sort(
    (a, b) =>
      a.image.localeCompare(b.image) || a.frame - b.frame || a.name.localeCompare(b.name),
  );
}

/** "Spline 3" — first number not already taken by a spline on this slice. */
export function nextSplineName(existing: string[]): string {
  const used = new Set(existing);
  for (let n = 1; ; n++) {
    const name = `Spline ${n}`;
    if (!used.has(name)) return name;
  }
}
