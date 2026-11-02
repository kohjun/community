import { TownAOI, townVoiceTargets } from "./town-spatial";
import { TownMovementValidator } from "./town-movement";
import { randomUUID } from "node:crypto";
import { evaluateContentPolicy } from "../domain/content-policy";
import {
  TOWN_CAPACITY,
  TOWN_SEATS,
  TOWN_RECONNECT_MS,
  TOWN_CHAT_TTL,
  type TownAvatar,
  type TownChat,
  type TownInput,
  type TownSnapshot,
} from "../domain/town";
export type TownMember = { actor: string; publicId: string; nickname: string; blocked: string[] };
type Resident = {
  member: TownMember;
  avatar: TownAvatar;
  connection: string | null;
  lostAt: number;
  input: { x: number; z: number; at: number };
  chatAt: number;
  waveAt: number;
  sequence: number;
  reportSequence: number;
  validator: TownMovementValidator;
  visible: Set<string>;
  voice: Set<string>;
};
type Message = { public: TownChat; actor: string; publicId: string; audience: Set<string> | null };
export class TownWorld {
  readonly residents = new Map<string, Resident>();
  private messages: Message[] = [];
  private readonly aoi = new TownAOI();
  constructor(
    private readonly now: () => number = Date.now,
    readonly capacity = TOWN_CAPACITY,
  ) {}
  join(member: TownMember, connection: string) {
    this.expire();
    let entry = this.residents.get(member.actor);
    const replaced = entry?.connection ?? null;
    if (!entry) {
      if (this.residents.size >= this.capacity)
        throw new Error("광장이 가득 찼어요. 잠시 뒤 다시 입장해주세요.");
      const index = this.residents.size;
      entry = {
        member,
        connection,
        lostAt: 0,
        input: { x: 0, z: 0, at: 0 },
        chatAt: -Infinity,
        waveAt: -Infinity,
        sequence: 0,
        reportSequence: 0,
        validator: new TownMovementValidator(this.now()),
        visible: new Set(),
        voice: new Set(),
        avatar: {
          id: randomUUID(),
          sequence: 0,
          nickname: member.nickname,
          color: index % 6,
          x: -4.5 + (index % 10),
          z: 9 + Math.floor(index / 10) * 0.45,
          yaw: Math.PI,
          moving: false,
          online: true,
          seat: null,
          wavingUntil: 0,
        },
      };
      this.residents.set(member.actor, entry);
    }
    entry.sequence = 0;
    entry.reportSequence = 0;
    entry.avatar.sequence = 0;
    entry.validator = new TownMovementValidator(this.now());
    entry.member = member;
    entry.avatar.nickname = member.nickname;
    entry.connection = connection;
    entry.avatar.online = true;
    entry.lostAt = 0;
    entry.input = { x: 0, z: 0, at: 0 };
    this.aoi.update(member.actor, entry.avatar.x, entry.avatar.z);
    return { id: entry.avatar.id, replaced };
  }
  disconnect(actor: string, connection: string) {
    const p = this.residents.get(actor);
    if (!p || p.connection !== connection) return;
    p.connection = null;
    p.lostAt = this.now();
    p.input = { x: 0, z: 0, at: 0 };
    p.avatar.online = false;
    p.avatar.moving = false;
  }
  remove(actor: string, connection?: string) {
    const p = this.residents.get(actor);
    if (p && (!connection || p.connection === connection)) {
      this.residents.delete(actor);
      this.aoi.remove(actor);
    }
  }
  updateMember(member: TownMember) {
    const p = this.residents.get(member.actor);
    if (p) {
      p.member = member;
      p.avatar.nickname = member.nickname;
    }
  }
  private visible(actor: string, other: string) {
    const a = this.residents.get(actor),
      b = this.residents.get(other);
    return (
      actor === other ||
      (!!a && !a.member.blocked.includes(other) && !b?.member.blocked.includes(actor))
    );
  }
  input(actor: string, connection: string, input: TownInput) {
    const p = this.residents.get(actor),
      now = this.now();
    if (!p || p.connection !== connection) throw new Error("광장에 다시 입장해주세요.");
    switch (input.type) {
      case "move":
        throw new Error("위치 보고 형식을 확인해주세요.");
      case "input": {
        if (input.sequence <= p.sequence || Math.hypot(input.moveX, input.moveZ) > 1.01)
          throw new Error("이동 순서를 확인해주세요.");
        p.sequence = input.sequence;
        p.input = { x: input.moveX, z: input.moveZ, at: now };
        break;
      }
      case "report": {
        if (input.sequence !== p.sequence || input.sequence <= p.reportSequence)
          throw new Error("위치 보고 순서를 확인해주세요.");
        p.reportSequence = input.sequence;
        if (p.avatar.seat) return;
        if (!p.validator.accept(p.avatar, input.position, p.input, now))
          throw new Error("movement_validation");
        p.avatar.x = input.position.x;
        p.avatar.z = input.position.z;
        p.avatar.yaw = input.rotationY;
        p.avatar.sequence = input.sequence;
        p.avatar.moving = Math.hypot(p.input.x, p.input.z) > 0.01;
        this.aoi.update(actor, p.avatar.x, p.avatar.z);
        break;
      }
      case "chat": {
        if (now - p.chatAt < 1500) throw new Error("채팅은 잠시 간격을 두고 보내주세요.");
        const result = evaluateContentPolicy([{ label: "채팅", text: input.text }]);
        if (!result.allowed) throw new Error(result.message);
        p.chatAt = now;
        this.messages.push({
          actor,
          publicId: p.member.publicId,
          audience:
            input.channel === "nearby"
              ? new Set(this.aoi.nearby(p.avatar.x, p.avatar.z, 15))
              : null,
          public: {
            id: randomUUID(),
            author: p.avatar.id,
            nickname: p.member.nickname,
            text: input.text,
            channel: input.channel,
            at: now,
          },
        });
        this.messages = this.messages.slice(-100);
        break;
      }
      case "wave":
        if (now - p.waveAt >= 3000) {
          p.waveAt = now;
          p.avatar.wavingUntil = now + 2500;
        }
        break;
      case "sit": {
        const seat = TOWN_SEATS.find((s) => s.id === input.seat)!;
        if (Math.hypot(seat.x - p.avatar.x, seat.z - p.avatar.z) > 2.2)
          throw new Error("벤치 가까이로 이동해주세요.");
        if (
          [...this.residents.values()].some((other) => other !== p && other.avatar.seat === seat.id)
        )
          throw new Error("이미 누군가 앉아 있어요. 다른 자리를 골라주세요.");
        p.avatar.seat = seat.id;
        p.avatar.x = seat.x;
        p.avatar.z = seat.z;
        p.avatar.yaw = seat.yaw;
        p.avatar.moving = false;
        this.aoi.update(actor, p.avatar.x, p.avatar.z);
        p.input = { x: 0, z: 0, at: 0 };
        break;
      }
      case "stand":
        p.avatar.seat = null;
        break;
      case "leave":
        this.remove(actor, connection);
        break;
    }
  }
  tick() {
    this.expire();
    for (const p of this.residents.values())
      if (this.now() - p.input.at > 500) p.avatar.moving = false;
  }
  private expire() {
    const now = this.now();
    for (const [actor, p] of this.residents)
      if (!p.connection && now - p.lostAt >= TOWN_RECONNECT_MS) {
        this.residents.delete(actor);
        this.aoi.remove(actor);
      }
    this.messages = this.messages.filter((m) => now - m.public.at < TOWN_CHAT_TTL);
  }
  view(actor: string): TownSnapshot | null {
    this.expire();
    const me = this.residents.get(actor);
    if (!me) return null;
    const candidates = this.aoi.nearby(me.avatar.x, me.avatar.z, 45);
    const visible = new Set(
      candidates.filter((id) => {
        const p = this.residents.get(id)!;
        return (
          this.visible(actor, id) &&
          Math.hypot(p.avatar.x - me.avatar.x, p.avatar.z - me.avatar.z) <=
            (me.visible.has(id) ? 45 : 40)
        );
      }),
    );
    me.visible = visible;
    return {
      type: "state",
      plaza: "sunny",
      me: me.avatar.id,
      now: this.now(),
      capacity: this.capacity,
      occupancy: this.residents.size,
      players: [...this.residents.values()]
        .filter((p) => visible.has(p.member.actor))
        .map((p) => ({ ...p.avatar })),
      messages: this.messages
        .filter((m) => (!m.audience || m.audience.has(actor)) && this.visible(actor, m.actor))
        .map((m) => ({ ...m.public })),
    };
  }
  voiceTargets(actor: string) {
    const p = this.residents.get(actor);
    if (!p) return [];
    const candidates = this.aoi
      .nearby(p.avatar.x, p.avatar.z, 18)
      .filter((id) => id !== actor && this.visible(actor, id))
      .map((id) => this.residents.get(id)!.avatar);
    const targets = townVoiceTargets(p.avatar, candidates, p.voice);
    p.voice = new Set(targets);
    return targets;
  }
  evidence(actor: string, target: string, kind: "message" | "player") {
    this.expire();
    if (!this.residents.has(actor)) throw new Error("광장에 입장한 뒤 다시 시도해주세요.");
    if (kind === "message") {
      const m = this.messages.find((m) => m.public.id === target);
      if (
        !m ||
        (m.audience && !m.audience.has(actor)) ||
        !this.visible(actor, m.actor) ||
        m.actor === actor
      )
        throw new Error("신고할 대화를 찾지 못했어요.");
      return {
        publicId: m.publicId,
        text: `[슬리퍼 타운 채팅] ${new Date(m.public.at).toISOString()}\n${m.public.nickname}: ${m.public.text}`,
      };
    }
    const p = [...this.residents.values()].find((p) => p.avatar.id === target);
    if (!p || !this.visible(actor, p.member.actor) || p.member.actor === actor)
      throw new Error("사용자를 찾지 못했어요.");
    return { publicId: p.member.publicId, text: `[슬리퍼 타운] 광장 참가자 ${p.member.nickname}` };
  }
}
