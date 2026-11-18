import {
  TEMPERATURE_MODE_LABELS,
  TEMPERATURE_MODES,
  TEMPERATURE_SECONDS,
  type TemperatureSettings,
} from "@/domain/temperature-game";

export function TemperatureSettingsFields({
  value,
  capacity,
  disabled,
  rowClassName,
  onChange,
}: {
  value: TemperatureSettings;
  capacity: number;
  disabled: boolean;
  rowClassName: string | undefined;
  onChange: (value: TemperatureSettings) => void;
}) {
  return (
    <>
      <label>
        마음의 온도 모드
        <select
          aria-label="마음의 온도 모드"
          value={value.mode}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, mode: event.target.value as TemperatureSettings["mode"] })
          }
        >
          {TEMPERATURE_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {TEMPERATURE_MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>
      <div className={rowClassName}>
        <label>
          라운드 수
          <select
            aria-label="라운드 수"
            value={value.rounds}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, rounds: Number(event.target.value) })}
          >
            {Array.from({ length: 10 }, (_, index) => index + 1).map((rounds) => (
              <option key={rounds} value={rounds}>
                {rounds}라운드
              </option>
            ))}
          </select>
        </label>
        <label>
          단계별 제출 시간
          <select
            aria-label="단계별 제출 시간"
            value={value.answerSeconds}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...value,
                answerSeconds: Number(event.target.value) as TemperatureSettings["answerSeconds"],
              })
            }
          >
            {TEMPERATURE_SECONDS.map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds}초
              </option>
            ))}
          </select>
        </label>
      </div>
      <small>
        {value.mode === "basic"
          ? `한 사람씩 30초 동안 설명해요. 모두 한 번 설명하면 1라운드이며, 정원이 다 차면 총 ${capacity * value.rounds}차례예요.`
          : "모두 상황을 한 번씩 제출하고 순서를 맞히면 1라운드예요."}
      </small>
    </>
  );
}
