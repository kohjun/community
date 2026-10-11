"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Clock3, Download, Users } from "lucide-react";
import { ParticipationShell } from "./participation-shell";
import { LibraryPlaybook } from "./library-playbook";
import { LibraryDiscoveryConditions } from "./library-discovery-metadata";
import { CATEGORIES } from "@/domain/categories";
import type {
  LibraryDetail as Detail,
  LibraryAccessPage,
  LibraryAccessRow,
} from "@/domain/library";
import { purchaseRequestSchema, type PurchaseDetail } from "@/domain/library-market";
import { libraryTestPurchaseSchema } from "@/domain/library-test-purchase";
import { LibraryPurchaseCard } from "./library-purchase-card";
import { LibraryRecordBacklinks } from "./record-discovery";
import { appRequest } from "@/lib/api-client";
import { LibraryCollaborationPanel } from "./library-collaboration";
import { LibraryEvidencePanel } from "./library-evidence";
import { LibraryUsageTerms, LibraryVersionPanel } from "./library-version-panel";
export function LibraryDetail({
  initial,
  authenticated,
  localTestPurchase = false,
}: {
  initial: Detail;
  authenticated: boolean;
  localTestPurchase?: boolean;
}) {
  const router = useRouter(),
    [entry, setEntry] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [testReceiptId, setTestReceiptId] = useState<string | null>(null),
    [confirmDelete, setConfirmDelete] = useState(false),
    base = "/archive";
  useEffect(() => setEntry(initial), [initial]);
  useEffect(() => {
    if (entry.myAccess?.status !== "pending") return;
    const controller = new AbortController();
    let fetching = false;
    const timer = window.setInterval(() => {
      if (document.hidden || fetching) return;
      fetching = true;
      void appRequest<Detail>(`/api/library/${entry.id}`, "GET", undefined, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setEntry(value);
        })
        .catch(() => {})
        .finally(() => {
          fetching = false;
        });
    }, 10000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [entry.id, entry.myAccess?.status]);
  async function claim(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");
    const f = new FormData(e.currentTarget),
      common = {
        version: entry.publishedVersion,
        note: String(f.get("note") ?? ""),
        consent: f.get("consent") === "on",
      },
      parsed = localTestPurchase
        ? libraryTestPurchaseSchema.safeParse(common)
        : purchaseRequestSchema.safeParse({
            ...common,
            externalReference: f.get("externalReference"),
          });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "입력 내용을 확인해주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const purchase = await appRequest<PurchaseDetail>(
        `/api/library/${entry.id}/${localTestPurchase ? "test-purchase" : "purchase"}`,
        "POST",
        parsed.data,
      );
      if (localTestPurchase) {
        setEntry(await appRequest<Detail>(`/api/library/${entry.id}`));
        setTestReceiptId(purchase.id);
      } else {
        router.push(`/archive/purchases/${purchase.id}`);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "구매 확인을 요청하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  async function derive(version: number) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await appRequest<Detail>(`/api/library/${entry.id}/derive`, "POST", {
        version,
      });
      router.push(`/archive/${created.id}/edit`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "파생 자료의 초안을 만들지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  async function refreshAccess() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setEntry(await appRequest<Detail>(`/api/library/${entry.id}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "확인 상태를 불러오지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await appRequest(`/api/library/${entry.id}`, "DELETE");
      router.push(base);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ParticipationShell>
      <Link className="participation-secondary" href={base}>
        ← 아카이브
      </Link>
      <header className="marketplace-detail-header">
        <div className="marketplace-tags">
          <span>{CATEGORIES.find((c) => c.slug === entry.category)?.name}</span>
          <span>{entry.kind === "template" ? "이벤트 템플릿" : "룰북"}</span>
          <span>
            {entry.status === "draft" ? "비공개 초안" : `발행 v${entry.publishedVersion}`}
          </span>
          {entry.tags.map((t) => (
            <span key={t}>#{t}</span>
          ))}
        </div>
        <h1>{entry.title}</h1>
        <p>{entry.summary}</p>
        {entry.status === "draft" && (
          <p className="library-save-message">
            작성자만 볼 수 있는 초안이에요. 편집 화면에서 이용 조건을 확인하고 첫 버전을
            발행해주세요.
          </p>
        )}
        {entry.status === "published" && entry.draftContent && (
          <p className="library-save-message">
            아직 발행하지 않은 변경 사항이 있어요. 아래 본문은 현재 발행본이며, 초안은 편집 화면에서
            확인할 수 있어요.
          </p>
        )}
        <div className="marketplace-meta">
          <span>
            <Users size={16} />
            권장{" "}
            {entry.minPlayers === entry.maxPlayers
              ? entry.minPlayers
              : `${entry.minPlayers}–${entry.maxPlayers}`}
            명
          </span>
          <span>
            <Clock3 size={16} />
            {entry.durationMinutes}분
          </span>
          <span>원저작자 {entry.author}</span>
          <strong className="marketplace-price">
            {entry.priceKRW
              ? `자료 ${entry.priceKRW.toLocaleString("ko-KR")}원`
              : entry.status === "draft"
                ? "무료 자료"
                : "무료 공개"}
          </strong>
        </div>
        <LibraryDiscoveryConditions metadata={entry.discoveryMetadata ?? null} />
        <p className="marketplace-disclaimer">
          {entry.recordedEvents
            ? `진행 기록 ${entry.recordedEvents}회 · 참가 기록 ${entry.recordedPlayers}명. 종료된 행사에서 담당자가 기록한 참가 내역이며 품질 인증은 아니에요.`
            : "커뮤니티가 공유한 자료예요. 아직 이 자료로 진행한 완료 행사의 참가 기록은 없어요."}
        </p>
        <div className="marketplace-actions">
          {authenticated && entry.status === "published" && (
            <>
              <Link href="/archive/purchases" className="participation-secondary">
                내 구매
              </Link>
              <Link href="/archive/purchases?scope=selling" className="participation-secondary">
                판매 관리
              </Link>
            </>
          )}
          {entry.payload && entry.status === "published" && (
            <a className="participation-secondary" href={`/api/library/${entry.id}/download`}>
              <Download size={16} />
              마크다운 다운로드
            </a>
          )}
          {entry.canHost && (
            <Link href={`/archive/${entry.id}/host`} className="participation-primary">
              이 자료로 모임 열기
            </Link>
          )}
          {entry.canDerive && entry.publishedVersion > 0 && (
            <button
              className="participation-secondary"
              type="button"
              disabled={busy}
              onClick={() => void derive(entry.publishedVersion)}
            >
              파생 자료 만들기
            </button>
          )}
          {entry.isMine && (
            <>
              <Link href={`${base}/${entry.id}/edit`} className="participation-secondary">
                초안 편집·발행
              </Link>
              <button
                className="participation-secondary"
                type="button"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                삭제
              </button>
            </>
          )}
        </div>
        {confirmDelete && (
          <div className="marketplace-alert">
            <p>자료를 삭제할까요? 이미 개설된 행사의 진행 가이드는 보존돼요.</p>
            <button className="participation-primary" disabled={busy} onClick={() => void remove()}>
              삭제하기
            </button>
            <button
              className="participation-secondary"
              type="button"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              취소
            </button>
          </div>
        )}
      </header>
      {error && (
        <p className="marketplace-alert" role="alert">
          {error}
        </p>
      )}
      {testReceiptId && (
        <p className="library-purchase-success" role="status">
          테스트 구매가 완료되어 가이드가 열렸어요. 실제 결제는 발생하지 않았어요.{" "}
          <Link href={`/archive/purchases/${testReceiptId}`}>구매 내역 보기</Link>
        </p>
      )}
      {entry.payload && (
        <LibraryPlaybook key={entry.updatedAt} payload={entry.payload} summary={entry.summary} />
      )}
      <section className="marketplace-section">
        <h2>이용 조건과 출처</h2>
        <LibraryUsageTerms
          usageTerms={entry.usageTerms}
          allowDerivatives={entry.allowDerivatives}
          allowCommercialUse={entry.allowCommercialUse}
        />
        {entry.sourceVersion && (
          <Link
            className="library-source-link"
            href={`/archive/${entry.sourceVersion.entryId}?version=${entry.sourceVersion.number}`}
          >
            원본 자료: {entry.sourceVersion.title} · v{entry.sourceVersion.number}
          </Link>
        )}
        {entry.sourceRecordPostId && (
          <Link className="library-source-link" href={"/records/" + entry.sourceRecordPostId}>
            운영 경험의 바탕이 된 행사 기록
          </Link>
        )}
        {(entry.sourceVersionId || entry.sourceRecordPostId) && (
          <p>파생 출처를 연결해도 원본의 유료·비공개 자료 열람 권한이 생기지는 않아요.</p>
        )}
      </section>
      {!entry.payload && (
        <LibraryPurchaseCard
          entry={entry}
          authenticated={authenticated}
          localTestPurchase={localTestPurchase}
          busy={busy}
          onSubmit={claim}
          onRefresh={() => void refreshAccess()}
        />
      )}
      {entry.publishedVersion > 0 && (
        <Suspense fallback={<p className="marketplace-disclaimer">버전 이력을 준비하고 있어요.</p>}>
          <LibraryVersionPanel
            entryId={entry.id}
            currentVersion={entry.publishedVersion}
            accessRevision={`${entry.updatedAt}:${entry.myAccess?.status ?? "none"}`}
            onDerive={derive}
            deriving={busy}
          />
        </Suspense>
      )}
      {entry.status === "published" && (
        <LibraryCollaborationPanel
          entry={entry}
          authenticated={authenticated}
          onChanged={async () => setEntry(await appRequest<Detail>(`/api/library/${entry.id}`))}
        />
      )}
      {entry.status === "published" && (
        <LibraryEvidencePanel entryId={entry.id} authenticated={authenticated} />
      )}
      <LibraryRecordBacklinks
        libraryId={entry.id}
        enabled={authenticated && entry.status === "published"}
      />
      {entry.priceKRW > 0 && (
        <p className="marketplace-disclaimer">
          이용 권한이 회수되면 새 모임 개설과 다운로드가 제한돼요. 이미 개설한 행사의 진행 가이드는
          보존돼요. 자료의 구체적인 이용 범위는 판매자의 안내를 확인해주세요.
        </p>
      )}
      {entry.isMine && entry.priceKRW > 0 && <LibraryPurchaseManagement entryId={entry.id} />}
    </ParticipationShell>
  );
}
function LibraryPurchaseManagement({ entryId }: { entryId: string }) {
  const [page, setPage] = useState<LibraryAccessPage | null>(null),
    [selected, setSelected] = useState<LibraryAccessRow | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load(cursor?: string) {
    setBusy(true);
    setError("");
    try {
      const value = await appRequest<LibraryAccessPage>(
        `/api/library/${entryId}/requests${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      setPage((previous) =>
        cursor && previous ? { ...value, items: [...previous.items, ...value.items] } : value,
      );
    } catch (e) {
      setPage(null);
      setSelected(null);
      setError(e instanceof Error ? e.message : "요청을 불러오지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  async function decide(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected || busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await appRequest(`/api/library/${entryId}/decision`, "POST", {
        userPublicId: selected.userPublicId,
        decision: f.get("decision"),
        paymentChecked: f.get("paymentChecked") === "on",
        note: String(f.get("note") ?? ""),
      });
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "처리하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="marketplace-section">
      <div className="marketplace-heading">
        <div>
          <h2>이전 구매 확인</h2>
          <p>
            이전 방식으로 접수한 요청이에요. 외부 플랫폼에서 금액과 주문 번호를 확인한 뒤
            승인해주세요.
          </p>
          <Link href="/archive/purchases?scope=selling" className="library-source-link">
            버전·이용 조건이 보관된 새 판매 관리 →
          </Link>
        </div>
        <button className="participation-secondary" disabled={busy} onClick={() => void load()}>
          요청 불러오기
        </button>
      </div>
      {error && (
        <p className="marketplace-alert" role="alert">
          {error}
        </p>
      )}
      {page?.items.map((request) => (
        <div className="marketplace-request" key={request.userPublicId}>
          <div>
            <strong>{request.nickname}</strong>
            <p>
              {request.externalReference} · {request.amountKRW.toLocaleString()}원
            </p>
            <small>{request.note}</small>
          </div>
          <span>
            {
              {
                pending: "확인 대기",
                approved: "이용 승인",
                rejected: "반려",
                revoked: "권한 회수",
              }[request.status]
            }
          </span>
          {["pending", "approved"].includes(request.status) && (
            <button
              className="participation-secondary"
              type="button"
              disabled={busy}
              onClick={() => setSelected(request)}
            >
              처리
            </button>
          )}
        </div>
      ))}
      {page && !page.items.length && <p>아직 구매 확인 요청이 없어요.</p>}
      {page?.nextCursor && (
        <button
          className="participation-secondary"
          disabled={busy}
          onClick={() => void load(page.nextCursor!)}
        >
          이전 요청 더 보기
        </button>
      )}
      {selected && (
        <form className="marketplace-form" key={selected.userPublicId} onSubmit={decide}>
          <h3>{selected.nickname}님의 구매 확인</h3>
          <label className="marketplace-field">
            처리
            <select
              name="decision"
              defaultValue={selected.status === "approved" ? "revoke" : "approve"}
            >
              {selected.status === "pending" ? (
                <>
                  <option value="approve">이용 승인</option>
                  <option value="reject">확인 반려</option>
                </>
              ) : (
                <option value="revoke">이용 권한 회수 (외부 환불 확인 등)</option>
              )}
            </select>
          </label>
          <label>
            <input name="paymentChecked" type="checkbox" />
            외부 플랫폼에서 이 구매 번호와 {selected.amountKRW.toLocaleString()}원 결제를
            확인했어요.
          </label>
          <label className="marketplace-field">
            처리 사유 (반려·회수 시 필수)
            <textarea name="note" rows={3} maxLength={500} />
          </label>
          <div className="marketplace-actions">
            <button className="participation-primary" disabled={busy}>
              처리 완료
            </button>
            <button
              className="participation-secondary"
              type="button"
              onClick={() => setSelected(null)}
            >
              취소
            </button>
          </div>
          <small>
            이 버튼은 실제 결제·환불을 수행하지 않아요. 외부 플랫폼 처리 결과를 확인한 뒤 이용
            권한을 변경해요.
          </small>
        </form>
      )}
    </section>
  );
}
