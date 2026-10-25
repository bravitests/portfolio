export type TracingDrawing = {
    id: string;
    title: string;
    src: string;
};

/**
 * Drawings offered on the 404 tracing page.
 * To add one, drop a line-art image (svg, png or jpg; 3:4 portrait reads best)
 * into public/tracing and list it here.
 */
export const TRACING_DRAWINGS: TracingDrawing[] = [
    { id: "cat", title: "the sleeping cat", src: "/tracing/cat.svg" },
    { id: "straw-hat", title: "the straw hat", src: "/tracing/straw-hat.svg" },
    { id: "baobab", title: "the baobab", src: "/tracing/baobab.svg" },
    { id: "cup", title: "the morning cup", src: "/tracing/cup.svg" },
    { id: "snail", title: "the slow snail", src: "/tracing/snail.svg" },
    { id: "me", title: "the developer", src: "/pfp.png" },
];
