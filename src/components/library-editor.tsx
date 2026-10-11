"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ParticipationShell } from "./participation-shell";
import { Globe2 } from "lucide-react";
import styles from "./library-discovery.module.css";
import { CATEGORIES } from "@/domain/categories";
import {
  libraryInputSchema,
  libraryPublishSchema,
  type LibraryKind,
  type LibraryInput,
  type LibraryDetail,
} from "@/domain/library";
import { appRequest } from "@/lib/api-client";
import { EventPlanEditor } from "./event-plan-editor";
import { LibraryPlaybook } from "./library-playbook";
import { emptyEventPlan, type EventPlan } from "@/domain/event-plan";
import { COEX_PLAYBOOK_EXAMPLE } from "@/domain/event-plan-example";
export function LibraryEditor({ kind, initial }: { kind: LibraryKind; initial?: LibraryDetail }) {
  const [example, setExample] = useState<LibraryInput | null>(null);
  const [exampleConfirm, setExampleConfirm] = useState(false);
  const [formRevision, setFormRevision] = useState(0);
  const router = useRouter(),
    draft = example ?? initial?.draftContent,
    [savedEntry, setSavedEntry] = useState(initial),
    [savingIntent, setSavingIntent] = useState<"save" | "publish" | null>(null),
    busy = savingIntent !== null,
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [paid, setPaid] = useState(!!(draft?.priceKRW ?? initial?.priceKRW)),
    [selectedKind, setSelectedKind] = useState<LibraryKind>(initial?.kind ?? kind),
    [allowDerivatives, setAllowDerivatives] = useState(
      draft?.allowDerivatives ?? initial?.allowDerivatives ?? false,
    ),
    [allowCommercialUse, setAllowCommercialUse] = useState(
      draft?.allowCommercialUse ?? initial?.allowCommercialUse ?? false,
    ),
    [publicContentConsent, setPublicContentConsent] = useState(false),
    base = "/archive",
    p = draft ?? initial?.payload,
    discoveryMetadata =
      draft?.discoveryMetadata !== undefined ? draft.discoveryMetadata : initial?.discoveryMetadata;
  const [eventPlan, setEventPlan] = useState<EventPlan | null>(
    p?.eventPlan ?? (kind === "template" && !initial ? emptyEventPlan() : null),
  );
  function loadExample() {
    const content = structuredClone(COEX_PLAYBOOK_EXAMPLE);
    setExample(content);
    setEventPlan(content.eventPlan ?? null);
    setSelectedKind("template");
    setPaid(false);
    setAllowDerivatives(false);
    setAllowCommercialUse(false);
    setPublicContentConsent(false);
    setError("");
    setMessage("코엑스 점령전 예시를 불러왔어요. 인원·장소·이용 조건을 검토한 뒤 저장해주세요.");
    setExampleConfirm(false);
    setFormRevision((v) => v + 1);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const publishing = submitter instanceof HTMLButtonElement && submitter.value === "publish";
    const f = new FormData(e.currentTarget);
    setError("");
    setMessage("");
    const lines = (name: string) =>
      String(f.get(name) ?? "")
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean);
    const preparationDifficulty = String(f.get("preparationDifficulty") ?? "") || null;
    const environment = String(f.get("environment") ?? "") || null;
    const staffText = String(f.get("requiredStaff") ?? "").trim();
    const requiredStaff = staffText ? Number(staffText) : null;
    const parsed = libraryInputSchema.safeParse({
      eventPlan,
      discoveryMetadata:
        preparationDifficulty || environment || requiredStaff !== null
          ? { preparationDifficulty, environment, requiredStaff }
          : null,
      kind: savedEntry?.kind ?? selectedKind,
      categorySlug: f.get("categorySlug"),
      title: f.get("title"),
      summary: f.get("summary"),
      scenario: f.get("scenario"),
      rules: f.get("rules"),
      hostGuide: f.get("hostGuide"),
      materials: lines("materials"),
      minPlayers: Number(f.get("minPlayers")),
      maxPlayers: Number(f.get("maxPlayers")),
      durationMinutes: Number(f.get("durationMinutes")),
      tags: String(f.get("tags") ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
      rounds: lines("rounds").map((v) => {
        const parts = v.split("|");
        return { name: parts[0]?.trim() ?? "", seconds: Number(parts[1]) };
      }),
      priceKRW: paid ? Number(f.get("priceKRW")) : 0,
      purchaseUrl: paid ? String(f.get("purchaseUrl") ?? "") : null,
      usageTerms: f.get("usageTerms"),
      allowDerivatives,
      allowCommercialUse,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const labels: Record<string, string> = {
        eventPlan: "운영 계획",
        discoveryMetadata: "공개 운영 조건",
        preparationDifficulty: "준비 난이도",
        environment: "진행 환경",
        requiredStaff: "추가 스태프 인원",
        reference: "이벤트 개요",
        organizer: "기획·진행자",
        date: "날짜",
        startTime: "시작 시간",
        endTime: "종료 시간",
        location: "장소",
        participants: "참가 인원",
        participantFeeKRW: "행사 참가비",
        planningIntent: "기획 의도",
        concept: "컨셉",
        worldbuilding: "세계관",
        format: "진행 포맷",
        teamSize: "팀 인원",
        victoryCondition: "승리 조건",
        movementRules: "이동 규칙",
        missions: "미션",
        name: "이름",
        zone: "구역",
        kind: "유형",
        summary: "소개",
        rules: "규칙",
        facilitatorNotes: "진행 포인트",
        scoring: "점수·성공 조건",
        durationMinutes: "진행 시간",
        timeline: "큐시트",
        time: "진행 시점",
        phase: "구분",
        program: "프로그램",
        details: "상세 내용",
        notes: "메모",
        budget: "예산",
        category: "항목",
        description: "세부 내역",
        amountKRW: "금액",
        budgetNotes: "예산 메모",
        title: "제목",
        categorySlug: "카테고리",
        scenario: "전체 시나리오",
        hostGuide: "진행자 가이드",
        materials: "준비물",
        rounds: "라운드 타이머",
        seconds: "초",
        minPlayers: "최소 인원",
        maxPlayers: "최대 인원",
        priceKRW: "자료 가격",
        purchaseUrl: "외부 구매 링크",
        usageTerms: "이용 조건",
        tags: "태그",
      };
      const location = issue?.path
        .map((key) =>
          typeof key === "number" ? key + 1 + "번째" : (labels[String(key)] ?? String(key)),
        )
        .join(" → ");
      setError(
        (location ? location + ": " : "") +
          (issue && /[가-힣]/.test(issue.message)
            ? issue.message
            : "입력값과 허용 범위를 확인해주세요."),
      );
      return;
    }
    const changeSummary = String(f.get("changeSummary") ?? "").trim();
    if (publishing && (!publicContentConsent || changeSummary.length < 2)) {
      setError(
        !publicContentConsent
          ? "공개할 수 있는 내용인지 확인하고 발행 동의를 선택해주세요."
          : "이번 버전에서 달라진 점을 2자 이상 적어주세요.",
      );
      return;
    }
    setSavingIntent(publishing ? "publish" : "save");
    let draftSaved = false;
    try {
      const saved = await appRequest<LibraryDetail>(
        savedEntry ? `/api/library/${savedEntry.id}/draft` : "/api/library/drafts",
        savedEntry ? "PUT" : "POST",
        savedEntry
          ? { content: parsed.data, expectedUpdatedAt: savedEntry.updatedAt }
          : parsed.data,
      );
      setSavedEntry(saved);
      draftSaved = true;
      if (publishing) {
        const publish = libraryPublishSchema.parse({
          expectedUpdatedAt: saved.updatedAt,
          changeSummary,
          publicContentConsent,
        });
        const published = await appRequest<LibraryDetail>(
          `/api/library/${saved.id}/publish`,
          "POST",
          publish,
        );
        router.push(`${base}/${published.id}`);
        router.refresh();
      } else {
        setMessage("초안을 저장했어요. 발행 전에는 작성자만 확인할 수 있어요.");
        if (!initial) router.replace(`${base}/${saved.id}/edit`);
      }
    } catch (err) {
      if (publishing && draftSaved)
        setMessage("초안은 저장됐어요. 발행 오류를 확인한 뒤 다시 발행할 수 있어요.");
      setError(err instanceof Error ? err.message : "저장하지 못했어요.");
    } finally {
      setSavingIntent(null);
    }
  }
  return (
    <ParticipationShell>
      <div className="marketplace-heading">
        <div>
          <span className="marketplace-kicker">SHARE YOUR PLAYBOOK</span>
          <h1>{savedEntry ? "자료 초안 편집" : "아카이브에 자료 올리기"}</h1>
          <p>
            초안을 다듬고 버전으로 발행해요. 이전 발행본과 행사 진행 가이드는 그대로 보존됩니다.
          </p>
        </div>
        <Link
          href={savedEntry ? `${base}/${savedEntry.id}` : base}
          className="participation-secondary"
        >
          돌아가기
        </Link>
      </div>
      {!savedEntry && (
        <aside className="playbook-example-banner">
          <div>
            <strong>어떻게 나누어 쓸지 고민되나요?</strong>
            <p>코엑스 점령전의 13개 미션·큐시트·예산 예시로 시작해보세요.</p>
          </div>
          <button
            type="button"
            className="participation-secondary"
            disabled={busy}
            onClick={() => setExampleConfirm(true)}
          >
            예시 불러오기
          </button>
          {exampleConfirm && (
            <div className="playbook-example-confirm">
              <p>
                현재 작성 중인 내용이 예시로 바뀌어요. 저장하거나 발행하기 전에는 다른 사람에게
                공개되지 않아요.
              </p>
              <button
                type="button"
                className="participation-primary"
                disabled={busy}
                onClick={loadExample}
              >
                예시로 교체
              </button>
              <button
                type="button"
                className="participation-secondary"
                disabled={busy}
                onClick={() => setExampleConfirm(false)}
              >
                계속 작성
              </button>
            </div>
          )}
        </aside>
      )}
      <form
        key={formRevision}
        className="marketplace-form"
        onSubmit={submit}
        aria-busy={busy}
        noValidate
      >
        <fieldset className="library-editor-fieldset" disabled={busy}>
          <section className="marketplace-section">
            <h2>자료 유형</h2>
            {savedEntry ? (
              <p>
                {savedEntry?.kind === "template" ? "이벤트 템플릿" : "룰북"}으로 등록된 자료예요.
                연결된 행사와 이용 권한을 유지하기 위해 자료 유형은 바꿀 수 없어요.
              </p>
            ) : (
              <>
                <div className="archive-kind-options" role="group" aria-label="등록할 자료 유형">
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={selectedKind === "rulebook"}
                    onClick={() => setSelectedKind("rulebook")}
                  >
                    <strong>룰북</strong>
                    <span>게임의 규칙, 시나리오와 진행 노하우를 공유해요.</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={selectedKind === "template"}
                    onClick={() => {
                      setSelectedKind("template");
                      if (!eventPlan) setEventPlan(emptyEventPlan());
                    }}
                  >
                    <strong>이벤트 템플릿</strong>
                    <span>다른 호스트가 일정과 참가비를 더해 모임을 열 수 있어요.</span>
                  </button>
                </div>
                <small>두 유형 모두 시나리오, 규칙, 준비물과 라운드 타이머를 담을 수 있어요.</small>
              </>
            )}
          </section>
          <section className="marketplace-section">
            <h2>어떤 게임인가요?</h2>
            <div className="marketplace-form-grid">
              <label className="marketplace-field">
                제목
                <input
                  name="title"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={draft?.title ?? initial?.title}
                  placeholder="예: 서로의 정체를 추리하는 블라인드 미션"
                />
              </label>
              <label className="marketplace-field">
                주제
                <select
                  name="categorySlug"
                  defaultValue={draft?.categorySlug ?? initial?.category ?? "mind-games"}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="marketplace-field">
              공개 소개
              <textarea
                name="summary"
                required
                minLength={10}
                maxLength={600}
                rows={3}
                defaultValue={draft?.summary ?? initial?.summary}
                placeholder="어떤 경험을 만들고 누구에게 어울리는지 소개해주세요. 유료 자료도 소개는 공개돼요."
              />
            </label>
            <div className="marketplace-form-grid">
              <label className="marketplace-field">
                최소 인원
                <input
                  name="minPlayers"
                  type="number"
                  min={1}
                  max={5000}
                  required
                  defaultValue={draft?.minPlayers ?? initial?.minPlayers ?? 4}
                />
              </label>
              <label className="marketplace-field">
                최대 인원
                <input
                  name="maxPlayers"
                  type="number"
                  min={1}
                  max={5000}
                  required
                  defaultValue={draft?.maxPlayers ?? initial?.maxPlayers ?? 12}
                />
              </label>
              <label className="marketplace-field">
                예상 진행 시간 (분)
                <input
                  name="durationMinutes"
                  type="number"
                  min={5}
                  max={1440}
                  required
                  defaultValue={draft?.durationMinutes ?? initial?.durationMinutes ?? 90}
                />
              </label>
              <label className="marketplace-field">
                태그 (쉼표로 구분, 최대 5개)
                <input
                  name="tags"
                  maxLength={124}
                  defaultValue={(draft?.tags ?? initial?.tags)?.join(", ")}
                  placeholder="추리, 팀플레이, 실내"
                />
              </label>
            </div>
          </section>
          <section className="marketplace-section">
            <h2>찾기 쉬운 공개 운영 조건</h2>
            <div className={styles.publicMetadataNote}>
              <Globe2 size={16} aria-hidden="true" />
              <span>
                선택한 난이도·환경·스태프 인원은 유료 자료도 목록과 검색에 공개돼요. 운영 계획에서
                자동으로 가져오지 않으며, 비워두면 ‘미입력’으로 표시됩니다.
              </span>
            </div>
            <div className="marketplace-form-grid">
              <label className="marketplace-field">
                준비 난이도 (선택)
                <select
                  name="preparationDifficulty"
                  defaultValue={discoveryMetadata?.preparationDifficulty ?? ""}
                >
                  <option value="">미입력</option>
                  <option value="easy">쉬움 — 준비가 간단해요</option>
                  <option value="standard">보통 — 소품·사전 준비가 필요해요</option>
                  <option value="advanced">높음 — 전문 준비·리허설이 필요해요</option>
                </select>
              </label>
              <label className="marketplace-field">
                진행 환경 (선택)
                <select name="environment" defaultValue={discoveryMetadata?.environment ?? ""}>
                  <option value="">미입력</option>
                  <option value="indoor">실내</option>
                  <option value="outdoor">실외</option>
                  <option value="mixed">실내·외 혼합</option>
                </select>
              </label>
              <label className="marketplace-field">
                추가 스태프 인원 (선택)
                <input
                  name="requiredStaff"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={discoveryMetadata?.requiredStaff ?? ""}
                  placeholder="예: 2"
                />
                <small>
                  주최자를 제외한 운영 인원이에요. 혼자 운영할 수 있다면 0을 입력해주세요.
                </small>
              </label>
            </div>
          </section>
          <section className="marketplace-section">
            <h2>소개와 공통 운영 가이드</h2>
            <p>마크다운으로 작성할 수 있어요. 유료 자료는 구매 확인 후 공개돼요.</p>
            <label className="marketplace-field">
              행사 소개·전체 시나리오
              <textarea
                name="scenario"
                required
                minLength={20}
                maxLength={10000}
                rows={8}
                defaultValue={p?.scenario}
                placeholder="게임의 배경, 준비 단계, 미션과 전체 진행 순서를 작성해주세요."
              />
            </label>
            <label className="marketplace-field">
              공통 규칙·점수·승리 조건
              <textarea
                name="rules"
                required
                minLength={10}
                maxLength={8000}
                rows={6}
                defaultValue={p?.rules}
              />
            </label>
            <label className="marketplace-field">
              준비물 (한 줄에 한 항목)
              <textarea
                name="materials"
                maxLength={4840}
                rows={5}
                defaultValue={p?.materials.join("\n")}
                placeholder="참가자 이름표 12장\n역할 카드 12장\n필기구"
              />
            </label>
            <label className="marketplace-field">
              진행자 멘트 · 운영 가이드
              <textarea
                name="hostGuide"
                required
                minLength={10}
                maxLength={8000}
                rows={6}
                defaultValue={p?.hostGuide}
                placeholder="시작 안내, 라운드 전환 멘트, 안전 및 매너 안내를 작성해주세요."
              />
            </label>
            <label className="marketplace-field">
              라운드 타이머 (이름 | 초, 한 줄에 하나)
              <textarea
                name="rounds"
                required
                rows={4}
                defaultValue={
                  p?.rounds.map((r) => `${r.name} | ${r.seconds}`).join("\n") ??
                  "게임 소개 | 300\n첫 번째 미션 | 600\n결과 발표 | 180"
                }
              />
              <small>최대 20개, 각 라운드 10초~24시간. 예: 토론 시간 | 600</small>
            </label>
          </section>
          <EventPlanEditor value={eventPlan} onChange={setEventPlan} />
          {example && (
            <details className="playbook-example-preview">
              <summary>불러온 예시의 상세 화면 미리보기</summary>
              <LibraryPlaybook
                payload={COEX_PLAYBOOK_EXAMPLE}
                summary={COEX_PLAYBOOK_EXAMPLE.summary}
              />
              <p className="playbook-note">
                원본 예시의 미리보기예요. 이후 수정한 내용은 저장한 자료에서 확인할 수 있어요.
              </p>
            </details>
          )}
          <section className="marketplace-section">
            <h2>배포 방식</h2>
            <div className="marketplace-actions">
              <label>
                <input
                  type="radio"
                  checked={!paid}
                  onChange={() => setPaid(false)}
                  name="distribution"
                />
                무료 배포
              </label>
              <label>
                <input
                  type="radio"
                  checked={paid}
                  onChange={() => setPaid(true)}
                  name="distribution"
                />
                유료 배포
              </label>
            </div>
            {paid && (
              <div className="marketplace-form-grid">
                <label className="marketplace-field">
                  자료 가격 (원)
                  <input
                    name="priceKRW"
                    type="number"
                    min={1}
                    max={1000000}
                    required
                    defaultValue={draft?.priceKRW || initial?.priceKRW || 10000}
                  />
                </label>
                <label className="marketplace-field">
                  외부 구매 링크
                  <input
                    name="purchaseUrl"
                    type="url"
                    maxLength={2048}
                    required
                    defaultValue={draft?.purchaseUrl ?? initial?.purchaseUrl ?? ""}
                    placeholder="https://"
                  />
                </label>
              </div>
            )}
            <p>
              {paid
                ? "결제는 외부 플랫폼에서 진행돼요. 구매 확인 요청을 받은 작성자가 결제를 확인하고 자료 이용을 승인해요."
                : "발행하면 누구나 전문을 보고 마크다운 파일을 다운로드할 수 있어요."}
            </p>
            <small>
              본인이 공유할 권리를 가진 시나리오와 자료만 올려주세요. 유료 자료의 이용 허용 범위와
              환불 안내를 외부 구매 페이지에 명시해주세요. 출처와 공동 제작자를 가이드에
              표기해주세요.
            </small>
          </section>
          <section className="marketplace-section">
            <h2>이용 조건과 다음 버전</h2>
            <label className="marketplace-field">
              이 자료의 이용 조건
              <textarea
                name="usageTerms"
                required
                maxLength={2000}
                rows={4}
                defaultValue={
                  draft?.usageTerms ??
                  initial?.usageTerms ??
                  "출처와 원저작자를 표시해주세요. 허용 범위를 벗어난 재배포는 작성자에게 문의해주세요."
                }
                placeholder="출처 표기, 수정·재배포 범위와 행사 이용 조건을 적어주세요."
              />
            </label>
            <div className="record-switch-line">
              <span>다른 회원이 이 자료로 파생 자료를 만들 수 있어요</span>
              <button
                type="button"
                role="switch"
                aria-checked={allowDerivatives}
                aria-label="파생 자료 제작 허용"
                className={"crew-switch " + (allowDerivatives ? "is-on" : "")}
                onClick={() => setAllowDerivatives((value) => !value)}
              />
            </div>
            <div className="record-switch-line">
              <span>참가비를 받는 행사 등 상업적인 운영을 허용해요</span>
              <button
                type="button"
                role="switch"
                aria-checked={allowCommercialUse}
                aria-label="상업적 이용 허용"
                className={"crew-switch " + (allowCommercialUse ? "is-on" : "")}
                onClick={() => setAllowCommercialUse((value) => !value)}
              />
            </div>
            <label className="marketplace-field">
              이번 버전에서 달라진 점
              <textarea
                name="changeSummary"
                maxLength={1000}
                rows={3}
                placeholder="예: 실제 진행 결과를 반영해 미션 순서와 준비물을 보완했어요."
              />
              <small>
                발행할 때 작성해요. 발행 후에는 해당 버전의 내용과 이용 조건을 고칠 수 없어요.
              </small>
            </label>
            <label className="library-public-consent">
              <input
                type="checkbox"
                checked={publicContentConsent}
                onChange={(event) => setPublicContentConsent(event.target.checked)}
              />
              <span>
                이 자료를 공개할 권한이 있으며, 개인 정보와 비공개 운영 내용을 검토했어요.
              </span>
            </label>
            <p>
              회원 전용 회고에서 가져온 내용도 자료로 발행하면 공개 범위가 달라질 수 있어요.
              사진·영상과 참가자 정보는 자동으로 복사하지 않습니다.
            </p>
            {savedEntry?.sourceRecordPostId && (
              <Link
                className="library-source-link"
                href={"/records/" + savedEntry.sourceRecordPostId}
              >
                초안의 바탕이 된 행사 회고 확인
              </Link>
            )}
          </section>
          {message && (
            <p className="library-save-message" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="marketplace-alert" role="alert">
              {error}
            </p>
          )}
          <div className="marketplace-actions">
            <button
              className="participation-secondary"
              type="submit"
              name="intent"
              value="save"
              disabled={busy}
            >
              {savingIntent === "save" ? "저장 중…" : "초안 저장"}
            </button>
            <button
              className="participation-primary"
              type="submit"
              name="intent"
              value="publish"
              disabled={busy}
            >
              {savingIntent === "publish"
                ? "저장·발행 중…"
                : savedEntry?.publishedVersion
                  ? "새 버전 발행"
                  : "첫 버전 발행"}
            </button>
            <Link className="participation-secondary" href={base}>
              취소
            </Link>
          </div>
        </fieldset>
      </form>
    </ParticipationShell>
  );
}
