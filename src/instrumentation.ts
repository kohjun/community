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
  console.log("Sliper notification worker ready.");
}
