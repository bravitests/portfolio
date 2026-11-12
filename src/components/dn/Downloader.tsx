"use client";

import { useState } from "react";
import { ArrowRight, ClipboardPaste, Link2, Sticker } from "lucide-react";
import { Input } from "@/components/motion/input";
import { StatefulButton, type ButtonState } from "@/components/motion/button/stateful";
import { Button } from "@/components/motion/button/base";
import type { StickerSeed } from "./DnTools";
import DownloadButton from "./DownloadButton";

export type ResolvedItem = {
  type: "video" | "gif" | "image";
  width?: number;
  height?: number;
  bitrate?: number;
  label?: string;
  name: string;
  src: string;
  // Platform CDN URL the browser can fetch directly (X, Instagram).
  direct?: string;
};

export type ResolvedMedia = {
  platform: "x" | "tiktok" | "instagram";
  id: string;
  title?: string;
  author?: string;
  thumbnail?: string;
  items: ResolvedItem[];
};

const PLATFORM: Record<ResolvedMedia["platform"], string> = { x: "X", tiktok: "TikTok", instagram: "Instagram" };

export async function resolveLink(url: string): Promise<ResolvedMedia> {
  const res = await fetch("/api/dn/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = await res.json().catch(() => ({ error: "Unexpected response." }));
  if (!res.ok) throw new Error(data.error ?? "Couldn't fetch that link.");
  return data;
}

function itemLabel(it: ResolvedItem) {
  const parts: string[] = [];
  if (it.height && it.width) parts.push(`${Math.min(it.width, it.height)}p`);
  if (it.label) parts.push(it.label);
  if (!parts.length) parts.push(it.type === "image" ? "Image" : it.type === "gif" ? "GIF (MP4)" : "Video");
  return parts.join(" · ");
}

const shortSide = (it: ResolvedItem) => (it.width && it.height ? Math.min(it.width, it.height) : 0);

// Recommended download: the best variant at or under 1080p (4K X uploads are 30-40 MB).
function recommended(group: ResolvedItem[]) {
  const sized = group.filter(shortSide);
  if (!sized.length) return group[0];
  return [...sized].filter((i) => shortSide(i) <= 1080).sort((a, b) => shortSide(b) - shortSide(a))[0] ?? sized.at(-1)!;
}

// Lightest variant that still looks fine in the inline preview.
function previewItem(group: ResolvedItem[]) {
  const sized = group.filter(shortSide);
  if (!sized.length) return group[0];
  return [...sized].filter((i) => shortSide(i) <= 720).sort((a, b) => shortSide(b) - shortSide(a))[0] ?? recommended(group);
}

// Group variants of the same media: X returns several bitrates per video.
function groupItems(items: ResolvedItem[]) {
  const groups: ResolvedItem[][] = [];
  for (const it of items) {
    const last = groups.at(-1);
    const sameMedia = last && last[0].type === it.type && it.type !== "image" && it.bitrate !== undefined && last[0].bitrate !== undefined && /-\d+\./.test(it.name);
    if (sameMedia && last.every((l) => l.bitrate !== it.bitrate)) last.push(it);
    else groups.push([it]);
  }
  return groups;
}

export default function Downloader({ onMakeSticker }: { onMakeSticker: (s: StickerSeed) => void }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<ResolvedMedia | null>(null);

  const submit = async (value = url) => {
    if (!value.trim()) return;
    setState("loading");
    setError(null);
    setMedia(null);
    try {
      setMedia(await resolveLink(value));
      setState("success");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    } finally {
      setTimeout(() => setState("idle"), 1400);
    }
  };

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        setUrl(text);
        submit(text);
      }
    } catch {
      setError("Clipboard access was blocked. Long-press the box and paste instead.");
    }
  };

  const groups = media ? groupItems(media.items) : [];
  const previewGroup = groups.find((g) => g[0].type !== "image") ?? groups[0];
  const preview = previewGroup ? previewItem(previewGroup) : undefined;

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
      >
        <Input
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-label="Link to an X, TikTok or Instagram post"
          placeholder="https://x.com/… · tiktok.com/… · instagram.com/reel/…"
          value={url}
          onChange={(v) => {
            setUrl(v);
            if (error) setError(null);
          }}
          error={error ?? undefined}
          leftIcon={<Link2 />}
          rightIcon={
            <button type="button" onClick={paste} aria-label="Paste from clipboard" title="Paste">
              <ClipboardPaste />
            </button>
          }
          className="min-w-0 flex-1"
          classNames={{ field: "h-14 bg-card shadow-sm", errorMessage: "text-sm px-5 pt-1" }}
        />
        <StatefulButton
          type="submit"
          size="lg"
          state={state}
          disabled={!url.trim()}
          loadingText="Fetching"
          successText="Found it"
          errorText="Try again"
          icon={<ArrowRight className="size-4" />}
          className="h-14 px-8 font-bold"
        >
          Get it
        </StatefulButton>
      </form>

      {media && (
        <article className="animate-slide-up overflow-hidden rounded-2xl border bg-card shadow-sm lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          {preview && preview.type !== "image" ? (
            <video
              src={preview.direct ?? preview.src}
              poster={media.thumbnail}
              controls
              playsInline
              loop={preview.type === "gif"}
              autoPlay={preview.type === "gif"}
              muted={preview.type === "gif"}
              className="max-h-[60vh] w-full bg-black object-contain lg:h-full lg:max-h-[72vh] lg:min-h-[420px]"
            />
          ) : preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.src} alt="" className="max-h-[60vh] w-full bg-secondary object-contain lg:h-full lg:max-h-[72vh]" />
          ) : null}

          <div className="space-y-4 p-5 lg:space-y-6 lg:p-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {PLATFORM[media.platform]}
                {media.author ? ` · ${media.author}` : ""}
              </p>
              {media.title && <p className="mt-1 line-clamp-2 text-sm lg:mt-2 lg:line-clamp-4 lg:text-base">{media.title}</p>}
            </div>

            {groups.map((group, gi) => (
              <div key={gi} className="space-y-2">
                {groups.length > 1 && (
                  <p className="text-xs font-semibold text-muted-foreground">
                    {group[0].type === "image" ? "Image" : group[0].type === "gif" ? "GIF" : "Video"} {gi + 1}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const best = recommended(group);
                    return [best, ...group.filter((it) => it !== best)].map((it) => (
                      <DownloadButton key={it.src} src={it.src} direct={it.direct} name={it.name} label={itemLabel(it)} primary={it === best} />
                    ));
                  })()}
                  {group[0].type !== "video" || media.platform === "x" ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        // Smallest variant is plenty for a 512px sticker.
                        const small = [...group].sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0))[0];
                        onMakeSticker({ src: small.src, direct: small.direct, type: small.type === "image" ? "image/jpeg" : "video/mp4", name: small.name });
                      }}
                      className="font-semibold"
                    >
                      <Sticker className="size-4" />
                      Make sticker
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </article>
      )}

      {!media && !error && (
        <ul className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          {[
            ["X / Twitter", "Videos, GIFs and photos from public posts"],
            ["TikTok", "Videos without the watermark, plus photo posts"],
            ["Instagram", "Public reels and posts"],
          ].map(([t, d]) => (
            <li key={t} className="rounded-xl border bg-card/60 p-4">
              <p className="font-semibold text-foreground">{t}</p>
              <p className="mt-1">{d}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
