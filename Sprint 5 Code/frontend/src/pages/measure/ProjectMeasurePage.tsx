"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, Ruler, ScanLine } from "lucide-react";
import { Card, CardBody, CardHeader, IconLink, VerticalRule } from "../../components/ui";
import { useProject } from "../../lib/useProjects";
import { getProject, updateProject } from "../../lib/projects";
import {
  DEFAULT_FILE_KEY,
  parseProjectData,
  serializeProjectData,
  type FileDims,
  type VolumeScale,
} from "../../lib/projectData";
import {
  isBoundary,
  type ThicknessMode,
  thicknessMatrix,
  thicknessStats,
  type ThicknessRow,
} from "../../lib/thickness";
import { drawThicknessReport, REPORT_WIDTH, REPORT_HEIGHT } from "../../lib/thicknessReport";
import { DEFAULT_SURFACE_LABELS, type SurfaceLabel } from "../../lib/surfaceLabels";

const selectClass =
  "h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm text-[color:var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]";

const numberClass = selectClass;

function fmt(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[color:var(--color-muted)]">{children}</p>;
}

function getSliceColor(index: number, total: number): string {
  const PALETTE = [
    "#38bdf8", // Sky Blue
    "#34d399", // Emerald Green
    "#facc15", // Amber Yellow
    "#f97316", // Bright Orange
    "#f43f5e", // Rose Red
    "#a855f7", // Vibrant Purple
    "#ec4899", // Hot Pink
    "#06b6d4", // Cyan
    "#a3e635", // Lime Green
    "#fbbf24", // Warm Yellow
  ];
  if (total <= PALETTE.length) return PALETTE[index % PALETTE.length]!;
  return `hsl(${Math.round((index * 360) / Math.max(1, total))}, 85%, 55%)`;
}

export function ProjectMeasurePage() {
  const { id = "" } = useParams<{ id: string }>();
  const { project, loading, error } = useProject(id);
  const [searchParams] = useSearchParams();

  const [savedNote, setSavedNote] = useState<string | null>(null);

  // Controls hold only what the user has actually changed; everything else is
  // derived from the project. That keeps the seeding out of an effect.
  const [scaleEdit, setScaleEdit] = useState<VolumeScale | null>(null);
  const [labelASel, setLabelASel] = useState("");
  const [labelBSel, setLabelBSel] = useState("");
  const [mode, setMode] = useState<ThicknessMode>("axial");

  const rawAnnotations = project?.annotations;
  const rawLabels = project?.labels;

  const data = useMemo(() => parseProjectData(rawAnnotations), [rawAnnotations]);

  const labels = useMemo<SurfaceLabel[]>(() => {
    if (!rawLabels) return DEFAULT_SURFACE_LABELS;
    try {
      const parsed = JSON.parse(rawLabels);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_SURFACE_LABELS;
    } catch {
      return DEFAULT_SURFACE_LABELS;
    }
  }, [rawLabels]);

  /** Which stored file we are measuring: ?file=… wins, else the only/first one. */
  const fileKey = useMemo(() => {
    const wanted = searchParams.get("file");
    const keys = Object.keys(data.files);
    if (wanted && data.files[wanted]) return wanted;
    if (wanted && keys.length === 0) return wanted;
    return keys[0] ?? DEFAULT_FILE_KEY;
  }, [searchParams, data.files]);

  // Memoised so the `?? {}` fallback does not produce a new object every render
  // and re-run the whole thickness computation below.
  const annotationsBySlice = useMemo(() => data.files[fileKey] ?? {}, [data.files, fileKey]);
  const dims: FileDims | null = data.dims[fileKey] ?? null;

  /**
   * The dropdown offers only layers actually traced as a boundary in this file
   * (Sprint 4: "a dropdown containing the available annotated layers"). If fewer
   * than two exist we fall back to the full list so the selectors still work and
   * the empty state can explain what to trace.
   */
  const selectableLabels = useMemo<SurfaceLabel[]>(() => {
    const traced = new Set<string>();
    for (const anns of Object.values(annotationsBySlice)) {
      for (const a of anns ?? []) if (isBoundary(a)) traced.add(a.labelId);
    }
    const only = labels.filter((l) => traced.has(l.id));
    return only.length >= 2 ? only : labels;
  }, [annotationsBySlice, labels]);

  const labelIdA = labelASel || selectableLabels[0]?.id || "";
  const labelIdB =
    labelBSel || selectableLabels[1]?.id || selectableLabels[0]?.id || "";

  /**
   * Scale precedence: an unsaved edit in this view, then a scale the user has
   * explicitly saved, then whatever the file itself declared (DICOM PixelSpacing),
   * then the Bioptigen defaults. A hand-saved scale is never overwritten by the file.
   */
  const detected = data.dims[fileKey]?.spacing;
  const scale: VolumeScale =
    scaleEdit ?? (data.scaleSource === "user" ? data.scale : detected ?? data.scale);
  const scaleOrigin: "edited" | "user" | "file" | "default" = scaleEdit
    ? "edited"
    : data.scaleSource === "user"
      ? "user"
      : detected
        ? "file"
        : "default";

  const rows: ThicknessRow[] = useMemo(() => {
    if (!dims || !labelIdA || !labelIdB) return [];
    return thicknessMatrix(
      annotationsBySlice,
      labelIdA,
      labelIdB,
      dims,
      scale.umPerPxAxial,
      mode,
      scale.umPerPxLateral,
    );
  }, [annotationsBySlice, labelIdA, labelIdB, dims, scale, mode]);

  const stats = useMemo(() => thicknessStats(rows), [rows]);

  /**
   * Why there is nothing to measure. "Not annotated" and "annotated, but only as
   * shapes that are not boundaries" are different problems with different fixes,
   * and telling the user the wrong one sends them off to redraw work they have.
   */
  const diagnosis = useMemo(() => {
    const seen = { [labelIdA]: { boundary: 0, other: 0 }, [labelIdB]: { boundary: 0, other: 0 } };
    for (const anns of Object.values(annotationsBySlice)) {
      for (const a of anns ?? []) {
        const bucket = seen[a.labelId];
        if (!bucket) continue;
        if (isBoundary(a)) bucket.boundary++;
        else bucket.other++;
      }
    }
    const nameOf = (lid: string) => labels.find((l) => l.id === lid)?.name ?? lid;
    const unusable = [labelIdA, labelIdB].filter(
      (lid) => seen[lid]!.boundary === 0 && seen[lid]!.other > 0,
    );
    const missing = [labelIdA, labelIdB].filter(
      (lid) => seen[lid]!.boundary === 0 && seen[lid]!.other === 0,
    );
    if (unusable.length > 0) {
      return `${unusable.map(nameOf).join(" and ")} ${unusable.length > 1 ? "are" : "is"} only drawn as points or filled polygons, which do not define a boundary. Trace ${unusable.length > 1 ? "them" : "it"} with the Layer, Spline, Line or Freehand tool.`;
    }
    if (missing.length > 0) {
      return `${missing.map(nameOf).join(" and ")} ${missing.length > 1 ? "have" : "has"} not been drawn on any slice yet.`;
    }
    return "Both layers exist, but never on the same slice. Draw both boundaries on at least one slice.";
  }, [annotationsBySlice, labelIdA, labelIdB, labels]);

  const profileRef = useRef<HTMLCanvasElement | null>(null);

  // ── Multi-slice profile chart ─────────────────────────────────────────────
  useEffect(() => {
    const canvas = profileRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = 200;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (rows.length === 0 || !Number.isFinite(stats.min)) return;

    const pad = { top: 12, right: 12, bottom: 20, left: 44 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const lo = stats.min === stats.max ? stats.min - 1 : stats.min;
    const hi = stats.min === stats.max ? stats.max + 1 : stats.max;
    const yFor = (v: number) => pad.top + plotH - ((v - lo) / (hi - lo)) * plotH;

    ctx.strokeStyle = "rgba(128,128,128,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.stroke();

    ctx.fillStyle = "rgba(128,128,128,0.9)";
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`${hi.toFixed(0)}`, pad.left - 6, pad.top + 4);
    ctx.fillText(`${lo.toFixed(0)}`, pad.left - 6, pad.top + plotH);
    ctx.textAlign = "left";
    ctx.fillText("um", 4, 12);

    rows.forEach((row, i) => {
      ctx.strokeStyle = getSliceColor(i, rows.length);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      let drawing = false;
      for (let x = 0; x < row.values.length; x++) {
        const v = row.values[x]!;
        if (!Number.isFinite(v)) {
          drawing = false;
          continue;
        }
        const px = pad.left + (x / Math.max(1, row.values.length - 1)) * plotW;
        const py = yFor(v);
        if (drawing) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
        drawing = true;
      }
      ctx.stroke();
    });
  }, [rows, stats.min, stats.max]);

  const reportRef = useRef<HTMLCanvasElement | null>(null);

  // ── Full report canvas (metadata, heat maps, ETDRS sectors, matrix) ────────
  useEffect(() => {
    const canvas = reportRef.current;
    if (!canvas || !dims || rows.length === 0) return;
    const nameA = labels.find((l) => l.id === labelIdA)?.name ?? "A";
    const nameB = labels.find((l) => l.id === labelIdB)?.name ?? "B";
    drawThicknessReport(canvas, {
      title: project?.name ?? "",
      fileName: fileKey,
      rows,
      stats,
      dims,
      scale,
      mode,
      labelA: nameA,
      labelB: nameB,
    });
  }, [dims, rows, stats, scale, mode, labelIdA, labelIdB, labels, project?.name, fileKey]);

  const downloadReport = () => {
    const canvas = reportRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${(project?.name ?? "oct").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-thickness-report.png`;
    a.click();
  };

  const saveScale = async () => {
    if (!project) return;
    // Re-read before writing: the annotate page may have saved since we loaded.
    const latest = await getProject(project.id);
    const fresh = parseProjectData(latest.annotations);
    fresh.scale = scale;
    fresh.scaleSource = "user";
    await updateProject(project.id, {
      name: project.name,
      description: project.description,
      annotations: serializeProjectData(fresh),
      labels: latest.labels,
    });
    setSavedNote("Scale saved to project.");
    setTimeout(() => setSavedNote(null), 3000);
  };

  /** Drop a hand-saved scale so the file's own declared spacing takes over again. */
  const resetScaleToFile = async () => {
    if (!project) return;
    const latest = await getProject(project.id);
    const fresh = parseProjectData(latest.annotations);
    fresh.scaleSource = "auto";
    await updateProject(project.id, {
      name: project.name,
      description: project.description,
      annotations: serializeProjectData(fresh),
      labels: latest.labels,
    });
    setSavedNote("Using the file's declared spacing.");
    setTimeout(() => setSavedNote(null), 3000);
  };


  const exportCsv = () => {
    if (!dims || rows.length === 0) return;
    const nameA = labels.find((l) => l.id === labelIdA)?.name ?? "A";
    const nameB = labels.find((l) => l.id === labelIdB)?.name ?? "B";

    const header = ["slice_um", ...Array.from({ length: dims.width }, (_, x) =>
      (x * scale.umPerPxLateral).toFixed(2),
    )];
    const lines = [
      `# ${nameA} to ${nameB} thickness (um), ${mode}`,
      `# file: ${fileKey}`,
      `# scale: ${scale.umPerPxLateral} um/px lateral, ${scale.umPerPxAxial} um/px axial, ${scale.umPerSlice} um/slice`,
      header.join(","),
      ...rows.map((r) =>
        [
          (r.slice * scale.umPerSlice).toFixed(2),
          // Empty cell for a gap — never 0, which would read as a real measurement.
          ...Array.from(r.values, (v) => (Number.isFinite(v) ? v.toFixed(3) : "")),
        ].join(","),
      ),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(project?.name ?? "oct").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${nameA}-${nameB}-${mode}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <main className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-6">
        <Empty>Loading…</Empty>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-6">
        <Card>
          <CardHeader title="Project not found" />
          <CardBody>
            <Empty>{error ?? "This project does not exist."}</Empty>
            <div className="mt-4">
              <IconLink to="/projects" label="Back to projects">
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </IconLink>
            </div>
          </CardBody>
        </Card>
      </main>
    );
  }

  const sameLabel = labelIdA === labelIdB;

  return (
    <main className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 truncate text-xl font-semibold tracking-tight">
            <Ruler className="h-5 w-5" aria-hidden="true" />
            Measurements
          </h1>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            {project.name}
            {fileKey !== DEFAULT_FILE_KEY ? ` — ${fileKey}` : ""}
          </p>
        </div>
        <div className="flex items-center">
          <IconLink
            to={`/projects/${project.id}/annotate`}
            label="Back to annotation"
            tone="accent"
          >
            <ScanLine className="h-5 w-5" aria-hidden="true" />
          </IconLink>
          <VerticalRule />
          <IconLink to={`/projects/${project.id}`} label="Back to project">
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </IconLink>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader
          title="Layers"
          subtitle="Thickness is measured axially: at each column, the vertical gap between the two boundaries."
        />
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[color:var(--color-muted)]">From layer</span>
              <select
                className={selectClass}
                value={labelIdA}
                onChange={(e) => setLabelASel(e.target.value)}
              >
                {selectableLabels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[color:var(--color-muted)]">To layer</span>
              <select
                className={selectClass}
                value={labelIdB}
                onChange={(e) => setLabelBSel(e.target.value)}
              >
                {selectableLabels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-col gap-1 text-sm sm:max-w-xs">
            <span className="text-[color:var(--color-muted)]">Measurement</span>
            <select
              className={selectClass}
              value={mode}
              onChange={(e) => setMode(e.target.value as ThicknessMode)}
            >
              <option value="axial">Axial (vertical gap per column)</option>
              <option value="perpendicular">Perpendicular (shortest distance)</option>
            </select>
            <span className="mt-1 text-xs text-[color:var(--color-muted)]">
              {mode === "axial"
                ? "Standard for thickness maps. Overestimates where the retina is tilted."
                : "L\u00b2 = (dx\u00b7\u00b5m/px lateral)\u00b2 + (dy\u00b7\u00b5m/px axial)\u00b2 \u2014 correct under tilt, never larger than axial. Depends on the lateral pitch."}
            </span>
          </div>
          {sameLabel ? (
            <p className="mt-3 text-sm text-[color:var(--color-muted)]">
              Pick two different layers to measure a thickness.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Scale"
          subtitle={
            scaleOrigin === "file"
              ? "Read from the file's own DICOM PixelSpacing tags."
              : scaleOrigin === "user"
                ? "Saved with this project."
                : scaleOrigin === "edited"
                  ? "Edited but not yet saved."
                  : "Pixel spacing is anisotropic, so these values decide the micrometre result. Defaults are the Bioptigen Envisu pitches."
          }
        />
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(
              [
                ["umPerPxLateral", "Lateral (um/px)"],
                ["umPerPxAxial", "Axial (um/px)"],
                ["umPerSlice", "Slice spacing (um)"],
              ] as [keyof VolumeScale, string][]
            ).map(([key, label]) => (
              <label key={key} className="flex flex-col gap-1 text-sm">
                <span className="text-[color:var(--color-muted)]">{label}</span>
                <input
                  className={numberClass}
                  type="number"
                  min="0"
                  step="0.01"
                  value={scale[key]}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    // Ignore junk rather than poisoning every measurement with NaN.
                    if (!Number.isFinite(n) || n <= 0) return;
                    setScaleEdit({ ...scale, [key]: n });
                  }}
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void saveScale()}
              className="h-9 cursor-pointer rounded-xl border border-[color:var(--color-border)] px-4 text-sm hover:bg-[color:var(--color-surface-2)]"
            >
              Save scale to project
            </button>
            {detected && scaleOrigin !== "file" ? (
              <button
                type="button"
                onClick={() => {
                  setScaleEdit(null);
                  void resetScaleToFile();
                }}
                className="h-9 cursor-pointer rounded-xl border border-[color:var(--color-border)] px-4 text-sm hover:bg-[color:var(--color-surface-2)]"
                title={`From the file: ${detected.umPerPxLateral} / ${detected.umPerPxAxial} / ${detected.umPerSlice} um`}
              >
                Use the file's values
              </button>
            ) : null}
            {savedNote ? (
              <span className="text-sm text-[color:var(--color-muted)]">{savedNote}</span>
            ) : null}
          </div>
        </CardBody>
      </Card>
      </div>

      {!dims ? (
        <Card>
          <CardHeader title="Image dimensions unknown" />
          <CardBody>
            <Empty>
              This file's size was not recorded. Open it once in the Annotate view — the
              dimensions are saved automatically — then come back.
            </Empty>
          </CardBody>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardHeader title="No measurable slices" />
          <CardBody>
            <Empty>
              {sameLabel ? "Select two different layers." : diagnosis}
            </Empty>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader
              title="Summary"
              subtitle={`${stats.count.toLocaleString()} measured columns across ${rows.length} slice${rows.length === 1 ? "" : "s"}`}
            />
            <CardBody>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(
                  [
                    ["Average", stats.mean],
                    ["Minimum", stats.min],
                    ["Maximum", stats.max],
                    ["STDEV", stats.stdev],
                  ] as [string, number][]
                ).map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] px-4 py-3"
                  >
                    <dt className="text-[11px] uppercase tracking-wider text-[color:var(--color-muted)]">
                      {label}
                    </dt>
                    <dd className="mt-1 font-mono text-lg">
                      {fmt(value)}
                      <span className="ml-1 text-xs text-[color:var(--color-muted)]">um</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={exportCsv}
                  className="flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-[color:var(--color-border)] px-4 text-sm hover:bg-[color:var(--color-surface-2)]"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Export CSV
                </button>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Slice profile"
              subtitle={`${rows.length} measured slice profile${rows.length === 1 ? "" : "s"}`}
            />
            <CardBody>
              <canvas ref={profileRef} className="w-full" style={{ height: 200 }} />
              {rows.length === 0 ? (
                <Empty>No measured slices to display profile.</Empty>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  {rows.map((r, i) => (
                    <div key={r.slice} className="flex items-center gap-1.5 font-mono">
                      <span
                        className="h-2.5 w-2.5 rounded-full inline-block"
                        style={{ backgroundColor: getSliceColor(i, rows.length) }}
                      />
                      <span className="text-[color:var(--color-foreground)]">Slice {r.slice + 1}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
          </div>

          <Card>
            <CardHeader
              title="Thickness Report"
              subtitle="Total Retinal Thickness heat map — Bruch's Membrane minus ILM at each column, per slice"
            />
            <CardBody>
              <canvas
                ref={reportRef}
                className="w-full rounded-xl border border-[color:var(--color-border)]"
                style={{ aspectRatio: `${REPORT_WIDTH} / ${REPORT_HEIGHT}` }}
              />
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={downloadReport}
                  className="flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-[color:var(--color-border)] px-4 text-sm hover:bg-[color:var(--color-surface-2)]"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Download PNG
                </button>
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </main>
  );
}
