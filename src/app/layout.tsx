import type { Metadata, Viewport } from "next";
import { Pixelify_Sans, Inter, JetBrains_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import "@xterm/xterm/css/xterm.css";
import { GlobalCmdK } from "@/components/GlobalCmdK";
import { PwaInstall } from "@/components/PwaInstall";

const pixel = Pixelify_Sans({ subsets: ["latin"], variable: "--font-pixel-google", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-sans-google", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-google", display: "swap" });
// DelOS v2.1 design PDF — serif italic accent for hero words like "flow".
const serif = Playfair_Display({ subsets: ["latin"], style: ["italic"], variable: "--font-serif-google", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://delrio.vercel.app"),
  title: "DelOS — agents that flow under pressure",
  description:
    "DelOS: the browser-OS where multi-agent orchestration is wired in by default. Memory · Tools · Recovery · Adaptation. Agents build the apps live.",
  manifest: "/manifest.webmanifest",
  // Explicit icons block · versioned URL busts browser favicon cache so
  // returning visitors see the DelOS D, not the stale Vercel Z.
  icons: {
    icon: [
      { url: "/icon.svg?v=3", type: "image/svg+xml" },
      { url: "/icon.svg?v=3", sizes: "any" },
    ],
    shortcut: "/icon.svg?v=3",
    // iOS ignores SVG for home-screen icons — must be a real PNG, else Safari
    // falls back to an ugly page screenshot on Add-to-Home-Screen.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  applicationName: "DelOS",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "DelOS" },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  openGraph: {
    type: "website",
    url: "https://delrio.vercel.app",
    title: "DelOS — agents that flow under pressure",
    description:
      "The browser-OS for multi-agent work. Memory · Tools · Recovery · Adaptation wired in by default. Agents build the apps live.",
    siteName: "DelOS",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "DelOS" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "DelOS — agents that flow under pressure",
    description:
      "Browser-OS for multi-agent work. Memory · Tools · Recovery · Adaptation. HydraDB hackathon 2026.",
    images: ["/twitter-image"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f0f1b",
  width: "device-width",
  initialScale: 1,
  // Let the app paint into the notch / Dynamic Island area; components use
  // env(safe-area-inset-*) to keep chrome clear of cutouts.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${pixel.variable} ${inter.variable} ${mono.variable} ${serif.variable}`}>
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <GlobalCmdK />
        <PwaInstall />
        <script
          dangerouslySetInnerHTML={{
            __html: `if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); }); }`,
          }}
        />
      </body>
    </html>
  );
}
