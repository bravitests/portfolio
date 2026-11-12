// Server-only media resolvers for X, TikTok and Instagram.
// Each resolver returns direct media URLs; the /api/dn/file route streams them
// back to the browser so downloads land as files instead of opening a tab.

export type Platform = "x" | "tiktok" | "instagram";

export type MediaItem = {
  type: "video" | "gif" | "image";
  url: string;
  width?: number;
  height?: number;
  bitrate?: number;
  label?: string;
  // Extra request headers needed when fetching this URL (e.g. TikTok cookies).
  headers?: Record<string, string>;
};

export type Resolved = {
  platform: Platform;
  id: string;
  title?: string;
  author?: string;
  thumbnail?: string;
  items: MediaItem[];
};

export class ResolveError extends Error {
  constructor(message: string, public status = 422) {
    super(message);
  }
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

const TIMEOUT = 12_000;

async function get(url: string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT),
    redirect: "follow",
    cache: "no-store",
  });
}

export function detectPlatform(raw: string): { platform: Platform; url: URL } | null {
  let url: URL;
  try {
    url = new URL(raw.trim().startsWith("http") ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  const h = url.hostname.replace(/^www\.|^m\.|^mobile\./, "");
  if (["x.com", "twitter.com", "fxtwitter.com", "vxtwitter.com", "fixupx.com"].includes(h)) return { platform: "x", url };
  if (h === "tiktok.com" || h.endsWith(".tiktok.com")) return { platform: "tiktok", url };
  if (h === "instagram.com" || h === "instagr.am" || h === "ddinstagram.com") return { platform: "instagram", url };
  return null;
}

/* ----------------------------------------------------------------- cobalt */
// Optional: if you self-host cobalt (github.com/imputnet/cobalt) set
// COBALT_API_URL (and COBALT_API_KEY if your instance needs one). It is tried
// first because it handles rate limits and login walls far better.
async function viaCobalt(url: string, platform: Platform): Promise<Resolved | null> {
  const base = process.env.COBALT_API_URL;
  if (!base) return null;
  try {
    const res = await fetch(base, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(process.env.COBALT_API_KEY ? { authorization: `Api-Key ${process.env.COBALT_API_KEY}` } : {}),
      },
      body: JSON.stringify({ url, videoQuality: "max", downloadMode: "auto" }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json();
    if (data.status === "tunnel" || data.status === "redirect") {
      return { platform, id: data.filename ?? "media", items: [{ type: "video", url: data.url, label: "Best" }] };
    }
    if (data.status === "picker") {
      return {
        platform,
        id: "media",
        items: data.picker.map((p: { type: string; url: string }) => ({
          type: p.type === "photo" ? "image" : p.type === "gif" ? "gif" : "video",
          url: p.url,
        })),
      };
    }
  } catch {
    // fall through to built-in resolvers
  }
  return null;
}

/* ---------------------------------------------------------------------- X */
function xToken(id: string) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

type XVariant = { content_type?: string; type?: string; url?: string; src?: string; bitrate?: number };

function pickXVariants(variants: XVariant[]) {
  return variants
    .map((v) => ({ url: v.url ?? v.src ?? "", type: v.content_type ?? v.type ?? "", bitrate: v.bitrate ?? 0 }))
    .filter((v) => v.type === "video/mp4" && v.url)
    .sort((a, b) => b.bitrate - a.bitrate);
}

function resFromUrl(u: string) {
  const m = u.match(/\/(\d+)x(\d+)\//);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : {};
}

async function resolveX(url: URL): Promise<Resolved> {
  const id = url.pathname.match(/status(?:es)?\/(\d+)/)?.[1];
  if (!id) throw new ResolveError("That X link doesn't point to a post.");

  // 1. Public syndication endpoint (used by embedded tweets).
  try {
    const res = await get(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${xToken(id)}`);
    if (res.ok) {
      const t = await res.json();
      const post = t.mediaDetails ? t : t.quoted_tweet?.mediaDetails ? t.quoted_tweet : t;
      const items: MediaItem[] = [];
      for (const m of post.mediaDetails ?? []) {
        if (m.type === "photo") {
          items.push({ type: "image", url: `${m.media_url_https}?name=orig`, width: m.original_info?.width, height: m.original_info?.height });
        } else if (m.video_info) {
          const kind = m.type === "animated_gif" ? "gif" : "video";
          for (const v of pickXVariants(m.video_info.variants)) {
            items.push({ type: kind, url: v.url, bitrate: v.bitrate, ...resFromUrl(v.url) });
          }
        }
      }
      if (items.length) {
        return {
          platform: "x",
          id,
          title: post.text?.replace(/\s*https:\/\/t\.co\/\S+$/, "").slice(0, 140),
          author: post.user?.screen_name ? `@${post.user.screen_name}` : undefined,
          thumbnail: post.mediaDetails?.[0]?.media_url_https,
          items,
        };
      }
    }
  } catch {
    // try fallback
  }

  // 2. fxtwitter public API.
  const res = await get(`https://api.fxtwitter.com/status/${id}`);
  if (!res.ok) throw new ResolveError("Couldn't reach that post. It may be private or deleted.");
  const data = await res.json();
  const t = data.tweet;
  const items: MediaItem[] = [];
  for (const p of t?.media?.photos ?? []) items.push({ type: "image", url: p.url, width: p.width, height: p.height });
  for (const v of t?.media?.videos ?? []) {
    const kind = v.type === "gif" ? "gif" : "video";
    const variants = v.formats?.length ? pickXVariants(v.formats) : [{ url: v.url, bitrate: 0 }];
    for (const f of variants) items.push({ type: kind, url: f.url, bitrate: f.bitrate, ...resFromUrl(f.url), width: v.width, height: v.height });
  }
  if (!items.length) throw new ResolveError("No video, GIF or image found in that post.");
  return { platform: "x", id, title: t.text?.slice(0, 140), author: t.author?.screen_name ? `@${t.author.screen_name}` : undefined, thumbnail: t.media?.videos?.[0]?.thumbnail_url, items };
}

/* ----------------------------------------------------------------- TikTok */
async function resolveTikTok(url: URL): Promise<Resolved> {
  let target = url.toString();

  // Short links (vm.tiktok.com / vt.tiktok.com / tiktok.com/t/...) redirect to the full URL.
  if (!/\/(video|photo)\/\d+/.test(url.pathname)) {
    const r = await get(target, { method: "GET" });
    target = r.url;
  }
  const id = target.match(/\/(?:video|photo)\/(\d+)/)?.[1];
  if (!id) throw new ResolveError("That TikTok link doesn't point to a video.");

  // 1. Read the page's hydration JSON. The play URL needs the cookies TikTok sets on this response.
  try {
    const res = await get(`https://www.tiktok.com/@i/video/${id}`, { headers: { accept: "text/html" } });
    const html = await res.text();
    const json = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    if (json) {
      const item = JSON.parse(json)?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
      const v = item?.video;
      const play = v?.playAddr || v?.downloadAddr;
      if (play) {
        const cookies = res.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; ");
        return {
          platform: "tiktok",
          id,
          title: item.desc?.slice(0, 140),
          author: item.author?.uniqueId ? `@${item.author.uniqueId}` : undefined,
          thumbnail: v.cover,
          items: [
            {
              type: "video",
              url: play,
              width: v.width,
              height: v.height,
              label: "No watermark",
              headers: { cookie: cookies, referer: "https://www.tiktok.com/" },
            },
          ],
        };
      }
    }
  } catch {
    // try fallback
  }

  // 2. tikwm public API.
  const res = await get(`https://www.tikwm.com/api/?url=${encodeURIComponent(`https://www.tiktok.com/@i/video/${id}`)}&hd=1`);
  const data = await res.json().catch(() => null);
  const d = data?.data;
  if (!d) throw new ResolveError("TikTok blocked that request. Try again in a minute.");
  const abs = (u: string) => (u?.startsWith("http") ? u : `https://www.tikwm.com${u}`);
  const items: MediaItem[] = [];
  if (d.images?.length) for (const img of d.images) items.push({ type: "image", url: abs(img) });
  if (d.hdplay) items.push({ type: "video", url: abs(d.hdplay), label: "HD, no watermark" });
  if (d.play) items.push({ type: "video", url: abs(d.play), label: "No watermark" });
  if (d.wmplay) items.push({ type: "video", url: abs(d.wmplay), label: "With watermark" });
  if (!items.length) throw new ResolveError("No downloadable media in that TikTok.");
  return { platform: "tiktok", id, title: d.title?.slice(0, 140), author: d.author?.unique_id ? `@${d.author.unique_id}` : undefined, thumbnail: abs(d.cover), items };
}

/* -------------------------------------------------------------- Instagram */
const IG_APP_ID = "936619743392459";

type IgNode = {
  is_video?: boolean;
  video_url?: string;
  display_url?: string;
  dimensions?: { width: number; height: number };
  edge_sidecar_to_children?: { edges: { node: IgNode }[] };
  edge_media_to_caption?: { edges: { node: { text: string } }[] };
  owner?: { username?: string };
};

function igItems(node: IgNode): MediaItem[] {
  const nodes = node.edge_sidecar_to_children?.edges.map((e) => e.node) ?? [node];
  return nodes.flatMap<MediaItem>((n) =>
    n.is_video && n.video_url
      ? [{ type: "video", url: n.video_url, width: n.dimensions?.width, height: n.dimensions?.height }]
      : n.display_url
        ? [{ type: "image", url: n.display_url, width: n.dimensions?.width, height: n.dimensions?.height }]
        : [],
  );
}

async function resolveInstagram(url: URL): Promise<Resolved> {
  const code = url.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)?.[1];
  if (!code) throw new ResolveError("That Instagram link doesn't point to a post or reel.");

  // 1. Public GraphQL query used by the logged-out web app.
  try {
    const body = new URLSearchParams({
      variables: JSON.stringify({ shortcode: code, fetch_tagged_user_count: null, hoisted_comment_id: null, hoisted_reply_id: null }),
      doc_id: "8845758582119845",
    });
    const res = await get("https://www.instagram.com/graphql/query", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-ig-app-id": IG_APP_ID,
        "x-fb-friendly-name": "PolarisPostActionLoadPostQueryQuery",
        "x-asbd-id": "129477",
        origin: "https://www.instagram.com",
        referer: `https://www.instagram.com/reel/${code}/`,
      },
      body,
    });
    if (res.ok) {
      const media: IgNode | undefined = (await res.json())?.data?.xdt_shortcode_media;
      if (media) {
        const items = igItems(media);
        if (items.length) {
          return {
            platform: "instagram",
            id: code,
            title: media.edge_media_to_caption?.edges[0]?.node.text?.slice(0, 140),
            author: media.owner?.username ? `@${media.owner.username}` : undefined,
            thumbnail: media.display_url,
            items,
          };
        }
      }
    }
  } catch {
    // try fallback
  }

  // 2. The embed page carries the media JSON for public posts.
  const res = await get(`https://www.instagram.com/p/${code}/embed/captioned/`, { headers: { accept: "text/html" } });
  const html = await res.text();
  const ctx = html.match(/"contextJSON":"((?:\\.|[^"\\])*)"/)?.[1];
  if (ctx) {
    try {
      const media: IgNode | undefined = JSON.parse(JSON.parse(`"${ctx}"`))?.context?.media;
      if (media) {
        const items = igItems(media);
        if (items.some((i) => i.type === "video") || items.length) {
          return { platform: "instagram", id: code, author: media.owner?.username ? `@${media.owner.username}` : undefined, thumbnail: media.display_url, items };
        }
      }
    } catch {
      // ignore
    }
  }
  const video = html.match(/"video_url":"([^"]+)"/)?.[1];
  if (video) {
    return { platform: "instagram", id: code, items: [{ type: "video", url: JSON.parse(`"${video}"`) }] };
  }
  throw new ResolveError("Instagram didn't share that one. Private posts and some reels need a login.");
}

/* ------------------------------------------------------------------- main */
export async function resolve(raw: string): Promise<Resolved> {
  const hit = detectPlatform(raw);
  if (!hit) throw new ResolveError("Paste an X, TikTok or Instagram link.", 400);
  const viaC = await viaCobalt(hit.url.toString(), hit.platform);
  if (viaC) return viaC;
  if (hit.platform === "x") return resolveX(hit.url);
  if (hit.platform === "tiktok") return resolveTikTok(hit.url);
  return resolveInstagram(hit.url);
}

// Hosts the file proxy is allowed to fetch. Keeps /api/dn/file from becoming an open proxy.
const ALLOWED = [
  /(^|\.)twimg\.com$/,
  /(^|\.)tiktokcdn\.com$/,
  /(^|\.)tiktokcdn-us\.com$/,
  /(^|\.)tiktokv\.com$/,
  /(^|\.)tiktokv\.us$/,
  /(^|\.)tiktok\.com$/,
  /(^|\.)byteoversea\.com$/,
  /(^|\.)ibytedtos\.com$/,
  /(^|\.)muscdn\.com$/,
  /(^|\.)tikwm\.com$/,
  /(^|\.)cdninstagram\.com$/,
  /(^|\.)fbcdn\.net$/,
];

export function isAllowedMediaHost(u: string) {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return false;
    if (process.env.COBALT_API_URL && url.origin === new URL(process.env.COBALT_API_URL).origin) return true;
    return ALLOWED.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}
