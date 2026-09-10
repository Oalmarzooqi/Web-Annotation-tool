import * as UTIFNS from "utif";

const UTIF = (UTIFNS as unknown as { default?: typeof UTIFNS }).default ?? UTIFNS;
type WorkerScope = typeof self & { postMessage: (message: unknown, transfer?: Transferable[]) => void };

type InitMsg = { type: "init"; buf: ArrayBuffer };
type SliceMsg = { type: "slice"; idx: number };
type Msg = InitMsg | SliceMsg;

type ReadyResp = { type: "ready"; sliceCount: number; width: number; height: number };
type SliceResp = { type: "slice"; idx: number; width: number; height: number; bitmap?: ImageBitmap; rgba?: Uint8ClampedArray };
type ErrorResp = { type: "error"; message: string };

let buf: ArrayBuffer | null = null;
let ifds: ReturnType<typeof UTIF.decode> | null = null;
let w = 0;
let h = 0;

function getNumber(v: unknown, fallback: number) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function rgbaToBitmap(rgba: Uint8ClampedArray, width: number, height: number): Promise<ImageBitmap | null> {
  try {
    // Worker context: prefer OffscreenCanvas if available.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const OffscreenCanvasCtor = (globalThis as any).OffscreenCanvas as (new (w: number, h: number) => OffscreenCanvas) | undefined;
    if (!OffscreenCanvasCtor || typeof createImageBitmap !== "function") return null;
    const off = new OffscreenCanvasCtor(width, height);
    const ctx = off.getContext("2d");
    if (!ctx) return null;
    const img = new ImageData(new Uint8ClampedArray(rgba), width, height);
    ctx.putImageData(img, 0, 0);
    return await createImageBitmap(off);
  } catch {
    return null;
  }
}

self.onmessage = async (ev: MessageEvent<Msg>) => {
  try {
    const msg = ev.data;
    if (msg.type === "init") {
      buf = msg.buf;
      ifds = UTIF.decode(buf);
      if (!ifds || ifds.length === 0) throw new Error("No frames found in TIFF");
      const first = ifds[0] as { width?: unknown; height?: unknown };
      w = getNumber(first.width, 0);
      h = getNumber(first.height, 0);
      const resp: ReadyResp = { type: "ready", sliceCount: ifds.length, width: w, height: h };
      self.postMessage(resp);
      return;
    }

    if (msg.type === "slice") {
      if (!buf || !ifds) throw new Error("Worker not initialized");
      const idx = msg.idx;
      if (idx < 0 || idx >= ifds.length) throw new Error("Slice index out of range");
      const ifd = ifds[idx];
      UTIF.decodeImage(buf, ifd);
      const rgbaU8 = UTIF.toRGBA8(ifd);
      const meta = ifd as { width?: unknown; height?: unknown };
      const width = getNumber(meta.width, w);
      const height = getNumber(meta.height, h);
      const rgba = new Uint8ClampedArray(rgbaU8);
      const bitmap = await rgbaToBitmap(rgba, width, height);
      const resp: SliceResp = bitmap
        ? { type: "slice", idx, width, height, bitmap }
        : { type: "slice", idx, width, height, rgba };

      if (bitmap) {
        (self as unknown as WorkerScope).postMessage(resp, [bitmap]);
      } else {
        (self as unknown as WorkerScope).postMessage(resp, [rgba.buffer]);
      }
    }
  } catch (e) {
    const resp: ErrorResp = { type: "error", message: e instanceof Error ? e.message : "Worker error" };
    (self as unknown as WorkerScope).postMessage(resp);
  }
};

