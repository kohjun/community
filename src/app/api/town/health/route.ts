export const runtime = "nodejs";
export async function GET() {
  const port = Number(process.env.TOWN_PORT ?? 13003);
  try {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error();
    const r = await fetch(`http://127.0.0.1:${port}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) throw new Error();
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
