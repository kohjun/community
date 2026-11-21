import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
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
  const { createLogger } = await import("./server/logger");
  createLogger("instrumentation").info("Sliper notification worker ready.");
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { createLogger, logSafeError } = await import("./server/logger");
  logSafeError(createLogger("next-request"), "Unhandled Next.js request error", error, {
    method: request.method,
    path: request.path,
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
  });
};
