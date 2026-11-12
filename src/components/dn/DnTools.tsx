"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Download, Sticker } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { TextCascade } from "@/components/motion/text-cascade";
import { AnimatedToastStack, useAnimatedToastStack, type ToastInput } from "@/components/motion/animated-toast-stack";
import Downloader from "./Downloader";
import StickerMaker from "./StickerMaker";

export type Tool = "download" | "sticker";
export type StickerSeed = { src: string; type: string; name: string } | null;

const NotifyContext = createContext<(t: ToastInput) => void>(() => {});
export const useNotify = () => useContext(NotifyContext);

const COPY: Record<Tool, { a: string; b: string; c: string; lead: string }> = {
  download: {
    a: "Paste a link,",
    b: "keep",
    c: "the video.",
    lead: "X, TikTok and Instagram reels. No watermark where the platform allows it, no sign-up.",
  },
  sticker: {
    a: "Any GIF or image,",
    b: "now",
    c: "a sticker.",
    lead: "Drop an image or GIF, or paste an X GIF link. You get a 512×512 WebP sized for WhatsApp.",
  },
};

export default function DnTools() {
  const [tool, setTool] = useState<Tool>("download");
  const [seed, setSeed] = useState<StickerSeed>(null);
  const { toasts, showToast, dismissToast } = useAnimatedToastStack({ limit: 3 });

  // Allow deep links like dn.bravian.site/?tool=sticker
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tool");
    if (t === "sticker" || t === "download") setTool(t);
  }, []);

  const pick = (t: Tool) => {
    setTool(t);
    const url = new URL(window.location.href);
    if (t === "download") url.searchParams.delete("tool");
    else url.searchParams.set("tool", t);
    window.history.replaceState(null, "", url);
  };

  const copy = COPY[tool];

  return (
    <NotifyContext.Provider value={showToast}>
      <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-4 pb-16 pt-8 sm:px-8 sm:pt-12 lg:px-12">
        <header className="mb-10 flex items-center justify-between">
          <a href="/" className="text-2xl font-black tracking-tighter" aria-label="dn home">
            dn<span className="ml-0.5 inline-block size-2.5 rounded-full bg-accent align-baseline" aria-hidden />
          </a>
          <a
            href="https://bravian.site"
            className="text-xs font-semibold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
          >
            by Bravian ↗
          </a>
        </header>

        <div className="mb-8 flex flex-col gap-6 lg:mb-10 lg:flex-row lg:items-end lg:justify-between">
          <section>
            <h1 className="text-4xl font-black leading-[0.95] tracking-tighter sm:text-6xl xl:text-7xl">
              <span className="sr-only">{`${copy.a} ${copy.b} ${copy.c}`}</span>
              <span aria-hidden className="block">
                <TextCascade text={copy.a} />
              </span>
              <span aria-hidden className="block">
                <TextCascade text={copy.b} className="font-serif font-normal italic" /> <TextCascade text={copy.c} />
              </span>
            </h1>
            <p key={tool} className="mt-4 max-w-md animate-fade-in text-muted-foreground">
              {copy.lead}
            </p>
          </section>

          <Tabs value={tool} onValueChange={(v) => pick(v as Tool)} variant="segment" className="w-full shrink-0 sm:w-auto">
            <TabsList aria-label="Tools">
              <TabsTrigger value="download" icon={<Download className="size-4" />}>
                Download
              </TabsTrigger>
              <TabsTrigger value="sticker" icon={<Sticker className="size-4" />}>
                Sticker maker
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div role="tabpanel">
          {tool === "download" ? (
            <Downloader
              onMakeSticker={(s) => {
                setSeed(s);
                pick("sticker");
              }}
            />
          ) : (
            <StickerMaker seed={seed} onSeedUsed={() => setSeed(null)} />
          )}
        </div>

        <footer className="mt-auto pt-16 text-xs text-muted-foreground">
          Only download content you have the right to save. Private posts can&apos;t be fetched.
        </footer>
      </main>
      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} position="bottom-right" fixed />
    </NotifyContext.Provider>
  );
}
