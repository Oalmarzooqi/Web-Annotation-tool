/**
 * Top-down (en-face) OCT view: the stack's B-scans run front-to-back along the
 * slice axis, each one a width×height cross-section. Looking down from the top
 * means collapsing each slice's depth (its rows) into a single intensity value
 * per column, then stacking those rows — one per slice.
 *
 * A cube scan's field of view is square (e.g. "2x2mm"), but it's sampled far
 * more densely across a B-scan (hundreds to a thousand A-scans wide) than
 * along the slice axis (tens of B-scans) — raw pixel counts like 1000x49 are
 * not the scan's real proportions, just mismatched sampling density. Stacking
 * one row per slice and displaying that 1:1 renders the square scan as a flat
 * strip. Resampling the slice axis up to the column count corrects for that
 * and reconstructs the square image the scan actually represents.
 */

/**
 * Per-column mean luma (BT.601) across a frame's rows — one row of the top view.
 * Walks the buffer row-major (matching its actual memory layout) rather than
 * column-major — same result, far fewer cache misses on a full-resolution
 * B-scan (this runs once per slice while building the top view).
 */
export function columnAverages(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const out = new Float32Array(width);
  if (height === 0) return out;
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = rowOffset + x * 4;
      out[x] += 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
    }
  }
  for (let x = 0; x < width; x++) out[x] /= height;
  return out;
}

/**
 * Linearly resample `rows.length` rows up (or down) to `outRows` rows, so a
 * sparse slice axis can be stretched to match the column count and render
 * as a square image instead of a flat strip.
 */
export function resampleRows(rows: Float32Array[], outRows: number): Float32Array[] {
  const width = rows[0]?.length ?? 0;
  if (rows.length === 0 || outRows <= 0) return [];
  if (outRows === rows.length) return rows;
  if (rows.length === 1) return new Array(outRows).fill(rows[0]!) as Float32Array[];

  const out: Float32Array[] = new Array(outRows);
  for (let oy = 0; oy < outRows; oy++) {
    const sy = (oy / (outRows - 1)) * (rows.length - 1);
    const y0 = Math.floor(sy);
    const y1 = Math.min(rows.length - 1, y0 + 1);
    const t = sy - y0;
    const row0 = rows[y0]!;
    const row1 = rows[y1]!;
    const row = new Float32Array(width);
    for (let x = 0; x < width; x++) row[x] = row0[x]! * (1 - t) + row1[x]! * t;
    out[oy] = row;
  }
  return out;
}

/**
 * Stack per-slice column-average rows into a min/max-stretched grayscale RGBA
 * image, resampled square (the slice axis stretched to the column count).
 */
export function buildEnFaceFrame(
  rows: Float32Array[],
  width: number,
): { width: number; height: number; rgba: Uint8ClampedArray } {
  rows = resampleRows(rows, width);
  const height = rows.length;
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (height === 0) return { width, height, rgba };

  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    for (let x = 0; x < width; x++) {
      const v = row[x]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const span = max - min || 1;

  for (let y = 0; y < height; y++) {
    const row = rows[y]!;
    for (let x = 0; x < width; x++) {
      const v = Math.round(((row[x]! - min) / span) * 255);
      const i = (y * width + x) * 4;
      rgba[i] = v;
      rgba[i + 1] = v;
      rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  return { width, height, rgba };
}
