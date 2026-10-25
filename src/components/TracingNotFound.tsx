"use client";

import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import { useSound } from "@/context/SoundContext";
import { EASE_OUT, SPRING_LAYOUT, SPRING_PRESS, TAP_SCALE } from "@/lib/motion";
import { TRACING_DRAWINGS, type TracingDrawing } from "@/lib/tracing-drawings";
import { cn } from "@/lib/utils";

type VellumState = "loose" | "register" | "lifted";
// Flat [x, y, width] triples; x and width are fractions of the sheet width, y of its height
type Stroke = number[];
type Point = { clientX: number; clientY: number };

const INK = "#161615";
const BASE_WIDTH = 0.0068;
const PAPER_GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.2 0 0 0 0 0.18 0 0 0 0 0.14 0 0 0 .16 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

const LABEL = "text-xs font-bold uppercase tracking-widest";
const SHEET_BUTTON = cn(
    LABEL,
    "inline-flex items-center rounded-full border border-foreground/10 bg-foreground/5 px-4 py-2 transition-colors hover:bg-foreground hover:text-background"
);
const EDGES = {
    top: "inset-x-0 top-0 h-4",
    bottom: "inset-x-0 bottom-0 h-4",
    left: "inset-y-0 left-0 w-4",
    right: "inset-y-0 right-0 w-4",
};
// The lines under the heading; use a new line for each bar, and credit the artist if they're borrowed
const BARS =
    "In blackest day, in brightest night,\nbeware, you've wandered off my site.\nNow trace the lines and get them right,\nand find your way by Bravian's light!";
const BARS_CREDIT = "";

const STATUS: Record<VellumState, string> = { loose: "drag me", register: "trace", lifted: "lifted" };

const Penflow = dynamic(() => import("penflow/react").then((mod) => mod.Penflow), {
    ssr: false,
});

function restingOffset(state: VellumState, w: number, h: number) {
    if (state === "register") return { x: 0, y: 0 };
    if (state === "lifted") return { x: w * 0.55, y: -h * 0.03 };
    return { x: w * 0.32, y: h * 0.08 };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

// Paints a stroke from point `from` onward, so live drawing only adds new segments
function paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, w: number, h: number, from = 0) {
    const count = stroke.length / 3;
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (count === 1 && from === 0) {
        ctx.beginPath();
        ctx.arc(stroke[0] * w, stroke[1] * h, (stroke[2] * w) / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
    }

    for (let i = Math.max(1, from); i < count; i++) {
        const a = (i - 1) * 3;
        const b = i * 3;
        ctx.lineWidth = ((stroke[a + 2] + stroke[b + 2]) / 2) * w;
        ctx.beginPath();
        ctx.moveTo(stroke[a] * w, stroke[a + 1] * h);
        ctx.lineTo(stroke[b] * w, stroke[b + 1] * h);
        ctx.stroke();
    }
}

type SheetButtonProps = {
    children: ReactNode;
    onClick: () => void;
    disabled?: boolean;
    primary?: boolean;
    selected?: boolean;
};

function SheetButton({ children, onClick, disabled, primary, selected }: SheetButtonProps) {
    return (
        <motion.button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-pressed={selected}
            whileTap={disabled ? undefined : TAP_SCALE}
            transition={SPRING_PRESS}
            className={cn(
                SHEET_BUTTON,
                (primary || selected) && "bg-foreground text-background",
                disabled && "cursor-not-allowed opacity-35 hover:bg-transparent hover:text-foreground"
            )}
        >
            {children}
        </motion.button>
    );
}

export default function TracingNotFound() {
    const router = useRouter();
    const reduce = useReducedMotion();
    const { playCue } = useSound();

    const [drawing, setDrawing] = useState<TracingDrawing>(TRACING_DRAWINGS[0]);
    const [vellum, setVellum] = useState<VellumState>("loose");
    const [size, setSize] = useState<{ w: number; h: number } | null>(null);
    const [strokeCount, setStrokeCount] = useState(0);

    const columnRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const vellumRef = useRef<VellumState>("loose");
    const ownSrcRef = useRef<string | null>(null);
    const strokes = useRef<Stroke[]>([]);
    const inking = useRef<{ id: number; t: number } | null>(null);
    const drag = useRef<{ id: number; startX: number; startY: number; fromX: number; fromY: number } | null>(null);

    const x = useMotionValue(0);
    const y = useMotionValue(0);

    // Size the sheets to the column, leaving room beside them to lift the vellum
    useEffect(() => {
        const column = columnRef.current;
        if (!column) return;

        const measure = () => {
            const byWidth = column.clientWidth / 1.56;
            const byHeight = window.innerHeight * 0.76 * 0.75;
            const w = Math.round(clamp(Math.min(byWidth, byHeight), 200, 420));
            setSize((prev) => (prev && prev.w === w ? prev : { w, h: Math.round((w * 4) / 3) }));
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(column);
        window.addEventListener("resize", measure);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, []);

    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !size) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        canvas.width = Math.round(size.w * dpr);
        canvas.height = Math.round(size.h * dpr);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (const stroke of strokes.current) paintStroke(ctx, stroke, size.w, size.h);
    }, [size]);

    useEffect(() => {
        if (!size) return;
        redraw();
        if (!drag.current) {
            const offset = restingOffset(vellumRef.current, size.w, size.h);
            x.set(offset.x);
            y.set(offset.y);
        }
    }, [size, redraw, x, y]);

    useEffect(() => {
        return () => {
            if (ownSrcRef.current) URL.revokeObjectURL(ownSrcRef.current);
        };
    }, []);

    const settle = useCallback(
        (next: VellumState) => {
            vellumRef.current = next;
            setVellum(next);
            if (!size) return;
            const offset = restingOffset(next, size.w, size.h);
            const transition = reduce ? { duration: 0 } : SPRING_LAYOUT;
            animate(x, offset.x, transition);
            animate(y, offset.y, transition);
        },
        [size, reduce, x, y]
    );

    const toggleVellum = () => {
        if (vellum === "register") {
            settle("lifted");
            playCue("close");
        } else {
            settle("register");
            playCue("open");
        }
    };

    const undo = useCallback(() => {
        if (!strokes.current.length) return;
        strokes.current.pop();
        redraw();
        setStrokeCount(strokes.current.length);
        playCue("tap", { emphasis: "subtle" });
    }, [redraw, playCue]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
                e.preventDefault();
                undo();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [undo]);

    const newLeaf = () => {
        strokes.current = [];
        redraw();
        setStrokeCount(0);
        playCue("close");
    };

    const randomDrawing = () => {
        const others = TRACING_DRAWINGS.filter((option) => option.id !== drawing.id);
        setDrawing(others[Math.floor(Math.random() * others.length)]);
        playCue("select");
    };

    const onOwnFile = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file || !file.type.startsWith("image/")) return;
        if (ownSrcRef.current) URL.revokeObjectURL(ownSrcRef.current);
        const src = URL.createObjectURL(file);
        ownSrcRef.current = src;
        setDrawing({ id: "your-own", title: "your own photo", src });
        playCue("select");
    };

    const takeTracing = () => {
        if (!strokes.current.length) return;
        const W = 1200;
        const H = 1600;
        const sheet = document.createElement("canvas");
        sheet.width = W;
        sheet.height = H;
        const ctx = sheet.getContext("2d");
        if (!ctx) return;

        ctx.fillStyle = "#f6f5f1";
        ctx.fillRect(0, 0, W, H);
        for (let i = 0; i < 9000; i++) {
            ctx.fillStyle = `rgba(60, 52, 40, ${Math.random() * 0.05})`;
            ctx.fillRect(Math.random() * W, Math.random() * H, 1.6, 1.6);
        }
        for (const stroke of strokes.current) paintStroke(ctx, stroke, W, H);

        ctx.fillStyle = "rgba(22, 22, 21, 0.55)";
        ctx.font = "700 20px Inter, ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(`TRACED AFTER ${drawing.title.toUpperCase()} · 404`, 48, H - 48);
        ctx.textAlign = "right";
        ctx.fillText("BRAVIAN NYATORO", W - 48, H - 48);

        sheet.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `tracing-${drawing.id}.png`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, "image/png");
        playCue("success");
    };

    const retrace = () => {
        if (window.history.length > 1) router.back();
        else router.push("/");
    };

    // Dragging the vellum by its edges
    const onEdgeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        x.stop();
        y.stop();
        drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, fromX: x.get(), fromY: y.get() };
        playCue("tap", { emphasis: "subtle" });
    };

    const onEdgeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId || !size) return;
        x.set(clamp(d.fromX + e.clientX - d.startX, -size.w * 0.6, size.w * 0.9));
        y.set(clamp(d.fromY + e.clientY - d.startY, -size.h * 0.4, size.h * 0.4));
    };

    const onEdgeUp = (e: ReactPointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId || !size) return;
        drag.current = null;
        if (Math.hypot(x.get(), y.get()) < Math.max(18, size.w * 0.07)) {
            settle("register");
            playCue("ready");
        } else {
            vellumRef.current = "loose";
            setVellum("loose");
        }
    };

    // Inking on the vellum
    const toSheet = (point: Point) => {
        const rect = canvasRef.current!.getBoundingClientRect();
        return [(point.clientX - rect.left) / rect.width, (point.clientY - rect.top) / rect.height] as const;
    };

    const penWidth = (pressure: number) => BASE_WIDTH * (0.4 + pressure * 1.2);

    const onInkDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx || !size) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const [px, py] = toSheet(e);
        const stroke = [px, py, e.pointerType === "pen" ? penWidth(e.pressure) : BASE_WIDTH];
        strokes.current.push(stroke);
        inking.current = { id: e.pointerId, t: e.timeStamp };
        paintStroke(ctx, stroke, size.w, size.h);
        setStrokeCount(strokes.current.length);
        playCue("tap", { emphasis: "subtle" });
    };

    const onInkMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        const ink = inking.current;
        const ctx = canvasRef.current?.getContext("2d");
        if (!ink || ink.id !== e.pointerId || !ctx || !size) return;

        const stroke = strokes.current[strokes.current.length - 1];
        const from = stroke.length / 3;
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];

        for (const event of events.length ? events : [e.nativeEvent]) {
            const [px, py] = toSheet(event);
            const last = stroke.length - 3;
            const dist = Math.hypot(px - stroke[last], ((py - stroke[last + 1]) * size.h) / size.w);
            if (dist < 0.002) continue;
            const dt = Math.max(1, event.timeStamp - ink.t);
            ink.t = event.timeStamp;
            // Faster strokes thin the line, like a nib dragged quickly
            const target =
                event.pointerType === "pen"
                    ? penWidth(event.pressure)
                    : BASE_WIDTH * clamp(1.35 - (dist / dt) * 260, 0.45, 1.35);
            stroke.push(px, py, stroke[last + 2] * 0.72 + target * 0.28);
        }

        paintStroke(ctx, stroke, size.w, size.h, from);
    };

    const onInkUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        if (inking.current?.id === e.pointerId) inking.current = null;
    };

    return (
        <main className="flex min-h-screen flex-col bg-background px-4 py-6 text-foreground sm:px-6 lg:px-12 xl:px-16">
            <header className="flex items-center justify-between gap-4">
                <Link
                    href="/"
                    className="flex items-center gap-3 text-xl font-bold tracking-tighter transition-all duration-150 hover:opacity-70 active:scale-[0.98] motion-reduce:active:scale-100"
                >
                    <Image src="/pfp.png" alt="" width={40} height={40} priority className="h-10 w-10 rounded-full" />
                    Bravian Nyatoro
                </Link>
                <SheetButton onClick={retrace}>‹ Go back</SheetButton>
            </header>

            <div className="grid flex-1 grid-cols-[minmax(0,1fr)] items-center gap-10 py-10 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:gap-16 md:py-12">
                <motion.section
                    initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={EASE_OUT}
                    className="max-w-sm space-y-8"
                >
                    <div className="space-y-4">
                        <p className={cn(LABEL, "text-foreground/50")}>404</p>
                        <h1 className="text-5xl leading-[1.05] md:text-6xl">
                            You&apos;re <span className="playful-italic">lost.</span>
                        </h1>
                        <p className="text-foreground/60">Trace something while you&apos;re here.</p>
                    </div>

                    <figure className="space-y-2 border-l-2 border-accent pl-4">
                        <blockquote className="whitespace-pre-line text-lg font-semibold leading-snug tracking-tight">
                            {BARS}
                        </blockquote>
                        {BARS_CREDIT && (
                            <figcaption className={cn(LABEL, "text-foreground/40")}>{BARS_CREDIT}</figcaption>
                        )}
                    </figure>

                    <div className="flex flex-wrap gap-2">
                        <SheetButton onClick={toggleVellum}>{vellum === "register" ? "Lift" : "Lay over"}</SheetButton>
                        <SheetButton onClick={undo} disabled={!strokeCount}>
                            Undo
                        </SheetButton>
                        <SheetButton onClick={newLeaf} disabled={!strokeCount}>
                            Clear
                        </SheetButton>
                        <SheetButton primary onClick={takeTracing} disabled={!strokeCount}>
                            Download ↓
                        </SheetButton>
                    </div>

                    <div className="space-y-3">
                        <p className={cn(LABEL, "text-foreground/40")}>Change photo</p>
                        <div className="flex flex-wrap gap-2">
                            <SheetButton onClick={() => fileRef.current?.click()}>Upload</SheetButton>
                            <SheetButton onClick={randomDrawing}>Random</SheetButton>
                            <input
                                ref={fileRef}
                                type="file"
                                accept="image/*"
                                className="sr-only"
                                tabIndex={-1}
                                onChange={onOwnFile}
                            />
                        </div>
                    </div>
                </motion.section>

                <div ref={columnRef} className="flex w-full min-w-0 justify-center">
                    {size && (
                        <div className="relative" style={{ width: size.w * 1.55, height: size.h * 1.08 }}>
                            <div
                                className="absolute left-0 top-0 overflow-hidden rounded-sm border border-black/10 shadow-sm"
                                style={{
                                    width: size.w,
                                    height: size.h,
                                    backgroundColor: "#f3f0e8",
                                    backgroundImage: PAPER_GRAIN,
                                }}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element -- also shows local object URLs */}
                                <img
                                    src={drawing.src}
                                    alt={`Drawing to trace: ${drawing.title}`}
                                    draggable={false}
                                    className="absolute inset-0 h-full w-full select-none object-contain p-[6%]"
                                />
                            </div>

                            <motion.div
                                className="absolute left-0 top-0 rounded-sm border border-black/[0.08]"
                                style={{
                                    x,
                                    y,
                                    width: size.w,
                                    height: size.h,
                                    backgroundColor: "rgba(250, 250, 247, 0.74)",
                                    backdropFilter: "blur(1.2px)",
                                    WebkitBackdropFilter: "blur(1.2px)",
                                    boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 14px 32px -14px rgba(0,0,0,0.16)",
                                }}
                            >
                                <canvas
                                    ref={canvasRef}
                                    aria-label="Tracing paper. Draw on it with a mouse, pen or finger."
                                    className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                                    onPointerDown={onInkDown}
                                    onPointerMove={onInkMove}
                                    onPointerUp={onInkUp}
                                    onPointerCancel={onInkUp}
                                />
                                <div className="pointer-events-none absolute inset-4 border border-dashed border-black/[0.06]" />
                                {(Object.keys(EDGES) as (keyof typeof EDGES)[]).map((side) => (
                                    <div
                                        key={side}
                                        className={cn("absolute cursor-grab touch-none active:cursor-grabbing", EDGES[side])}
                                        onPointerDown={onEdgeDown}
                                        onPointerMove={onEdgeMove}
                                        onPointerUp={onEdgeUp}
                                        onPointerCancel={onEdgeUp}
                                    />
                                ))}
                                <span className={cn(LABEL, "pointer-events-none absolute left-5 top-5 text-foreground/40")}>
                                    {STATUS[vellum]}
                                </span>
                            </motion.div>
                        </div>
                    )}
                </div>
            </div>

            <footer className="h-14 w-56 [&>canvas]:!h-auto [&>canvas]:!max-w-full">
                <Penflow
                    text="Bravian Nyatoro"
                    fontUrl="/fonts/BrittanySignature.ttf"
                    size={30}
                    speed={1.2}
                    quality="balanced"
                    brushScale={0.072}
                    seed="wordmark"
                    animate={!reduce}
                    incremental={false}
                    lineHeight={2.0}
                />
            </footer>
        </main>
    );
}
