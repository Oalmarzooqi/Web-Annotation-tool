/** Retinal layer / surface labels for OCT annotations (Phase 6). */

export type SurfaceLabel = {
  id: string;
  name: string;
  /** CSS color (hex preferred for stable parsing). */
  color: string;
};

/** Default palette: ILM, RPE, NFL — distinct hues on canvas; panel label text uses medium grey separately. */
export const DEFAULT_SURFACE_LABELS: SurfaceLabel[] = [
  { id: "surface-ilm", name: "ILM", color: "#1d4ed8" },
  { id: "surface-rpe", name: "RPE", color: "#c2410c" },
  { id: "surface-nfl", name: "NFL", color: "#6d28d9" },
];

export type AnnotationDrawStyle = {
  stroke: string;
  fillPoint: string;
  fillPolygon: string;
};

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.trim().replace(/^#/, "");
  if (h.length !== 3 && h.length !== 6) return null;
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Stroke + fills derived from a solid label color (hex). */
export function colorToAnnotationStyle(cssColor: string): AnnotationDrawStyle {
  const rgb = parseHex(cssColor);
  if (!rgb) {
    return {
      stroke: "rgb(55, 55, 55)",
      fillPoint: "rgba(90, 90, 90, 0.38)",
      fillPolygon: "rgba(90, 90, 90, 0.12)",
    };
  }
  const { r, g, b } = rgb;
  return {
    stroke: `rgb(${Math.round(r * 0.55)}, ${Math.round(g * 0.55)}, ${Math.round(b * 0.55)})`,
    fillPoint: `rgba(${r}, ${g}, ${b}, 0.38)`,
    fillPolygon: `rgba(${r}, ${g}, ${b}, 0.12)`,
  };
}

/** Brighter stroke/fills for the currently active label (stands out on the canvas). */
export function colorToAnnotationStyleActive(cssColor: string): AnnotationDrawStyle {
  const rgb = parseHex(cssColor);
  if (!rgb) {
    return {
      stroke: "rgb(75, 75, 75)",
      fillPoint: "rgba(110, 110, 110, 0.58)",
      fillPolygon: "rgba(110, 110, 110, 0.22)",
    };
  }
  const { r, g, b } = rgb;
  const strokeR = Math.min(255, Math.round(r * 0.92));
  const strokeG = Math.min(255, Math.round(g * 0.92));
  const strokeB = Math.min(255, Math.round(b * 0.92));
  return {
    stroke: `rgb(${strokeR}, ${strokeG}, ${strokeB})`,
    fillPoint: `rgba(${r}, ${g}, ${b}, 0.58)`,
    fillPolygon: `rgba(${r}, ${g}, ${b}, 0.22)`,
  };
}

/** New custom labels get a random saturated hex (avoid very light colors). */
export function randomLabelColor(): string {
  let n: number;
  do {
    n = Math.floor(Math.random() * 0xffffff);
  } while (luminanceFromRgb(n) > 0.72);
  return `#${n.toString(16).padStart(6, "0")}`;
}

function luminanceFromRgb(n: number): number {
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
