import { authConfiguration } from "@/server/auth-config";
import { canonicalLocalNavigation } from "@/server/request-origin";

export const dynamic = "force-dynamic";

/** Finish a loopback page redirect outside Proxy's localhost URL normalization. */
export async function GET(request: Request) {
  const config = authConfiguration();
  const encoded = new URL(request.url).searchParams.get("target") ?? "";
  if (!config || encoded.length > 16_384 || !/^[A-Za-z0-9_-]+$/.test(encoded))
    return new Response(null, { status: 400 });
  const path = Buffer.from(encoded, "base64url").toString("utf8");
  if (
    Buffer.from(path).toString("base64url") !== encoded ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\")
  )
    return new Response(null, { status: 400 });
  const source = new URL(path, config.origin);
  if (source.origin !== config.origin) return new Response(null, { status: 400 });
  const target = canonicalLocalNavigation(
    new Request(source, { headers: request.headers }),
    config.origin,
  );
  if (!target) return new Response(null, { status: 400 });
  return new Response(null, {
    status: 307,
    headers: { Location: target.href, "Cache-Control": "private, no-store" },
  });
}
