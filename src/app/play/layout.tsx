import type { Metadata, Viewport } from "next";

// page.tsx is a client component ("use client") so it can't export metadata
// itself. This server-component layout supplies the per-route <title> so the
// tab / PWA window reads "Play — DelOS" instead of the generic root title.
export const metadata: Metadata = {
  title: "Play — DelOS",
  description: "Watch DelOS agents take on live challenges under pressure.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
};

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
