declare module "utif" {
  export type UTIFIFD = Record<string, unknown> & { width?: unknown; height?: unknown };

  export function decode(buf: ArrayBuffer): UTIFIFD[];
  export function decodeImage(buf: ArrayBuffer, ifd: UTIFIFD): void;
  export function toRGBA8(ifd: UTIFIFD): Uint8Array;

  const UTIF: {
    decode: typeof decode;
    decodeImage: typeof decodeImage;
    toRGBA8: typeof toRGBA8;
  };
  export default UTIF;
}

