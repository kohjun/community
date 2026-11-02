// Container liveness only: deliberately no Auth, database, Storage or queue access.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};
export function GET() {
  return new Response(JSON.stringify({ status: "ok" }), { headers });
}
export function HEAD() {
  return new Response(null, { headers });
}
