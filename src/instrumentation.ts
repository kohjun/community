import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ initServerSentry }, { createLogger }] = await Promise.all([
    import("./server/sentry-init"),
    import("./server/logger"),
  ]);
  const logger = createLogger("instrumentation");
  initServerSentry("sliper-web");

  const { pushConfiguration, isLocalPushDevelopment } = await import("./server/push-configuration");
  const embedded =
    process.env.PUSH_WORKER_MODE === "embedded" ||
    (process.env.PUSH_WORKER_MODE !== "external" &&
      process.env.NODE_ENV === "development" &&
      isLocalPushDevelopment());
  if (!embedded) return;
  const config = pushConfiguration();
  const state = globalThis as unknown as { sliperPushWorker?: { stop(): Promise<void> } };
  if (state.sliperPushWorker) return;
  const [{ getDatabase }, { startPushWorker }] = await Promise.all([
    import("./db/client"),
    import("./server/push-worker-loop"),
  ]);
  state.sliperPushWorker = startPushWorker(getDatabase(), config, { unref: true });
  logger.info("Sliper notification worker ready.");
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [Sentry, { createLogger, logSafeError }, { isServerSentryEnabled }, { sanitizeRoutePath }] =
    await Promise.all([
      import("@sentry/nextjs"),
      import("./server/logger"),
      import("./server/sentry-init"),
      import("./domain/observability"),
    ]);
  const safePath = sanitizeRoutePath(request.path);
  logSafeError(createLogger("next-request"), "Unhandled Next.js request error", error, {
    method: request.method,
    path: safePath,
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
  });
  if (isServerSentryEnabled()) {
    Sentry.captureRequestError(
      error,
      {
        path: safePath,
        method: request.method,
        headers: {},
      },
      context,
    );
  }
};
