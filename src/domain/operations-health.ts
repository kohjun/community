export interface HealthQueue {
  key: "inbox" | "push" | "video";
  label: string;
  waiting: number;
  processing: number;
  retrying: number;
  failed: number;
  staleLeases: number;
  oldestWaitingAt: string | null;
  latestCompletedAt: string | null;
}
export interface OperationsHealth {
  checkedAt: string;
  queues: HealthQueue[];
  media: {
    abandonedImages: number;
    abandonedVideos: number;
    videoSourcesToClean: number;
    videoOutputsToClean: number;
  };
  configuration: {
    mediaStorage: "local" | "supabase" | "invalid";
    roomUpdates: "configured" | "disabled" | "invalid";
    push: "configured" | "disabled" | "invalid";
    pushWorker: "embedded" | "external" | "invalid";
  };
}
