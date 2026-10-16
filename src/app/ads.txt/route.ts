import { isAdvertisingOrigin, produceAdsTxt } from "@/domain/advertising";
import { getAdvertisingConfiguration } from "@/server/advertising-config";

export async function GET(request: Request) {
  const configuration = getAdvertisingConfiguration();
  const contents = produceAdsTxt(configuration);
  const matchesDomain = isAdvertisingOrigin(new URL(request.url).origin, configuration.siteOrigin);
  return new Response(contents && matchesDomain ? contents : "Not found\n", {
    status: contents && matchesDomain ? 200 : 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
