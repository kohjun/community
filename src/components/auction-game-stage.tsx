"use client";
import { useEffect, useRef, useState } from "react";
import { Clock3, Eye, EyeOff, Gavel, LockKeyhole, TrendingUp, Wallet } from "lucide-react";
import type { GameRoomView } from "@/domain/game-room";
import { AUCTION_BID_STEP, AUCTION_GUIDE } from "@/domain/auction-game";
import cg from "./creative-games.module.css";
import styles from "./auction-game-stage.module.css";

type Task = { emoji: string; title: string; detail: string; tone: "act" | "wait" | "watch" };
const money = (value: number) => `${value.toLocaleString("ko-KR")}G`;
const signed = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value))}`;

export function AuctionGameStage({
  room,
  busy,
  onAction,
  onRefresh,
}: {
  room: GameRoomView;
  busy: boolean;
  onAction: (action: Record<string, unknown>, host?: boolean) => void;
  onRefresh: () => void;
}) {
  const g = room.auction!,
    lot = g.lot,
    me = room.viewer.id;
  const [draft, setDraft] = useState(""),
    [reveal, setReveal] = useState(false),
    [seconds, setSeconds] = useState(0),
    [toast, setToast] = useState<{ id: string; text: string } | null>(null);
  const refreshed = useRef<number | null>(null),
    refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    setDraft("");
    setReveal(false);
  }, [g.round]);
  useEffect(() => {
    if (!lot?.endsAt) return;
    const end = lot.endsAt,
      offset = g.serverNow - Date.now();
    const tick = () => {
      const left = Math.max(0, Math.ceil((end - Date.now() - offset) / 1000));
      setSeconds(left);
      if (left === 0 && refreshed.current !== end) {
        refreshed.current = end;
        refresh.current();
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [lot?.endsAt, g.serverNow]);
  const name = (id: string | null) => g.standings.find((p) => p.id === id)?.nickname ?? "참가자";
  const who = (id: string | null) => (id === me ? "나" : `${name(id)}님`);
  const hostAction = (action: string) =>
    onAction({ action, revision: room.revision, round: g.round }, true);
  const isSeller = !!lot && lot.sellerId === me;
  const isBidder = room.viewer.status === "admitted" && !isSeller;
  const leading = !!lot && lot.highestBidder === me;
  const minimum = lot?.minimumBid ?? AUCTION_BID_STEP,
    amount = draft === "" ? minimum : Number(draft);
  const cash = g.myCash ?? 0;
  const valid =
    Number.isInteger(amount) &&
    amount >= minimum &&
    amount % AUCTION_BID_STEP === 0 &&
    amount <= cash;
  useEffect(() => {
    setDraft((value) => (value !== "" && Number(value) < minimum ? "" : value));
  }, [minimum]);
  const latest = g.history.at(-1);
  const bidClosed = seconds === 0;
  const step = g.stage === "pitch" ? 0 : g.stage === "bidding" ? 1 : g.stage === "review" ? 2 : -1;
  const setAmount = (value: number) =>
    setDraft(String(Math.max(minimum, Math.min(cash, Math.round(value / 10) * 10))));

  const task: Task = (() => {
    if (g.stage === "pitch" && lot)
      return isSeller
        ? {
            emoji: "🎤",
            title: "내 물건을 소개할 차례예요",
            detail: "감정가보다 비싸게 팔수록 이익이에요. 감정가는 숨기고 매력을 말로 설득해요.",
            tone: "act",
          }
        : {
            emoji: "👂",
            title: `${name(lot.sellerId)}님의 물건 소개를 들어요`,
            detail: "얼마까지 낼지 생각해두세요. 진짜 가치(감정가)는 거래가 끝나면 공개돼요.",
            tone: "watch",
          };
    if (g.stage === "bidding" && lot) {
      if (isSeller)
        return {
          emoji: "👀",
          title: "입찰을 지켜봐요",
          detail: "내 물건에는 입찰할 수 없어요. 높게 팔릴수록 내 이익이에요.",
          tone: "watch",
        };
      if (!isBidder)
        return {
          emoji: "🔨",
          title: "실시간 입찰 중이에요",
          detail: "가장 높게 부른 사람이 시간이 끝나면 낙찰받아요.",
          tone: "watch",
        };
      if (leading)
        return {
          emoji: "🥇",
          title: "내가 최고 입찰자예요",
          detail: "다른 사람이 더 높게 부르면 다시 입찰할 수 있어요.",
          tone: "wait",
        };
      if (cash < minimum)
        return {
          emoji: "💸",
          title: "머니가 부족해요",
          detail: `최소 입찰가 ${money(minimum)}보다 내 머니가 적어요. 이번엔 지켜봐요.`,
          tone: "wait",
        };
      return {
        emoji: "🔨",
        title: "얼마에 살까요?",
        detail: `최소 ${money(minimum)}부터 10G 단위로 불러요. 낙찰되면 내 머니에서 빠져요.`,
        tone: "act",
      };
    }
    if (g.stage === "review" && latest)
      return latest.outcome === "sold"
        ? {
            emoji: "🔨",
            title: `${who(latest.buyerId)} ${money(latest.price)}에 낙찰!`,
            detail: `감정가는 ${money(latest.appraisal)}. ${
              latest.appraisal >= latest.price ? "싸게 샀어요!" : "비싸게 팔렸어요!"
            } ${room.isHost ? "‘다음 물건으로’를 눌러요." : ""}`,
            tone: "watch",
          }
        : {
            emoji: "🪹",
            title: "아무도 사지 않았어요",
            detail: "유찰이에요. 판매자에게 매입금을 그대로 돌려줬어요.",
            tone: "watch",
          };
    if (g.stage === "aborted")
      return {
        emoji: "⏹️",
        title: "경매를 중단했어요",
        detail: "진행 중이던 매입금은 환급했고, 완료된 거래만 남아요.",
        tone: "watch",
      };
    return {
      emoji: "🏆",
      title: "경매 끝!",
      detail: "남은 머니와 산 물건의 감정가를 합친 최종 순위예요.",
      tone: "watch",
    };
  })();

  // Briefly announce each new step (who sells, bidding opened, the reveal).
  const announced = useRef<string | null>(null);
  const phase = `${g.round}:${g.stage}`;
  useEffect(() => {
    if (announced.current === phase) return;
    const first = announced.current === null;
    announced.current = phase;
    if (first || g.stage === "lobby") return;
    setToast({ id: phase, text: `${task.emoji} ${task.title}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2_600);
    return () => clearTimeout(timer);
  }, [toast]);

  if (g.stage === "lobby")
    return (
      <section className={styles.prepare} aria-label="수상한 경매장 안내">
        <span className={styles.mark} aria-hidden="true">
          {AUCTION_GUIDE.emoji}
        </span>
        <div>
          <h2>수상한 경매장</h2>
          <p>설득해서 비싸게, 판단해서 싸게. 모두 한 번 이상 판매자가 돼요.</p>
          <ol className={styles.prepareSteps}>
            {AUCTION_GUIDE.steps.map((s, i) => (
              <li key={s.title}>
                <b>{i + 1}</b> {s.title}
              </li>
            ))}
          </ol>
          <div className={styles.tags}>
            <span>{money(g.settings.initialMoney)}로 시작</span>
            <span>물건 {g.settings.maxRounds}개</span>
            <span>입찰 {g.settings.bidSeconds}초</span>
          </div>
        </div>
      </section>
    );

  const finished = g.stage === "result" || g.stage === "aborted";
  return (
    <section className={cg.stage} aria-label="수상한 경매장">
      {toast && (
        <div key={toast.id} className={cg.dgToast} role="status">
          {toast.text}
        </div>
      )}
      <header className={cg.dgTop}>
        <span className={cg.dgMode}>🔨 수상한 경매장</span>
        {!finished && (
          <span className={cg.dgRound}>
            물건 {g.round}/{g.settings.maxRounds}
          </span>
        )}
        {g.myCash !== null && (
          <span className={cg.dgRound} data-negative={g.myCash < 0}>
            💰 {money(g.myCash)}
          </span>
        )}
        {g.stage === "bidding" ? (
          <span className={cg.clock} data-urgent={seconds <= 10}>
            <Clock3 size={15} aria-hidden="true" />
            {seconds > 0 ? `${seconds}초` : "정산 중"}
          </span>
        ) : (
          <span />
        )}
      </header>

      {step >= 0 && (
        <ol className={cg.dgSteps} aria-label="진행 단계">
          {AUCTION_GUIDE.steps.map((s, index) => (
            <li
              key={s.title}
              data-state={index < step ? "done" : index === step ? "now" : "next"}
              aria-current={index === step ? "step" : undefined}
            >
              <span>{index < step ? "✓" : index + 1}</span>
              <small>{s.title}</small>
            </li>
          ))}
        </ol>
      )}

      <div className={cg.dgTask} data-tone={task.tone}>
        <span className={cg.dgTaskEmoji} aria-hidden="true">
          {task.emoji}
        </span>
        <div>
          <small>
            {task.tone === "act" ? "내 할 일" : task.tone === "wait" ? "기다리는 중" : "지금은"}
          </small>
          <strong>{task.title}</strong>
          <p>{task.detail}</p>
        </div>
      </div>

      {lot && !finished && (
        <article className={styles.item}>
          <span className={styles.art} aria-hidden="true">
            {lot.item.icon}
          </span>
          <div>
            <small>
              LOT {String(g.round).padStart(3, "0")} · 판매자 {who(lot.sellerId)}
            </small>
            <h2>{lot.item.name}</h2>
            <p>{lot.item.description}</p>
          </div>
        </article>
      )}

      {isSeller &&
        lot?.appraisal !== null &&
        lot &&
        (g.stage === "pitch" || g.stage === "bidding") && (
          <div className={styles.secret}>
            <div>
              <LockKeyhole size={16} aria-hidden="true" />
              <span>나만 아는 감정가</span>
              <button
                type="button"
                aria-label={reveal ? "감정가 가리기" : "감정가 보기"}
                onClick={() => setReveal((v) => !v)}
              >
                {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <strong>{reveal ? money(lot.appraisal!) : "••• G"}</strong>
            <small>이 금액을 먼저 냈어요. 이보다 비싸게 팔면 그 차이가 이익이에요.</small>
          </div>
        )}

      {g.stage === "bidding" && lot && (
        <div className={styles.board}>
          <span className={styles.live}>
            <i /> 실시간 입찰
          </span>
          <small>현재 최고가</small>
          <strong className={styles.price}>{money(lot.highestBid)}</strong>
          <p className={styles.leader}>
            {lot.highestBidder
              ? `${name(lot.highestBidder)}님이 앞서고 있어요`
              : "아직 입찰이 없어요. 첫 입찰을 기다려요"}
          </p>
          {!!lot.bids.length && (
            <ol className={styles.trail} aria-label="최근 입찰">
              {lot.bids
                .slice(-4)
                .reverse()
                .map((b, i) => (
                  <li key={`${b.amount}:${i}`}>
                    <b>{name(b.playerId)}</b> {money(b.amount)}
                  </li>
                ))}
            </ol>
          )}
        </div>
      )}

      {g.stage === "bidding" && lot && isBidder && (
        <form
          className={styles.bidForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && g.canBid && !busy)
              onAction({ action: "auction-bid", round: g.round, amount });
          }}
        >
          <div className={styles.amount}>
            <button
              type="button"
              aria-label="10G 내리기"
              disabled={busy || !g.canBid || bidClosed || amount <= minimum}
              onClick={() => setAmount(amount - AUCTION_BID_STEP)}
            >
              −
            </button>
            <label>
              <input
                aria-label="입찰 금액"
                type="number"
                inputMode="numeric"
                step={AUCTION_BID_STEP}
                min={minimum}
                max={cash}
                value={draft === "" ? minimum : draft}
                disabled={busy || !g.canBid || bidClosed}
                onChange={(e) => setDraft(e.target.value)}
              />
              <span>G</span>
            </label>
            <button
              type="button"
              aria-label="10G 올리기"
              disabled={busy || !g.canBid || bidClosed || amount + AUCTION_BID_STEP > cash}
              onClick={() => setAmount(amount + AUCTION_BID_STEP)}
            >
              +
            </button>
          </div>
          <div className={styles.quick}>
            {[0, 50, 100].map((v) => (
              <button
                key={v}
                type="button"
                disabled={busy || !g.canBid || minimum + v > cash || bidClosed}
                onClick={() => setDraft(String(minimum + v))}
              >
                {v === 0 ? `최소 ${money(minimum)}` : `최소 +${v}G`}
              </button>
            ))}
          </div>
          <div className={cg.dgDock}>
            <button
              type="submit"
              className={cg.button}
              disabled={busy || !g.canBid || !valid || bidClosed}
            >
              <Gavel size={17} aria-hidden="true" />
              {leading
                ? "내가 최고 입찰자예요"
                : cash < minimum
                  ? "입찰할 머니가 부족해요"
                  : `${money(Number.isFinite(amount) ? amount : 0)} 입찰하기`}
            </button>
            <small className={styles.dockHint}>
              입찰은 취소할 수 없어요 · 마지막 5초 입찰 시 시간 연장
            </small>
          </div>
        </form>
      )}

      {g.stage === "review" && latest && (
        <div className={styles.reveal}>
          <span className={styles.badge} data-sold={latest.outcome === "sold"}>
            {latest.outcome === "sold" ? "낙찰 완료" : "이번 경매는 유찰"}
          </span>
          <div className={styles.compare}>
            <div>
              <small>낙찰가</small>
              <strong>{latest.outcome === "sold" ? money(latest.price) : "거래 없음"}</strong>
            </div>
            <div data-key="true">
              <small>실제 감정가</small>
              <strong>{money(latest.appraisal)}</strong>
            </div>
          </div>
          {latest.outcome === "sold" ? (
            <div className={styles.profits}>
              <div data-up={latest.price - latest.appraisal >= 0}>
                <small>판매자 · {who(latest.sellerId)}</small>
                <strong>{signed(latest.price - latest.appraisal)}</strong>
              </div>
              <div data-up={latest.appraisal - latest.price >= 0}>
                <small>구매자 · {who(latest.buyerId)}</small>
                <strong>{signed(latest.appraisal - latest.price)}</strong>
              </div>
            </div>
          ) : (
            <p>입찰이 없어 거래되지 않았어요. 판매자에게 차감한 매입금만큼 전액 돌려줬어요.</p>
          )}
        </div>
      )}

      {g.stage === "pitch" && room.isHost && (
        <div className={cg.dgDock}>
          <button
            type="button"
            className={cg.button}
            disabled={busy}
            onClick={() => hostAction("auction-open")}
          >
            소개 완료 · 입찰 시작
          </button>
        </div>
      )}
      {g.stage === "bidding" && room.isHost && (
        <button
          type="button"
          className={cg.secondary}
          disabled={busy || bidClosed}
          onClick={() => {
            if (confirm("지금 최고가로 낙찰을 확정할까요? 입찰이 없으면 유찰돼요."))
              hostAction("auction-close");
          }}
        >
          지금 경매 마감
        </button>
      )}
      {g.stage === "review" && room.isHost && (
        <div className={cg.dgDock}>
          <button
            type="button"
            className={cg.button}
            disabled={busy}
            onClick={() => hostAction("auction-next")}
          >
            다음 물건으로
          </button>
        </div>
      )}

      {finished && (
        <div className={styles.final}>
          <span aria-hidden="true">{g.stage === "aborted" ? "👋" : "🏆"}</span>
          <h2>
            {g.stage === "aborted"
              ? "경매를 중단했어요"
              : `${g.winners.map(name).join(" · ")}님 ${g.winners.length > 1 ? "공동 우승!" : "우승!"}`}
          </h2>
          {g.stage === "result" && (
            <>
              <p>머니와 산 물건의 가치를 모두 합친 최종 자산이에요.</p>
              <strong>{money(g.standings[0]?.total ?? 0)}</strong>
            </>
          )}
        </div>
      )}

      {g.myCash !== null && !finished && (
        <div className={styles.wallet} data-negative={g.myCash < 0}>
          <Wallet size={18} aria-hidden="true" />
          <span>내 게임 머니</span>
          <strong>{money(g.myCash)}</strong>
          <small>
            {g.myCash < 0
              ? "매입금으로 잔액이 마이너스예요. 유찰이면 해당 매입금은 환급돼요."
              : "게임 전용 · 실제 결제 없음"}
          </small>
        </div>
      )}

      <details
        className={styles.standings}
        open={finished || g.stage === "review" ? true : undefined}
      >
        <summary>
          <span>
            <TrendingUp size={17} aria-hidden="true" />
            {g.stage === "result" ? "최종 자산 순위" : "자산 순위"}
          </span>
          <small>머니 + 산 물건 감정가</small>
        </summary>
        <p>진행 중에는 감정가 보호를 위해 직전 정산 기준으로 보여요. 같은 자산은 공동 순위예요.</p>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>순위 · 참가자</th>
                <th>머니</th>
                <th>물건 가치</th>
                <th>총 자산</th>
              </tr>
            </thead>
            <tbody>
              {g.standings.map((p) => (
                <tr key={p.id} data-self={p.id === me}>
                  <th>
                    <span>{p.rank}</span> {p.nickname}
                    {p.id === me ? " · 나" : ""}
                  </th>
                  <td>{money(p.cash)}</td>
                  <td>{money(p.assetValue)}</td>
                  <td>
                    <strong>{money(p.total)}</strong>
                    <small>{signed(p.profit)}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {!!g.history.length && (
        <details className={styles.history}>
          <summary>
            판매·구매 내역 <b>{g.history.length}건</b>
          </summary>
          <ol>
            {g.history.map((h) => (
              <li key={h.round}>
                <span aria-hidden="true">{h.item.icon}</span>
                <div>
                  <strong>{h.item.name}</strong>
                  <p>
                    {name(h.sellerId)} → {h.buyerId ? name(h.buyerId) : "유찰"}
                  </p>
                </div>
                <div>
                  <strong>{h.outcome === "sold" ? money(h.price) : "거래 없음"}</strong>
                  <small>감정가 {money(h.appraisal)}</small>
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
