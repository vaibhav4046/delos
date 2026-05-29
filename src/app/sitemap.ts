import type { MetadataRoute } from "next";

const BASE = "https://delrio.vercel.app";

const ROUTES = [
  "",
  "/os",
  "/play",
  "/arena",
  "/live",
  "/memory",
  "/scorecard",
  "/demo",
  "/docs",
  "/status",
  "/extension",
  "/install",
  "/leaderboard",
  "/pitch",
  "/ask",
  "/wiki",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map((r) => ({
    url: `${BASE}${r}`,
    lastModified: now,
    changeFrequency: r === "" || r === "/os" ? "daily" : "weekly",
    priority: r === "" ? 1.0 : r === "/os" ? 0.9 : 0.7,
  }));
}
