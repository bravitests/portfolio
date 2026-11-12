// Packs a media URL (plus any headers it needs) into an opaque query token for
// /api/dn/file. The host allowlist in extract.ts is the real security boundary.

export type FileToken = { u: string; h?: Record<string, string> };

const ALLOWED_HEADERS = new Set(["cookie", "referer"]);

export function encodeToken(t: FileToken) {
  return Buffer.from(JSON.stringify(t)).toString("base64url");
}

export function decodeToken(raw: string): FileToken | null {
  try {
    const t = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof t?.u !== "string") return null;
    const h: Record<string, string> = {};
    for (const [k, v] of Object.entries(t.h ?? {})) {
      if (ALLOWED_HEADERS.has(k.toLowerCase()) && typeof v === "string") h[k.toLowerCase()] = v;
    }
    return { u: t.u, h };
  } catch {
    return null;
  }
}
