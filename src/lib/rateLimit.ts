// Simple per-visitor limit for the AI routes, so one person can't burn the free AI quota.
// Kept in memory: each server instance counts on its own and it resets on redeploy,
// which is fine for a hackathon demo. Over the limit, the routes use canned replies.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;

const hits = new Map<string, number[]>();

export function visitorId(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

// True if this visitor may make another AI call right now.
export function allowAi(id: string) {
  const now = Date.now();
  const recent = (hits.get(id) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(id, recent);
    return false;
  }
  recent.push(now);
  hits.set(id, recent);
  return true;
}
