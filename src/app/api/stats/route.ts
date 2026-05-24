import { getSiteStats } from "@/lib/stats";

export const runtime = "nodejs";
export const maxDuration = 10;

// Single source of truth for site-wide counts. Logic lives in @/lib/stats so
// landing page server component can call it directly without a network hop.
// Callers that need to record run stats import recordRunStats from @/lib/stats.

export async function GET() {
  const stats = await getSiteStats();
  return Response.json(stats);
}
