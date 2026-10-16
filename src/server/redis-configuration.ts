import { isIP } from "node:net";

/** Static URL parsing only. Never connects to Redis or serializes credentials. */
export function parseRedisConfiguration(value: string | undefined) {
  try {
    const url = new URL(value?.trim() ?? "");
    if (!["redis:", "rediss:"].includes(url.protocol)) return null;
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const address = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    if (!host || (url.port && Number(url.port) === 0)) return null;
    if (!isIP(address)) {
      if (
        host.length > 253 ||
        /^\d+(?:\.\d+){3}$/.test(host) ||
        !host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
      )
        return null;
    }
    // Match node-redis's URL database index rather than accepting an unusable path.
    if (
      url.pathname &&
      url.pathname !== "/" &&
      (!/^\/\d+$/.test(url.pathname) || !Number.isSafeInteger(Number(url.pathname.slice(1))))
    )
      return null;
    return url;
  } catch {
    return null;
  }
}
export function isPrivateRedisHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (isIP(host) === 0 && !host.includes("."))
  )
    return true;
  if (isIP(host) === 4)
    return /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (isIP(host) === 6) {
    if (host === "::1" || /^(f[cd]|fe[89ab])/.test(host)) return true;
    const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(host);
    if (mapped) {
      const high = parseInt(mapped[1]!, 16),
        low = parseInt(mapped[2]!, 16);
      return isPrivateRedisHost(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
  }
  return false;
}
