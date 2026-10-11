// Push-only worker: never cache pages, API responses, or authenticated content.
const ROOM_PATH =
  /^\/rooms\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_PATH =
  /^\/events\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANAGEMENT_PATH =
  /^\/management\/events\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeNotificationUrl(value) {
  if (typeof value !== "string" || value.length > 512) return "/";
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin || url.username || url.password) return "/";
    if (url.pathname === "/" || url.pathname === "/stories") {
      const post = url.searchParams.get("post");
      return post && POST_ID.test(post) ? `${url.pathname}?post=${post}` : url.pathname;
    }
    if (
      url.pathname === "/mypage" ||
      url.pathname === "/participation" ||
      url.pathname === "/notifications" ||
      url.pathname === "/management" ||
      EVENT_PATH.test(url.pathname) ||
      ROOM_PATH.test(url.pathname) ||
      MANAGEMENT_PATH.test(url.pathname)
    )
      return url.pathname;
  } catch {}
  return "/";
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    const value = event.data?.json();
    if (value && typeof value === "object" && !Array.isArray(value)) payload = value;
  } catch {}
  const title = typeof payload.title === "string" ? payload.title.slice(0, 120) : "Sliper";
  const body =
    typeof payload.body === "string"
      ? payload.body.slice(0, 240)
      : "새로운 알림이 있어요. Sliper에서 확인해주세요.";
  const options = {
    body,
    icon: "/images/sliper-icon-192.png",
    data: { url: safeNotificationUrl(payload.url) },
    ...(typeof payload.tag === "string" ? { tag: payload.tag.slice(0, 120) } : {}),
  };
  event.waitUntil(self.registration.showNotification(title || "Sliper", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safeNotificationUrl(event.notification.data?.url);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (!("focus" in client) || new URL(client.url).href !== target) continue;
        try {
          await client.focus();
          return;
        } catch {}
      }
      await self.clients.openWindow(target);
    })(),
  );
});
