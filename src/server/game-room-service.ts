import { roomSettings, roomSettingsVersion } from "./game-room-settings";
import {
  newToast,
  startToast,
  askToast,
  answerToast,
  tickToast,
  nextToast,
  skipToast,
  abortToast,
  lastWordToast,
  toastView,
} from "./toast-game";
import {
  newAuction,
  startAuction,
  openAuction,
  bidAuction,
  settleAuction,
  tickAuction,
  nextAuction,
  abortAuction,
  auctionView,
} from "./auction-game";
import {
  advanceIntro,
  newIntro,
  startIntro,
  submitIntro,
  endIntroRound,
  nextIntroRound,
  introView,
} from "./mbti-intro";
import {
  newWordGame,
  newMbti,
  startMbti,
  tickMbti,
  voteMbti,
  tallyMbti,
  nextMbti,
  guessMbti,
  mbtiView,
} from "./mbti-game";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { gameRooms, gamePlayers, gameRequestLimits } from "../db/game-room-schema";
import { memberSafety } from "../db/safety-schema";
import { membershipActive } from "../domain/safety";
import {
  createGameRoomSchema,
  gameHostActionSchema,
  gamePlayerActionSchema,
  gameRoomId,
  GAME_LEASE_MS,
  GAME_MAX_QUEUE,
  GAME_ROOM_TTL_MS,
  type GameRoomView,
} from "../domain/game-room";
import { evaluateContentPolicy } from "../domain/content-policy";
import { AppError, requireActor } from "./errors";
import { enforceRequestLimit } from "./request-limits";
type Room = typeof gameRooms.$inferSelect;
type Player = typeof gamePlayers.$inferSelect;
export type GamePrincipal = { identityHash: string; networkHash: string; actor: string | null };
export function gameRoomService(
  db: Database,
  options: { now?: () => Date; wake?: (id: string) => Promise<void> } = {},
) {
  const clock = options.now ?? (() => new Date());
  async function active(tx: Database, actor: string | null) {
    const id = requireActor(actor);
    const [state] = await tx.select().from(memberSafety).where(eq(memberSafety.userId, id));
    if (!membershipActive(state, clock()))
      throw new AppError("FORBIDDEN", "이용 가능한 계정으로 로그인해주세요.");
    return id;
  }
  function policy(label: string, text: string) {
    const result = evaluateContentPolicy([{ label, text }]);
    if (!result.allowed) throw new AppError("VALIDATION", result.message);
  }
  async function limit(
    tx: Database,
    roomId: string,
    subjectHash: string,
    count: number,
    now: Date,
  ) {
    const window = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const result = await tx
      .insert(gameRequestLimits)
      .values({ roomId, subjectHash, count: 1, windowStartedAt: window })
      .onConflictDoUpdate({
        target: [gameRequestLimits.roomId, gameRequestLimits.subjectHash],
        set: {
          windowStartedAt: window,
          count: sql`case when ${gameRequestLimits.windowStartedAt} = ${window.toISOString()}::timestamptz then ${gameRequestLimits.count} + 1 else 1 end`,
        },
        setWhere: sql`${gameRequestLimits.windowStartedAt} <> ${window.toISOString()}::timestamptz or ${gameRequestLimits.count} < ${count}`,
      })
      .returning();
    if (!result.length) throw new AppError("RATE_LIMITED", "잠시 쉬었다가 다시 시도해주세요.");
  }
  async function withRoom(
    id: string,
    who: GamePrincipal,
    work: (
      tx: Database,
      room: Room,
      players: Player[],
      now: Date,
      changed: () => void,
    ) => Promise<void>,
  ) {
    const roomId = gameRoomId.parse(id);
    let dirty = false;
    const view = await db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      await tx.execute(sql`set local statement_timeout = '5s'`);
      const [found] = await tx
        .select()
        .from(gameRooms)
        .where(eq(gameRooms.id, roomId))
        .for("update");
      if (!found) throw new AppError("NOT_FOUND", "게임방을 찾을 수 없어요.");
      const room: Room = found;
      if (who.actor !== null && who.actor !== room.hostId)
        throw new AppError("FORBIDDEN", "이 방의 호스트 계정으로 로그인해주세요.");
      const now = clock();
      if (room.expiresAt <= now)
        throw new AppError("NOT_FOUND", "사용 기간이 지난 게임방이에요. 새 방을 열어주세요.");
      const players = await tx
        .select()
        .from(gamePlayers)
        .where(eq(gamePlayers.roomId, roomId))
        .orderBy(asc(gamePlayers.ticket));
      const changed = () => {
        dirty = true;
      };
      // Lobby leases free abandoned seats. During a round, membership is frozen until the host finishes.
      async function reconcile() {
        if (room.phase !== "lobby") return;
        for (const p of players) {
          if (
            ["admitted", "waiting"].includes(p.status) &&
            now.getTime() - p.lastSeenAt.getTime() >= GAME_LEASE_MS
          ) {
            if (room.intro) delete room.intro.registered[p.id];
            p.status = "left";
            p.ready = false;
            await tx
              .update(gamePlayers)
              .set({ status: "left", ready: false })
              .where(eq(gamePlayers.id, p.id));
            changed();
          }
        }
        let free = room.capacity - players.filter((p) => p.status === "admitted").length;
        for (const p of players) {
          if (free <= 0) break;
          if (p.status !== "waiting") continue;
          p.status = "admitted";
          p.ready = false;
          p.nickname = null;
          await tx
            .update(gamePlayers)
            .set({ status: p.status, ready: false, nickname: null })
            .where(eq(gamePlayers.id, p.id));
          free--;
          changed();
        }
      }
      await reconcile();
      if (room.phase === "playing" && room.mbti && tickMbti(room.mbti, now.getTime())) changed();
      if (room.phase === "playing" && room.auction && tickAuction(room.auction, now.getTime())) {
        if (room.auction.stage === "result") room.phase = "finished";
        changed();
      }
      if (room.phase === "playing" && room.toast && tickToast(room.toast, now.getTime())) {
        if (room.toast.stage === "result") room.phase = "finished";
        changed();
      }
      await work(tx, room, players, now, changed);
      await reconcile();
      if (dirty) {
        room.revision++;
        await tx
          .update(gameRooms)
          .set({
            title: room.title,
            capacity: room.capacity,
            minPlayers: room.minPlayers,
            toast: room.toast,
            auction: room.auction,
            intro: room.intro,
            mbti: room.mbti,
            phase: room.phase,
            revision: room.revision,
            round: room.round,
            nextTicket: room.nextTicket,
            startedAt: room.startedAt,
          })
          .where(eq(gameRooms.id, roomId));
      }
      const host = who.actor !== null && who.actor === room.hostId;
      if (host) await active(tx, who.actor);
      const me = players.find((p) => p.identityHash === who.identityHash);
      const admitted = players.filter((p) => p.status === "admitted");
      const waiting = players.filter((p) => p.status === "waiting");
      const access = host || (!!me && ["admitted", "waiting"].includes(me.status));
      const online = (p: Player) => now.getTime() - p.lastSeenAt.getTime() < GAME_LEASE_MS;
      return {
        settings: access ? roomSettings(room) : null,
        settingsVersion: access ? roomSettingsVersion(room) : null,
        toast:
          room.toast && (host || me?.status === "admitted") && room.phase !== "closed"
            ? toastView(room.toast, host ? null : (me?.id ?? null), now.getTime())
            : null,
        gameType: room.toast
          ? "toast"
          : room.auction
            ? "auction"
            : room.intro
              ? "mbti-intro"
              : room.mbti?.words
                ? "word-liar"
                : room.mbti
                  ? "mbti"
                  : "lobby",
        auction:
          room.auction && (host || me?.status === "admitted") && room.phase !== "closed"
            ? auctionView(room.auction, host ? null : (me?.id ?? null), now.getTime())
            : null,
        mbtiIntro:
          room.intro && (host || me?.status === "admitted") && room.phase !== "closed"
            ? introView(room.intro, host ? null : (me?.id ?? null), now.getTime())
            : null,
        mbti:
          room.mbti && (host || me?.status === "admitted") && room.phase !== "closed"
            ? mbtiView(room.mbti, host ? null : (me?.id ?? null), now.getTime())
            : null,
        id: room.id,
        title: room.title,
        capacity: room.capacity,
        minPlayers: room.minPlayers,
        phase: room.phase,
        revision: room.revision,
        round: room.round,
        startedAt: room.startedAt?.toISOString() ?? null,
        expiresAt: room.expiresAt.toISOString(),
        isHost: host,
        canStart:
          host &&
          room.phase === "lobby" &&
          admitted.length >= room.minPlayers &&
          (!room.auction || admitted.length < room.auction.settings.maxRounds) &&
          admitted.every(
            (p) =>
              p.ready &&
              !!p.nickname &&
              online(p) &&
              (!room.intro || !!room.intro.registered[p.id]),
          ),
        waitingCount: waiting.length,
        readyCount: admitted.filter((p) => p.ready).length,
        viewer: {
          id: host ? null : (me?.id ?? null),
          status: host ? "host" : (me?.status ?? "new"),
          nickname: host ? null : (me?.nickname ?? null),
          ready: host ? false : (me?.ready ?? false),
          queuePosition:
            !host && me?.status === "waiting" ? waiting.findIndex((p) => p.id === me.id) + 1 : null,
        },
        players: access
          ? admitted.map((p) => ({
              id: p.id,
              nickname: p.nickname,
              ready: p.ready,
              online: online(p),
            }))
          : [],
        waiting: host ? waiting.map((p, i) => ({ id: p.id, position: i + 1 })) : [],
      } satisfies GameRoomView;
    });
    // Publish only after COMMIT. Hints contain a room UUID, never players or credentials.
    if (dirty) await options.wake?.(roomId);
    return view;
  }
  return {
    async mine(actor: string | null) {
      const id = await active(db, actor);
      return db
        .select({
          id: gameRooms.id,
          title: gameRooms.title,
          phase: gameRooms.phase,
          expiresAt: gameRooms.expiresAt,
        })
        .from(gameRooms)
        .where(and(eq(gameRooms.hostId, id), gt(gameRooms.expiresAt, clock())))
        .orderBy(desc(gameRooms.createdAt), desc(gameRooms.id))
        .limit(12);
    },
    async create(actor: string | null, input: unknown) {
      const hostId = await active(db, actor);
      const value = createGameRoomSchema.parse(input);
      if (
        ["mbti", "mbti-intro", "word-liar", "auction", "toast"].includes(value.gameType) &&
        (value.minPlayers < 3 || value.capacity < 3)
      )
        throw new AppError("VALIDATION", "이 게임은 최소 3명으로 설정해주세요.");
      policy("방 제목", value.title);
      await enforceRequestLimit(db, hostId, "game-create", 5);
      const [room] = await db
        .insert(gameRooms)
        .values({
          title: value.title,
          capacity: value.capacity,
          minPlayers: value.minPlayers,
          toast:
            value.gameType === "toast"
              ? newToast({
                  mode: value.toastMode,
                  rounds: value.toastRounds,
                  answerSeconds: value.toastAnswerSeconds,
                })
              : null,
          auction:
            value.gameType === "auction"
              ? newAuction({
                  maxRounds: value.auctionRounds,
                  initialMoney: value.auctionInitialMoney,
                  bidSeconds: value.auctionBidSeconds,
                })
              : null,
          intro: value.gameType === "mbti-intro" ? newIntro(value.maxRounds) : null,
          mbti:
            value.gameType === "word-liar"
              ? newWordGame(value.wordCategory, value.wordMode)
              : value.gameType === "mbti"
                ? newMbti(value.revealLiar)
                : null,
          hostId,
          expiresAt: new Date(clock().getTime() + GAME_ROOM_TTL_MS),
        })
        .returning({ id: gameRooms.id });
      return { id: room!.id };
    },
    read(id: string, who: GamePrincipal) {
      return withRoom(id, who, async () => {});
    },
    connect(id: string, who: GamePrincipal) {
      return withRoom(id, who, async (tx, room, players, now, changed) => {
        if (who.actor === room.hostId) return; // Hosts do not occupy a player seat.
        if (room.phase === "closed") throw new AppError("CONFLICT", "종료된 게임방이에요.");
        const me = players.find((p) => p.identityHash === who.identityHash);
        if (me?.status === "kicked")
          throw new AppError("FORBIDDEN", "진행자가 이 기기의 입장을 제한했어요.");
        if (me && ["admitted", "waiting"].includes(me.status)) {
          me.lastSeenAt = now;
          await tx.update(gamePlayers).set({ lastSeenAt: now }).where(eq(gamePlayers.id, me.id));
          return;
        }
        await limit(tx, room.id, who.identityHash, 20, now);
        await limit(tx, room.id, who.networkHash, 180, now);
        if (players.filter((p) => p.status === "waiting").length >= GAME_MAX_QUEUE)
          throw new AppError("CONFLICT", "대기열이 가득 찼어요. 잠시 후 다시 접속해주세요.");
        // Room row lock serializes ticket allocation and admission across all server instances.
        if (!me && players.length >= 500)
          throw new AppError("RATE_LIMITED", "이 방의 접속 한도에 도달했어요. 새 방을 열어주세요.");
        const ticket = room.nextTicket++;
        if (me) {
          Object.assign(me, {
            ticket,
            status: "waiting",
            ready: false,
            nickname: null,
            lastSeenAt: now,
            joinedAt: now,
          });
          await tx
            .update(gamePlayers)
            .set({
              ticket,
              status: "waiting",
              ready: false,
              nickname: null,
              lastSeenAt: now,
              joinedAt: now,
            })
            .where(eq(gamePlayers.id, me.id));
          players.sort((a, b) => a.ticket - b.ticket);
        } else {
          const [created] = await tx
            .insert(gamePlayers)
            .values({
              roomId: room.id,
              identityHash: who.identityHash,
              ticket,
              status: "waiting",
              lastSeenAt: now,
              joinedAt: now,
            })
            .returning();
          players.push(created!);
        }
        changed();
      });
    },
    player(id: string, who: GamePrincipal, input: unknown) {
      const value = gamePlayerActionSchema.parse(input);
      if (value.action === "nickname" || value.action === "intro-profile")
        policy("닉네임", value.nickname);
      if (value.action === "word-guess") policy("정답 입력", value.guess);
      if (value.action === "toast-question") policy("건배 질문", value.question);
      return withRoom(id, who, async (tx, room, players, now, changed) => {
        const me = players.find((p) => p.identityHash === who.identityHash);
        if (!me || !["admitted", "waiting"].includes(me.status))
          throw new AppError("FORBIDDEN", "먼저 게임방에 입장해주세요.");
        if (room.phase === "closed") throw new AppError("CONFLICT", "종료된 게임방이에요.");
        await limit(tx, room.id, who.identityHash, 50, now);
        if (
          value.action === "toast-question" ||
          value.action === "toast-answer" ||
          value.action === "toast-last-word"
        ) {
          if (!room.toast || me.status !== "admitted")
            throw new AppError("FORBIDDEN", "이번 게임에 입장한 참가자만 선택할 수 있어요.");
          if (value.action === "toast-last-word")
            lastWordToast(room.toast, me.id, value.targetId, value.turn);
          else {
            if (room.phase !== "playing")
              throw new AppError("CONFLICT", "진행 중인 게임에서 선택해주세요.");
            if (value.action === "toast-question")
              askToast(room.toast, me.id, value.turn, value.question, now.getTime());
            else
              answerToast(
                room.toast,
                me.id,
                value.turn,
                value.cheers,
                value.prediction,
                now.getTime(),
              );
          }
          if (room.toast.stage === "result") room.phase = "finished";
          changed();
          return;
        }
        if (value.action === "auction-bid") {
          if (room.phase !== "playing" || !room.auction || me.status !== "admitted")
            throw new AppError("FORBIDDEN", "이번 경매에 입장한 참가자만 입찰할 수 있어요.");
          bidAuction(room.auction, me.id, value.round, value.amount, now.getTime());
          changed();
          return;
        }
        if (value.action === "intro-turn-done") {
          if (room.phase !== "playing" || !room.intro || me.status !== "admitted")
            throw new AppError("FORBIDDEN", "이번 게임 참가자만 진행할 수 있어요.");
          advanceIntro(room.intro, me.id, value.round, value.turn, now.getTime());
          changed();
          return;
        }
        if (value.action === "intro-submit") {
          if (room.phase !== "playing" || !room.intro || me.status !== "admitted")
            throw new AppError("FORBIDDEN", "이번 게임 참가자만 제출할 수 있어요.");
          submitIntro(room.intro, me.id, value.round, value.guesses);
          if (room.intro.stage === "result") room.phase = "finished";
          changed();
          return;
        }
        if (
          value.action === "mbti-vote" ||
          value.action === "mbti-guess" ||
          value.action === "word-guess"
        ) {
          if (room.phase !== "playing" || !room.mbti || me.status !== "admitted")
            throw new AppError("FORBIDDEN", "이번 게임에 입장한 참가자만 참여할 수 있어요.");
          if (value.action === "mbti-vote") voteMbti(room.mbti, me.id, value.cycle, value.target);
          else {
            if ((value.action === "word-guess") !== !!room.mbti.words)
              throw new AppError("CONFLICT", "현재 게임의 정답 입력 방식을 사용해주세요.");
            guessMbti(room.mbti, me.id, value.cycle, value.guess);
            room.phase = "finished";
          }
          changed();
          return;
        }
        if (value.action === "heartbeat") {
          await tx.update(gamePlayers).set({ lastSeenAt: now }).where(eq(gamePlayers.id, me.id));
          me.lastSeenAt = now;
          return;
        }
        if (value.action === "leave") {
          if (room.intro && room.phase === "lobby") delete room.intro.registered[me.id];
          me.status = "left";
          me.ready = false;
        } else {
          if (room.phase !== "lobby" || me.status !== "admitted")
            throw new AppError("CONFLICT", "대기실에 입장한 후 설정할 수 있어요.");
          if (value.action === "nickname" || value.action === "intro-profile") {
            if (
              players.some(
                (p) =>
                  p.id !== me.id &&
                  p.status === "admitted" &&
                  p.nickname?.toLowerCase() === value.nickname.toLowerCase(),
              )
            )
              throw new AppError("CONFLICT", "이미 사용 중인 닉네임이에요.");
            if (value.action === "intro-profile") {
              if (!room.intro) throw new AppError("CONFLICT", "자기소개 게임이 아니에요.");
              room.intro.registered[me.id] = value.mbti;
            }
            me.nickname = value.nickname;
            me.ready = false;
          } else {
            if (!me.nickname) throw new AppError("VALIDATION", "닉네임을 먼저 정해주세요.");
            if (value.ready && room.intro && !room.intro.registered[me.id])
              throw new AppError("VALIDATION", "내 MBTI를 먼저 저장해주세요.");
            me.ready = value.ready;
          }
        }
        me.lastSeenAt = now;
        await tx
          .update(gamePlayers)
          .set({ status: me.status, nickname: me.nickname, ready: me.ready, lastSeenAt: now })
          .where(eq(gamePlayers.id, me.id));
        changed();
      });
    },
    host(id: string, who: GamePrincipal, input: unknown) {
      const value = gameHostActionSchema.parse(input);
      if (value.action === "settings") policy("방 제목", value.settings.title);
      return withRoom(id, who, async (tx, room, players, now, changed) => {
        if (!who.actor || who.actor !== room.hostId)
          throw new AppError("FORBIDDEN", "이 방의 호스트만 진행할 수 있어요.");
        await active(tx, who.actor);
        await limit(tx, room.id, who.identityHash, 50, now);
        if (value.action === "settings") {
          if (room.phase !== "lobby")
            throw new AppError(
              "CONFLICT",
              "대기실에서만 설정을 변경할 수 있어요. 게임 종료 후 다음 라운드를 준비해주세요.",
            );
          if (roomSettingsVersion(room) !== value.settingsVersion)
            throw new AppError(
              "CONFLICT",
              "다른 창에서 설정을 변경했어요. 최신 설정을 불러온 뒤 다시 저장해주세요.",
            );
          const previous = roomSettings(room),
            config = value.settings;
          if (config.gameType !== previous.gameType)
            throw new AppError(
              "VALIDATION",
              "이 방의 게임 종류는 바꿀 수 없어요. 현재 게임의 옵션을 변경해주세요.",
            );
          const joined = players.filter((p) => p.status === "admitted").length;
          if (config.gameType !== "lobby" && (config.capacity < 3 || config.minPlayers < 3))
            throw new AppError("VALIDATION", "이 게임은 최소 3명으로 설정해주세요.");
          if (config.capacity < joined)
            throw new AppError("CONFLICT", `현재 입장한 ${joined}명보다 정원을 줄일 수 없어요.`);
          if (room.auction && config.auctionRounds <= joined)
            throw new AppError("VALIDATION", "경매 라운드 수는 현재 참가자 수보다 많아야 해요.");
          const candidate = {
            ...room,
            title: config.title,
            capacity: config.capacity,
            minPlayers: config.minPlayers,
          };
          if (room.toast)
            candidate.toast = newToast({
              mode: config.toastMode,
              rounds: config.toastRounds,
              answerSeconds: config.toastAnswerSeconds,
            });
          if (room.auction)
            candidate.auction = newAuction({
              maxRounds: config.auctionRounds,
              initialMoney: config.auctionInitialMoney,
              bidSeconds: config.auctionBidSeconds,
            });
          if (room.intro)
            candidate.intro = {
              ...newIntro(config.maxRounds),
              registered: { ...room.intro.registered },
            };
          if (room.mbti)
            candidate.mbti = room.mbti.words
              ? newWordGame(config.wordCategory, config.wordMode)
              : newMbti(config.revealLiar);
          if (roomSettingsVersion(candidate) === value.settingsVersion) return;
          Object.assign(room, candidate);
          // Readiness, nickname, MBTI registrations and admission order are preserved.
          changed();
          return;
        }
        if (
          (value.action === "start" && room.phase === "playing") ||
          (value.action === "finish" && room.phase === "finished") ||
          (value.action === "close" && room.phase === "closed")
        )
          return;
        if (room.revision !== value.revision)
          throw new AppError("CONFLICT", "참가 현황이 바뀌었어요. 최신 상태에서 다시 눌러주세요.");
        if (room.phase === "closed") throw new AppError("CONFLICT", "종료된 게임방이에요.");
        if (value.action === "toast-next" || value.action === "toast-skip") {
          if (room.phase !== "playing" || !room.toast)
            throw new AppError("CONFLICT", "진행 중인 건배 게임이 아니에요.");
          if (value.action === "toast-next") nextToast(room.toast, value.turn);
          else skipToast(room.toast, value.turn);
          if (room.toast.stage === "result") room.phase = "finished";
          changed();
          return;
        }
        if (
          value.action === "auction-open" ||
          value.action === "auction-close" ||
          value.action === "auction-next"
        ) {
          if (room.phase !== "playing" || !room.auction || room.auction.round !== value.round)
            throw new AppError("CONFLICT", "진행 중인 경매의 현재 라운드에서 눌러주세요.");
          if (value.action === "auction-open")
            openAuction(room.auction, value.round, now.getTime());
          else if (value.action === "auction-next") nextAuction(room.auction, value.round);
          else {
            if (room.auction.stage !== "bidding")
              throw new AppError("CONFLICT", "입찰 중에만 마감할 수 있어요.");
            settleAuction(room.auction);
          }
          if (room.auction.stage === "result") room.phase = "finished";
          changed();
          return;
        }
        if (
          value.action === "intro-next" ||
          value.action === "intro-end-round" ||
          value.action === "intro-next-turn"
        ) {
          if (room.phase !== "playing" || !room.intro)
            throw new AppError("CONFLICT", "진행 중인 자기소개 게임이 아니에요.");
          if (value.action === "intro-next-turn")
            advanceIntro(room.intro, null, room.intro.round, room.intro.turn, now.getTime());
          else if (value.action === "intro-next") nextIntroRound(room.intro, now.getTime());
          else endIntroRound(room.intro);
          if (room.intro.stage === "result") room.phase = "finished";
          changed();
          return;
        }
        if (value.action === "mbti-next" || value.action === "mbti-tally") {
          if (room.phase !== "playing" || !room.mbti)
            throw new AppError("CONFLICT", "진행 중인 MBTI 게임이 아니에요.");
          if (value.action === "mbti-next") nextMbti(room.mbti, now.getTime());
          else tallyMbti(room.mbti);
          changed();
          return;
        }
        if (value.action === "start") {
          const joined = players.filter((p) => p.status === "admitted");
          if (
            room.phase !== "lobby" ||
            joined.length < room.minPlayers ||
            joined.some(
              (p) =>
                !p.ready || !p.nickname || now.getTime() - p.lastSeenAt.getTime() >= GAME_LEASE_MS,
            )
          )
            throw new AppError(
              "CONFLICT",
              "최소 인원이 모이고 입장한 참가자 모두 준비되어야 시작할 수 있어요.",
            );
          if (room.toast)
            startToast(
              room.toast,
              joined.map((p) => ({ id: p.id, nickname: p.nickname! })),
            );
          if (room.auction)
            startAuction(
              room.auction,
              joined.map((p) => ({ id: p.id, nickname: p.nickname! })),
            );
          if (room.intro)
            startIntro(
              room.intro,
              joined.map((p) => ({ id: p.id, nickname: p.nickname! })),
              now.getTime(),
            );
          if (room.mbti)
            startMbti(
              room.mbti,
              joined.map((p) => ({ id: p.id, nickname: p.nickname! })),
              now.getTime(),
            );
          room.phase = "playing";
          room.startedAt = now;
        } else if (value.action === "finish") {
          if (room.phase !== "playing")
            throw new AppError("CONFLICT", "진행 중인 라운드가 없어요.");
          if (room.toast) abortToast(room.toast);
          if (room.auction) abortAuction(room.auction);
          if (room.intro) room.intro.stage = "aborted";
          if (room.mbti) {
            room.mbti.stage = "aborted";
            room.mbti.endsAt = null;
          }
          room.phase = "finished";
        } else if (value.action === "reset") {
          if (room.phase !== "finished")
            throw new AppError("CONFLICT", "라운드를 종료한 후 다음 게임을 준비해주세요.");
          if (room.toast) room.toast = newToast(room.toast.settings);
          if (room.auction) room.auction = newAuction(room.auction.settings);
          if (room.intro) room.intro = newIntro(room.intro.maxRounds);
          if (room.mbti)
            room.mbti = room.mbti.words
              ? newWordGame(room.mbti.words.category, room.mbti.words.mode)
              : newMbti(room.mbti.revealLiar);
          room.phase = "lobby";
          room.startedAt = null;
          room.round++;
          for (const p of players) p.ready = false;
          await tx.update(gamePlayers).set({ ready: false }).where(eq(gamePlayers.roomId, room.id));
        } else if (value.action === "kick") {
          if (room.phase !== "lobby")
            throw new AppError("CONFLICT", "퇴장은 대기실에서 할 수 있어요.");
          const target = players.find(
            (p) => p.id === value.playerId && ["admitted", "waiting"].includes(p.status),
          );
          if (!target) throw new AppError("NOT_FOUND", "참가자를 찾을 수 없어요.");
          if (room.intro) delete room.intro.registered[target.id];
          target.status = "kicked";
          target.ready = false;
          await tx
            .update(gamePlayers)
            .set({ status: "kicked", ready: false })
            .where(eq(gamePlayers.id, target.id));
        } else {
          if (room.toast && room.phase === "playing") abortToast(room.toast);
          if (room.auction && room.phase === "playing") abortAuction(room.auction);
          room.phase = "closed";
          for (const p of players) {
            if (p.status !== "kicked") p.status = "left";
            p.ready = false;
          }
          await tx
            .update(gamePlayers)
            .set({ status: "left", ready: false })
            .where(
              and(
                eq(gamePlayers.roomId, room.id),
                inArray(gamePlayers.status, ["waiting", "admitted"]),
              ),
            );
        }
        changed();
      });
    },
  };
}
