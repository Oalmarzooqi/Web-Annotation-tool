"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { OctCanvas, OctLabelPanel, OctToolbar } from "../../components/oct";
import { IconButton } from "../../components/ui";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  CircleDot,
  Eraser,
  FileUp,
  Hand,
  Pencil,
  Pentagon,
  Redo2,
  ScanLine,
  Slash,
  Spline,
  Undo2,
  X,
  Save,
  Download,
  Upload,
  Trash2,
  Trash,
} from "lucide-react";
import type { Annotation, DrawMode, Draft, ImagePoint, OctCanvasFrame } from "../../components/oct/OctCanvas";
import { setAnnotationPointAt, type EditHit } from "../../lib/annotationEdit";
import {
  colorToAnnotationStyle,
  colorToAnnotationStyleActive,
  DEFAULT_SURFACE_LABELS,
  randomLabelColor,
  type SurfaceLabel,
} from "../../lib/surfaceLabels";
import { useProject } from "../../lib/useProjects";
import { updateProject } from "../../lib/projects";
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

  type AnnotState = {
    annotationsBySlice: Record<number, Annotation[]>;
    draftBySlice: Record<number, Draft | null>;
  };
  type HistoryState = { past: AnnotState[]; present: AnnotState; future: AnnotState[] };
  type HistoryAction =
    | { type: "reset" }
    | { type: "commit"; update: (s: AnnotState) => AnnotState }
    | { type: "undo" }
    | { type: "redo" };

  const HISTORY_MAX = 100;

  function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
    switch (action.type) {
      case "reset":
        return { past: [], present: { annotationsBySlice: {}, draftBySlice: {} }, future: [] };
      case "commit": {
        const nextPresent = action.update(state.present);
        if (nextPresent === state.present) return state;
        const nextPast = [...state.past, state.present];
        const trimmedPast = nextPast.length > HISTORY_MAX ? nextPast.slice(nextPast.length - HISTORY_MAX) : nextPast;
        return { past: trimmedPast, present: nextPresent, future: [] };
      }
      case "undo": {
        if (state.past.length === 0) return state;
        const prev = state.past[state.past.length - 1]!;
        const nextPast = state.past.slice(0, -1);
        const nextFuture = [state.present, ...state.future];
        return { past: nextPast, present: prev, future: nextFuture.slice(0, HISTORY_MAX) };
      }
      case "redo": {
        if (state.future.length === 0) return state;
        const next = state.future[0]!;
        const nextFuture = state.future.slice(1);
        const nextPast = [...state.past, state.present];
        const trimmedPast = nextPast.length > HISTORY_MAX ? nextPast.slice(nextPast.length - HISTORY_MAX) : nextPast;
        return { past: trimmedPast, present: next, future: nextFuture };
      }
      default:
        return state;
    }
  }

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [volume, setVolume] = useState<VolumeState>(null);
  const [sliceIdx, setSliceIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastFrame, setLastFrame] = useState<OctCanvasFrame | null>(null);
  const [history, dispatchHistory] = useReducer(historyReducer, {
    past: [],
    present: { annotationsBySlice: {}, draftBySlice: {} },
    future: [],
  });
  const [mode, setMode] = useState<DrawMode>("point");
  const [editSelection, setEditSelection] = useState<EditHit | null>(null);
  const [labels, setLabels] = useState<SurfaceLabel[]>(() => [...DEFAULT_SURFACE_LABELS]);
  const [activeLabelId, setActiveLabelId] = useState<string | null>(() => DEFAULT_SURFACE_LABELS[0]!.id);
  const [showAllLayers, setShowAllLayers] = useState(true);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const loadedFileKeyRef = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel?: () => void;
  } | null>(null);
  const [promptDialog, setPromptDialog] = useState<{
    title: string;
    defaultValue: string;
    onConfirm: (val: string) => void;
    onCancel?: () => void;
  } | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    setNotification({ message, type });
    const timer = setTimeout(() => {
      setNotification(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, []);

  // ── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Parse the raw `project.annotations` string into our v2 multi-file map.
   * Handles:
   *   - v2 format : { __v: 2, files: { [fileName]: annotationsBySlice } }
   *   - v1 format : flat { [sliceIdx]: Annotation[] }  → stored under "__default__"
   *   - empty / null
   */
  function parseAnnotationMap(
    raw: string | null | undefined,
  ): Record<string, Record<number, Annotation[]>> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.__v === 2) {
        return (parsed.files as Record<string, Record<number, Annotation[]>>) ?? {};
      }
      // v1 flat format — migrate to "__default__" key
      return { __default__: parsed as Record<number, Annotation[]> };
    } catch {
      return {};
    }
  }

  const saveProjectToDb = useCallback(async () => {
    if (!project) {
      showToast("Cannot save to cloud: No active project loaded.", "error");
      return;
    }
    const fileKey = selectedFileName || "__default__";
    try {
      setSaving(true);
      setSaveSuccess(false);
      showToast("Saving to cloud...", "info");

      // Fetch the latest stored map so we don't wipe sibling files.
      const latestProject = await import("../../lib/projects").then((m) =>
        m.getProject(project.id),
      );
      const fileMap = parseAnnotationMap(latestProject.annotations);
      fileMap[fileKey] = history.present.annotationsBySlice;

      await updateProject(project.id, {
        name: project.name,
        description: project.description,
        annotations: JSON.stringify({ __v: 2, files: fileMap }),
        labels: JSON.stringify(labels),
      });
      setSaveSuccess(true);
      showToast("Project annotations saved to cloud!", "success");
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      console.error("Failed to save project to db", e);
      showToast("Failed to save annotations to cloud.", "error");
    } finally {
      setSaving(false);
    }
  }, [project, selectedFileName, history.present.annotationsBySlice, labels, showToast]);

  const saveAsJson = useCallback(async () => {
    const projName = project?.name || selectedFileName || "oct-project";
    const defaultName = `${projName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-annotations.json`;
    const fileKey = selectedFileName || "__default__";

    // Build the full v2 file map (include all files stored in the project so
    // the export is a complete snapshot and roundtrips cleanly).
    const existingMap = parseAnnotationMap(project?.annotations);
    existingMap[fileKey] = history.present.annotationsBySlice;

    const data = {
      version: 2,
      projectId: project?.id || null,
      projectName: projName,
      labels,
      files: existingMap,
    };
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });

    // Use native OS "Save As" dialog when available (Chrome / Edge / Opera).
    if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: defaultName,
          types: [
            {
              description: "JSON annotation file",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        showToast("Annotations exported successfully!", "success");
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          showToast("Failed to save file.", "error");
        }
      }
      return;
    }

    // Fallback: trigger a browser download (Firefox, Safari, etc.).
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Annotations exported successfully!", "success");
  }, [project, selectedFileName, labels, history.present.annotationsBySlice, showToast]);

  const loadFromJson = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (!data || typeof data !== "object") {
          showToast("Failed to load: Invalid annotations JSON format.", "error");
          return;
        }

        const fileProjName = data.projectName || "Unknown Project";
        const currentProjName = project?.name || selectedFileName || "Current Project";

        const performLoad = () => {
          let loadedAnnotations: Record<number, Annotation[]> = {};

          if (data.version === 2 && data.files && typeof data.files === "object") {
            // v2: pick the current file's slice map; fall back to __default__ or
            // the first available file so loading always does something useful.
            const fileKey = selectedFileName || "__default__";
            loadedAnnotations =
              data.files[fileKey] ??
              data.files["__default__"] ??
              Object.values(data.files)[0] ??
              {};
          } else {
            // v1 flat format
            loadedAnnotations = data.annotationsBySlice || {};
          }

          const loadedLabels: SurfaceLabel[] = data.labels || [];

          // Reset the guard so the load-effect won't immediately overwrite us.
          loadedFileKeyRef.current = `${project?.id ?? ""}::${selectedFileName || "__default__"}`;

          dispatchHistory({
            type: "commit",
            update: () => ({
              annotationsBySlice: loadedAnnotations,
              draftBySlice: {},
            }),
          });
          if (loadedLabels.length > 0) {
            setLabels(loadedLabels);
            setActiveLabelId(loadedLabels[0].id);
          }
          showToast("Annotations loaded successfully from file!", "success");
        };

        if (fileProjName !== currentProjName) {
          setConfirmDialog({
            title: "Project Mismatch Warning",
            message: `Warning: The loaded annotations are for "${fileProjName}", but the current project/file is "${currentProjName}".\n\nDo you still want to load it anyway?`,
            onConfirm: performLoad,
            onCancel: () => {
              showToast("Load cancelled due to project mismatch.", "info");
            },
          });
        } else {
          performLoad();
        }
      } catch (err) {
        console.error("Failed to parse JSON", err);
        showToast("Failed to parse JSON file.", "error");
      }
    };
    reader.readAsText(file);
  }, [project, selectedFileName, showToast]);

  const clearAllAnnotations = useCallback(() => {
    setConfirmDialog({
      title: "Clear All Annotations",
      message: "Are you sure you want to clear all annotations across all slices? This cannot be undone.",
      onConfirm: () => {
        dispatchHistory({
          type: "commit",
          update: () => ({
            annotationsBySlice: {},
            draftBySlice: {},
          }),
        });
        showToast("All annotations cleared.", "info");
      },
      onCancel: () => {
        showToast("Clear annotations cancelled.", "info");
      }
    });
  }, [showToast]);

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

  const sliceAnnotations = history.present.annotationsBySlice[sliceIdx] ?? [];
  const filteredAnnotations = useMemo(() => {
    if (showAllLayers) return sliceAnnotations;
    return sliceAnnotations.filter((a) => a.labelId === activeLabelId);
  }, [sliceAnnotations, showAllLayers, activeLabelId]);
  const sliceDraft = history.present.draftBySlice[sliceIdx] ?? null;

  /**
   * Load annotations for the current file whenever the project data or the
   * resolved file name changes. Guards against double-loading with
   * loadedFileKeyRef (keyed by "projectId::fileName").
   */
  useEffect(() => {
    // Need both project data and a known filename before we can load.
    if (!project) return;
    const fileKey = selectedFileName || "__default__";
    const guardKey = `${id}::${fileKey}`;
    if (loadedFileKeyRef.current === guardKey) return;
    loadedFileKeyRef.current = guardKey;
    try {
      const fileMap = parseAnnotationMap(project.annotations);
      const annObj = fileMap[fileKey] ?? {};
      const labelsObj = project.labels ? JSON.parse(project.labels) : [];
      dispatchHistory({
        type: "commit",
        update: () => ({
          annotationsBySlice: annObj,
          draftBySlice: {},
        }),
      });
      if (labelsObj && labelsObj.length > 0) {
        setLabels(labelsObj);
        setActiveLabelId(labelsObj[0].id);
      } else {
        setLabels([...DEFAULT_SURFACE_LABELS]);
        setActiveLabelId(DEFAULT_SURFACE_LABELS[0]!.id);
      }
    } catch (e) {
      console.error("Failed to load project annotations", e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, selectedFileName, id]);

  useEffect(() => {
    loadedFileKeyRef.current = null;
    dispatchHistory({ type: "reset" });
    setLabels([...DEFAULT_SURFACE_LABELS]);
    setActiveLabelId(DEFAULT_SURFACE_LABELS[0]!.id);
  }, [id]);

  useEffect(() => {
    setEditSelection(null);
  }, [sliceIdx]);

  useEffect(() => {
    if (mode !== "edit") setEditSelection(null);
  }, [mode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveProjectToDb();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveProjectToDb]);

  const resolveAnnotationStyle = useCallback(
    (labelId: string) => {
      const lab = labels.find((l) => l.id === labelId);
      const color = lab?.color ?? labels[0]?.color ?? "#666666";
      if (activeLabelId !== null && labelId === activeLabelId) {
        return colorToAnnotationStyleActive(color);
      }
      return colorToAnnotationStyle(color);
    },
    [activeLabelId, labels],
  );

  const draftStyle = useMemo(() => {
    if (activeLabelId === null) return colorToAnnotationStyle("#9ca3af");
    return resolveAnnotationStyle(activeLabelId);
  }, [activeLabelId, resolveAnnotationStyle]);

  const clearActiveLabelSelection = useCallback(() => {
    setActiveLabelId(null);
    dispatchHistory({
      type: "commit",
      update: (s) => ({ ...s, draftBySlice: { ...s.draftBySlice, [sliceIdx]: null } }),
    });
  }, [sliceIdx]);

  const makeId = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (globalThis as any).crypto as Crypto | undefined;
    if (c?.randomUUID) return c.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }, []);

  const addAnnotation = useCallback((a: Annotation) => {
    dispatchHistory({
      type: "commit",
      update: (s) => ({
        ...s,
        annotationsBySlice: { ...s.annotationsBySlice, [sliceIdx]: [...(s.annotationsBySlice[sliceIdx] ?? []), a] },
      }),
    });
  }, [sliceIdx]);

  const setSliceDraft = (d: Draft | null) => {
    dispatchHistory({
      type: "commit",
      update: (s) => ({
        ...s,
        draftBySlice: { ...s.draftBySlice, [sliceIdx]: d },
      }),
    });
  };

  const clearCurrentSlice = () => {
    dispatchHistory({
      type: "commit",
      update: (s) => {
        const nextAnn = { ...s.annotationsBySlice };
        const nextDraft = { ...s.draftBySlice };
        delete nextAnn[sliceIdx];
        delete nextDraft[sliceIdx];
        return { annotationsBySlice: nextAnn, draftBySlice: nextDraft };
      },
    });
  };

  const onCanvasClick = (p: ImagePoint) => {
    if (!volume) return;
    if (mode === "pan" || mode === "edit") return;
    if (!activeLabelId) return;
    if (mode === "freehand") return;
    if (mode === "point") {
      addAnnotation({ id: makeId(), labelId: activeLabelId, type: "point", points: [p] });
      return;
    }
    if (mode === "line") {
      if (!sliceDraft || sliceDraft.type !== "line") {
        setSliceDraft({ type: "line", points: [p] });
        return;
      }
      addAnnotation({
        id: makeId(),
        labelId: activeLabelId,
        type: "line",
        points: [sliceDraft.points[0], p],
      });
      dispatchHistory({ type: "commit", update: (s) => ({ ...s, draftBySlice: { ...s.draftBySlice, [sliceIdx]: null } }) });
      return;
    }
    // polygon mode
    if (!sliceDraft || sliceDraft.type !== "polygon") {
      setSliceDraft({ type: "polygon", points: [p] });
      return;
    }
    dispatchHistory({
      type: "commit",
      update: (s) => ({
        ...s,
        draftBySlice: {
          ...s.draftBySlice,
          [sliceIdx]: { type: "polygon", points: [...sliceDraft.points, p] },
        },
      }),
    });
  };

  const onFreehandComplete = useCallback(
    (points: ImagePoint[]) => {
      if (!volume || !activeLabelId || points.length < 2) return;
      addAnnotation({ id: makeId(), labelId: activeLabelId, type: "freehand", points });
    },
    [activeLabelId, addAnnotation, makeId, volume],
  );

  const onCanvasDoubleClick = () => {
    if (!activeLabelId) return;
    if (mode !== "polygon") return;
    if (!sliceDraft || sliceDraft.type !== "polygon") return;
    if (sliceDraft.points.length < 3) return;
    addAnnotation({
      id: makeId(),
      labelId: activeLabelId,
      type: "polygon",
      points: sliceDraft.points,
      closed: true,
    });
    dispatchHistory({ type: "commit", update: (s) => ({ ...s, draftBySlice: { ...s.draftBySlice, [sliceIdx]: null } }) });
  };

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const onEditSelect = useCallback((hit: EditHit | null) => {
    setEditSelection(hit);
  }, []);

  const onEditVertexCommit = useCallback(
    (annotationId: string, pointIndex: number, p: ImagePoint) => {
      if (!frame) return;
      dispatchHistory({
        type: "commit",
        update: (s) => {
          const list = s.annotationsBySlice[sliceIdx] ?? [];
          const next = list.map((ann) =>
            ann.id === annotationId ? setAnnotationPointAt(ann, pointIndex, p, frame) : ann,
          );
          return {
            ...s,
            annotationsBySlice: { ...s.annotationsBySlice, [sliceIdx]: next },
          };
        },
      });
      setEditSelection({ kind: "vertex", annotationId, pointIndex });
    },
    [frame, sliceIdx],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode !== "edit") return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (!editSelection) return;
      e.preventDefault();
      const aid = editSelection.annotationId;
      dispatchHistory({
        type: "commit",
        update: (s) => {
          const list = s.annotationsBySlice[sliceIdx] ?? [];
          const next = list.filter((a) => a.id !== aid);
          return {
            ...s,
            annotationsBySlice: { ...s.annotationsBySlice, [sliceIdx]: next },
          };
        },
      });
      setEditSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editSelection, mode, sliceIdx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) dispatchHistory({ type: "redo" });
      else dispatchHistory({ type: "undo" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (mode === "edit" && editSelection) {
        e.preventDefault();
        setEditSelection(null);
        return;
      }
      // Esc = drop current draft; if no draft, return to point mode.
      if (sliceDraft) {
        e.preventDefault();
        dispatchHistory({
          type: "commit",
          update: (s) => ({ ...s, draftBySlice: { ...s.draftBySlice, [sliceIdx]: null } }),
        });
        return;
      }
      if (mode !== "point") {
        e.preventDefault();
        setMode("point");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editSelection, mode, sliceDraft, sliceIdx]);

  const canFinishPolygon =
    activeLabelId !== null &&
    mode === "polygon" &&
    sliceDraft?.type === "polygon" &&
    sliceDraft.points.length >= 3;

  const finishPolygon = useCallback(() => {
    if (!canFinishPolygon || !activeLabelId) return;
    addAnnotation({
      id: makeId(),
      labelId: activeLabelId,
      type: "polygon",
      points: sliceDraft!.points,
      closed: true,
    });
    dispatchHistory({
      type: "commit",
      update: (s) => ({ ...s, draftBySlice: { ...s.draftBySlice, [sliceIdx]: null } }),
    });
  }, [activeLabelId, addAnnotation, canFinishPolygon, makeId, sliceDraft, sliceIdx]);

  const addSurfaceLabel = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const nid = makeId();
      setLabels((prev) => [...prev, { id: nid, name: trimmed, color: randomLabelColor() }]);
      setActiveLabelId(nid);
    },
    [makeId],
  );

  const deleteSurfaceLabel = useCallback(
    (labelId: string) => {
      if (labels.length <= 1) return;
      const lab = labels.find((l) => l.id === labelId);
      if (!lab) return;

      setConfirmDialog({
        title: "Delete Label",
        message: `Remove “${lab.name}” and delete all annotations that use this label on every slice?`,
        onConfirm: () => {
          const remaining = labels.filter((l) => l.id !== labelId);
          setLabels(remaining);
          setActiveLabelId((cur) => (cur === labelId ? remaining[0]!.id : cur));
          dispatchHistory({
            type: "commit",
            update: (s) => {
              const nextAnn: Record<number, Annotation[]> = {};
              for (const [key, list] of Object.entries(s.annotationsBySlice)) {
                const idx = Number(key);
                nextAnn[idx] = list.filter((a) => a.labelId !== labelId);
              }
              return { ...s, annotationsBySlice: nextAnn };
            },
          });
          showToast(`Label "${lab.name}" deleted.`, "info");
        },
        onCancel: () => {
          showToast("Label deletion cancelled.", "info");
        }
      });
    },
    [labels, showToast],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      if (!canFinishPolygon) return;
      e.preventDefault();
      finishPolygon();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canFinishPolygon, finishPolygon]);

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
                    dispatchHistory({ type: "reset" });
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
            const newName = f ? f.name : null;
            setSelectedFileName(newName);

            // Reset the guard so the load-effect can re-run for the new file.
            loadedFileKeyRef.current = null;

            // Restore annotations saved for this specific file (if any).
            if (newName && project) {
              const fileMap = parseAnnotationMap(project.annotations);
              const saved = fileMap[newName] ?? {};
              dispatchHistory({
                type: "commit",
                update: () => ({ annotationsBySlice: saved, draftBySlice: {} }),
              });
            } else {
              dispatchHistory({ type: "reset" });
            }

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
        <div className="flex flex-wrap items-stretch justify-start gap-x-5 gap-y-2 border-b border-[color:var(--color-ocean-green)]/20 bg-[color:var(--color-surface-2)] px-4 py-1 text-center">
          
          {/* Slice Navigation Group */}
          <div className="flex flex-col items-center justify-between gap-0.5">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-600 dark:text-neutral-400">
              Slices
            </span>
            <div className="flex items-center gap-1">
              <span className="inline-flex min-w-[7.5rem] flex-row items-center justify-center gap-1.5 font-mono text-xs tabular-nums text-[color:var(--color-foreground)] px-2 py-0.5">
                <ScanLine className="h-3.5 w-3.5 text-[color:var(--color-ocean-green)]" aria-hidden="true" />
                <span>{sliceLabel}</span>
              </span>
              <ToolbarButton
                text="Prev"
                icon={<ChevronLeft className="h-5 w-5" />}
                onClick={() => setSliceIdx((i) => Math.max(0, i - 1))}
                disabled={sliceIdx === 0}
                title="Previous slice"
              />
              {sliceCount > 1 ? (
                <div className="flex items-center px-1">
                  <input
                    type="range"
                    min={0}
                    max={sliceCount - 1}
                    value={sliceIdx}
                    onChange={(e) => setSliceIdx(Number(e.target.value))}
                    className="oct-slider w-28 cursor-pointer"
                  />
                </div>
              ) : null}
              <ToolbarButton
                text="Next"
                icon={<ChevronRight className="h-5 w-5" />}
                onClick={() => setSliceIdx((i) => Math.min(sliceCount - 1, i + 1))}
                disabled={sliceIdx >= sliceCount - 1}
                title="Next slice"
              />
            </div>
          </div>

          <div className="h-9 w-px bg-[color:var(--color-ocean-green)]/20 self-center" aria-hidden />

          {/* History & Edit Group */}
          <div className="flex flex-col items-center justify-between gap-0.5">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-600 dark:text-neutral-400">
              Edit & History
            </span>
            <div className="flex items-center gap-1">
              <ToolbarButton
                text="Undo"
                icon={<Undo2 className="h-5 w-5" />}
                onClick={() => dispatchHistory({ type: "undo" })}
                disabled={!canUndo}
              />
              <ToolbarButton
                text="Redo"
                icon={<Redo2 className="h-5 w-5" />}
                onClick={() => dispatchHistory({ type: "redo" })}
                disabled={!canRedo}
              />
              <ToolbarButton
                text="Delete"
                icon={<Trash className="h-5 w-5" />}
                onClick={() => {
                  if (!editSelection) return;
                  const aid = editSelection.annotationId;
                  dispatchHistory({
                    type: "commit",
                    update: (s) => {
                      const list = s.annotationsBySlice[sliceIdx] ?? [];
                      const next = list.filter((a) => a.id !== aid);
                      return {
                        ...s,
                        annotationsBySlice: { ...s.annotationsBySlice, [sliceIdx]: next },
                      };
                    },
                  });
                  setEditSelection(null);
                }}
                disabled={!editSelection}
                title="Delete selected annotation"
              />
              <ToolbarButton
                text="Clear Slice"
                icon={<Trash2 className="h-5 w-5" />}
                onClick={() => clearCurrentSlice()}
                disabled={sliceAnnotations.length === 0 && !sliceDraft}
                title="Clear all annotations on this slice"
              />
              {mode === "polygon" ? (
                <ToolbarButton
                  text="Finish"
                  icon={<Check className="h-5 w-5" />}
                  onClick={() => finishPolygon()}
                  disabled={!canFinishPolygon}
                  tone="accent"
                  title="Finish polygon"
                />
              ) : null}
            </div>
          </div>

          <div className="h-9 w-px bg-[color:var(--color-ocean-green)]/20 self-center" aria-hidden />

          {/* Drawing & Navigation Tools Group */}
          <div className="flex flex-col items-center justify-between gap-0.5">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-600 dark:text-neutral-400">
              Tools
            </span>
            <div className="flex items-center gap-1">
              <ToolbarButton
                text="Point"
                icon={<CircleDot className="h-5 w-5" />}
                tone={mode === "point" ? "accent" : "default"}
                onClick={() => setMode("point")}
                title="Point — click to place a marker"
              />
              <ToolbarButton
                text="Polygon"
                icon={<Pentagon className="h-5 w-5" />}
                tone={mode === "polygon" ? "accent" : "default"}
                onClick={() => setMode("polygon")}
                title="Polygon — click vertices; Enter or double-click to close"
              />
              <ToolbarButton
                text="Line"
                icon={<Slash className="h-5 w-5" />}
                tone={mode === "line" ? "accent" : "default"}
                onClick={() => setMode("line")}
                title="Line — click two points for a straight segment"
              />
              <ToolbarButton
                text="Freehand"
                icon={<Spline className="h-5 w-5" />}
                tone={mode === "freehand" ? "accent" : "default"}
                onClick={() => setMode("freehand")}
                title="Freehand — drag to draw; release to finish"
              />
              <ToolbarButton
                text="Pan"
                icon={<Hand className="h-5 w-5" />}
                tone={mode === "pan" ? "accent" : "default"}
                onClick={() => setMode("pan")}
                title="Pan — drag to move the image"
              />
              <ToolbarButton
                text="Edit"
                icon={<Pencil className="h-5 w-5" />}
                tone={mode === "edit" ? "accent" : "default"}
                onClick={() => setMode("edit")}
                title="Edit — click to select; drag a point to move; Delete removes selection"
              />
              <ToolbarButton
                text="Erase"
                icon={<Eraser className="h-5 w-5" />}
                tone={mode === "erase" ? "accent" : "default"}
                onClick={() => setMode("erase")}
                title="Erase — click an annotation to delete it"
              />
            </div>
          </div>

          <div className="h-9 w-px bg-[color:var(--color-ocean-green)]/20 self-center" aria-hidden />

          {/* Cloud & Local Storage Group */}
          <div className="flex flex-col items-center justify-between gap-0.5">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-600 dark:text-neutral-400">
              CRUD Actions
            </span>
            <div className="flex items-center gap-1">
              <ToolbarButton
                text="Save"
                icon={<Save className="h-5 w-5" />}
                onClick={saveProjectToDb}
                tone={saveSuccess ? "accent" : "default"}
                disabled={saving}
                title={saving ? "Saving..." : "Save (Ctrl+S)"}
              />
              <ToolbarButton
                text="Save As"
                icon={<Download className="h-5 w-5" />}
                onClick={saveAsJson}
                title="Save As (Export JSON)"
              />
              <ToolbarButton
                text="Load"
                icon={<Upload className="h-5 w-5" />}
                onClick={() => jsonInputRef.current?.click()}
                title="Load (Import JSON)"
              />
              <ToolbarButton
                text="Clear All"
                icon={<Trash2 className="h-5 w-5" />}
                onClick={clearAllAnnotations}
                title="Clear All Annotations"
              />
              <input
                type="file"
                ref={jsonInputRef}
                className="hidden"
                accept=".json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    loadFromJson(file);
                  }
                  e.target.value = "";
                }}
              />
            </div>
          </div>

        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-row">
        <OctCanvas
          frame={frame}
          annotations={filteredAnnotations}
          mode={mode}
          draft={sliceDraft}
          resolveAnnotationStyle={resolveAnnotationStyle}
          draftStyle={draftStyle}
          annotationCommitEnabled={activeLabelId !== null}
          editSelection={editSelection}
          onEditSelect={volume ? onEditSelect : undefined}
          onEditVertexCommit={volume ? onEditVertexCommit : undefined}
          onDeleteAnnotation={
            volume
              ? (annotationId) => {
                  dispatchHistory({
                    type: "commit",
                    update: (s) => {
                      const list = s.annotationsBySlice[sliceIdx] ?? [];
                      const next = list.filter((a) => a.id !== annotationId);
                      return {
                        ...s,
                        annotationsBySlice: { ...s.annotationsBySlice, [sliceIdx]: next },
                      };
                    },
                  });
                  if (editSelection?.annotationId === annotationId) {
                    setEditSelection(null);
                  }
                }
              : undefined
          }
          onClickImage={volume ? onCanvasClick : undefined}
          onDoubleClickImage={volume ? onCanvasDoubleClick : undefined}
          onFreehandComplete={volume ? onFreehandComplete : undefined}
          onNavigateSlice={
            volume
              ? (delta) => {
                  setSliceIdx((i) => {
                    if (delta === -1) return Math.max(0, i - 1);
                    return Math.min(sliceCount - 1, i + 1);
                  });
                }
              : undefined
          }
        />
        <OctLabelPanel
          labels={labels}
          activeLabelId={activeLabelId}
          onSelectLabel={(id) => setActiveLabelId(id)}
          onClearActiveLabel={clearActiveLabelSelection}
          onAddLabel={addSurfaceLabel}
          onDeleteLabel={deleteSurfaceLabel}
          showAllLayers={showAllLayers}
          onToggleShowAll={() => setShowAllLayers(!showAllLayers)}
        />
      </div>

      {notification && (
        <div className="fixed top-4 left-1/2 z-[9999] -translate-x-1/2 transform rounded-lg bg-neutral-900/95 dark:bg-neutral-800/95 px-4 py-2.5 text-sm font-medium text-white shadow-xl flex items-center gap-2 border border-neutral-700/50 backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-top-2">
          <div className={
            "h-2 w-2 rounded-full " +
            (notification.type === "success" ? "bg-emerald-500" :
             notification.type === "error" ? "bg-rose-500" :
             "bg-sky-500")
          } />
          <span>{notification.message}</span>
        </div>
      )}

      {confirmDialog && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-[2px] animate-in fade-in duration-200">
          <div className="w-full max-w-md transform overflow-hidden rounded-2xl border border-neutral-700/50 bg-neutral-900/95 p-6 text-left align-middle shadow-2xl transition-all duration-300 scale-in-95">
            <h3 className="text-lg font-semibold leading-6 text-white mb-2">
              {confirmDialog.title}
            </h3>
            <p className="text-sm text-neutral-300 whitespace-pre-line mb-6 leading-relaxed">
              {confirmDialog.message}
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-neutral-300 hover:text-white rounded-lg border border-neutral-700 hover:bg-neutral-800 transition-colors"
                onClick={() => {
                  confirmDialog.onCancel?.();
                  setConfirmDialog(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors shadow-sm"
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {promptDialog && (
        <PromptDialogModal
          title={promptDialog.title}
          defaultValue={promptDialog.defaultValue}
          onConfirm={(val) => {
            promptDialog.onConfirm(val);
            setPromptDialog(null);
          }}
          onCancel={() => {
            promptDialog.onCancel?.();
            setPromptDialog(null);
          }}
        />
      )}
    </div>
  );
}

function PromptDialogModal({
  title,
  defaultValue,
  onConfirm,
  onCancel,
}: {
  title: string;
  defaultValue: string;
  onConfirm: (val: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-[2px] animate-in fade-in duration-200">
      <div className="w-full max-w-md transform overflow-hidden rounded-2xl border border-neutral-700/50 bg-neutral-900/95 p-6 text-left align-middle shadow-2xl transition-all duration-300 scale-in-95">
        <h3 className="text-lg font-semibold leading-6 text-white mb-2">
          {title}
        </h3>
        <div className="mt-3 mb-6">
          <input
            type="text"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3.5 py-2 text-sm text-white placeholder-neutral-500 focus:border-[color:var(--color-ocean-green)] focus:outline-none focus:ring-1 focus:ring-[color:var(--color-ocean-green)]"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onConfirm(value);
              } else if (e.key === "Escape") {
                onCancel();
              }
            }}
          />
        </div>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            className="px-4 py-2 text-sm font-medium text-neutral-300 hover:text-white rounded-lg border border-neutral-700 hover:bg-neutral-800 transition-colors"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-4 py-2 text-sm font-medium text-white bg-[color:var(--color-ocean-green)] hover:bg-[color:var(--color-ocean-green)]/90 rounded-lg transition-colors shadow-sm"
            onClick={() => onConfirm(value)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  icon,
  text,
  onClick,
  disabled = false,
  tone = "default",
  title,
}: {
  icon: React.ReactNode;
  text: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger" | "accent";
  title?: string;
}) {
  const activeColorClass =
    tone === "accent"
      ? "text-[color:var(--color-ocean-green)]"
      : tone === "danger"
      ? "text-red-500"
      : "text-[color:var(--color-muted)] hover:text-[color:var(--color-foreground)] focus:text-[color:var(--color-foreground)]";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title || text}
      className={`flex flex-col items-center justify-center p-1 rounded-lg transition-colors focus:outline-none ${activeColorClass} ${
        disabled ? "opacity-35 cursor-not-allowed" : "cursor-pointer"
      } min-w-[3rem]`}
    >
      <div className="flex h-5.5 w-5.5 items-center justify-center">{icon}</div>
      <span className="text-[9px] font-semibold tracking-tight mt-0.5 whitespace-nowrap text-center opacity-85">
        {text}
      </span>
    </button>
  );
}

