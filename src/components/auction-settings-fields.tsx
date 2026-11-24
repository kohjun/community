"use client";
import {
  AUCTION_GUIDE,
  AUCTION_MAX_ROUNDS,
  AUCTION_MONEY_OPTIONS,
  AUCTION_SECONDS,
} from "@/domain/auction-game";
import { GameModePlan } from "./game-mode-picker";

export type AuctionOptions = { rounds: number; initialMoney: number; bidSeconds: number };

/** 수상한 경매장 options, shared by room creation and the lobby settings panel. */
export function AuctionSettingsFields({
  value,
  capacity,
  minRounds,
  disabled,
  rowClassName,
  labels,
  onChange,
}: {
  value: AuctionOptions;
  capacity: number;
  /** Rounds must exceed the player count so everyone gets to sell. */
  minRounds: number;
  disabled: boolean;
  rowClassName: string | undefined;
  /** Accessible names stay distinct between the create form and the lobby panel. */
  labels: { rounds: string; money: string; seconds: string };
  onChange: (value: Partial<AuctionOptions>) => void;
}) {
  const turns = Math.max(1, Math.floor(value.rounds / Math.max(1, capacity)));
  // Roughly: ~40s pitch + the bid window + ~15s to look at the reveal, per item.
  const minutes = Math.max(1, Math.ceil((value.rounds * (40 + value.bidSeconds + 15)) / 60));
  const moneyOptions = [...new Set([...AUCTION_MONEY_OPTIONS, value.initialMoney])].sort(
    (a, b) => a - b,
  );
  return (
    <>
      <GameModePlan mode={AUCTION_GUIDE} note={AUCTION_GUIDE.rules} />
      <label>
        경매할 물건 수 (총 라운드)
        <input
          aria-label={labels.rounds}
          type="number"
          min={minRounds}
          max={AUCTION_MAX_ROUNDS}
          required
          disabled={disabled}
          value={value.rounds}
          onChange={(e) => onChange({ rounds: Number(e.target.value) })}
        />
        <small>
          {capacity}명 기준 한 사람당 약 {turns}번 판매해요 · 참가자 수보다 많아야 해요
        </small>
      </label>
      <div className={rowClassName}>
        <label>
          시작 게임 머니
          <select
            aria-label={labels.money}
            disabled={disabled}
            value={value.initialMoney}
            onChange={(e) => onChange({ initialMoney: Number(e.target.value) })}
          >
            {moneyOptions.map((v) => (
              <option key={v} value={v}>
                {v.toLocaleString("ko-KR")}G{v === 1000 ? " (추천)" : ""}
              </option>
            ))}
          </select>
          <small>게임 전용 머니예요 · 실제 결제 없음</small>
        </label>
        <label>
          물건당 입찰 시간
          <select
            aria-label={labels.seconds}
            disabled={disabled}
            value={value.bidSeconds}
            onChange={(e) => onChange({ bidSeconds: Number(e.target.value) })}
          >
            {AUCTION_SECONDS.map((v) => (
              <option key={v} value={v}>
                {v}초{v === 60 ? " (추천)" : ""}
              </option>
            ))}
          </select>
          <small>마지막 5초 입찰 시 최대 30초 연장</small>
        </label>
      </div>
      <small>
        ⏱️ 물건 {value.rounds}개면 길어야 약 {minutes}분이에요.
      </small>
    </>
  );
}
