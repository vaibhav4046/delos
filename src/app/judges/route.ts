// Pretty alias for the /api/judges magic link.
// /judges?token=... → same behavior as /api/judges?token=...
export { GET } from "../api/judges/route";
export const runtime = "nodejs";
