import type { NextConfig } from "next";

// CSP — strict default-src 'self', no unsafe-eval.
// 'unsafe-inline' on style-src kept (Tailwind injects inline styles in dev).
// connect-src allows the live provider hosts that the orchestrator fetches.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://api.groq.com https://api.mistral.ai https://generativelanguage.googleapis.com https://api.hydradb.com https://api.elevenlabs.io https://en.wikipedia.org https://duckduckgo.com https://api.duckduckgo.com https://api.coingecko.com https://api.frankfurter.app https://api.dictionaryapi.dev https://icanhazdadjoke.com https://api.open-meteo.com https://geocoding-api.open-meteo.com https://api.github.com https://hacker-news.firebaseio.com https://ip-api.com https://gmail.googleapis.com https://oauth2.googleapis.com https://api.notion.com",
  "frame-src 'self' https:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), interest-cohort=()" },
];

const nextConfig: NextConfig = {
  // BUG-7 fix · stop advertising the framework version in response headers.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/((?!api/).*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
