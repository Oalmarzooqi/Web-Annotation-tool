import * as dicomParser from "dicom-parser";

type WorkerScope = typeof self & { postMessage: (message: unknown, transfer?: Transferable[]) => void };

type InitMsg = { type: "init"; buf: ArrayBuffer };
type SliceMsg = { type: "slice"; idx: number };
type Msg = InitMsg | SliceMsg;

type ReadyResp = { type: "ready"; sliceCount: number; width: number; height: number };
type SliceResp = {
  type: "slice";
  idx: number;
  width: number;
  height: number;
  bitmap?: ImageBitmap;
  rgba?: Uint8ClampedArray;
};
type ErrorResp = { type: "error"; message: string };

/** Uncompressed transfer syntaxes we decode in-process (raw Pixel Data). */
const RAW_SYNTAX = new Set([
  "1.2.840.10008.1.2", // Implicit VR Little Endian
  "1.2.840.10008.1.2.1", // Explicit VR Little Endian
  "1.2.840.10008.1.2.2", // Explicit VR Big Endian (still raw OW)
]);

type FrameMeta = {
  rows: number;
  cols: number;
  numFrames: number;
  bitsAllocated: number;
  bitsStored: number;
  samplesPerPixel: number;
  pixelRepresentation: number;
  photometric: string;
  planarConfiguration: number;
  rescaleSlope: number;
  rescaleIntercept: number;
  windowCenter: number | null;
  windowWidth: number | null;
  dataOffset: number;
  frameSizeBytes: number;
  bigEndian: boolean;
};

let buf: ArrayBuffer | null = null;
let meta: FrameMeta | null = null;

function numFromDs(dataSet: dicomParser.DataSet, tag: string, fallback: number) {
  try {
    const s = dataSet.string(tag);
    if (s != null && s !== "") {
      const n = parseFloat(s);
      if (Number.isFinite(n)) return n;
    }
  } catch {
    /* optional */
  }
  try {
    const u = dataSet.uint16(tag);
    if (u != null && Number.isFinite(u)) return u;
  } catch {
    /* optional */
  }
  return fallback;
}

function parseFrameMeta(dataSet: dicomParser.DataSet): FrameMeta {
  const transferSyntax = dataSet.string("x00020010") ?? "";
  if (!RAW_SYNTAX.has(transferSyntax)) {
    if (transferSyntax.startsWith("1.2.840.10008.1.2.4.") || transferSyntax.includes("1.2.840.10008.1.2.4.")) {
      throw new Error(
        "Compressed DICOM (JPEG / JPEG-LS / RLE) is not supported in-browser yet. Re-export as Explicit VR Little Endian uncompressed, or use TIFF.",
      );
    }
    throw new Error(`Unsupported transfer syntax: ${transferSyntax || "(missing)"}`);
  }

  const rows = dataSet.uint16("x00280010");
  const cols = dataSet.uint16("x00280011");
  if (!rows || !cols) throw new Error("Missing Rows/Columns in DICOM");

  const bitsAllocated = dataSet.uint16("x00280100") ?? 16;
  const bitsStored = dataSet.uint16("x00280101") ?? bitsAllocated;
  const samplesPerPixel = dataSet.uint16("x00280002") ?? 1;
  const pixelRepresentation = dataSet.uint16("x00280103") ?? 0;
  const photometric = (dataSet.string("x00280004") ?? "MONOCHROME2").trim();
  const planarConfiguration = dataSet.uint16("x00280006") ?? 0;

  let numFrames = 1;
  const nfStr = dataSet.string("x00280008");
  if (nfStr) {
    const n = parseInt(nfStr, 10);
    if (Number.isFinite(n) && n > 0) numFrames = n;
  }

  const rescaleSlope = numFromDs(dataSet, "x00281053", 1);
  const rescaleIntercept = numFromDs(dataSet, "x00281052", 0);

  let windowCenter: number | null = null;
  let windowWidth: number | null = null;
  try {
    const wc = dataSet.string("x00281050");
    const ww = dataSet.string("x00281051");
    if (wc) windowCenter = parseFloat(wc.split("\\")[0]!);
    if (ww) windowWidth = parseFloat(ww.split("\\")[0]!);
  } catch {
    /* optional */
  }

  const pixelEl = dataSet.elements.x7fe00010;
  if (!pixelEl) throw new Error("DICOM has no Pixel Data element");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const frags = (pixelEl as any).fragments as unknown[] | undefined;
  if (frags && frags.length > 0) {
    throw new Error(
      "Encapsulated / compressed Pixel Data is not supported yet. Use uncompressed Explicit VR Little Endian, or TIFF.",
    );
  }

  const bigEndian = transferSyntax === "1.2.840.10008.1.2.2";
  const bytesPerSample = Math.ceil(bitsAllocated / 8);
  const bytesPerPixel = samplesPerPixel * bytesPerSample;
  const frameSizeBytes = rows * cols * bytesPerPixel;

  if (planarConfiguration !== 0 && samplesPerPixel > 1) {
    throw new Error("Planar color DICOM not supported yet (use interleaved RGB or grayscale).");
  }

  const rawLen = pixelEl.length ?? 0;
  const expectedTotal = frameSizeBytes * numFrames;
  if (rawLen < frameSizeBytes) {
    throw new Error("Pixel Data shorter than one frame (corrupt or unsupported layout).");
  }
  if (rawLen < expectedTotal - 1) {
    const altFrames = Math.max(1, Math.floor(rawLen / frameSizeBytes));
    numFrames = altFrames;
  }

  return {
    rows,
    cols,
    numFrames,
    bitsAllocated,
    bitsStored,
    samplesPerPixel,
    pixelRepresentation,
    photometric,
    planarConfiguration,
    rescaleSlope,
    rescaleIntercept,
    windowCenter,
    windowWidth,
    dataOffset: pixelEl.dataOffset,
    frameSizeBytes,
    bigEndian,
  };
}

function readSampleU16(
  view: DataView,
  byteOffset: number,
  littleEndian: boolean,
): number {
  return view.getUint16(byteOffset, littleEndian);
}

function readSampleS16(
  view: DataView,
  byteOffset: number,
  littleEndian: boolean,
): number {
  return view.getInt16(byteOffset, littleEndian);
}

function frameToRgba(buf: ArrayBuffer, m: FrameMeta, frameIdx: number): Uint8ClampedArray {
  const { rows, cols, frameSizeBytes, dataOffset, bitsAllocated, samplesPerPixel, photometric, pixelRepresentation } = m;
  const start = dataOffset + frameIdx * frameSizeBytes;
  const end = start + frameSizeBytes;
  const ab = buf instanceof ArrayBuffer ? buf : (buf as ArrayBuffer).slice(0);
  const total = ab.byteLength;
  if (end > total) throw new Error("Frame read out of range");

  const out = new Uint8ClampedArray(rows * cols * 4);
  const littleEndian = !m.bigEndian;
  const view = new DataView(ab, start, frameSizeBytes);

  if (bitsAllocated === 8 && samplesPerPixel === 1) {
    const src = new Uint8Array(ab, start, rows * cols);
    let min = 255;
    let max = 0;
    for (let i = 0; i < src.length; i++) {
      const v = src[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min || 1;
    const invert = photometric === "MONOCHROME1";
    for (let i = 0; i < src.length; i++) {
      let g = (src[i]! - min) / range;
      if (invert) g = 1 - g;
      const gv = Math.round(g * 255);
      const o = i * 4;
      out[o] = gv;
      out[o + 1] = gv;
      out[o + 2] = gv;
      out[o + 3] = 255;
    }
    return out;
  }

  if (bitsAllocated === 16 && samplesPerPixel === 1) {
    const n = rows * cols;
    const tmp = new Float64Array(n);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const o = i * 2;
      const raw =
        pixelRepresentation === 1
          ? readSampleS16(view, o, littleEndian)
          : readSampleU16(view, o, littleEndian);
      const v = raw * m.rescaleSlope + m.rescaleIntercept;
      tmp[i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    let wMin = min;
    let wMax = max;
    if (m.windowCenter != null && m.windowWidth != null && m.windowWidth > 0) {
      wMin = m.windowCenter - m.windowWidth / 2;
      wMax = m.windowCenter + m.windowWidth / 2;
    }
    const range = wMax - wMin || 1;
    const invert = photometric === "MONOCHROME1";
    for (let i = 0; i < n; i++) {
      let g = (tmp[i]! - wMin) / range;
      g = Math.max(0, Math.min(1, g));
      if (invert) g = 1 - g;
      const gv = Math.round(g * 255);
      const o = i * 4;
      out[o] = gv;
      out[o + 1] = gv;
      out[o + 2] = gv;
      out[o + 3] = 255;
    }
    return out;
  }

  if (bitsAllocated === 8 && samplesPerPixel === 3 && photometric === "RGB") {
    let p = 0;
    for (let i = 0; i < rows * cols; i++) {
      out[p++] = view.getUint8(i * 3);
      out[p++] = view.getUint8(i * 3 + 1);
      out[p++] = view.getUint8(i * 3 + 2);
      out[p++] = 255;
    }
    return out;
  }

  throw new Error(
    `Unsupported pixel layout: ${bitsAllocated}-bit, ${samplesPerPixel} sample(s), ${photometric}. Try 8/16-bit grayscale or 8-bit RGB.`,
  );
}

async function rgbaToBitmap(rgba: Uint8ClampedArray, width: number, height: number): Promise<ImageBitmap | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const OffscreenCanvasCtor = (globalThis as any).OffscreenCanvas as
      | (new (w: number, h: number) => OffscreenCanvas)
      | undefined;
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
      const byteArray = new Uint8Array(buf);
      const dataSet = dicomParser.parseDicom(byteArray);
      meta = parseFrameMeta(dataSet);
      const resp: ReadyResp = {
        type: "ready",
        sliceCount: meta.numFrames,
        width: meta.cols,
        height: meta.rows,
      };
      self.postMessage(resp);
      return;
    }

    if (msg.type === "slice") {
      if (!buf || !meta) throw new Error("DICOM worker not initialized");
      const idx = msg.idx;
      if (idx < 0 || idx >= meta.numFrames) throw new Error("Slice index out of range");
      const rgba = frameToRgba(buf, meta, idx);
      const width = meta.cols;
      const height = meta.rows;
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
    const resp: ErrorResp = { type: "error", message: e instanceof Error ? e.message : "DICOM worker error" };
    (self as unknown as WorkerScope).postMessage(resp);
  }
};
