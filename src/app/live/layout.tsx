import type { Metadata, Viewport } from "next";

// page.tsx is a client component ("use client") so it can't export metadata
// itself. This server-component layout supplies the per-route <title> so the
// tab / PWA window reads "Live — DelOS" instead of the generic root title.
export const metadata: Metadata = {
  title: "Live — DelOS",
  description: "Live DelOS agent runs, streamed in real time.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
};

export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return children;
}
