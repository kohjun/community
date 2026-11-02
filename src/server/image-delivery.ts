/** Invoke only after the current request has passed the parent asset's access checks. */
export async function authorizedImageResponse(
  request: Request | undefined,
  image: {
    id: string;
    contentType: string;
    byteSize: number;
    browserCache: boolean;
  },
  load: () => Promise<Uint8Array>,
) {
  const headers = new Headers({
    "Content-Type": image.contentType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": image.browserCache
      ? "private, no-cache, must-revalidate"
      : "private, no-store",
    "Content-Disposition": "inline",
    Vary: "Cookie",
  });
  if (image.browserCache) {
    // Uploaded object IDs are immutable and never upserted; replacements get a new UUID.
    const etag = '"sliper-image-v1-' + image.id + "-" + image.byteSize + '"';
    headers.set("ETag", etag);
    const matches = request?.headers
      .get("if-none-match")
      ?.split(",")
      .some((value) => {
        const tag = value.trim().replace(/^W\//, "");
        return tag === "*" || tag === etag;
      });
    if (matches && (!request || ["GET", "HEAD"].includes(request.method)))
      return new Response(null, { status: 304, headers });
  }
  headers.set("Content-Length", String(image.byteSize));
  if (request?.method === "HEAD") return new Response(null, { headers });
  const bytes = await load();
  return new Response(new Uint8Array(bytes), { headers });
}
