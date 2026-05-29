import type { Annotation, ImagePoint } from "../components/oct/OctCanvas";

/** Pointer picked a vertex (drag to move) or an annotation body (delete selects whole). */
export type EditHit =
  | { kind: "vertex"; annotationId: string; pointIndex: number }
  | { kind: "annotation"; annotationId: string };

export type EditSelection = EditHit;

function len2(ax: number, ay: number) {
  return ax * ax + ay * ay;
}

/** Squared distance from p to segment a–b (image space). */
export function distSqPointToSegment(p: ImagePoint, a: ImagePoint, b: ImagePoint): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abLen2 = len2(abx, aby);
  if (abLen2 < 1e-12) return len2(p.x - a.x, p.y - a.y);
  let t = (apx * abx + apy * aby) / abLen2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  return len2(p.x - cx, p.y - cy);
}

/** Ray-cast odd-even test (image space). */
export function pointInPolygon(p: ImagePoint, ring: ImagePoint[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.x;
    const yi = ring[i]!.y;
    const xj = ring[j]!.x;
    const yj = ring[j]!.y;
    const inter = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (inter) inside = !inside;
  }
  return inside;
}

/** Elliptical proximity: (dx/tx)² + (dy/ty)² ≤ 1 */
function nearAnisotropic(dx: number, dy: number, tx: number, ty: number): boolean {
  if (tx < 1e-9 || ty < 1e-9) return dx * dx + dy * dy < 1e-6;
  return (dx / tx) * (dx / tx) + (dy / ty) * (dy / ty) <= 1;
}

function nearPoint(p: ImagePoint, q: ImagePoint, tolX: number, tolY: number): boolean {
  return nearAnisotropic(p.x - q.x, p.y - q.y, tolX, tolY);
}

/**
 * Hit-test in image space. tolX/tolY are half-axes of the pick ellipse around each vertex
 * (e.g. from ~10 CSS px: tolX = 10 * frame.width / cssW).
 */
export function hitTestAnnotations(
  annotations: Annotation[],
  p: ImagePoint,
  tolX: number,
  tolY: number,
): EditHit | null {
  const tolSeg = Math.max(tolX, tolY);

  for (let ai = annotations.length - 1; ai >= 0; ai--) {
    const a = annotations[ai]!;
    const pts = a.points;
    for (let i = 0; i < pts.length; i++) {
      if (nearPoint(p, pts[i]!, tolX, tolY)) {
        return { kind: "vertex", annotationId: a.id, pointIndex: i };
      }
    }
  }

  for (let ai = annotations.length - 1; ai >= 0; ai--) {
    const a = annotations[ai]!;
    if (a.type === "point") {
      continue;
    }
    if (a.type === "line") {
      const d2 = distSqPointToSegment(p, a.points[0]!, a.points[1]!);
      if (d2 <= tolSeg * tolSeg) return { kind: "annotation", annotationId: a.id };
      continue;
    }
    if (a.type === "polygon") {
      if (pointInPolygon(p, a.points)) return { kind: "annotation", annotationId: a.id };
      const ring = a.points;
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        const d2 = distSqPointToSegment(p, ring[i]!, ring[j]!);
        if (d2 <= tolSeg * tolSeg) return { kind: "annotation", annotationId: a.id };
      }
      continue;
    }
    if (a.type === "freehand") {
      const ring = a.points;
      if (ring.length < 2) continue;
      for (let i = 0; i < ring.length - 1; i++) {
        const d2 = distSqPointToSegment(p, ring[i]!, ring[i + 1]!);
        if (d2 <= tolSeg * tolSeg) return { kind: "annotation", annotationId: a.id };
      }
    }
  }

  return null;
}

export function setAnnotationPointAt(
  a: Annotation,
  pointIndex: number,
  pt: ImagePoint,
  frame: { width: number; height: number },
): Annotation {
  const clamp = (q: ImagePoint): ImagePoint => ({
    x: Math.max(0, Math.min(frame.width - Number.EPSILON, q.x)),
    y: Math.max(0, Math.min(frame.height - Number.EPSILON, q.y)),
  });

  if (a.type === "point") {
    return { ...a, points: [clamp(pt)] as [ImagePoint] };
  }
  if (a.type === "line") {
    const next: [ImagePoint, ImagePoint] = [...a.points];
    if (pointIndex < 0 || pointIndex > 1) return a;
    next[pointIndex] = clamp(pt);
    return { ...a, points: next };
  }
  if (a.type === "polygon") {
    const next = [...a.points];
    if (pointIndex < 0 || pointIndex >= next.length) return a;
    next[pointIndex] = clamp(pt);
    return { ...a, points: next, closed: true };
  }
  const next = [...a.points];
  if (pointIndex < 0 || pointIndex >= next.length) return a;
  next[pointIndex] = clamp(pt);
  return { ...a, points: next };
}
