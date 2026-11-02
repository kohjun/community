import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
  type ParticipantInfo,
} from "livekit-server-sdk";
export function townVoiceConfig(env: Record<string, string | undefined> = process.env) {
  if (
    !env.LIVEKIT_URL ||
    !env.LIVEKIT_API_KEY ||
    !env.LIVEKIT_API_SECRET ||
    env.TOWN_VOICE_SERVER_SUBSCRIPTIONS_VERIFIED !== "true"
  )
    return null;
  const url = new URL(env.LIVEKIT_URL);
  if (url.protocol !== "wss:") throw new Error("LiveKit requires WSS.");
  return {
    url: url.origin.replace("https:", "wss:"),
    key: env.LIVEKIT_API_KEY,
    secret: env.LIVEKIT_API_SECRET,
  };
}
export async function issueTownVoiceToken(
  identity: string,
  config: NonNullable<ReturnType<typeof townVoiceConfig>>,
) {
  const token = new AccessToken(config.key, config.secret, { identity, ttl: 60 });
  // Client-side subscribe requests are forbidden; RoomService manages subscriptions.
  token.addGrant({
    roomJoin: true,
    room: "sliper-town-main-world",
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canPublishData: false,
    canSubscribe: false,
    canUpdateOwnMetadata: false,
  });
  return { url: config.url, token: await token.toJwt(), roomName: "sliper-town-main-world" };
}
export class TownVoicePolicy {
  private busy = false;
  private applied = new Map<string, Set<string>>();
  constructor(
    private readonly service: Pick<
      RoomServiceClient,
      "listParticipants" | "updateSubscriptions" | "removeParticipant"
    >,
    private readonly room = "sliper-town-main-world",
  ) {}
  async remove(identity: string) {
    this.applied.delete(identity);
    if (identity) await this.service.removeParticipant(this.room, identity).catch(() => {});
  }
  async sync(targets: Map<string, string[]>) {
    if (this.busy) return;
    this.busy = true;
    let participants: ParticipantInfo[] = [];
    try {
      participants = await this.service.listParticipants(this.room);
      // Never allow a stale voice connection to survive leaving / blocking / account revocation.
      for (const p of participants) if (!targets.has(p.identity)) await this.remove(p.identity);
      const tracks = new Map(
        participants.map((p) => [
          p.identity,
          p.tracks.filter((t) => t.source === TrackSource.MICROPHONE).map((t) => t.sid),
        ]),
      );
      for (const p of participants) {
        const allowed = targets.get(p.identity);
        if (!allowed) continue;
        const desired = new Set(allowed.slice(0, 12).flatMap((id) => tracks.get(id) ?? [])),
          previous = this.applied.get(p.identity) ?? new Set<string>();
        const revoke = [...previous].filter((id) => !desired.has(id)),
          grant = [...desired].filter((id) => !previous.has(id));
        // Revoke before granting so a move never transiently exceeds the target set.
        if (revoke.length)
          await this.service.updateSubscriptions(this.room, p.identity, revoke, false);
        if (grant.length)
          await this.service.updateSubscriptions(this.room, p.identity, grant, true);
        this.applied.set(p.identity, desired);
      }
    } catch (error) {
      await Promise.all(participants.map((p) => this.remove(p.identity)));
      this.applied.clear();
      throw error;
    } finally {
      this.busy = false;
    }
  }
}
export function createTownVoicePolicy() {
  const config = townVoiceConfig();
  return config
    ? new TownVoicePolicy(
        new RoomServiceClient(config.url.replace("wss:", "https:"), config.key, config.secret),
      )
    : null;
}
