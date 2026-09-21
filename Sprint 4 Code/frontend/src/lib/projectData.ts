import type { Annotation } from "../components/oct/OctCanvas";

/**
 * The `Project.annotations` blob.
 *
 * The backend stores this column as an opaque string and never parses it, so the
 * shape is owned entirely by the client. It stays at `__v: 2` — `scale` and `dims`
 * are additive, and a blob written before they existed still loads.
 */

/** Physical size of one voxel. Thickness is meaningless without it. */
export type VolumeScale = {
  /** Along x, within a B-scan. */
  umPerPxLateral: number;
  /** Along y (depth). This is the one thickness is measured in. */
  umPerPxAxial: number;
  /** Between adjacent B-scans. */
  umPerSlice: number;
};

/**
 * Bioptigen Envisu defaults, derived from the sample data's own sidecar CSV
 * (`Data/Mouse Retina TIFF (Bioptigen)/*.csv`): 1.8 mm / 1000 px lateral,
 * 1.6513 mm / 1024 px axial, 1.8 mm / 100 slices.
 */
export const DEFAULT_SCALE: VolumeScale = {
  umPerPxLateral: 1.8,
  umPerPxAxial: 1.61,
  umPerSlice: 18,
};

/**
 * Decoded volume geometry, recorded by the annotate page so other views need no decode.
 * `spacing` is the physical voxel size the FILE declared (DICOM PixelSpacing), when it
 * declares one — distinct from the user's own `scale` below.
 */
export type FileDims = {
  width: number;
  height: number;
  sliceCount: number;
  spacing?: VolumeScale;
};

export type ProjectData = {
  files: Record<string, Record<number, Annotation[]>>;
  scale: VolumeScale;
  /**
   * "user" once someone saves the scale by hand — after that it wins over anything
   * read from the file, so a deliberate correction is never silently overwritten.
   */
  scaleSource: "auto" | "user";
  dims: Record<string, FileDims>;
};

/** The file key used when no file name is known. */
export const DEFAULT_FILE_KEY = "__default__";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A finite positive number, or the fallback. Guards against null/""/NaN from old blobs. */
function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}

function parseScale(v: unknown): VolumeScale {
  if (!isObj(v)) return { ...DEFAULT_SCALE };
  return {
    umPerPxLateral: num(v.umPerPxLateral, DEFAULT_SCALE.umPerPxLateral),
    umPerPxAxial: num(v.umPerPxAxial, DEFAULT_SCALE.umPerPxAxial),
    umPerSlice: num(v.umPerSlice, DEFAULT_SCALE.umPerSlice),
  };
}

function parseDims(v: unknown): Record<string, FileDims> {
  if (!isObj(v)) return {};
  const out: Record<string, FileDims> = {};
  for (const [key, d] of Object.entries(v)) {
    if (!isObj(d)) continue;
    const width = num(d.width, 0);
    const height = num(d.height, 0);
    const sliceCount = num(d.sliceCount, 0);
    if (!width || !height || !sliceCount) continue;
    const spacing = isObj(d.spacing) ? parseScale(d.spacing) : undefined;
    out[key] = spacing
      ? { width, height, sliceCount, spacing }
      : { width, height, sliceCount };
  }
  return out;
}

/**
 * Parse the raw `project.annotations` string.
 *
 * Handles:
 *   - v2 : { __v: 2, files: { [fileName]: annotationsBySlice }, scale?, dims? }
 *   - v1 : flat { [sliceIdx]: Annotation[] }  -> migrated under DEFAULT_FILE_KEY
 *   - empty / null / malformed -> empty data with default scale
 */
export function parseProjectData(raw: string | null | undefined): ProjectData {
  const empty = (): ProjectData => ({
    files: {},
    scale: { ...DEFAULT_SCALE },
    scaleSource: "auto",
    dims: {},
  });
  if (!raw) return empty();
  try {
    const parsed = JSON.parse(raw);
    if (isObj(parsed) && parsed.__v === 2) {
      return {
        files: (parsed.files as ProjectData["files"]) ?? {},
        scale: parseScale(parsed.scale),
        scaleSource: parsed.scaleSource === "user" ? "user" : "auto",
        dims: parseDims(parsed.dims),
      };
    }
    // v1 flat format — migrate to the default key.
    return {
      files: { [DEFAULT_FILE_KEY]: parsed as Record<number, Annotation[]> },
      scale: { ...DEFAULT_SCALE },
      scaleSource: "auto",
      dims: {},
    };
  } catch {
    return empty();
  }
}

/**
 * Serialise for storage.
 *
 * Always write the whole object. Rebuilding the blob from `files` alone silently
 * drops `scale` and `dims` — and since the annotate page auto-saves every 2s, that
 * loses the user's settings within seconds.
 */
export function serializeProjectData(d: ProjectData): string {
  return JSON.stringify({
    __v: 2,
    files: d.files,
    scale: d.scale,
    scaleSource: d.scaleSource,
    dims: d.dims,
  });
}
