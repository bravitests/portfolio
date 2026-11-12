// Fetch a resolved media item, trying the platform CDN directly first.
// X and Instagram CDNs allow CORS, so this keeps video bytes off our Vercel
// functions. If the direct request fails (CORS change, expired URL, network),
// fall back to the /api/dn/file proxy.
export async function fetchMedia(item: { src: string; direct?: string }, init: RequestInit = {}) {
  if (item.direct) {
    try {
      const res = await fetch(item.direct, { ...init, mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
      if (res.ok && res.body) return res;
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
    }
  }
  return fetch(item.src, init);
}
