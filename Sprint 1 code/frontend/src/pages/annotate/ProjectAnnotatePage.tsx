"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { OctCanvas, OctLabelPanel, OctToolbar } from "../../components/oct";
import { IconButton } from "../../components/ui";
import { ChevronLeft, ChevronRight, Eraser, FileUp, ScanLine, X } from "lucide-react";
import type { ImagePoint, OctCanvasFrame } from "../../components/oct/OctCanvas";
import { useProject } from "../../lib/useProjects";
import { deleteProjectVolume, getProjectVolume, setProjectVolume } from "../../lib/idb";

async function fileToArrayBuffer(file: File) {
  return await file.arrayBuffer();
}

type TiffState = {
  kind: "tiff";
  worker: Worker;
  sliceCount: number;
  width: number;
  height: number;
};

/** Uncompressed DICOM volume — same worker protocol as TIFF (`ready` + `slice`). */
type DicomState = {
  kind: "dicom";
  worker: Worker;
  sliceCount: number;
  width: number;
  height: number;
};

type SingleState = {
  kind: "single";
  frame: OctCanvasFrame;
};

type VolumeState = TiffState | DicomState | SingleState | null;

function isStackVolume(v: VolumeState): v is TiffState | DicomState {
  return v !== null && (v.kind === "tiff" || v.kind === "dicom");
}

type WorkerReady = { type: "ready"; sliceCount: number; width: number; height: number };
type WorkerSlice = {
  type: "slice";
  idx: number;
  width: number;
  height: number;
  bitmap?: ImageBitmap;
  rgba?: Uint8ClampedArray;
};
type WorkerError = { type: "error"; message: string };
type WorkerResp = WorkerReady | WorkerSlice | WorkerError;

async function decodeSingleImage(file: File): Promise<OctCanvasFrame[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Failed to load image"));
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D context");
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return [{ width: canvas.width, height: canvas.height, rgba: data }];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function createStackVolumeFromBuffer(
  buf: ArrayBuffer,
  format: "tiff" | "dicom",
): Promise<TiffState | DicomState> {
  const workerUrl =
    format === "tiff"
      ? new URL("../../workers/tiffWorker.ts", import.meta.url)
      : new URL("../../workers/dicomWorker.ts", import.meta.url);
  const worker = new Worker(workerUrl, { type: "module" });
  const ready = await new Promise<WorkerReady>((resolve, reject) => {
    const handler = (ev: MessageEvent<WorkerResp>) => {
      const m = ev.data;
      if (m.type === "ready") {
        worker.removeEventListener("message", handler as EventListener);
        resolve(m);
      } else if (m.type === "error") {
        worker.removeEventListener("message", handler as EventListener);
        reject(new Error(m.message));
      }
    };
    worker.addEventListener("message", handler as EventListener);
    worker.postMessage({ type: "init", buf }, [buf]);
  });
  return {
    kind: format,
    worker,
    sliceCount: ready.sliceCount,
    width: ready.width,
    height: ready.height,
  };
}

export function ProjectAnnotatePage() {
  const { id = "" } = useParams<{ id: string }>();
  const { project } = useProject(id);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [volume, setVolume] = useState<VolumeState>(null);
  const [sliceIdx, setSliceIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastFrame, setLastFrame] = useState<OctCanvasFrame | null>(null);
  /** Phase 3: markers in original image pixels, keyed by slice index. */
  const [pointsBySlice, setPointsBySlice] = useState<Record<number, ImagePoint[]>>({});

  const cacheRef = useRef<Map<number, OctCanvasFrame>>(new Map());
  const [, setCacheVersion] = useState(0);
  const inflightRef = useRef<Set<number>>(new Set());
  const workerRef = useRef<Worker | null>(null);

  const sliceCount = useMemo(() => {
    if (!volume) return 0;
    if (volume.kind === "single") return 1;
    return volume.sliceCount; // tiff or dicom
  }, [volume]);

  // NOTE: Do not memoize this — the cache mutates without changing deps.
  const frame: OctCanvasFrame | null = !volume
    ? null
    : volume.kind === "single"
      ? volume.frame
      : cacheRef.current.get(sliceIdx) ?? lastFrame ?? null;

  // Lazy request current slice from worker (and keep a small LRU cache).
  useEffect(() => {
    if (!isStackVolume(volume)) return;
    if (sliceIdx < 0 || sliceIdx >= volume.sliceCount) return;
    if (cacheRef.current.has(sliceIdx)) return;
    if (inflightRef.current.has(sliceIdx)) return;
    inflightRef.current.add(sliceIdx);

    volume.worker.postMessage({ type: "slice", idx: sliceIdx });
  }, [sliceIdx, volume]);

  // Prefetch neighbors so next/prev feels instant.
  useEffect(() => {
    if (!isStackVolume(volume)) return;
    const wants = [sliceIdx - 1, sliceIdx + 1, sliceIdx + 2, sliceIdx - 2].filter(
      (i) => i >= 0 && i < volume.sliceCount,
    );
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      for (const i of wants) {
        if (cacheRef.current.has(i)) continue;
        if (inflightRef.current.has(i)) continue;
        inflightRef.current.add(i);
        volume.worker.postMessage({ type: "slice", idx: i });
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [sliceIdx, volume]);
  const sliceLabel = useMemo(() => {
    if (sliceCount === 0) return null;
    return `Slice ${sliceIdx + 1} / ${sliceCount}`;
  }, [sliceCount, sliceIdx]);

  const slicePoints = pointsBySlice[sliceIdx] ?? [];

  useEffect(() => {
    setPointsBySlice({});
  }, [id]);

  const addPoint = (p: ImagePoint) => {
    setPointsBySlice((prev) => ({
      ...prev,
      [sliceIdx]: [...(prev[sliceIdx] ?? []), p],
    }));
  };

  const clearCurrentSlicePoints = () => {
    setPointsBySlice((prev) => {
      const next = { ...prev };
      delete next[sliceIdx];
      return next;
    });
  };

  useEffect(() => {
    const idx = sliceIdx;
    if (sliceCount === 0) {
      if (sliceIdx !== 0) setSliceIdx(0);
      return;
    }
    if (idx >= sliceCount) {
      setSliceIdx(sliceCount - 1);
    }
  }, [sliceCount, sliceIdx]);

  // Worker message handler + caching.
  useEffect(() => {
    if (!isStackVolume(volume)) return;
    const w = volume.worker;
    const onMsg = (ev: MessageEvent<WorkerResp>) => {
      const m = ev.data;
      if (m.type === "error") {
        setLoadError(m.message);
        return;
      }
      if (m.type !== "slice") return;
      inflightRef.current.delete(m.idx);
      const f: OctCanvasFrame = {
        width: m.width,
        height: m.height,
        bitmap: m.bitmap,
        rgba: m.rgba,
      };
      cacheRef.current.set(m.idx, f);
      if (m.idx === sliceIdx) setLastFrame(f);

      // LRU-ish trim.
      const MAX = 48;
      if (cacheRef.current.size > MAX) {
        const keys = Array.from(cacheRef.current.keys());
        keys.sort((a, b) => Math.abs(a - sliceIdx) - Math.abs(b - sliceIdx));
        for (const k of keys.slice(MAX)) {
          const old = cacheRef.current.get(k);
          if (old?.bitmap) old.bitmap.close();
          cacheRef.current.delete(k);
        }
      }
      setCacheVersion((v) => v + 1);
    };
    w.addEventListener("message", onMsg as EventListener);
    return () => {
      w.removeEventListener("message", onMsg as EventListener);
    };
  }, [sliceIdx, volume]);

  // Restore last volume for this project (browser persistence).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) return;
      try {
        const saved = await getProjectVolume(id);
        if (!saved || cancelled) return;
        setSelectedFileName(saved.name);
        setLoadError(null);
        setLoading(true);
        cacheRef.current.clear();
        setCacheVersion((v) => v + 1);
        setSliceIdx(0);

        const buf = await saved.blob.arrayBuffer();
        const name = saved.name.toLowerCase();
        if (name.endsWith(".tif") || name.endsWith(".tiff")) {
          workerRef.current?.terminate();
          cacheRef.current.clear();
          inflightRef.current.clear();
          setCacheVersion((v) => v + 1);
          setLastFrame(null);
          const vol = await createStackVolumeFromBuffer(buf, "tiff");
          workerRef.current = vol.worker;
          setVolume(vol);
        } else if (
          name.endsWith(".dcm") ||
          name.endsWith(".dicom") ||
          saved.type === "application/dicom"
        ) {
          workerRef.current?.terminate();
          cacheRef.current.clear();
          inflightRef.current.clear();
          setCacheVersion((v) => v + 1);
          setLastFrame(null);
          const vol = await createStackVolumeFromBuffer(buf, "dicom");
          workerRef.current = vol.worker;
          setVolume(vol);
        } else if (saved.type.startsWith("image/")) {
          // Reuse existing single-image path by creating a File.
          const file = new File([saved.blob], saved.name, { type: saved.type });
          const decoded = await decodeSingleImage(file);
          setVolume({ kind: "single", frame: decoded[0]! });
        } else {
          setVolume(null);
          setLoadError("Saved file type is not supported for display.");
        }
      } catch (err) {
        if (!cancelled) {
          setVolume(null);
          setLoadError(err instanceof Error ? err.message : "Failed to restore saved volume");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative">
        <OctToolbar
          projectName={project ? project.name : id}
          right={
            <>
              {loading ? (
                <span className="hidden text-xs text-[color:var(--color-muted)] sm:inline">Loading…</span>
              ) : null}
              {selectedFileName ? (
                <span
                  className="hidden max-w-[min(40vw,22rem)] truncate font-mono text-[11px] text-[color:var(--color-muted)] sm:inline"
                  title={selectedFileName}
                >
                  {selectedFileName}
                </span>
              ) : null}

              {selectedFileName ? (
                <IconButton
                  label="Clear selected file"
                  onClick={() => {
                    setSelectedFileName(null);
                    setPointsBySlice({});
                    setVolume(null);
                    cacheRef.current.clear();
                    inflightRef.current.clear();
                    setCacheVersion((v) => v + 1);
                    setLastFrame(null);
                    setSliceIdx(0);
                    if (inputRef.current) inputRef.current.value = "";
                    void deleteProjectVolume(id);
                    workerRef.current?.terminate();
                    workerRef.current = null;
                  }}
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </IconButton>
              ) : null}

              <IconButton
                tone="accent"
                label="Pick a local file"
                disabled={loading}
                onClick={() => inputRef.current?.click()}
              >
                <FileUp className="h-5 w-5" aria-hidden="true" />
              </IconButton>
            </>
          }
        />

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept="image/*,.tif,.tiff,.dcm,.dicom,.json,.csv"
          onChange={async (e) => {
            const f = e.target.files?.[0] ?? null;
            setSelectedFileName(f ? f.name : null);
            setPointsBySlice({});
            setVolume(null);
            cacheRef.current.clear();
            inflightRef.current.clear();
            setCacheVersion((v) => v + 1);
            setLastFrame(null);
            setSliceIdx(0);
            setLoadError(null);
            if (!f) return;

            const name = f.name.toLowerCase();
            try {
              setLoading(true);
              await setProjectVolume({
                projectId: id,
                name: f.name,
                type: f.type || "application/octet-stream",
                blob: f,
              });
              if (name.endsWith(".tif") || name.endsWith(".tiff")) {
                const buf = await fileToArrayBuffer(f);
                workerRef.current?.terminate();
                cacheRef.current.clear();
                inflightRef.current.clear();
                setCacheVersion((v) => v + 1);
                setLastFrame(null);
                const vol = await createStackVolumeFromBuffer(buf, "tiff");
                workerRef.current = vol.worker;
                setVolume(vol);
              } else if (
                name.endsWith(".dcm") ||
                name.endsWith(".dicom") ||
                f.type === "application/dicom"
              ) {
                const buf = await fileToArrayBuffer(f);
                workerRef.current?.terminate();
                cacheRef.current.clear();
                inflightRef.current.clear();
                setCacheVersion((v) => v + 1);
                setLastFrame(null);
                const vol = await createStackVolumeFromBuffer(buf, "dicom");
                workerRef.current = vol.worker;
                setVolume(vol);
              } else if (f.type.startsWith("image/")) {
                const decoded = await decodeSingleImage(f);
                setVolume({ kind: "single", frame: decoded[0]! });
              } else {
                setVolume(null);
                setLoadError("Unsupported file type for display (use image, TIFF, or uncompressed DICOM).");
              }
            } catch (err) {
              setVolume(null);
              setLoadError(err instanceof Error ? err.message : "Failed to decode file");
            } finally {
              setLoading(false);
            }
          }}
        />
      </div>

      {loadError ? (
        <div className="border-b border-[color:var(--color-ocean-green)]/15 bg-[color:var(--color-surface-2)] px-4 py-2.5">
          <p className="text-sm text-red-700">
            Failed to load file{selectedFileName ? ` “${selectedFileName}”` : ""}: {loadError}
          </p>
        </div>
      ) : null}

      {sliceCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--color-ocean-green)]/20 bg-[color:var(--color-surface-2)] px-4 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-xs text-[color:var(--color-muted)]">
            <ScanLine className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{sliceLabel}</span>
          </span>

          <div className="flex items-center gap-1">
            <IconButton
              label="Previous slice"
              onClick={() => setSliceIdx((i) => Math.max(0, i - 1))}
              disabled={sliceIdx === 0}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </IconButton>
            <IconButton
              label="Next slice"
              onClick={() => setSliceIdx((i) => Math.min(sliceCount - 1, i + 1))}
              disabled={sliceIdx >= sliceCount - 1}
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </IconButton>
            <IconButton
              label="Clear points on this slice"
              onClick={() => clearCurrentSlicePoints()}
              disabled={slicePoints.length === 0}
            >
              <Eraser className="h-5 w-5" aria-hidden="true" />
            </IconButton>
          </div>

          {sliceCount > 1 ? (
            <input
              type="range"
              min={0}
              max={sliceCount - 1}
              value={sliceIdx}
              onChange={(e) => setSliceIdx(Number(e.target.value))}
              className="oct-slider w-[min(820px,65vw)] cursor-pointer"
            />
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-row">
        <OctCanvas
          frame={frame}
          points={slicePoints}
          onAddPoint={volume ? addPoint : undefined}
        />
        <OctLabelPanel />
      </div>
    </div>
  );
}

