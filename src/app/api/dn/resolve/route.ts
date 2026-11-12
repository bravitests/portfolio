import { resolve, ResolveError } from "@/lib/dn/extract";
import { encodeToken } from "@/lib/dn/token";

export const maxDuration = 30;

function fileUrl(u: string, h: Record<string, string> | undefined, name?: string) {
  const q = new URLSearchParams({ t: encodeToken({ u, h }) });
  if (name) q.set("name", name);
  return `/api/dn/file?${q}`;
}

export async function POST(request: Request) {
  let url: unknown;
  try {
    ({ url } = await request.json());
  } catch {
    return Response.json({ error: "Send JSON with a url." }, { status: 400 });
  }
  if (typeof url !== "string" || url.length > 2048) {
    return Response.json({ error: "Paste an X, TikTok or Instagram link." }, { status: 400 });
  }

  try {
    const r = await resolve(url);
    const base = `${r.platform}-${r.id}`.replace(/[^\w.-]/g, "_");
    const items = r.items.map((item, i) => {
      const ext = item.type === "image" ? "jpg" : "mp4";
      const name = `${base}${r.items.length > 1 ? `-${i + 1}` : ""}.${ext}`;
      return {
        type: item.type,
        width: item.width,
        height: item.height,
        bitrate: item.bitrate,
        label: item.label,
        name,
        src: fileUrl(item.url, item.headers, name),
      };
    });
    return Response.json({
      platform: r.platform,
      id: r.id,
      title: r.title,
      author: r.author,
      thumbnail: r.thumbnail ? fileUrl(r.thumbnail, undefined) : undefined,
      items,
    });
  } catch (e) {
    if (e instanceof ResolveError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[dn/resolve]", e);
    return Response.json({ error: "Something went wrong fetching that link. Try again." }, { status: 502 });
  }
}
