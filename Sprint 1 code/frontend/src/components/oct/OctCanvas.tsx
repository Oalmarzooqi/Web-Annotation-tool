"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export function OctCanvas({
  frame,
  points,
  onAddPoint,
}: {
  frame: OctCanvasFrame | null;
  /** Current slice only — parent keeps per-slice maps. */
  points: ImagePoint[];
  onAddPoint?: (p: ImagePoint) => void;
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
          <CanvasFrame frame={frame} points={points} onAddPoint={onAddPoint} />
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
  points,
  onAddPoint,
}: {
  frame: OctCanvasFrame;
  points: ImagePoint[];
  onAddPoint?: (p: ImagePoint) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const lastRgbaRef = useRef<Uint8ClampedArray | undefined>(undefined);

  // Magnifier default zoom.
  const MAGNIFIER_DEFAULT_ZOOM = 2.0;
  const [zoom, setZoom] = useState(MAGNIFIER_DEFAULT_ZOOM);
  const [hoverImage, setHoverImage] = useState<ImagePoint | null>(null);
  const [isMagnifierActive, setIsMagnifierActive] = useState(false);

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  // Base scale: keep 1:1 unless the slice is huge.
  const baseMaxW = 1100;
  const baseMaxH = 650;
  const baseScale = useMemo(() => {
    return Math.min(baseMaxW / frame.width, baseMaxH / frame.height, 1);
  }, [frame.height, frame.width]);

  const MAIN_SCALE_FACTOR = 0.6;

  const { cssW, cssH } = useMemo(() => {
    const scale = baseScale * MAIN_SCALE_FACTOR;
    return {
      cssW: Math.round(frame.width * scale),
      cssH: Math.round(frame.height * scale),
    };
  }, [baseScale, frame.height, frame.width]);

  const clientToImage = useCallback(
    (clientX: number, clientY: number): ImagePoint | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const ox = clientX - rect.left;
      const oy = clientY - rect.top;
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

    let sourceCanvasOrBitmap: CanvasImageSource | null = null;

    if (frame.bitmap) {
      sourceCanvasOrBitmap = frame.bitmap;
    } else if (frame.rgba) {
      const off = offscreenRef.current ?? document.createElement("canvas");
      offscreenRef.current = off;
      const offCtx = off.getContext("2d");
      if (offCtx) {
        if (off.width !== frame.width || off.height !== frame.height || lastRgbaRef.current !== frame.rgba) {
          off.width = frame.width;
          off.height = frame.height;
          const imageData = new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height);
          offCtx.putImageData(imageData, 0, 0);
          lastRgbaRef.current = frame.rgba;
        }
        sourceCanvasOrBitmap = off;
      }
    }

    if (sourceCanvasOrBitmap) {
      ctx.drawImage(sourceCanvasOrBitmap, 0, 0, frame.width, frame.height, 0, 0, cssW, cssH);
    }

    const mainScaleFactor = cssW / frame.width;

    const drawPoints = (scaleFactor: number, offsetX: number = 0, offsetY: number = 0, pointRadius: number = 4) => {
      for (const p of points) {
        const px = offsetX + p.x * scaleFactor;
        const py = offsetY + p.y * scaleFactor;
        ctx.beginPath();
        ctx.arc(px, py, pointRadius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(46, 139, 87, 0.35)";
        ctx.strokeStyle = "rgb(35, 104, 65)";
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();
      }
    };

    drawPoints(mainScaleFactor, 0, 0, 4);

    if (isMagnifierActive && hoverImage && sourceCanvasOrBitmap) {
      const hx = (hoverImage.x / frame.width) * cssW;
      const hy = (hoverImage.y / frame.height) * cssH;
      const magRadius = 100;

      ctx.save();
      
      ctx.beginPath();
      ctx.arc(hx, hy, magRadius, 0, Math.PI * 2);
      ctx.clip();

      const magScaleFactor = baseScale * zoom;
      const dw = frame.width * magScaleFactor;
      const dh = frame.height * magScaleFactor;
      const dx = hx - hoverImage.x * magScaleFactor;
      const dy = hy - hoverImage.y * magScaleFactor;

      ctx.fillStyle = "rgba(0, 0, 0, 1)";
      ctx.fillRect(hx - magRadius, hy - magRadius, magRadius * 2, magRadius * 2);

      ctx.drawImage(sourceCanvasOrBitmap, 0, 0, frame.width, frame.height, dx, dy, dw, dh);

      const magnifiedPointRadius = 4 * (magScaleFactor / mainScaleFactor);
      drawPoints(magScaleFactor, dx, dy, magnifiedPointRadius);

      ctx.restore();

      ctx.beginPath();
      ctx.arc(hx, hy, magRadius, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 8;
      ctx.stroke();
    }
  }, [cssH, cssW, dpr, frame.bitmap, frame.height, frame.rgba, frame.width, points, hoverImage, zoom, baseScale, isMagnifierActive]);

  return (
    <div
      className="relative flex w-full flex-col items-center justify-center p-6"
    >
      {/* Floating canvas toolbar (left) */}
      <div className="absolute left-4 top-4 z-10 flex flex-col gap-1 rounded-2xl border border-[color:var(--color-ocean-green)]/25 bg-[color:var(--color-surface)]/95 p-1 shadow-lg shadow-black/5 backdrop-blur">
        <IconButton
          tone={isMagnifierActive ? "accent" : "default"}
          label={isMagnifierActive ? "Disable Magnifier" : "Enable Magnifier"}
          onClick={() => setIsMagnifierActive((v) => !v)}
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </IconButton>

        {isMagnifierActive && (
          <>
            <div className="my-1 h-px w-full bg-[color:var(--color-ocean-green)]/20" />
            <IconButton
              label="Magnifier Zoom in"
              onClick={() => setZoom((z) => Math.min(10, Math.round((z + 0.5) * 10) / 10))}
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
            </IconButton>
            <IconButton
              label="Magnifier Zoom out"
              onClick={() => setZoom((z) => Math.max(1.0, Math.round((z - 0.5) * 10) / 10))}
            >
              <Minus className="h-5 w-5" aria-hidden="true" />
            </IconButton>
            <IconButton
              label="Default magnifier size"
              onClick={() => setZoom(MAGNIFIER_DEFAULT_ZOOM)}
            >
              <Maximize2 className="h-5 w-5" aria-hidden="true" />
            </IconButton>
          </>
        )}
      </div>

      <canvas
        ref={canvasRef}
        role="img"
        aria-label="OCT slice — click to place a point"
        className="cursor-crosshair rounded-xl border border-[color:var(--color-ocean-green)]/25 bg-black/5"
        onMouseMove={(e) => {
          const p = clientToImage(e.clientX, e.clientY);
          setHoverImage(p);
        }}
        onMouseLeave={() => setHoverImage(null)}
        onClick={(e) => {
          if (!onAddPoint) return;
          const p = clientToImage(e.clientX, e.clientY);
          if (p) onAddPoint(p);
        }}
      />
      <p className="mt-3 font-mono text-xs text-[color:var(--color-muted)]">
        {frame.width}×{frame.height} · Mag: {zoom.toFixed(1)}×
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
      </p>
    </div>
  );
}

