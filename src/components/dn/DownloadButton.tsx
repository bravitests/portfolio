"use client";

import { useRef, useState } from "react";
import { Check, Download, Loader2, Share, X as XIcon } from "lucide-react";
import { useNotify } from "./DnTools";
import { fetchMedia } from "@/lib/dn/fetch-media";

// Browsers that ignore <a download> or hide the result: iOS (files land in
// Files → Downloads, never Photos) and in-app webviews (WhatsApp, Instagram,
// X, TikTok, Facebook...). There we hand the finished file to the share sheet,
// which offers "Save Video" / "Save to Files".
function prefersShareSheet() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const webview = /FBAN|FBAV|Instagram|WhatsApp|Twitter|TikTok|musical_ly|BytedanceWebview|Line\//i.test(ua);
  return iOS || webview;
}

function saveBlob(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1)} MB`;

type State = { kind: "idle" } | { kind: "loading"; loaded: number; total: number } | { kind: "ready"; file: File } | { kind: "done" } | { kind: "error" };

export default function DownloadButton({ src, direct, name, label, primary }: { src: string; direct?: string; name: string; label: string; primary?: boolean }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const notify = useNotify();

  const share = async (file: File) => {
    try {
      await navigator.share({ files: [file] });
      setState({ kind: "done" });
      setTimeout(() => setState({ kind: "idle" }), 2500);
    } catch (e) {
      // AbortError = user closed the sheet; keep the file ready to try again.
      if ((e as Error).name !== "AbortError") saveBlob(file);
    }
  };

  const start = async () => {
    if (state.kind === "loading") {
      abortRef.current?.abort();
      setState({ kind: "idle" });
      return;
    }
    if (state.kind === "ready") return share(state.file);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({ kind: "loading", loaded: 0, total: 0 });
    try {
      const res = await fetchMedia({ src, direct }, { signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error(await res.text().catch(() => "Download failed"));
      const total = Number(res.headers.get("content-length")) || 0;
      const ct = res.headers.get("content-type");
      const type = (ct && ct !== "application/octet-stream" ? ct : "") || (name.endsWith(".jpg") ? "image/jpeg" : "video/mp4");
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      let lastPaint = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        const now = performance.now();
        if (now - lastPaint > 120) {
          lastPaint = now;
          setState({ kind: "loading", loaded, total });
        }
      }
      const file = new File(chunks as BlobPart[], name, { type });

      if (prefersShareSheet() && navigator.canShare?.({ files: [file] })) {
        // The share sheet needs a fresh tap, so park the file behind a "Save" button.
        setState({ kind: "ready", file });
        notify({ title: "Ready to save", description: `Tap Save, then “Save Video” · ${mb(file.size)}`, status: "success" });
        return;
      }
      saveBlob(file);
      setState({ kind: "done" });
      notify({ title: "Downloaded", description: `${name} · ${mb(file.size)}`, status: "success" });
      setTimeout(() => setState({ kind: "idle" }), 2500);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setState({ kind: "error" });
      notify({ title: "Download failed", description: "The link may have expired. Paste it again.", status: "error" });
      setTimeout(() => setState({ kind: "idle" }), 3000);
    }
  };

  const pct = state.kind === "loading" && state.total ? Math.round((state.loaded / state.total) * 100) : null;
  const text =
    state.kind === "loading"
      ? pct !== null
        ? `${pct}%`
        : state.loaded
          ? mb(state.loaded)
          : "Starting…"
      : state.kind === "ready"
        ? `Save ${label}`
        : state.kind === "done"
          ? "Saved"
          : state.kind === "error"
            ? "Failed"
            : label;
  const Icon = state.kind === "loading" ? Loader2 : state.kind === "ready" ? Share : state.kind === "done" ? Check : state.kind === "error" ? XIcon : Download;

  return (
    <button
      type="button"
      onClick={start}
      aria-label={state.kind === "loading" ? `Downloading ${label}, ${pct ?? 0}%. Tap to cancel.` : state.kind === "ready" ? `Save ${label}` : `Download ${label}`}
      className={`relative inline-flex h-10 items-center gap-2 overflow-hidden rounded-full px-4 text-sm font-semibold tabular-nums transition-all active:scale-[0.97] ${
        state.kind === "ready"
          ? "bg-foreground text-background"
          : state.kind === "error"
            ? "border border-destructive/40 text-destructive"
            : primary
              ? "bg-accent text-accent-foreground hover:brightness-95"
              : "border hover:bg-muted/60"
      }`}
    >
      {state.kind === "loading" && (
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 transition-[width] duration-150 ${primary ? "bg-foreground/15" : "bg-accent/40"}`}
          style={{ width: pct !== null ? `${pct}%` : "100%", opacity: pct !== null ? 1 : 0.4 }}
        />
      )}
      <Icon className={`relative size-4 ${state.kind === "loading" ? "animate-spin" : ""}`} />
      <span className="relative">{text}</span>
    </button>
  );
}
