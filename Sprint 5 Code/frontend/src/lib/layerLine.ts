import type { ImagePoint } from "../components/oct/OctCanvas";

/** A layer line needs at least this many clicked points before it can be committed. */
export const LAYER_MIN_POINTS = 3;

/**
 * Extend a clicked polyline so it spans the full image width.
 *
 * The first and last segments are extrapolated along their own slope out to
 * x=0 and x=width, with y clamped into the image. Only the clicked points are
 * ever stored — this runs at paint/hit-test time so that dragging an end
 * vertex re-extends the line automatically.
 *
 * Points are sorted by x first: OCT boundaries are functions of x, and users
 * do not always click strictly left-to-right.
 */
export function extendToEdges(
  points: ImagePoint[],
  width: number,
  height: number,
): ImagePoint[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort((a, b) => a.x - b.x);
  const clampY = (y: number) => Math.max(0, Math.min(height, y));

  if (sorted.length === 1) {
    // Nothing to take a slope from — run flat across the image.
    const y = clampY(sorted[0]!.y);
    return [{ x: 0, y }, { x: width, y }];
  }

  const out = [...sorted];

  const a = out[0]!;
  const b = out[1]!;
  if (a.x > 0) {
    out.unshift({ x: 0, y: clampY(extrapolateY(a, b, 0)) });
  }

  const z = out[out.length - 1]!;
  const y2 = out[out.length - 2]!;
  if (z.x < width) {
    out.push({ x: width, y: clampY(extrapolateY(y2, z, width)) });
  }

  return out;
}

/** y of the line through a,b at the given x. Vertical segments hold b's y. */
function extrapolateY(a: ImagePoint, b: ImagePoint, x: number): number {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-9) return b.y;
  return a.y + ((b.y - a.y) * (x - a.x)) / dx;
}
