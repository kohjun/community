import { z } from "zod";
import { getDatabase } from "@/db/client";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { currentActor } from "@/server/identity";
import { requireActor } from "@/server/errors";
import { safetyService } from "@/server/safety-service";
import { townInternal } from "@/server/town-internal";
import { enforceRequestLimit } from "@/server/request-limits";
const input = z.strictObject({
  action: z.enum(["report", "block"]),
  target: z.string().uuid(),
  kind: z.enum(["message", "player"]),
  reason: z
    .enum(["spam", "fraud", "harassment", "hate", "sexual", "privacy", "unsafe", "other"])
    .default("harassment"),
  detail: z.string().trim().max(1000).default(""),
});
export const runtime = "nodejs";
export async function POST(request: Request) {
  return apiResponse(async () => {
    assertSameOrigin(request);
    const actor = requireActor(await currentActor()),
      value = input.parse(await readJson(request, 2048)),
      db = getDatabase();
    await enforceRequestLimit(db, actor, "town-safety", 30);
    const evidence = await townInternal("/internal/evidence", {
      actor,
      target: value.target,
      kind: value.kind,
    });
    const service = safetyService(db),
      target = { targetType: "player" as const, targetId: evidence.publicId };
    if (value.action === "block") {
      await service.block(actor, target);
      // The DB change remains authoritative even if a transient refresh fails; periodic recheck follows.
      await townInternal("/internal/refresh", {}).catch(() => {});
      return { saved: true };
    }
    await service.report(actor, {
      ...target,
      reason: value.reason,
      detail: `${evidence.text}\n${value.detail}`.slice(0, 2000),
    });
    return { saved: true };
  });
}
