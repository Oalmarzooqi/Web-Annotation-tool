"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  hitTestAnnotations,
  setAnnotationPointAt,
  type EditHit,
} from "../../lib/annotationEdit";
import type { AnnotationDrawStyle } from "../../lib/surfaceLabels";
import { IconButton } from "../ui";
import { Maximize2, Minus, Plus, Search } from "lucide-react";

export type OctCanvasFrame = {
  width: number;
  height: number;
  rgba?: Uint8ClampedArray;
  bitmap?: ImageBitmap;
};

/** One marker in original image pixel space (not zoomed canvas pixels). */
export type ImagePoint = { x: number; y: number };

export type DrawMode = "point" | "polygon" | "line" | "freehand" | "pan" | "edit" | "erase";

export type Annotation =
  | { id: string; labelId: string; type: "point"; points: [ImagePoint] }
  | { id: string; labelId: string; type: "line"; points: [ImagePoint, ImagePoint] }
  | { id: string; labelId: string; type: "polygon"; points: ImagePoint[]; closed: true }
  /** Phase 5: polyline in image pixels (≥2 points). */
  | { id: string; labelId: string; type: "freehand"; points: ImagePoint[] };

export type Draft =
  | { type: "polygon"; points: ImagePoint[] }
  | { type: "line"; points: [ImagePoint] };

export type { EditHit };

export function OctCanvas({
  frame,
  annotations,
  mode,
  draft,
  onClickImage,
  onDoubleClickImage,
  onFreehandComplete,
  onNavigateSlice,
  resolveAnnotationStyle,
  draftStyle,
  annotationCommitEnabled = true,
  editSelection = null,
  onEditSelect,
  onEditVertexCommit,
  onDeleteAnnotation,
}: {
  frame: OctCanvasFrame | null;
  /** Current slice only — parent keeps per-slice maps. */
  annotations: Annotation[];
  mode: DrawMode;
  draft: Draft | null;
  /** Phase 6: stroke/fills from label id (annotations store labelId). */
  resolveAnnotationStyle: (labelId: string) => AnnotationDrawStyle;
  /** Phase 6: in-progress draft + live freehand use active label color. */
  draftStyle: AnnotationDrawStyle;
  /** When false, freehand stroke is not started (no active label). */
  annotationCommitEnabled?: boolean;
  /** Phase 8: selected vertex or whole annotation (delete). */
  editSelection?: EditHit | null;
  onEditSelect?: (hit: EditHit | null) => void;
  onEditVertexCommit?: (annotationId: string, pointIndex: number, p: ImagePoint) => void;
  onDeleteAnnotation?: (annotationId: string) => void;
  onClickImage?: (p: ImagePoint) => void;
  onDoubleClickImage?: (p: ImagePoint) => void;
  /** Phase 5: released after drag; points in image space. */
  onFreehandComplete?: (points: ImagePoint[]) => void;
  /** Touch gesture: two-finger swipe left/right to change slice. */
  onNavigateSlice?: (delta: -1 | 1) => void;
}) {
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-[color:var(--color-background)] p-4"
      aria-label="Image canvas"
    >
      <div
        className="flex min-h-[min(60vh,520px)] flex-1 items-stretch justify-stretch rounded-2xl border border-[color:var(--color-ocean-green)]/20 bg-[color:var(--color-surface)] shadow-sm shadow-black/[0.03]"
      >
        {frame ? (
          <CanvasFrame
            frame={frame}
            annotations={annotations}
            mode={mode}
            draft={draft}
            onClickImage={onClickImage}
            onDoubleClickImage={onDoubleClickImage}
            onFreehandComplete={onFreehandComplete}
            onNavigateSlice={onNavigateSlice}
            resolveAnnotationStyle={resolveAnnotationStyle}
            draftStyle={draftStyle}
            annotationCommitEnabled={annotationCommitEnabled}
            editSelection={editSelection}
            onEditSelect={onEditSelect}
            onEditVertexCommit={onEditVertexCommit}
            onDeleteAnnotation={onDeleteAnnotation}
          />
        ) : (
          <CanvasEmpty />
        )}
      </div>
    </section>
  );
}

function CanvasEmpty() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="h-10 w-10 rounded-2xl border border-[color:var(--color-ocean-green)]/30 bg-[color:var(--color-surface-2)]" />
      <p className="text-sm font-medium text-[color:var(--color-foreground)]">Canvas</p>
      <p className="text-sm text-[color:var(--color-muted)]">
        Pick a local image/TIFF to display the first slice.
      </p>
    </div>
  );
}

function CanvasFrame({
  frame,
  annotations,
  mode,
  draft,
  onClickImage,
  onDoubleClickImage,
  onFreehandComplete,
  onNavigateSlice,
  resolveAnnotationStyle,
  draftStyle,
  annotationCommitEnabled = true,
  editSelection = null,
  onEditSelect,
  onEditVertexCommit,
  onDeleteAnnotation,
}: {
  frame: OctCanvasFrame;
  annotations: Annotation[];
  mode: DrawMode;
  draft: Draft | null;
  resolveAnnotationStyle: (labelId: string) => AnnotationDrawStyle;
  draftStyle: AnnotationDrawStyle;
  annotationCommitEnabled?: boolean;
  editSelection?: EditHit | null;
  onEditSelect?: (hit: EditHit | null) => void;
  onEditVertexCommit?: (annotationId: string, pointIndex: number, p: ImagePoint) => void;
  onDeleteAnnotation?: (annotationId: string) => void;
  onClickImage?: (p: ImagePoint) => void;
  onDoubleClickImage?: (p: ImagePoint) => void;
  onFreehandComplete?: (points: ImagePoint[]) => void;
  onNavigateSlice?: (delta: -1 | 1) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  /** Last pointer position for wheel zoom anchor (viewport client coords). */
  const wheelPointerRef = useRef({ x: 0, y: 0 });
  const panDragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    scrollL: number;
    scrollT: number;
  } | null>(null);
  const [panGrabbing, setPanGrabbing] = useState(false);

  // Default zoom: slightly zoomed-out from baseline (comfortable view).
  const DEFAULT_ZOOM = 0.6;
  const zoomRef = useRef(DEFAULT_ZOOM);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [hoverImage, setHoverImage] = useState<ImagePoint | null>(null);

  // Magnifier glass tool states
  const [magnifierActive, setMagnifierActive] = useState(false);
  const [magnifierZoom, setMagnifierZoom] = useState(2.5);
  const [lensPos, setLensPos] = useState({ x: 0, y: 0 });
  const lensSize = 200;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lensCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const magnifierActiveRef = useRef(magnifierActive);
  useEffect(() => {
    magnifierActiveRef.current = magnifierActive;
  }, [magnifierActive]);

  const hoverImageRef = useRef(hoverImage);
  useEffect(() => {
    hoverImageRef.current = hoverImage;
  }, [hoverImage]);
  /** In-progress freehand stroke (image space); committed on pointer up. */
  const [freehandLive, setFreehandLive] = useState<ImagePoint[] | null>(null);
  const suppressNextClickRef = useRef(false);
  const freehandPointerIdRef = useRef<number | null>(null);
  /** Latest stroke samples (synced with freehandLive for paint). */
  const freehandStrokeRef = useRef<ImagePoint[]>([]);

  /** Phase 8: vertex drag preview (image space); ref updated synchronously for pointerup commit. */
  const [vertexDragLive, setVertexDragLive] = useState<{
    annotationId: string;
    pointIndex: number;
    current: ImagePoint;
  } | null>(null);
  const vertexDragLiveRef = useRef<{
    annotationId: string;
    pointIndex: number;
    current: ImagePoint;
  } | null>(null);
  const editDownRef = useRef<{
    clientX: number;
    clientY: number;
    hit: EditHit | null;
    moved: boolean;
    pointerId: number;
  } | null>(null);

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  // Touch gesture state (pinch zoom + 2-finger swipe to change slice).
  const touchRef = useRef<{
    active: boolean;
    startDist: number;
    startZoom: number;
    startMidX: number;
    lastNavAt: number;
  }>({ active: false, startDist: 0, startZoom: DEFAULT_ZOOM, startMidX: 0, lastNavAt: 0 });

  function clampZoom(z: number) {
    return Math.max(0.2, Math.min(6, Math.round(z * 100) / 100));
  }

  /** After zoom changes, re-align scroll so image point under anchor stays fixed (Phase 7.2 / 7.4). */
  const scrollAnchorAfterZoomRef = useRef<{
    z0: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Trackpad gestures: pinch-to-zoom (cursor-centered) + horizontal scroll for slice.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const wheelState = {
      raf: 0 as number | 0,
      pendingZoomDelta: 0,
      pendingSliceDeltaX: 0,
      lastSliceAt: 0,
    };

    const applyPending = () => {
      wheelState.raf = 0;

      if (wheelState.pendingZoomDelta !== 0) {
        const step = 0.00135;
        const dz = wheelState.pendingZoomDelta;
        wheelState.pendingZoomDelta = 0;
        const z0 = zoomRef.current;
        const z1 = clampZoom(z0 * Math.exp(-dz * step));
        if (Math.abs(z1 - z0) > 1e-8) {
          const { x, y } = wheelPointerRef.current;
          scrollAnchorAfterZoomRef.current = { z0, clientX: x, clientY: y };
          setZoom(z1);
        }
      }

      if (wheelState.pendingSliceDeltaX !== 0 && onNavigateSlice) {
        const dx = wheelState.pendingSliceDeltaX;
        const threshold = 52;
        const now = Date.now();
        const cooldownMs = 110;
        if (now - wheelState.lastSliceAt >= cooldownMs) {
          if (dx >= threshold) {
            wheelState.pendingSliceDeltaX = dx - threshold;
            wheelState.lastSliceAt = now;
            onNavigateSlice(1);
          } else if (dx <= -threshold) {
            wheelState.pendingSliceDeltaX = dx + threshold;
            wheelState.lastSliceAt = now;
            onNavigateSlice(-1);
          }
        }
        if (Math.abs(wheelState.pendingSliceDeltaX) >= threshold && wheelState.raf === 0) {
          wheelState.raf = requestAnimationFrame(applyPending);
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (magnifierActiveRef.current && hoverImageRef.current) {
        e.preventDefault();
        const zoomStep = 0.2;
        if (e.deltaY < 0) {
          setMagnifierZoom(z => Math.min(6.0, Math.round((z + zoomStep) * 10) / 10));
        } else {
          setMagnifierZoom(z => Math.max(1.5, Math.round((z - zoomStep) * 10) / 10));
        }
        return;
      }

      wheelPointerRef.current = { x: e.clientX, y: e.clientY };
      const wantsPinchZoom = e.ctrlKey;
      const wantsSliceScroll = !e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2;

      if (!wantsPinchZoom && !wantsSliceScroll) return;
      e.preventDefault();

      if (wantsPinchZoom) {
        wheelState.pendingZoomDelta += e.deltaY;
        if (wheelState.raf === 0) wheelState.raf = requestAnimationFrame(applyPending);
      } else if (wantsSliceScroll && onNavigateSlice) {
        wheelState.pendingSliceDeltaX += e.deltaX;
        if (wheelState.raf === 0) wheelState.raf = requestAnimationFrame(applyPending);
      }
    };

    scrollEl.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      scrollEl.removeEventListener("wheel", onWheel as EventListener);
      if (wheelState.raf) cancelAnimationFrame(wheelState.raf);
    };
  }, [onNavigateSlice]);

  useEffect(() => {
    if (mode === "freehand") return;
    const id = requestAnimationFrame(() => {
      setFreehandLive(null);
      freehandStrokeRef.current = [];
      freehandPointerIdRef.current = null;
    });
    return () => cancelAnimationFrame(id);
  }, [mode]);

  useEffect(() => {
    if (mode === "edit") return;
    setVertexDragLive(null);
    vertexDragLiveRef.current = null;
    editDownRef.current = null;
  }, [mode]);

  useEffect(() => {
    if (mode !== "pan") setPanGrabbing(false);
  }, [mode]);

  useEffect(() => {
    if (annotationCommitEnabled) return;
    const id = requestAnimationFrame(() => {
      setFreehandLive(null);
      freehandStrokeRef.current = [];
      freehandPointerIdRef.current = null;
    });
    return () => cancelAnimationFrame(id);
  }, [annotationCommitEnabled]);

  useEffect(() => {
    if (mode !== "freehand") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!freehandLive || freehandLive.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      freehandStrokeRef.current = [];
      setFreehandLive(null);
      suppressNextClickRef.current = true;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [freehandLive, mode]);

  // Base scale: keep 1:1 unless the slice is huge.
  const baseMaxW = 1100;
  const baseMaxH = 650;
  const baseScale = useMemo(() => {
    return Math.min(baseMaxW / frame.width, baseMaxH / frame.height, 1);
  }, [frame.height, frame.width]);

  const { cssW, cssH } = useMemo(() => {
    const scale = baseScale * zoom;
    return {
      cssW: Math.round(frame.width * scale),
      cssH: Math.round(frame.height * scale),
    };
  }, [baseScale, frame.height, frame.width, zoom]);

  /** Keep cursor-anchored zoom aligned after canvas dimensions update (Phase 7.2). */
  useLayoutEffect(() => {
    const anchor = scrollAnchorAfterZoomRef.current;
    if (!anchor) return;
    scrollAnchorAfterZoomRef.current = null;
    const sc = scrollRef.current;
    if (!sc) return;
    const { z0, clientX, clientY } = anchor;
    const sr = sc.getBoundingClientRect();
    const vx = clientX - sr.left;
    const vy = clientY - sr.top;
    const cssW0 = frame.width * baseScale * z0;
    const cssH0 = frame.height * baseScale * z0;
    const mx = sc.scrollLeft + vx;
    const my = sc.scrollTop + vy;
    const ix = (mx / cssW0) * frame.width;
    const iy = (my / cssH0) * frame.height;
    const z1 = zoom;
    const cssW1 = frame.width * baseScale * z1;
    const cssH1 = frame.height * baseScale * z1;
    const newMx = (ix / frame.width) * cssW1;
    const newMy = (iy / frame.height) * cssH1;
    const maxL = Math.max(0, sc.scrollWidth - sr.width);
    const maxT = Math.max(0, sc.scrollHeight - sr.height);
    sc.scrollLeft = Math.max(0, Math.min(newMx - vx, maxL));
    sc.scrollTop = Math.max(0, Math.min(newMy - vy, maxT));
  }, [zoom, baseScale, frame.height, frame.width]);

  /** New slice: center the image in the viewport (after canvas has laid out). */
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const apply = () => {
      const z = zoomRef.current;
      const dw = frame.width * baseScale * z;
      const dh = frame.height * baseScale * z;
      const cw = sc.clientWidth;
      const ch = sc.clientHeight;
      if (cw === 0 || ch === 0) return;
      sc.scrollLeft = Math.max(0, (dw - cw) / 2);
      sc.scrollTop = Math.max(0, (dh - ch) / 2);
    };
    requestAnimationFrame(apply);
  }, [frame.width, frame.height, baseScale]);

  const clientToImage = useCallback(
    (clientX: number, clientY: number): ImagePoint | null => {
      const sc = scrollRef.current;
      if (!sc) return null;
      const sr = sc.getBoundingClientRect();
      const vx = clientX - sr.left;
      const vy = clientY - sr.top;
      if (vx < 0 || vy < 0 || vx > sr.width || vy > sr.height) return null;
      const ox = sc.scrollLeft + vx;
      const oy = sc.scrollTop + vy;
      if (ox < 0 || oy < 0 || ox > cssW || oy > cssH) return null;
      const x = (ox / cssW) * frame.width;
      const y = (oy / cssH) * frame.height;
      return {
        x: Math.max(0, Math.min(frame.width - Number.EPSILON, x)),
        y: Math.max(0, Math.min(frame.height - Number.EPSILON, y)),
      };
    },
    [cssH, cssW, frame.height, frame.width],
  );

  const drawPoint = useCallback(
    (ctx: CanvasRenderingContext2D, p: ImagePoint, style: AnnotationDrawStyle) => {
      const px = (p.x / frame.width) * cssW;
      const py = (p.y / frame.height) * cssH;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = style.fillPoint;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    },
    [cssH, cssW, frame.height, frame.width],
  );

  const drawLine = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      a: ImagePoint,
      b: ImagePoint,
      dashed: boolean,
      style: AnnotationDrawStyle,
    ) => {
      const ax = (a.x / frame.width) * cssW;
      const ay = (a.y / frame.height) * cssH;
      const bx = (b.x / frame.width) * cssW;
      const by = (b.y / frame.height) * cssH;
      ctx.save();
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 2;
      if (dashed) ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.restore();
    },
    [cssH, cssW, frame.height, frame.width],
  );

  const drawPolygon = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      pts: ImagePoint[],
      opts: { closed: boolean; fill: boolean; dashed: boolean },
      style: AnnotationDrawStyle,
    ) => {
      if (pts.length === 0) return;
      ctx.save();
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 2;
      if (opts.dashed) ctx.setLineDash([6, 6]);
      ctx.beginPath();
      const first = pts[0]!;
      ctx.moveTo((first.x / frame.width) * cssW, (first.y / frame.height) * cssH);
      for (const p of pts.slice(1)) {
        ctx.lineTo((p.x / frame.width) * cssW, (p.y / frame.height) * cssH);
      }
      if (opts.closed) ctx.closePath();
      if (opts.fill && opts.closed) {
        ctx.fillStyle = style.fillPolygon;
        ctx.fill();
      }
      ctx.stroke();
      ctx.restore();
    },
    [cssH, cssW, frame.height, frame.width],
  );

  /** Freehand stroke: open polyline with rounded caps (Phase 5).
   *  Any enclosed / self-crossing region is filled using the even-odd rule,
   *  mirroring the polygon fill behaviour. */
  const drawFreehandPolyline = useCallback(
    (ctx: CanvasRenderingContext2D, pts: ImagePoint[], style: AnnotationDrawStyle, filled = false) => {
      if (pts.length < 2) return;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const first = pts[0]!;
      ctx.moveTo((first.x / frame.width) * cssW, (first.y / frame.height) * cssH);
      for (const p of pts.slice(1)) {
        ctx.lineTo((p.x / frame.width) * cssW, (p.y / frame.height) * cssH);
      }
      if (filled) {
        // Close path back to start so the enclosed area includes the gap
        // between the last point and the first (handles near-closed strokes).
        ctx.closePath();
        ctx.fillStyle = style.fillPolygon;
        ctx.fill("evenodd");
      }
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    },
    [cssH, cssW, frame.height, frame.width],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = false;
    if (frame.bitmap) {
      try {
        ctx.drawImage(frame.bitmap, 0, 0, frame.width, frame.height, 0, 0, cssW, cssH);
      } catch (err) {
        console.warn("Failed to draw image frame (source may be detached):", err);
      }
    } else if (frame.rgba) {
      const off = offscreenRef.current ?? document.createElement("canvas");
      offscreenRef.current = off;
      const imageData = new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height);
      if (off.width !== frame.width) off.width = frame.width;
      if (off.height !== frame.height) off.height = frame.height;
      const offCtx = off.getContext("2d");
      if (!offCtx) return;
      offCtx.putImageData(imageData, 0, 0);
      ctx.drawImage(off, 0, 0, frame.width, frame.height, 0, 0, cssW, cssH);
    }

    let annotationsToPaint = annotations;
    if (mode === "edit" && vertexDragLive) {
      const { annotationId, pointIndex, current } = vertexDragLive;
      annotationsToPaint = annotations.map((ann) =>
        ann.id === annotationId ? setAnnotationPointAt(ann, pointIndex, current, frame) : ann,
      );
    }

    // Final annotations (Phase 6: per-label color).
    for (const a of annotationsToPaint) {
      const st = resolveAnnotationStyle(a.labelId);
      if (a.type === "point") {
        drawPoint(ctx, a.points[0], st);
      } else if (a.type === "line") {
        drawLine(ctx, a.points[0], a.points[1], false, st);
        drawPoint(ctx, a.points[0], st);
        drawPoint(ctx, a.points[1], st);
      } else if (a.type === "polygon") {
        drawPolygon(ctx, a.points, { closed: true, fill: true, dashed: false }, st);
        for (const p of a.points) drawPoint(ctx, p, st);
      } else if (a.type === "freehand") {
        drawFreehandPolyline(ctx, a.points, st, true);
      }
    }

    // Phase 8: edit selection highlight (gold dashed overlay).
    if (mode === "edit" && editSelection) {
      const hi = annotationsToPaint.find((x) => x.id === editSelection.annotationId);
      if (hi) {
        ctx.save();
        ctx.strokeStyle = "rgba(250, 204, 21, 0.95)";
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 4]);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        if (editSelection.kind === "annotation") {
          if (hi.type === "point") {
            const p = hi.points[0]!;
            const px = (p.x / frame.width) * cssW;
            const py = (p.y / frame.height) * cssH;
            ctx.beginPath();
            ctx.arc(px, py, 10, 0, Math.PI * 2);
            ctx.stroke();
          } else if (hi.type === "line") {
            const ax = (hi.points[0]!.x / frame.width) * cssW;
            const ay = (hi.points[0]!.y / frame.height) * cssH;
            const bx = (hi.points[1]!.x / frame.width) * cssW;
            const by = (hi.points[1]!.y / frame.height) * cssH;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
          } else if (hi.type === "polygon") {
            const ring = hi.points;
            if (ring.length > 0) {
              const f = ring[0]!;
              ctx.beginPath();
              ctx.moveTo((f.x / frame.width) * cssW, (f.y / frame.height) * cssH);
              for (const p of ring.slice(1)) {
                ctx.lineTo((p.x / frame.width) * cssW, (p.y / frame.height) * cssH);
              }
              ctx.closePath();
              ctx.stroke();
            }
          } else if (hi.type === "freehand" && hi.points.length >= 2) {
            const ring = hi.points;
            const f0 = ring[0]!;
            ctx.beginPath();
            ctx.moveTo((f0.x / frame.width) * cssW, (f0.y / frame.height) * cssH);
            for (const p of ring.slice(1)) {
              ctx.lineTo((p.x / frame.width) * cssW, (p.y / frame.height) * cssH);
            }
            ctx.stroke();
          }
        } else {
          const idx = editSelection.pointIndex;
          const vp = hi.points[idx];
          if (vp) {
            const px = (vp.x / frame.width) * cssW;
            const py = (vp.y / frame.height) * cssH;
            ctx.beginPath();
            ctx.arc(px, py, 9, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    // Draft preview (uses current hover as dynamic endpoint).
    if (draft && hoverImage) {
      if (draft.type === "polygon" && draft.points.length > 0) {
        drawPolygon(
          ctx,
          [...draft.points, hoverImage],
          { closed: false, fill: false, dashed: true },
          draftStyle,
        );
        for (const p of draft.points) drawPoint(ctx, p, draftStyle);
      } else if (draft.type === "line") {
        drawLine(ctx, draft.points[0], hoverImage, true, draftStyle);
        drawPoint(ctx, draft.points[0], draftStyle);
      }
    } else if (draft && draft.type === "polygon") {
      // No hover (e.g. pointer left) — still show existing draft points.
      if (draft.points.length > 1) {
        drawPolygon(ctx, draft.points, { closed: false, fill: false, dashed: true }, draftStyle);
      }
      for (const p of draft.points) drawPoint(ctx, p, draftStyle);
    } else if (draft && draft.type === "line") {
      drawPoint(ctx, draft.points[0], draftStyle);
    }

    if (freehandLive && freehandLive.length >= 2) {
      drawFreehandPolyline(ctx, freehandLive, draftStyle);
    }
  }, [
    annotations,
    cssH,
    cssW,
    dpr,
    draft,
    draftStyle,
    drawFreehandPolyline,
    drawLine,
    drawPoint,
    drawPolygon,
    editSelection,
    frame.bitmap,
    freehandLive,
    frame.height,
    frame.rgba,
    frame.width,
    hoverImage,
    mode,
    resolveAnnotationStyle,
    vertexDragLive,
  ]);

  // Magnifier drawing effect
  useEffect(() => {
    if (!magnifierActive || !hoverImage) return;

    const lensCanvas = lensCanvasRef.current;
    const mainCanvas = canvasRef.current;
    if (!lensCanvas || !mainCanvas || !frame) return;

    const ctx = lensCanvas.getContext("2d");
    if (!ctx) return;

    // Fill background
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, lensSize, lensSize);

    ctx.save();
    // Clip to circle
    ctx.beginPath();
    ctx.arc(lensSize / 2, lensSize / 2, lensSize / 2, 0, Math.PI * 2);
    ctx.clip();

    const mainX = (hoverImage.x / frame.width) * cssW;
    const mainY = (hoverImage.y / frame.height) * cssH;

    const bufX = mainX * dpr;
    const bufY = mainY * dpr;

    const srcSize = (lensSize / magnifierZoom) * dpr;
    const srcX = bufX - srcSize / 2;
    const srcY = bufY - srcSize / 2;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      mainCanvas,
      srcX,
      srcY,
      srcSize,
      srcSize,
      0,
      0,
      lensSize,
      lensSize
    );

    ctx.restore();

    // Draw lens border
    ctx.beginPath();
    ctx.arc(lensSize / 2, lensSize / 2, lensSize / 2 - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(46, 139, 87, 0.85)"; // var(--color-ocean-green)
    ctx.lineWidth = 3;
    ctx.stroke();

    // Draw inner white sheen
    ctx.beginPath();
    ctx.arc(lensSize / 2, lensSize / 2, lensSize / 2 - 3, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw center crosshair
    ctx.beginPath();
    ctx.moveTo(lensSize / 2 - 6, lensSize / 2);
    ctx.lineTo(lensSize / 2 + 6, lensSize / 2);
    ctx.moveTo(lensSize / 2, lensSize / 2 - 6);
    ctx.lineTo(lensSize / 2, lensSize / 2 + 6);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();

  }, [
    magnifierActive,
    hoverImage,
    magnifierZoom,
    cssW,
    cssH,
    dpr,
    frame,
    annotations,
    draft,
    freehandLive,
    vertexDragLive,
    editSelection
  ]);

  const lensLeft = lensPos.x - lensSize / 2;
  const lensTop = lensPos.y - lensSize / 2;

  return (
    <div
      ref={containerRef}
      className="relative flex w-full flex-col items-center justify-center p-6"
    >
      {/* Floating canvas toolbar (left) */}
      <div className="absolute left-4 top-4 z-10 flex gap-2">
        <div className="flex flex-col gap-1 rounded-2xl border border-[color:var(--color-ocean-green)]/25 bg-[color:var(--color-surface)]/95 p-1 shadow-lg shadow-black/5 backdrop-blur">
          {/* Zoom In */}
          <div className="relative group flex items-center">
            <IconButton
              tone="accent"
              label="Zoom in"
              title=""
              onClick={() => {
                const z0 = zoomRef.current;
                const z1 = Math.min(6, Math.round((z0 + 0.1) * 10) / 10);
                if (Math.abs(z1 - z0) < 1e-8) return;
                const sc = scrollRef.current;
                const r = sc?.getBoundingClientRect();
                scrollAnchorAfterZoomRef.current = {
                  z0,
                  clientX: r ? r.left + r.width / 2 : 0,
                  clientY: r ? r.top + r.height / 2 : 0,
                };
                setZoom(z1);
              }}
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
            </IconButton>
            <div className="absolute left-full ml-2 px-2 py-1 bg-[color:var(--color-surface)]/95 border border-[color:var(--color-ocean-green)]/20 text-[color:var(--color-foreground)] text-[10px] font-semibold tracking-wider uppercase rounded-lg shadow-lg shadow-black/5 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-all scale-95 group-hover:scale-100 duration-150 z-50 backdrop-blur">
              Zoom In
            </div>
          </div>

          {/* Zoom Out */}
          <div className="relative group flex items-center">
            <IconButton
              label="Zoom out"
              title=""
              onClick={() => {
                const z0 = zoomRef.current;
                const z1 = Math.max(0.2, Math.round((z0 - 0.1) * 10) / 10);
                if (Math.abs(z1 - z0) < 1e-8) return;
                const sc = scrollRef.current;
                const r = sc?.getBoundingClientRect();
                scrollAnchorAfterZoomRef.current = {
                  z0,
                  clientX: r ? r.left + r.width / 2 : 0,
                  clientY: r ? r.top + r.height / 2 : 0,
                };
                setZoom(z1);
              }}
            >
              <Minus className="h-5 w-5" aria-hidden="true" />
            </IconButton>
            <div className="absolute left-full ml-2 px-2 py-1 bg-[color:var(--color-surface)]/95 border border-[color:var(--color-ocean-green)]/20 text-[color:var(--color-foreground)] text-[10px] font-semibold tracking-wider uppercase rounded-lg shadow-lg shadow-black/5 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-all scale-95 group-hover:scale-100 duration-150 z-50 backdrop-blur">
              Zoom Out
            </div>
          </div>

          {/* Reset Zoom */}
          <div className="relative group flex items-center">
            <IconButton
              label="Default size"
              title=""
              onClick={() => {
                const z0 = zoomRef.current;
                const z1 = DEFAULT_ZOOM;
                if (Math.abs(z1 - z0) < 1e-8) return;
                const sc = scrollRef.current;
                const r = sc?.getBoundingClientRect();
                scrollAnchorAfterZoomRef.current = {
                  z0,
                  clientX: r ? r.left + r.width / 2 : 0,
                  clientY: r ? r.top + r.height / 2 : 0,
                };
                setZoom(z1);
              }}
            >
              <Maximize2 className="h-5 w-5" aria-hidden="true" />
            </IconButton>
            <div className="absolute left-full ml-2 px-2 py-1 bg-[color:var(--color-surface)]/95 border border-[color:var(--color-ocean-green)]/20 text-[color:var(--color-foreground)] text-[10px] font-semibold tracking-wider uppercase rounded-lg shadow-lg shadow-black/5 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-all scale-95 group-hover:scale-100 duration-150 z-50 backdrop-blur">
              Reset Zoom
            </div>
          </div>

          {/* Magnifier Glass */}
          <div className="relative group flex items-center">
            <IconButton
              tone={magnifierActive ? "accent" : "default"}
              label="Toggle Magnifier Glass"
              title=""
              onClick={() => setMagnifierActive(!magnifierActive)}
            >
              <Search className="h-5 w-5" aria-hidden="true" />
            </IconButton>
            <div className="absolute left-full ml-2 px-2 py-1 bg-[color:var(--color-surface)]/95 border border-[color:var(--color-ocean-green)]/20 text-[color:var(--color-foreground)] text-[10px] font-semibold tracking-wider uppercase rounded-lg shadow-lg shadow-black/5 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-all scale-95 group-hover:scale-100 duration-150 z-50 backdrop-blur">
              Magnifier
            </div>
          </div>
        </div>
      </div>

      {magnifierActive && hoverImage && (
        <div
          className="absolute z-30 pointer-events-none rounded-full overflow-hidden shadow-[0_10px_25px_rgba(0,0,0,0.5)] border border-white/20"
          style={{
            left: `${lensLeft}px`,
            top: `${lensTop}px`,
            width: `${lensSize}px`,
            height: `${lensSize}px`,
          }}
        >
          <canvas
            ref={lensCanvasRef}
            width={lensSize}
            height={lensSize}
            className="block"
          />
          {/* Elegant themed zoom badge inside the lens */}
          <div className="absolute bottom-3.5 left-1/2 -translate-x-1/2 bg-slate-900/90 border border-white/10 text-white font-mono text-[10px] font-bold px-2 py-0.5 rounded-full select-none tracking-wide shadow-sm">
            {magnifierZoom.toFixed(1)}x
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className={
          "max-h-[min(70vh,650px)] max-w-[min(1100px,100%)] overflow-auto rounded-xl border border-[color:var(--color-ocean-green)]/25 bg-black/5 shadow-inner " +
          (mode === "pan" ? (panGrabbing ? "cursor-grabbing" : "cursor-grab") : "")
        }
        style={{ touchAction: "none" }}
        onPointerLeave={() => setHoverImage(null)}
        onPointerMove={(e) => {
          setHoverImage(clientToImage(e.clientX, e.clientY));
          if (magnifierActive && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setLensPos({
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
            });
          }
          const d = panDragRef.current;
          if (mode === "pan" && d?.active) {
            const sc = scrollRef.current;
            if (sc) {
              sc.scrollLeft = d.scrollL - (e.clientX - d.startX);
              sc.scrollTop = d.scrollT - (e.clientY - d.startY);
            }
          }
        }}
        onPointerDown={(e) => {
          if (mode !== "pan" || e.button !== 0) return;
          const sc = scrollRef.current;
          if (!sc) return;
          e.preventDefault();
          setPanGrabbing(true);
          panDragRef.current = {
            active: true,
            startX: e.clientX,
            startY: e.clientY,
            scrollL: sc.scrollLeft,
            scrollT: sc.scrollTop,
          };
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          if (mode !== "pan") return;
          setPanGrabbing(false);
          if (panDragRef.current?.active) {
            panDragRef.current = null;
            try {
              (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
            } catch {
              /* ok */
            }
          }
        }}
        onPointerCancel={(e) => {
          setPanGrabbing(false);
          panDragRef.current = null;
          try {
            (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
          } catch {
            /* ok */
          }
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="OCT slice canvas"
          className={
            mode === "pan"
              ? "block cursor-inherit touch-none"
              : mode === "edit"
                ? "block cursor-default touch-none"
                : "block cursor-crosshair touch-none"
          }
          style={{
            touchAction: "none",
            pointerEvents: mode === "pan" ? "none" : "auto",
            cursor: mode === "erase" ? 'url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%2724%27%20height%3D%2724%27%20viewBox%3D%270%200%2024%2024%27%3E%3Cpath%20d%3D%27m20%2020-2.8-2.8%27%20fill%3D%27none%27%20stroke%3D%27white%27%20stroke-width%3D%274%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%2F%3E%3Cpath%20d%3D%27M11%202.8c-1.3-1.3-3.3-1.3-4.6%200L2.8%206.4c-1.3%201.3-1.3%203.3%200%204.6l7.8%207.8c1.3%201.3%203.3%201.3%204.6%200l3.6-3.6c1.3-1.3%201.3-3.3%200-4.6L11%202.8Z%27%20fill%3D%27none%27%20stroke%3D%27white%27%20stroke-width%3D%274%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%2F%3E%3Cpath%20d%3D%27m5%208.7%207.6%207.6%27%20fill%3D%27none%27%20stroke%3D%27white%27%20stroke-width%3D%274%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%2F%3E%3Cpath%20d%3D%27m20%2020-2.8-2.8%27%20fill%3D%27none%27%20stroke%3D%27black%27%20stroke-width%3D%272%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%2F%3E%3Cpath%20d%3D%27M11%202.8c-1.3-1.3-3.3-1.3-4.6%200L2.8%206.4c-1.3%201.3-1.3%203.3%200%204.6l7.8%207.8c1.3%201.3%203.3%201.3%204.6%200l3.6-3.6c1.3-1.3%201.3-3.3%200-4.6L11%202.8Z%27%20fill%3D%27none%27%20stroke%3D%27black%27%20stroke-width%3D%272%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%2F%3E%3Cpath%20d%3D%27m5%208.7%207.6%207.6%27%20fill%3D%27none%27%20stroke%3D%27black%27%20stroke-width%3D%272%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%2F%3E%3C%2Fsvg%3E) 4 16, auto' : undefined,
          }}
          onPointerMove={(e) => {
            if (mode === "edit" && editDownRef.current) {
              const d = editDownRef.current;
              if (e.pointerId !== d.pointerId) return;
              const dist = Math.hypot(e.clientX - d.clientX, e.clientY - d.clientY);
              if (dist > 5) d.moved = true;
              if (d.hit?.kind === "vertex" && d.moved) {
                const p = clientToImage(e.clientX, e.clientY);
                if (p) {
                  const next = {
                    annotationId: d.hit.annotationId,
                    pointIndex: d.hit.pointIndex,
                    current: p,
                  };
                  vertexDragLiveRef.current = next;
                  setVertexDragLive(next);
                }
              }
              return;
            }
            if (mode !== "freehand") return;
            if (!annotationCommitEnabled) return;
            if (freehandPointerIdRef.current !== e.pointerId) return;
            if ((e.buttons & 1) === 0) return;
            const p = clientToImage(e.clientX, e.clientY);
            if (!p) return;
            const prev = freehandStrokeRef.current;
            const last = prev[prev.length - 1];
            if (last) {
              const dx = p.x - last.x;
              const dy = p.y - last.y;
              if (dx * dx + dy * dy < 0.72 * 0.72) return;
            }
            const next = [...prev, p];
            freehandStrokeRef.current = next;
            setFreehandLive(next);
          }}
          onPointerDown={(e) => {
            if (mode === "pan") return;
            if (mode === "erase") {
              if (e.button !== 0) return;
              e.preventDefault();
              suppressNextClickRef.current = true;
              const p = clientToImage(e.clientX, e.clientY);
              if (!p) return;
              const tolX = (12 / cssW) * frame.width;
              const tolY = (12 / cssH) * frame.height;
              const hit = hitTestAnnotations(annotations, p, tolX, tolY);
              if (hit && onDeleteAnnotation) {
                onDeleteAnnotation(hit.annotationId);
              }
              return;
            }
            if (mode === "edit") {
              if (e.button !== 0 || !onEditSelect) return;
              e.preventDefault();
              suppressNextClickRef.current = true;
              const p = clientToImage(e.clientX, e.clientY);
              if (!p) return;
              const tolX = (12 / cssW) * frame.width;
              const tolY = (12 / cssH) * frame.height;
              const hit = hitTestAnnotations(annotations, p, tolX, tolY);
              editDownRef.current = {
                clientX: e.clientX,
                clientY: e.clientY,
                hit,
                moved: false,
                pointerId: e.pointerId,
              };
              (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
              return;
            }
            if (mode !== "freehand" || e.button !== 0) return;
          if (!annotationCommitEnabled) return;
          const p = clientToImage(e.clientX, e.clientY);
          if (!p) return;
          e.preventDefault();
          suppressNextClickRef.current = true;
          freehandPointerIdRef.current = e.pointerId;
          freehandStrokeRef.current = [p];
          setFreehandLive([p]);
          (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          if (mode === "edit" && editDownRef.current) {
            const d = editDownRef.current;
            if (e.pointerId !== d.pointerId) return;
            const el = e.currentTarget as HTMLCanvasElement;
            try {
              el.releasePointerCapture(e.pointerId);
            } catch {
              /* ok */
            }
            const vd = vertexDragLiveRef.current;
            editDownRef.current = null;
            vertexDragLiveRef.current = null;
            setVertexDragLive(null);
            if (d.hit?.kind === "vertex") {
              if (d.moved && vd && onEditVertexCommit) {
                onEditVertexCommit(vd.annotationId, vd.pointIndex, vd.current);
              } else if (!d.moved && onEditSelect) {
                onEditSelect(d.hit);
              }
            } else if (d.hit?.kind === "annotation") {
              if (!d.moved && onEditSelect) onEditSelect(d.hit);
            } else if (d.hit === null && !d.moved && onEditSelect) {
              onEditSelect(null);
            }
            suppressNextClickRef.current = true;
            return;
          }
          if (mode !== "freehand") return;
          if (freehandPointerIdRef.current !== e.pointerId) return;
          freehandPointerIdRef.current = null;
          const el = e.currentTarget as HTMLCanvasElement;
          try {
            el.releasePointerCapture(e.pointerId);
          } catch {
            /* already released */
          }
          const pts = freehandStrokeRef.current;
          freehandStrokeRef.current = [];
          setFreehandLive(null);
          if (pts.length >= 2 && annotationCommitEnabled && onFreehandComplete) {
            onFreehandComplete(pts);
          }
        }}
        onPointerCancel={(e) => {
          if (mode === "edit" && editDownRef.current?.pointerId === e.pointerId) {
            editDownRef.current = null;
            vertexDragLiveRef.current = null;
            setVertexDragLive(null);
            suppressNextClickRef.current = true;
            try {
              (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
            } catch {
              /* ok */
            }
            return;
          }
          if (mode !== "freehand") return;
          if (freehandPointerIdRef.current !== e.pointerId) return;
          freehandPointerIdRef.current = null;
          freehandStrokeRef.current = [];
          setFreehandLive(null);
          suppressNextClickRef.current = true;
        }}
        onClick={(e) => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          if (mode === "pan") return;
          if (mode === "edit") return;
          if (mode === "erase") return;
          if (mode === "freehand") return;
          if (!onClickImage) return;
          const p = clientToImage(e.clientX, e.clientY);
          if (p) onClickImage(p);
        }}
        onDoubleClick={(e) => {
          if (mode === "pan") return;
          if (mode === "edit") return;
          if (mode === "erase") return;
          if (mode === "freehand") return;
          if (!onDoubleClickImage) return;
          const p = clientToImage(e.clientX, e.clientY);
          if (p) onDoubleClickImage(p);
        }}
        onTouchStart={(e) => {
          if (e.touches.length !== 2) return;
          e.preventDefault();
          const t1 = e.touches[0]!;
          const t2 = e.touches[1]!;
          const dx = t2.clientX - t1.clientX;
          const dy = t2.clientY - t1.clientY;
          const dist = Math.hypot(dx, dy);
          const midX = (t1.clientX + t2.clientX) / 2;
          touchRef.current = {
            active: true,
            startDist: dist,
            startZoom: zoom,
            startMidX: midX,
            lastNavAt: touchRef.current.lastNavAt,
          };
        }}
        onTouchMove={(e) => {
          if (e.touches.length !== 2) return;
          if (!touchRef.current.active) return;
          e.preventDefault();
          const t1 = e.touches[0]!;
          const t2 = e.touches[1]!;
          const dx = t2.clientX - t1.clientX;
          const dy = t2.clientY - t1.clientY;
          const dist = Math.hypot(dx, dy);
          const midX = (t1.clientX + t2.clientX) / 2;

          // Pinch zoom (anchor on pinch midpoint — Phase 7).
          if (touchRef.current.startDist > 0) {
            const ratio = dist / touchRef.current.startDist;
            const z0 = zoomRef.current;
            const z1 = clampZoom(touchRef.current.startZoom * ratio);
            if (Math.abs(z1 - z0) > 1e-6) {
              scrollAnchorAfterZoomRef.current = {
                z0,
                clientX: (t1.clientX + t2.clientX) / 2,
                clientY: (t1.clientY + t2.clientY) / 2,
              };
              zoomRef.current = z1;
              setZoom(z1);
            }
          }

          // Two-finger horizontal swipe to change slice.
          if (onNavigateSlice) {
            const now = Date.now();
            const cooldownMs = 250;
            const dxMid = midX - touchRef.current.startMidX;
            const threshold = 50;
            if (now - touchRef.current.lastNavAt > cooldownMs) {
              if (dxMid > threshold) {
                touchRef.current.lastNavAt = now;
                touchRef.current.startMidX = midX;
                onNavigateSlice(-1);
              } else if (dxMid < -threshold) {
                touchRef.current.lastNavAt = now;
                touchRef.current.startMidX = midX;
                onNavigateSlice(1);
              }
            }
          }
        }}
        onTouchEnd={() => {
          touchRef.current.active = false;
        }}
        />
      </div>
      <p className="mt-3 font-mono text-xs text-[color:var(--color-muted)]">
        {frame.width}×{frame.height} · {(baseScale * zoom).toFixed(2)}×
        {hoverImage ? (
          <>
            {" "}
            · x:{Math.round(hoverImage.x)} y:{Math.round(hoverImage.y)}
          </>
        ) : (
          <>
            {" "}
            · x:— y:—
          </>
        )}
        {" "}
        · mode:{mode}
      </p>
    </div>
  );
}

