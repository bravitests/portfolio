import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "dn. by Bravian — download videos & make WhatsApp stickers",
  description:
    "Paste an X, TikTok or Instagram link to download the video, or turn any image, GIF or X GIF into a WhatsApp sticker. Free, no sign-up.",
  openGraph: {
    title: "dn. — downloads & stickers",
    description: "Download X, TikTok and Instagram videos. Turn images and GIFs into WhatsApp stickers.",
    url: "https://dn.bravian.site",
  },
};

export const viewport: Viewport = { themeColor: "#fafafa" };

export default function DnLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-background text-foreground">{children}</div>;
}
