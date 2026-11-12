"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { ArrowRight, Download, ImagePlus, Link2, Package, Plus, Share2, Sparkles, Trash2, X as XIcon } from "lucide-react";
import { Input } from "@/components/motion/input";
import { StatefulButton, type ButtonState } from "@/components/motion/button/stateful";
import { Button } from "@/components/motion/button/base";
import { Switch } from "@/components/motion/switch";
import { RangeSlider } from "@/components/motion/range-slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { Loader } from "@/components/motion/loader";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { ANIMATED_LIMIT, MAX_SECONDS, STATIC_LIMIT, STICKER_SIZE, drawFrame, loadFromBlob, makeSticker, type RenderOptions, type Source, type StickerResult } from "@/lib/dn/sticker";
import { zip } from "@/lib/dn/zip";
import { resolveLink } from "./Downloader";
import { fetchMedia } from "@/lib/dn/fetch-media";
import { useNotify, type StickerSeed } from "./DnTools";

const DEFAULTS: RenderOptions = { fit: "contain", padding: 16, caption: "", captionPosition: "bottom", outline: false };

type Packed = { id: string; result: StickerResult; url: string };

const kb = (n: number) => `${Math.round(n / 1024)} KB`;

export default function StickerMaker({ seed, onSeedUsed }: { seed: StickerSeed; onSeedUsed: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [videoStart, setVideoStart] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [source, setSource] = useState<Source | null>(null);
  const [opts, setOpts] = useState<RenderOptions>(DEFAULTS);
  const [link, setLink] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<(StickerResult & { url: string }) | null>(null);
  const [pack, setPack] = useState<Packed[]>([]);
  const [packTitle, setPackTitle] = useState("My stickers");
  const [linkState, setLinkState] = useState<ButtonState>("idle");
  const startRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const notify = useNotify();

  /* ------------------------------------------------------------ loading */
  const load = useCallback(async (b: Blob, start = 0) => {
    setError(null);
    setResult(null);
    setStatus(b.type.startsWith("video/") ? "Reading video frames…" : "Reading image…");
    try {
      if (b.type.startsWith("video/")) {
        const d = await videoLength(b);
        setVideoDuration(d);
      } else setVideoDuration(0);
      const src = await loadFromBlob(b, { start, fps: 12 });
      setSource((old) => {
        old?.frames.forEach((f) => f.image.close());
        return src;
      });
      setBlob(b);
    } catch (e) {
      setError((e as Error).message || "Couldn't read that file.");
    } finally {
      setStatus(null);
    }
  }, []);

  const fromUrl = useCallback(
    async (item: { src: string; direct?: string }, typeHint?: string) => {
      setStatus("Fetching media…");
      const res = await fetchMedia(item);
      if (!res.ok) throw new Error("Couldn't download that media. Paste the link again.");
      const raw = await res.blob();
      const type = raw.type && raw.type !== "application/octet-stream" ? raw.type : (typeHint ?? "video/mp4");
      setVideoStart(0);
      startRef.current = 0;
      await load(raw.slice(0, raw.size, type));
    },
    [load],
  );

  // Seed from the downloader's "Make sticker" button.
  useEffect(() => {
    if (!seed) return;
    fromUrl(seed, seed.type).catch((e) => setError(e.message));
    onSeedUsed();
  }, [seed, fromUrl, onSeedUsed]);

  const onDrop = useCallback(
    (files: File[]) => {
      if (files[0]) {
        setVideoStart(0);
        startRef.current = 0;
        load(files[0]);
      }
    },
    [load],
  );
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    noClick: !!source,
    multiple: false,
    accept: { "image/*": [], "video/mp4": [], "video/webm": [], "video/quicktime": [] },
  });

  const submitLink = async () => {
    if (!link.trim()) return;
    setError(null);
    setLinkState("loading");
    setStatus("Looking up link…");
    try {
      const media = await resolveLink(link);
      const pick =
        media.items.filter((i) => i.type === "gif").sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0))[0] ??
        media.items.filter((i) => i.type === "image")[0] ??
        media.items.filter((i) => i.type === "video").sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0))[0];
      if (!pick) throw new Error("No GIF, image or video found at that link.");
      await fromUrl(pick, pick.type === "image" ? "image/jpeg" : "video/mp4");
      setLinkState("success");
    } catch (e) {
      setError((e as Error).message);
      setLinkState("error");
      setStatus(null);
    } finally {
      setTimeout(() => setLinkState("idle"), 1400);
    }
  };

  // Reload frames when the start offset settles (videos longer than 10s).
  useEffect(() => {
    if (!blob || !blob.type.startsWith("video/") || videoStart === startRef.current) return;
    const t = setTimeout(() => {
      startRef.current = videoStart;
      load(blob, videoStart);
    }, 450);
    return () => clearTimeout(t);
  }, [videoStart, blob, load]);

  // Paste an image straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
      if (file) {
        e.preventDefault();
        load(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [load]);

  /* ------------------------------------------------------------ live preview */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    const ctx = canvas.getContext("2d")!;
    let i = 0;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const f = source.frames[i];
      if (now - last >= f.delay || i === 0) {
        drawFrame(ctx, f.image, source, opts);
        if (source.animated && now - last >= f.delay) {
          i = (i + 1) % source.frames.length;
          last = now;
        }
      }
      if (source.animated) raf = requestAnimationFrame(tick);
    };
    drawFrame(ctx, source.frames[0].image, source, opts);
    if (source.animated) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [source, opts]);

  // Any option change invalidates the last export.
  useEffect(() => setResult(null), [opts, source]);

  /* ------------------------------------------------------------ export */
  const generate = async () => {
    if (!source) return;
    setError(null);
    setProgress(0);
    try {
      let last = -1;
      const r = await makeSticker(source, opts, (p) => {
        const pct = Math.round(p * 100);
        if (pct !== last) {
          last = pct;
          setProgress(pct / 100);
        }
      });
      setResult({ ...r, url: URL.createObjectURL(r.blob) });
      notify(
        r.fits
          ? { title: "Sticker ready", description: `${kb(r.bytes)}${r.animated ? ` · ${r.frames} frames` : ""}`, status: "success" }
          : { title: "A bit too big for WhatsApp", description: `${kb(r.bytes)} of ${kb(r.animated ? ANIMATED_LIMIT : STATIC_LIMIT)}`, status: "error" },
      );
    } catch (e) {
      setError((e as Error).message || "Encoding failed.");
    } finally {
      setProgress(null);
    }
  };

  const file = (r: StickerResult, name = "sticker") => new File([r.blob], `${name}.webp`, { type: "image/webp" });
  const canShare = typeof navigator !== "undefined" && !!navigator.canShare && result ? navigator.canShare({ files: [file(result)] }) : false;

  const share = async () => {
    if (!result) return;
    try {
      await navigator.share({ files: [file(result)] });
    } catch {
      // user cancelled
    }
  };

  const addToPack = () => {
    if (!result || pack.length >= 30) return;
    setPack((p) => [...p, { id: crypto.randomUUID(), result, url: result.url }]);
    notify({ title: "Added to pack", description: `${pack.length + 1} of 30${pack.length + 1 < 3 ? ", packs need 3+" : ""}`, status: "success" });
  };

  const exportPack = async () => {
    const tray = await trayIcon(pack[0].result.blob);
    const files = [
      { name: "title.txt", data: new TextEncoder().encode(packTitle.trim() || "My stickers") },
      { name: "author.txt", data: new TextEncoder().encode("dn.bravian.site") },
      { name: "tray.png", data: tray },
      ...(await Promise.all(pack.map(async (p, i) => ({ name: `${String(i + 1).padStart(2, "0")}.webp`, data: new Uint8Array(await p.result.blob.arrayBuffer()) })))),
    ];
    const out = zip(files);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(out);
    a.download = `${(packTitle.trim() || "stickers").replace(/[^\w-]+/g, "_")}.wastickers`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    notify({ title: "Pack exported", description: "Open it with a WhatsApp sticker loader app.", status: "success" });
  };

  const set = <K extends keyof RenderOptions>(k: K, v: RenderOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const limit = source?.animated ? ANIMATED_LIMIT : STATIC_LIMIT;

  /* ------------------------------------------------------------ view */
  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitLink();
        }}
        className="flex gap-3"
      >
        <Input
          type="url"
          inputMode="url"
          aria-label="X GIF link"
          placeholder="Paste an X GIF link…"
          value={link}
          onChange={setLink}
          leftIcon={<Link2 />}
          className="min-w-0 flex-1"
          classNames={{ field: "h-14 bg-card shadow-sm" }}
        />
        <StatefulButton
          type="submit"
          size="lg"
          state={linkState}
          disabled={!link.trim() || (!!status && linkState !== "loading")}
          loadingText="Loading"
          successText="Loaded"
          icon={<ArrowRight className="size-4" />}
          className="h-14 px-6 font-bold"
        >
          Load
        </StatefulButton>
      </form>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)] lg:gap-10">
        {/* Canvas / dropzone */}
        <div
          {...getRootProps()}
          className={`relative aspect-square overflow-hidden rounded-2xl border-2 border-dashed transition-colors ${
            isDragActive ? "border-foreground bg-accent/20" : source ? "border-transparent" : "cursor-pointer border-border hover:border-foreground/40"
          }`}
          style={{
            backgroundColor: "#fff",
            backgroundImage: "linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)",
            backgroundSize: "24px 24px",
            backgroundPosition: "0 0,0 12px,12px -12px,-12px 0",
          }}
        >
          <input {...getInputProps()} />
          <canvas ref={canvasRef} width={STICKER_SIZE} height={STICKER_SIZE} className={`size-full ${source ? "" : "hidden"}`} aria-label="Sticker preview" />
          {!source && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <ImagePlus className="size-10 text-muted-foreground" />
              <p className="font-semibold">Drop an image, GIF or short video</p>
              <p className="text-sm text-muted-foreground">or tap to choose · or paste from clipboard</p>
            </div>
          )}
          {status && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/80 text-sm font-semibold backdrop-blur-sm">
              <Loader variant="dot-matrix" size={36} label={status} />
              <TextShimmer>{status}</TextShimmer>
            </div>
          )}
          {source && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                open();
              }}
              className="absolute right-3 top-3 rounded-full bg-foreground/80 px-3 py-1.5 text-xs font-semibold text-background backdrop-blur hover:bg-foreground"
            >
              Replace
            </button>
          )}
        </div>

        {/* Controls */}
        <div className="space-y-5">
          <fieldset disabled={!source} className="space-y-5 disabled:opacity-50">
            <Segmented
              label="Fit"
              value={opts.fit}
              options={[
                ["contain", "Whole image"],
                ["cover", "Fill square"],
              ]}
              onChange={(v) => set("fit", v as RenderOptions["fit"])}
            />

            <div>
              <span className="mb-2 flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Padding <span className="tabular-nums">{opts.padding}px</span>
              </span>
              <RangeSlider min={0} max={64} step={8} value={opts.padding} onValueChange={(v) => set("padding", v)} aria-label="Padding" formatValueText={(v) => `${v} pixels`} />
            </div>

            <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
              <span className="text-sm font-semibold">White sticker outline</span>
              <Switch checked={opts.outline} onCheckedChange={(v) => set("outline", v)} ariaLabel="White sticker outline" />
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-bold uppercase tracking-widest text-muted-foreground">Caption</span>
              <input
                type="text"
                maxLength={40}
                placeholder="Optional text"
                value={opts.caption}
                onChange={(e) => set("caption", e.target.value)}
                className="w-full rounded-full border bg-card px-4 py-3 text-base outline-none transition-shadow focus:border-foreground/40 focus:ring-2 focus:ring-ring/40"
              />
              {opts.caption && (
                <Segmented
                  value={opts.captionPosition}
                  options={[
                    ["top", "Top"],
                    ["bottom", "Bottom"],
                  ]}
                  onChange={(v) => set("captionPosition", v as RenderOptions["captionPosition"])}
                />
              )}
            </div>

            {videoDuration > MAX_SECONDS && blob && (
              <div>
                <span className="mb-2 flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Start at <span className="tabular-nums">{videoStart.toFixed(0)}s</span>
                </span>
                <RangeSlider
                  min={0}
                  max={Math.max(1, Math.floor(videoDuration - 1))}
                  step={1}
                  showTicks={videoDuration <= 40}
                  value={videoStart}
                  onValueChange={setVideoStart}
                  aria-label="Start time"
                  formatValueText={(v) => `${v} seconds`}
                />
                <span className="mt-2 block text-xs text-muted-foreground">WhatsApp stickers can be up to {MAX_SECONDS}s long.</span>
              </div>
            )}
          </fieldset>

          <StatefulButton
            onClick={generate}
            size="lg"
            state={progress !== null ? "loading" : "idle"}
            disabled={!source || !!status}
            loadingText="Encoding"
            icon={<Sparkles className="size-4" />}
            className="h-14 w-full font-bold"
          >
            Make {source?.animated ? "animated " : ""}sticker
          </StatefulButton>
          {progress !== null && (
            <div className="-mt-2 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Encoding progress" aria-valuenow={Math.round(progress * 100)}>
              <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}

          {result && (
            <div className="animate-slide-up space-y-3 rounded-2xl border bg-card p-4">
              <p className="text-sm">
                <span className={`mr-2 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${result.fits ? "bg-accent text-accent-foreground" : "bg-destructive/10 text-destructive"}`}>
                  {kb(result.bytes)} / {kb(limit)}
                </span>
                {result.fits ? "Ready for WhatsApp." : "Still over WhatsApp's size limit. Try Fill square, less padding, or a shorter clip."}
                {result.animated && <span className="text-muted-foreground"> {result.frames} frames.</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                {canShare && (
                  <Button onClick={share} className="bg-[#25D366] font-bold text-[#0b2e17] hover:bg-[#25D366]/90">
                    <Share2 className="size-4" /> Send to WhatsApp
                  </Button>
                )}
                <a href={result.url} download="sticker.webp" className="inline-flex h-10 items-center gap-2 rounded-full border px-5 text-sm font-semibold transition-colors hover:bg-muted/60 active:scale-[0.97]">
                  <Download className="size-4" /> Download .webp
                </a>
                <Button variant="outline" onClick={addToPack} disabled={pack.length >= 30} className="font-semibold">
                  <Plus className="size-4" /> Add to pack
                </Button>
              </div>
              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer font-semibold text-foreground">How do I save it in WhatsApp?</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>
                    <b>Phone:</b> tap <i>Send to WhatsApp</i> and pick any chat (even your own number). It arrives as a sticker. Tap it, then <i>Add to Favorites</i>.
                  </li>
                  <li>
                    <b>WhatsApp Web / Desktop:</b> open the sticker picker, then <i>Create</i>, then upload the .webp.
                  </li>
                  <li>
                    <b>A whole pack:</b> add 3 or more stickers to a pack, export the <code>.wastickers</code> file, and open it with a sticker loader app to add the full pack to your tray.
                  </li>
                </ul>
              </details>
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>

      {pack.length > 0 && (
        <section className="space-y-4 rounded-2xl border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <Package className="size-5" /> Pack <span className="text-sm font-normal text-muted-foreground">{pack.length}/30</span>
            </h2>
            <input
              value={packTitle}
              onChange={(e) => setPackTitle(e.target.value)}
              maxLength={128}
              aria-label="Pack name"
              className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-foreground sm:max-w-60"
            />
          </div>
          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-10">
            {pack.map((p) => (
              <li key={p.id} className="group relative aspect-square rounded-xl bg-secondary p-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="Sticker in pack" className="size-full object-contain" />
                <button
                  onClick={() => setPack((all) => all.filter((x) => x.id !== p.id))}
                  aria-label="Remove from pack"
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground p-1 text-background opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <XIcon className="size-3" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={exportPack} disabled={pack.length < 3} className="font-bold">
              <Download className="size-4" /> Export .wastickers
            </Button>
            <Button variant="ghost" onClick={() => setPack([])} className="font-semibold">
              <Trash2 className="size-4" /> Clear
            </Button>
            {pack.length < 3 && <span className="text-xs text-muted-foreground">WhatsApp packs need at least 3 stickers.</span>}
          </div>
        </section>
      )}
    </div>
  );
}

function Segmented({ label, value, options, onChange }: { label?: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div>
      {label && <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>}
      <Tabs value={value} onValueChange={onChange} variant="segment" className="w-full">
        <TabsList aria-label={label} className="w-full">
          {options.map(([v, l]) => (
            <TabsTrigger key={v} value={v} className="flex-1">
              {l}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}

function videoLength(b: Blob) {
  return new Promise<number>((res) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(b);
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      res(v.duration || 0);
    };
    v.onerror = () => res(0);
    v.src = url;
  });
}

// WhatsApp tray icons are 96x96 PNG.
async function trayIcon(sticker: Blob) {
  const img = await createImageBitmap(sticker);
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  c.getContext("2d")!.drawImage(img, 0, 0, 96, 96);
  const png = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
  return new Uint8Array(await png.arrayBuffer());
}
