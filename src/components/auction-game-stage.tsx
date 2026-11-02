"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Gavel,
  LockKeyhole,
  Timer,
  Trophy,
  Wallet,
  TrendingUp,
  Eye,
  EyeOff,
  Info,
} from "lucide-react";
import type { GameRoomView } from "@/domain/game-room";
import { AUCTION_BID_STEP } from "@/domain/auction-game";
import styles from "./auction-game-stage.module.css";
const money = (value: number) => `${value.toLocaleString("ko-KR")}G`;
const signed = (value: number) => `${value > 0 ? "+" : ""}${money(value)}`;
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
    lot = g.lot;
  const [draft, setDraft] = useState(""),
    [reveal, setReveal] = useState(false),
    [seconds, setSeconds] = useState(0);
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
  const hostAction = (action: string) =>
    onAction({ action, revision: room.revision, round: g.round }, true);
  const isSeller = lot?.sellerId === room.viewer.id;
  const minimum = lot?.minimumBid ?? AUCTION_BID_STEP,
    amount = draft === "" ? minimum : Number(draft);
  const valid =
    Number.isInteger(amount) &&
    amount >= minimum &&
    amount % AUCTION_BID_STEP === 0 &&
    amount <= (g.myCash ?? 0);
  useEffect(() => {
    setDraft((value) => (value !== "" && Number(value) < minimum ? "" : value));
  }, [minimum]);
  const latest = g.history.at(-1);
  const settled = g.stage === "review" || g.stage === "result";
  if (g.stage === "lobby")
    return (
      <section className={styles.prepare} aria-label="수상한 경매장 안내">
        <span className={styles.mark}>
          <Gavel size={22} />
        </span>
        <div>
          <h2>수상한 경매장</h2>
          <p>설득해서 비싸게, 판단해서 싸게. 모두가 한 번 이상 판매자가 돼요.</p>
          <div className={styles.tags}>
            <span>{money(g.settings.initialMoney)}로 시작</span>
            <span>{g.settings.maxRounds}라운드</span>
            <span>입찰 {g.settings.bidSeconds}초</span>
          </div>
          <details className={styles.rules}>
            <summary>플레이 방법 보기</summary>
            <p>
              감정가를 아는 판매자가 먼저 물건을 소개해요. 호스트가 입찰을 열면 나머지 참가자는 10G
              단위로 최고가보다 높게 입찰해요. 판매자는 매입금으로 잔액이 마이너스가 되어도
              진행해요. 유찰이면 차감한 매입금만큼 환급해요. 최종 자산은 남은 머니와 구매 물건의
              감정가 합계예요.
            </p>
            <p>
              진행 중인 입찰은 취소할 수 없어요. 호스트는 조기 마감할 수 있고, 시간 종료 시 자동
              정산돼요. 마지막 5초의 입찰은 5초를 확보하도록 최대 30초 연장돼요.
            </p>
          </details>
        </div>
      </section>
    );
  return (
    <section className={styles.stage} aria-label="수상한 경매장">
      <header className={styles.header}>
        <span>
          <Gavel size={18} /> 수상한 경매장
        </span>
        <span>
          ROUND <b>{String(g.round).padStart(2, "0")}</b>
          <small> / {g.settings.maxRounds}</small>
        </span>
      </header>
      <div className={styles.body}>
        <div className={styles.steps}>
          <span data-active={g.stage === "pitch"}>01 물건 소개</span>
          <ArrowRight size={12} />
          <span data-active={g.stage === "bidding"}>02 실시간 입찰</span>
          <ArrowRight size={12} />
          <span data-active={settled}>03 감정가 공개</span>
        </div>
        {g.stage === "aborted" ? (
          <div className={styles.result}>
            <Info size={32} />
            <h2>경매를 중단했어요</h2>
            <p>
              진행 중인 입찰은 취소하고 이번 매입금은 환급했어요. 아래에는 완료된 거래만 남아요.
            </p>
          </div>
        ) : g.stage === "result" ? (
          <div className={styles.result}>
            <span className={styles.trophy}>
              <Trophy size={30} />
            </span>
            <p className={styles.eyebrow}>THE FINAL HAMMER</p>
            <h2>
              {g.winners.map(name).join(" · ")} 님{g.winners.length > 1 ? " 공동 우승!" : " 우승!"}
            </h2>
            <p>머니와 물건의 가치를 모두 합친 최종 결과예요.</p>
            <strong className={styles.finalTotal}>{money(g.standings[0]?.total ?? 0)}</strong>
          </div>
        ) : (
          lot && (
            <div className={styles.auctionGrid}>
              <article className={styles.item}>
                <div className={styles.itemTop}>
                  <span>LOT {String(g.round).padStart(3, "0")}</span>
                  <span>{name(lot.sellerId)}의 물건</span>
                </div>
                <div className={styles.art} aria-hidden="true">
                  <span>{lot.item.icon}</span>
                  <i />
                  <i />
                </div>
                <h2>{lot.item.name}</h2>
                <p>{lot.item.description}</p>
                <div className={styles.sellerLine}>
                  <span className={styles.avatar}>{name(lot.sellerId).slice(0, 1)}</span>
                  <div>
                    <small>이번 판매자</small>
                    <strong>
                      {name(lot.sellerId)}
                      {isSeller ? " · 나" : ""}
                    </strong>
                  </div>
                </div>
              </article>
              <div className={styles.controls}>
                {g.stage === "pitch" ? (
                  <>
                    <span className={styles.badge}>지금은 물건 소개 중</span>
                    <h3>
                      {isSeller
                        ? "이 물건의 가치를 설득해보세요"
                        : "이 물건, 얼마의 가치가 있을까요?"}
                    </h3>
                    <p>
                      판매자의 이야기를 듣고 입찰할 가격을 생각해보세요. 감정가는 거래가 끝나면
                      공개돼요.
                    </p>
                    {isSeller && lot.appraisal !== null && (
                      <div className={styles.secret}>
                        <div>
                          <LockKeyhole size={16} />
                          <span>나만 아는 감정가</span>
                          <button
                            type="button"
                            aria-label={reveal ? "감정가 가리기" : "감정가 보기"}
                            onClick={() => setReveal((v) => !v)}
                          >
                            {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </div>
                        <strong>{reveal ? money(lot.appraisal) : "••• G"}</strong>
                        <small>
                          이 금액을 먼저 부담했어요. 더 비싸게 팔면 그 차액이 이익이에요.
                        </small>
                      </div>
                    )}
                    {room.isHost ? (
                      <button
                        className={styles.primary}
                        disabled={busy}
                        onClick={() => hostAction("auction-open")}
                      >
                        소개 완료 · 입찰 시작
                        <ArrowRight size={17} />
                      </button>
                    ) : (
                      <div className={styles.wait}>호스트가 입찰을 열면 시작해요</div>
                    )}
                  </>
                ) : g.stage === "bidding" ? (
                  <>
                    <div className={styles.bidHeader}>
                      <span className={styles.live}>
                        <i /> LIVE AUCTION
                      </span>
                      <span className={styles.clock} data-urgent={seconds <= 10}>
                        <Timer size={16} />
                        {seconds > 0 ? `${seconds}초` : "정산 중"}
                      </span>
                    </div>
                    <p className={styles.priceLabel}>현재 최고 입찰가</p>
                    <strong className={styles.price}>{money(lot.highestBid)}</strong>
                    <p className={styles.leader}>
                      {lot.highestBidder
                        ? `${name(lot.highestBidder)} 님이 앞서고 있어요`
                        : "첫 입찰로 경매를 시작해보세요"}
                    </p>
                    {!room.isHost && !isSeller ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (valid && g.canBid && !busy)
                            onAction({ action: "auction-bid", round: g.round, amount });
                        }}
                      >
                        <label className={styles.bidInput}>
                          입찰 금액
                          <div>
                            <input
                              aria-label="입찰 금액"
                              type="number"
                              inputMode="numeric"
                              step={10}
                              min={minimum}
                              max={g.myCash ?? 0}
                              value={draft === "" ? minimum : draft}
                              disabled={busy || !g.canBid || seconds === 0}
                              onChange={(e) => setDraft(e.target.value)}
                            />
                            <span>G</span>
                          </div>
                        </label>
                        <div className={styles.quick}>
                          {[0, 50, 100].map((v) => (
                            <button
                              key={v}
                              type="button"
                              disabled={
                                busy || !g.canBid || minimum + v > (g.myCash ?? 0) || seconds === 0
                              }
                              onClick={() => setDraft(String(minimum + v))}
                            >
                              {v === 0 ? "최소 입찰" : `+${v}G`}
                            </button>
                          ))}
                        </div>
                        <button
                          type="submit"
                          className={styles.primary}
                          disabled={busy || !g.canBid || !valid || seconds === 0}
                        >
                          {lot.highestBidder === room.viewer.id
                            ? "내가 최고 입찰자예요"
                            : (g.myCash ?? 0) < minimum
                              ? "입찰할 머니가 부족해요"
                              : `${money(Number.isFinite(amount) ? amount : 0)} 입찰하기`}
                          <Gavel size={17} />
                        </button>
                        <small className={styles.hint}>
                          최소 {money(minimum)} · 10G 단위 · 낙찰 시 차감 · 입찰 취소 불가
                        </small>
                      </form>
                    ) : (
                      <div className={styles.wait}>
                        {isSeller
                          ? "참가자들의 입찰을 지켜보세요. 내 물건에는 입찰할 수 없어요."
                          : "모든 참가자의 입찰을 실시간으로 확인해요."}
                      </div>
                    )}
                    {room.isHost && (
                      <button
                        className={styles.secondary}
                        disabled={busy || seconds === 0}
                        onClick={() => {
                          if (confirm("지금 최고가로 낙찰을 확정할까요? 입찰이 없으면 유찰돼요."))
                            hostAction("auction-close");
                        }}
                      >
                        지금 경매 마감
                      </button>
                    )}
                    <p className={styles.hint}>마지막 5초에 입찰하면 최대 30초까지 연장돼요.</p>
                  </>
                ) : latest ? (
                  <>
                    <span className={styles.badge}>
                      {latest.outcome === "sold" ? "낙찰 완료" : "이번 경매는 유찰"}
                    </span>
                    <h3>
                      {latest.outcome === "sold"
                        ? `${name(latest.buyerId)} 님의 판단은?`
                        : "다음 물건을 기다려볼까요?"}
                    </h3>
                    <div className={styles.reveal}>
                      <span>실제 감정가</span>
                      <strong>{money(latest.appraisal)}</strong>
                      <div>
                        <span>낙찰가</span>
                        <b>{latest.outcome === "sold" ? money(latest.price) : "거래 없음"}</b>
                      </div>
                    </div>
                    {latest.outcome === "sold" ? (
                      <div className={styles.profits}>
                        <div>
                          <span>판매자 {name(latest.sellerId)}</span>
                          <strong>{signed(latest.price - latest.appraisal)}</strong>
                        </div>
                        <div>
                          <span>구매자 {name(latest.buyerId)}</span>
                          <strong>{signed(latest.appraisal - latest.price)}</strong>
                        </div>
                      </div>
                    ) : (
                      <p>
                        입찰이 없어 거래되지 않았어요. 판매자에게 차감한 매입금만큼 전액 돌려줬어요.
                      </p>
                    )}
                    {room.isHost ? (
                      <button
                        className={styles.primary}
                        disabled={busy}
                        onClick={() => hostAction("auction-next")}
                      >
                        다음 물건으로
                        <ArrowRight size={17} />
                      </button>
                    ) : (
                      <div className={styles.wait}>호스트가 다음 물건을 준비하고 있어요</div>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          )
        )}
        {g.myCash !== null && (
          <div className={styles.wallet}>
            <Wallet size={18} />
            <span>내 게임 머니</span>
            <strong>{money(g.myCash)}</strong>
            <small>
              {g.myCash < 0
                ? "매입금으로 잔액이 마이너스예요. 유찰이면 해당 매입금은 환급돼요."
                : "게임 전용 · 실제 결제 없음"}
            </small>
          </div>
        )}
        {g.stage === "bidding" && !!lot?.bids.length && (
          <div className={styles.bidTrail} aria-label="최근 입찰">
            <span>최근 입찰</span>
            {lot.bids
              .slice(-4)
              .reverse()
              .map((b, i) => (
                <span key={`${b.amount}:${i}`}>
                  <b>{name(b.playerId)}</b> {money(b.amount)}
                </span>
              ))}
          </div>
        )}
        <details
          className={styles.standings}
          open={g.stage === "result" || g.stage === "aborted" ? true : undefined}
        >
          <summary>
            <span>
              <TrendingUp size={17} />
              {g.stage === "result" ? "최종 자산 순위" : "자산 순위 보기"}
            </span>
            <small>머니 + 구입 물건 감정가</small>
          </summary>
          <p>
            진행 중에는 감정가 보호를 위해 직전 정산 기준으로 보여요. 같은 자산은 공동 순위예요.
          </p>
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
                  <tr key={p.id} data-self={p.id === room.viewer.id}>
                    <th>
                      <span>{p.rank}</span> {p.nickname}
                      {p.id === room.viewer.id ? " · 나" : ""}
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
                  <span>{String(h.round).padStart(2, "0")}</span>
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
      </div>
    </section>
  );
}
