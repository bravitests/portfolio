"use client";

// Browser-side WhatsApp sticker maker.
// Sources (image, GIF, video/MP4 from X GIFs) are decoded into frames, drawn on a
// 512x512 transparent canvas, encoded to WebP and, for animations, muxed into
// an animated WebP. Everything runs on the visitor's device.

import { parseGIF, decompressFrames } from "gifuct-js";

export const STICKER_SIZE = 512;
export const STATIC_LIMIT = 100 * 1024;
export const ANIMATED_LIMIT = 500 * 1024;
export const MAX_SECONDS = 10;

export type Frame = { image: ImageBitmap; delay: number };
export type Source = { width: number; height: number; frames: Frame[]; animated: boolean; duration: number };

export type RenderOptions = {
  fit: "contain" | "cover";
  padding: number; // px on the 512 canvas
  caption: string;
  captionPosition: "top" | "bottom";
  outline: boolean; // white sticker border around the subject
};

/* ---------------------------------------------------------------- decoding */

export async function loadFromBlob(blob: Blob, opts: { fps?: number; start?: number } = {}): Promise<Source> {
  const type = blob.type || "";
  if (type === "image/gif") return loadGif(blob);
  if (type.startsWith("video/")) return loadVideo(blob, opts.fps ?? 12, opts.start ?? 0);
  return loadImage(blob);
}

async function loadImage(blob: Blob): Promise<Source> {
  const image = await createImageBitmap(blob);
  return { width: image.width, height: image.height, frames: [{ image, delay: 0 }], animated: false, duration: 0 };
}

async function loadGif(blob: Blob): Promise<Source> {
  const gif = parseGIF(await blob.arrayBuffer());
  const parsed = decompressFrames(gif, true);
  if (parsed.length <= 1) return loadImage(blob);

  const { width, height } = gif.lsd;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const patch = document.createElement("canvas");
  const pctx = patch.getContext("2d")!;

  const frames: Frame[] = [];
  let elapsed = 0;
  let restore: ImageData | null = null;

  for (const f of parsed) {
    const { left, top, width: w, height: h } = f.dims;
    if (f.disposalType === 3) restore = ctx.getImageData(0, 0, width, height);

    patch.width = w;
    patch.height = h;
    const data = pctx.createImageData(w, h);
    data.data.set(f.patch);
    pctx.putImageData(data, 0, 0);
    ctx.drawImage(patch, left, top);

    const delay = Math.max(20, f.delay || 100);
    frames.push({ image: await createImageBitmap(canvas), delay });
    elapsed += delay;

    if (f.disposalType === 2) ctx.clearRect(left, top, w, h);
    else if (f.disposalType === 3 && restore) ctx.putImageData(restore, 0, 0);

    if (elapsed >= MAX_SECONDS * 1000) break;
  }
  return { width, height, frames, animated: true, duration: elapsed };
}

async function loadVideo(blob: Blob, fps: number, start: number): Promise<Source> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((res, rej) => {
      video.onloadeddata = () => res();
      video.onerror = () => rej(new Error("This browser can't read that video."));
    });
    const end = Math.min(video.duration || MAX_SECONDS, start + MAX_SECONDS);
    const step = 1 / fps;
    const delay = Math.round(1000 / fps);
    const frames: Frame[] = [];
    for (let t = Math.max(0, start); t < end - step / 2; t += step) {
      await seek(video, t);
      frames.push({ image: await createImageBitmap(video), delay });
    }
    if (!frames.length) {
      await seek(video, 0);
      frames.push({ image: await createImageBitmap(video), delay });
    }
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      frames,
      animated: frames.length > 1,
      duration: frames.length * delay,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function seek(video: HTMLVideoElement, t: number) {
  return new Promise<void>((res) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      res();
    };
    video.addEventListener("seeked", done);
    video.currentTime = t;
  });
}

/* --------------------------------------------------------------- rendering */

export function drawFrame(ctx: CanvasRenderingContext2D, image: CanvasImageSource, src: { width: number; height: number }, o: RenderOptions) {
  const S = STICKER_SIZE;
  ctx.clearRect(0, 0, S, S);

  const captionSpace = o.caption.trim() ? 96 : 0;
  const box = S - o.padding * 2;
  const boxH = box - (o.fit === "contain" ? captionSpace : 0);
  const scale = o.fit === "cover" ? Math.max(box / src.width, box / src.height) : Math.min(box / src.width, boxH / src.height);
  const w = src.width * scale;
  const h = src.height * scale;
  const x = (S - w) / 2;
  let y = (S - h) / 2;
  if (o.fit === "contain" && captionSpace) y += o.captionPosition === "top" ? captionSpace / 2 : -captionSpace / 2;

  ctx.save();
  if (o.fit === "cover") {
    ctx.beginPath();
    ctx.roundRect(o.padding, o.padding, box, box, 48);
    ctx.clip();
  }
  if (o.outline) {
    // Fake die-cut border: draw the silhouette offset in a ring, tinted white.
    const ring = 8;
    const tmp = document.createElement("canvas");
    tmp.width = S;
    tmp.height = S;
    const t = tmp.getContext("2d")!;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      t.drawImage(image, x + Math.cos(a) * ring, y + Math.sin(a) * ring, w, h);
    }
    t.globalCompositeOperation = "source-in";
    t.fillStyle = "#fff";
    t.fillRect(0, 0, S, S);
    ctx.drawImage(tmp, 0, 0);
  }
  ctx.drawImage(image, x, y, w, h);
  ctx.restore();

  const text = o.caption.trim();
  if (text) {
    let size = 64;
    ctx.font = `900 ${size}px Inter, system-ui, sans-serif`;
    while (ctx.measureText(text).width > S - 40 && size > 24) {
      size -= 4;
      ctx.font = `900 ${size}px Inter, system-ui, sans-serif`;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = o.captionPosition === "top" ? "top" : "bottom";
    const ty = o.captionPosition === "top" ? 20 : S - 20;
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(8, size / 5);
    ctx.strokeStyle = "#000";
    ctx.strokeText(text, S / 2, ty);
    ctx.fillStyle = "#fff";
    ctx.fillText(text, S / 2, ty);
  }
}

/* ---------------------------------------------------------------- encoding */

let nativeWebp: boolean | null = null;
function hasNativeWebp() {
  if (nativeWebp === null) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    nativeWebp = c.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return nativeWebp;
}

let wasmReady: Promise<(d: ImageData, o: { quality: number; alpha_quality?: number }) => Promise<ArrayBuffer>> | null = null;
function wasmEncoder() {
  wasmReady ??= (async () => {
    const mod = await import("@jsquash/webp/encode");
    await mod.init({ locateFile: (p: string) => `/dn-wasm/${p}` });
    return (d: ImageData, o: { quality: number; alpha_quality?: number }) => mod.default(d, o);
  })();
  return wasmReady;
}

async function encodeCanvas(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  if (hasNativeWebp()) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", quality));
    if (blob) return new Uint8Array(await blob.arrayBuffer());
  }
  const enc = await wasmEncoder();
  const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  return new Uint8Array(await enc(data, { quality: Math.round(quality * 100), alpha_quality: 90 }));
}

/* ---------------------------------------------------------- animated muxing */

type Chunk = { fourcc: string; data: Uint8Array };

function readChunks(webp: Uint8Array): Chunk[] {
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const chunks: Chunk[] = [];
  let p = 12; // skip "RIFF" size "WEBP"
  while (p + 8 <= webp.length) {
    const fourcc = String.fromCharCode(...webp.subarray(p, p + 4));
    const size = view.getUint32(p + 4, true);
    chunks.push({ fourcc, data: webp.subarray(p + 8, p + 8 + size) });
    p += 8 + size + (size & 1);
  }
  return chunks;
}

function u24(n: number) {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
}

function chunk(fourcc: string, data: Uint8Array | number[]): Uint8Array {
  const body = data instanceof Uint8Array ? data : new Uint8Array(data);
  const pad = body.length & 1;
  const out = new Uint8Array(8 + body.length + pad);
  for (let i = 0; i < 4; i++) out[i] = fourcc.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function muxAnimated(frames: { webp: Uint8Array; delay: number }[], size: number): Uint8Array {
  const vp8x = chunk("VP8X", [0x10 | 0x02, 0, 0, 0, ...u24(size - 1), ...u24(size - 1)]);
  const anim = chunk("ANIM", [0, 0, 0, 0, 0, 0]); // transparent background, loop forever
  const anmfs = frames.map(({ webp, delay }) => {
    const payload = readChunks(webp)
      .filter((c) => c.fourcc === "ALPH" || c.fourcc === "VP8 " || c.fourcc === "VP8L")
      .map((c) => chunk(c.fourcc, c.data));
    const header = new Uint8Array([...u24(0), ...u24(0), ...u24(size - 1), ...u24(size - 1), ...u24(Math.max(8, Math.round(delay))), 0x02]);
    return chunk("ANMF", concat([header, ...payload]));
  });
  const body = concat([new TextEncoder().encode("WEBP"), vp8x, anim, ...anmfs]);
  const riff = new Uint8Array(8);
  riff.set(new TextEncoder().encode("RIFF"));
  new DataView(riff.buffer).setUint32(4, body.length, true);
  return concat([riff, body]);
}

/* -------------------------------------------------------------- pipeline */

export type StickerResult = { blob: Blob; bytes: number; quality: number; frames: number; animated: boolean; fits: boolean };

export async function makeSticker(src: Source, o: RenderOptions, onProgress?: (p: number) => void): Promise<StickerResult> {
  const S = STICKER_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d", { willReadFrequently: !hasNativeWebp() })!;

  if (!src.animated) {
    drawFrame(ctx, src.frames[0].image, src, o);
    let best: Uint8Array | null = null;
    let q = 0.92;
    for (; q >= 0.2; q -= 0.12) {
      best = await encodeCanvas(canvas, q);
      if (best.length <= STATIC_LIMIT) break;
    }
    onProgress?.(1);
    const bytes = best!.length;
    return { blob: new Blob([best! as BlobPart], { type: "image/webp" }), bytes, quality: q, frames: 1, animated: false, fits: bytes <= STATIC_LIMIT };
  }

  // Animated: estimate the size of each (quality, frame-thinning) option from a
  // sample of frames, then do one full encode with the best option that fits.
  const qualities = [0.82, 0.7, 0.58, 0.46, 0.36, 0.28, 0.2];
  const sampleIdx = src.frames.map((_, i) => i).filter((i) => i % Math.max(1, Math.floor(src.frames.length / 8)) === 0);
  const sampleSize = new Map<number, number>(); // quality -> avg bytes/frame
  const avgAt = async (q: number) => {
    if (!sampleSize.has(q)) {
      let total = 0;
      for (const i of sampleIdx) {
        drawFrame(ctx, src.frames[i].image, src, o);
        total += (await encodeCanvas(canvas, q)).length;
      }
      sampleSize.set(q, total / sampleIdx.length);
    }
    return sampleSize.get(q)!;
  };
  const budget = ANIMATED_LIMIT * 0.9;
  const plans: { q: number; thin: number }[] = [];
  for (const thin of [1, 2, 3]) for (const q of qualities) plans.push({ q, thin });

  let step = 0;
  for (const plan of plans) {
    const count = Math.ceil(src.frames.length / plan.thin);
    if (count < 2 && plan.thin > 1) break;
    const est = (await avgAt(plan.q)) * count;
    onProgress?.(Math.min(0.3, (++step / plans.length) * 0.3));
    if (est > budget) continue;

    const frames = src.frames.filter((_, i) => i % plan.thin === 0).map((f) => ({ ...f, delay: f.delay * plan.thin }));
    const encoded: { webp: Uint8Array; delay: number }[] = [];
    let running = 0;
    for (let i = 0; i < frames.length; i++) {
      drawFrame(ctx, frames[i].image, src, o);
      const webp = await encodeCanvas(canvas, plan.q);
      encoded.push({ webp, delay: frames[i].delay });
      running += webp.length;
      onProgress?.(0.3 + 0.7 * ((i + 1) / frames.length));
      if (running > ANIMATED_LIMIT) break; // estimate was off, try the next plan
    }
    if (encoded.length === frames.length && running <= ANIMATED_LIMIT - 1024) {
      const out = muxAnimated(encoded, S);
      onProgress?.(1);
      return { blob: new Blob([out as BlobPart], { type: "image/webp" }), bytes: out.length, quality: plan.q, frames: frames.length, animated: true, fits: out.length <= ANIMATED_LIMIT };
    }
  }
  const frames = src.frames.filter((_, i) => i % 3 === 0).map((f) => ({ ...f, delay: f.delay * 3 }));
  // Last resort: lowest quality, whatever size it lands at.
  const encoded = [];
  for (const f of frames) {
    drawFrame(ctx, f.image, src, o);
    encoded.push({ webp: await encodeCanvas(canvas, 0.2), delay: f.delay });
  }
  const out = muxAnimated(encoded, S);
  onProgress?.(1);
  return { blob: new Blob([out as BlobPart], { type: "image/webp" }), bytes: out.length, quality: 0.2, frames: frames.length, animated: true, fits: out.length <= ANIMATED_LIMIT };
}
