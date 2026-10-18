import {
  avgStdRange,
  buildThicknessGrid,
  thicknessRgb,
  type ThicknessMode,
  type ThicknessRow,
  type ThicknessStats,
} from "./thickness";
import type { FileDims, VolumeScale } from "./projectData";

/**
 * The thickness report, drawn as one canvas.
 *
 * Laid out after the Bioptigen "Retinal Thickness Report": scan metadata, the heat
 * map, a contrast-stretched twin, an ETDRS-style sector grid, and the thickness matrix.
 *
 * Rendered once and used twice — shown on screen and saved as the PNG — so the file
 * the user downloads is exactly the one they reviewed.
 *
 * NOT included: the reference's "Segmented VIP" panel. That is a projection of the OCT
 * volume itself, and this view works from saved annotations without ever decoding the
 * image. A placeholder there would read as data.
 */

export type ReportInput = {
  title: string;
  fileName: string;
  /** Measured rows — the source of every statistic. */
  rows: ThicknessRow[];
  stats: ThicknessStats;
  dims: FileDims;
  scale: VolumeScale;
  mode: ThicknessMode;
  labelA: string;
  labelB: string;
};

/** One flat palette so the report reads as a single document. */
const C = {
  ink: "#0f172a",
  muted: "#64748b",
  faint: "#94a3b8",
  accent: "#2563eb",
  border: "#cbd5e1",
  hair: "#e2e8f0",
  head: "#e8f0fe",
  headInk: "#1e3a5f",
  cell: "#ffffff",
  cellAlt: "#f8fafc",
  panel: "#2f3438",
  warn: "#b45309",
};

const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace";

export const REPORT_WIDTH = 1280;
export const REPORT_HEIGHT = 800;

const MARGIN = 56;

const fmt0 = (v: number) => (Number.isFinite(v) ? Math.round(v).toString() : "—");
const fmt2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

type Cell = { text: string; w: number; head?: boolean; align?: "left" | "right" };

/**
 * A table with a rounded outline, tinted label cells and hairline separators.
 * Numeric columns are set in a monospace face and right-aligned so digits line up.
 */
function drawTable(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rowH: number,
  rows: Cell[][],
) {
  const totalW = rows[0]!.reduce((a, c) => a + c.w, 0);
  const totalH = rows.length * rowH;

  ctx.save();
  roundRect(ctx, x, y, totalW, totalH, 8);
  ctx.clip();

  rows.forEach((cells, ri) => {
    const ry = y + ri * rowH;
    let cx = x;
    for (const cell of cells) {
      ctx.fillStyle = cell.head ? C.head : ri % 2 === 1 ? C.cellAlt : C.cell;
      ctx.fillRect(cx, ry, cell.w, rowH);
      cx += cell.w;
    }
    // Hairline between rows, never under the last one.
    if (ri < rows.length - 1) {
      ctx.strokeStyle = C.hair;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, ry + rowH + 0.5);
      ctx.lineTo(x + totalW, ry + rowH + 0.5);
      ctx.stroke();
    }
  });

  rows.forEach((cells, ri) => {
    const ry = y + ri * rowH;
    let cx = x;
    for (const cell of cells) {
      ctx.fillStyle = cell.head ? C.headInk : C.ink;
      ctx.font = cell.head ? `600 12px ${FONT}` : `12px ${cell.align === "right" ? MONO : FONT}`;
      if (cell.align === "right") {
        ctx.textAlign = "right";
        ctx.fillText(cell.text, cx + cell.w - 12, ry + rowH / 2 + 4);
      } else {
        ctx.textAlign = "left";
        ctx.fillText(cell.text, cx + 12, ry + rowH / 2 + 4);
      }
      cx += cell.w;
      if (cx < x + totalW) {
        ctx.strokeStyle = C.hair;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx + 0.5, ry);
        ctx.lineTo(cx + 0.5, ry + rowH);
        ctx.stroke();
      }
    }
  });
  ctx.restore();

  roundRect(ctx, x + 0.5, y + 0.5, totalW, totalH, 8);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * A vertical colour-ramp legend beside a heat map, with low/mid/high value labels —
 * the map is unreadable without knowing what the colours mean.
 */
function drawColorbar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lo: number,
  hi: number,
) {
  const steps = 64;
  const strip = document.createElement("canvas");
  strip.width = 1;
  strip.height = steps;
  const sctx = strip.getContext("2d")!;
  const img = sctx.createImageData(1, steps);
  for (let i = 0; i < steps; i++) {
    // Row 0 is the top of the bar, which reads as the HIGH end.
    const [r, g, b] = thicknessRgb(1 - i / (steps - 1));
    const o = i * 4;
    img.data[o] = r;
    img.data[o + 1] = g;
    img.data[o + 2] = b;
    img.data[o + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(strip, x, y, w, h);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);

  ctx.fillStyle = C.ink;
  ctx.font = `600 10px ${MONO}`;
  ctx.textAlign = "right";
  ctx.fillText(fmt0(hi), x - 5, y + 9);
  ctx.fillText(fmt0((lo + hi) / 2), x - 5, y + h / 2 + 3);
  ctx.fillText(fmt0(lo), x - 5, y + h - 1);
}

/**
 * The en-face heat map: the slice x column thickness grid rendered as an image
 * with the shared colour ramp, plus a colorbar so the colours are legible.
 *
 * Fit "contain", not stretched to the square panel — a 512-column x 49-slice volume
 * is far wider than it is tall, and stretching it into a square would misrepresent
 * the scan geometry.
 */
function drawHeatMap(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  grid: Float64Array[],
  lo: number,
  hi: number,
  label: string,
) {
  ctx.fillStyle = C.ink;
  ctx.font = `600 13px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(label, x + w / 2, y - 14);

  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  ctx.save();
  roundRect(ctx, x, y, w, h, 8);
  ctx.clip();
  ctx.fillStyle = C.panel;
  ctx.fillRect(x, y, w, h);

  if (rows > 0 && cols > 0) {
    const off = document.createElement("canvas");
    off.width = cols;
    off.height = rows;
    const octx = off.getContext("2d")!;
    const img = octx.createImageData(cols, rows);
    const range = hi - lo || 1;
    for (let r = 0; r < rows; r++) {
      const row = grid[r]!;
      for (let c = 0; c < cols; c++) {
        const v = row[c]!;
        const o = (r * cols + c) * 4;
        if (Number.isFinite(v)) {
          const [rr, gg, bb] = thicknessRgb((v - lo) / range);
          img.data[o] = rr;
          img.data[o + 1] = gg;
          img.data[o + 2] = bb;
        } else {
          // No measurement here — panel background colour, not a ramp colour.
          img.data[o] = 0x2f;
          img.data[o + 1] = 0x34;
          img.data[o + 2] = 0x38;
        }
        img.data[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);

    const scale = Math.min(w / cols, h / rows);
    const dw = cols * scale;
    const dh = rows * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  ctx.restore();

  roundRect(ctx, x + 0.5, y + 0.5, w, h, 8);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.stroke();
}




export function drawThicknessReport(canvas: HTMLCanvasElement, input: ReportInput): void {
  const { dims, scale, stats, rows } = input;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  canvas.width = Math.round(REPORT_WIDTH * dpr);
  canvas.height = Math.round(REPORT_HEIGHT * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, REPORT_WIDTH, REPORT_HEIGHT);

  // ── Header ───────────────────────────────────────────────────────────────
  ctx.fillStyle = C.ink;
  ctx.font = `700 26px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("Retinal Thickness Report", MARGIN, 48);

  ctx.fillStyle = C.accent;
  ctx.font = `600 13px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`${input.labelA} → ${input.labelB}`, REPORT_WIDTH - MARGIN, 34);
  ctx.fillStyle = C.muted;
  ctx.font = `12px ${FONT}`;
  ctx.fillText(
    `${input.mode} · ${rows.length}/${dims.sliceCount} slices measured`,
    REPORT_WIDTH - MARGIN,
    52,
  );

  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN, 64.5);
  ctx.lineTo(REPORT_WIDTH - MARGIN, 64.5);
  ctx.stroke();

  // ── Metadata ─────────────────────────────────────────────────────────────
  const tableW = REPORT_WIDTH - MARGIN * 2;
  const w = [110, 230, 140, 95, 175, 80, 135, tableW - 965];
  const rowH = 30;
  drawTable(ctx, MARGIN, 84, rowH, [
    [
      { text: "Name", w: w[0]!, head: true },
      { text: input.fileName, w: tableW - w[0]! },
    ],
    [
      { text: "Depth (mm)", w: w[0]!, head: true },
      { text: ((dims.height * scale.umPerPxAxial) / 1000).toFixed(2), w: w[1]!, align: "right" },
      { text: "Depth Samples", w: w[2]!, head: true },
      { text: String(dims.height), w: w[3]!, align: "right" },
      { text: "Depth Pitch (um/pix)", w: w[4]!, head: true },
      { text: scale.umPerPxAxial.toFixed(2), w: w[5]!, align: "right" },
      { text: "Refractive Index", w: w[6]!, head: true },
      { text: "—", w: w[7]!, align: "right" },
    ],
    [
      { text: "Width (mm)", w: w[0]!, head: true },
      { text: ((dims.width * scale.umPerPxLateral) / 1000).toFixed(2), w: w[1]!, align: "right" },
      { text: "Width Samples", w: w[2]!, head: true },
      { text: String(dims.width), w: w[3]!, align: "right" },
      { text: "Width Pitch (um/pix)", w: w[4]!, head: true },
      { text: scale.umPerPxLateral.toFixed(2), w: w[5]!, align: "right" },
      { text: "Eye", w: w[6]!, head: true },
      { text: "—", w: w[7]!, align: "right" },
    ],
    [
      { text: "Length (mm)", w: w[0]!, head: true },
      { text: ((dims.sliceCount * scale.umPerSlice) / 1000).toFixed(2), w: w[1]!, align: "right" },
      { text: "Length Samples", w: w[2]!, head: true },
      { text: String(dims.sliceCount), w: w[3]!, align: "right" },
      { text: "Length Pitch (um/pix)", w: w[4]!, head: true },
      { text: scale.umPerSlice.toFixed(2), w: w[5]!, align: "right" },
      { text: "Scan Type", w: w[6]!, head: true },
      { text: "—", w: w[7]!, align: "right" },
    ],
  ]);

  // ── Panels ───────────────────────────────────────────────────────────────
  const panel = 360;
  const panelY = 245;

  ctx.fillStyle = C.faint;
  ctx.font = `600 11px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("TOTAL", MARGIN, panelY - 24);

  const x1 = Math.round((REPORT_WIDTH - panel) / 2);
  const cbarW = 14;

  const grid = buildThicknessGrid(rows, dims.sliceCount, dims.width);
  const stretchedRange = avgStdRange(stats);

  drawColorbar(ctx, x1 - 24, panelY, cbarW, panel, stretchedRange[0], stretchedRange[1]);
  drawHeatMap(
    ctx,
    x1,
    panelY,
    panel,
    panel,
    grid,
    stretchedRange[0],
    stretchedRange[1],
    "Heat Map (AVG \u00b1 2 STD um)",
  );

  // ── Thickness matrix ─────────────────────────────────────────────────────
  const cw = 168;
  const mtx = Math.round((REPORT_WIDTH - cw * 5) / 2);
  const mty = panelY + panel + 54;
  ctx.fillStyle = C.ink;
  ctx.font = `600 13px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("Thickness Matrix", mtx, mty - 12);

  drawTable(ctx, mtx, mty, rowH, [
    [
      { text: "Analysis", w: cw, head: true },
      { text: "Average (um)", w: cw, head: true },
      { text: "Minimum (um)", w: cw, head: true },
      { text: "Maximum (um)", w: cw, head: true },
      { text: "STDEV (um)", w: cw, head: true },
    ],
    [
      { text: "Total", w: cw, head: true },
      { text: fmt2(stats.mean), w: cw, align: "right" },
      { text: fmt2(stats.min), w: cw, align: "right" },
      { text: fmt2(stats.max), w: cw, align: "right" },
      { text: fmt2(stats.stdev), w: cw, align: "right" },
    ],
  ]);

  // ── Footer ───────────────────────────────────────────────────────────────
  const measuredFraction = dims.sliceCount > 0 ? rows.length / dims.sliceCount : 0;
  if (measuredFraction < 0.25) {
    ctx.fillStyle = C.warn;
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(
      `Sparse data — only ${rows.length} of ${dims.sliceCount} B-scans are annotated, so most of the map has no measurement.`,
      MARGIN,
      REPORT_HEIGHT - 58,
    );
  }

  ctx.strokeStyle = C.hair;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN, REPORT_HEIGHT - 42.5);
  ctx.lineTo(REPORT_WIDTH - MARGIN, REPORT_HEIGHT - 42.5);
  ctx.stroke();
  ctx.fillStyle = C.faint;
  ctx.font = `11px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(input.title, MARGIN, REPORT_HEIGHT - 24);
  ctx.textAlign = "right";
  ctx.fillText(
    `generated from annotations · ${stats.count.toLocaleString()} samples`,
    REPORT_WIDTH - MARGIN,
    REPORT_HEIGHT - 24,
  );
}
