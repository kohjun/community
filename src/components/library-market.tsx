"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ReceiptText,
  RefreshCw,
} from "lucide-react";
import type {
  PurchaseDetail,
  PurchaseDispute,
  PurchasePage,
  PurchaseStatus,
} from "@/domain/library-market";
import { appRequest, RequestError } from "@/lib/api-client";
import { ParticipationShell } from "./participation-shell";
import { LibraryUsageTerms } from "./library-version-panel";

const statusNames: Record<PurchaseStatus, string> = {
  pending: "구매 확인 대기",
  paid: "이용 승인",
  rejected: "확인 반려",
  revoked: "이용 권한 회수",
  refunded: "전액 환불 확인",
};
const scopeNames = { buying: "내 구매", selling: "판매 관리", disputes: "운영 분쟁 검토" };
type Scope = keyof typeof scopeNames;
const disputeNames: Record<PurchaseDispute["kind"], string> = {
  delivery: "자료 열람·제공",
  terms: "이용 조건",
  payment: "결제·환불",
  other: "기타",
};
const date = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const money = (value: number) => `${value.toLocaleString("ko-KR")}원`;

export function LibraryMarketUnavailable({ message }: { message: string }) {
  return (
    <ParticipationShell advertising={false}>
      <section className="library-market-empty">
        <ReceiptText size={28} />
        <h1>구매 내역을 열 수 없어요</h1>
        <p>{message}</p>
        <Link href="/archive" className="participation-secondary">
          아카이브로 돌아가기
        </Link>
      </section>
    </ParticipationShell>
  );
}

export function LibraryMarketList({ initial, scope }: { initial: PurchasePage; scope: Scope }) {
  const first = Math.max(1, initial.page - 2),
    last = Math.min(initial.pageCount, first + 4);
  return (
    <ParticipationShell advertising={false}>
      <Link href="/archive" className="library-market-back">
        <ArrowLeft size={16} /> 아카이브
      </Link>
      <header className="library-market-header">
        <div>
          <span className="marketplace-kicker">MY ARCHIVE</span>
          <h1>구매와 판매</h1>
          <p>구매한 자료의 버전과 이용 조건, 외부 결제 확인 내역을 한곳에서 확인해요.</p>
        </div>
        <ReceiptText size={30} aria-hidden="true" />
      </header>
      <nav className="library-market-tabs" aria-label="구매와 판매 구분">
        {(["buying", "selling", ...(initial.canReviewDisputes ? ["disputes"] : [])] as Scope[]).map(
          (value) => (
            <Link
              key={value}
              href={`/archive/purchases?scope=${value}`}
              aria-current={scope === value ? "page" : undefined}
            >
              {scopeNames[value]}
            </Link>
          ),
        )}
      </nav>
      <div className="library-market-list-heading">
        <h2>{scopeNames[scope]}</h2>
        <span>{initial.total.toLocaleString("ko-KR")}건 · 20개씩 보기</span>
      </div>
      {initial.items.length ? (
        <ul className="library-market-list">
          {initial.items.map((purchase) => (
            <li key={purchase.id}>
              <Link href={`/archive/purchases/${purchase.id}`} className="library-market-row">
                <div className="library-market-row-main">
                  <span className={`library-market-status is-${purchase.status}`}>
                    {statusNames[purchase.status]}
                  </span>
                  <h3>{purchase.snapshot.title}</h3>
                  <p>
                    v{purchase.snapshot.versionNumber} · {scope === "buying" ? "판매자" : "구매자"}{" "}
                    {scope === "buying" ? purchase.seller : purchase.buyer} ·{" "}
                    {date(purchase.createdAt)}
                  </p>
                  {purchase.openDisputes > 0 && (
                    <small className="library-market-blue">
                      열린 문의 {purchase.openDisputes}건
                    </small>
                  )}
                </div>
                <div className="library-market-row-side">
                  <strong>{money(purchase.amountKRW)}</strong>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="library-market-empty">
          <ReceiptText size={28} />
          <h3>
            {scope === "selling"
              ? "아직 판매 확인 요청이 없어요"
              : scope === "disputes"
                ? "열린 분쟁이 없어요"
                : "아직 구매 내역이 없어요"}
          </h3>
          <p>
            {scope === "buying"
              ? "아카이브에서 자료를 살펴보고 구매 후 확인을 요청해주세요."
              : "새 요청이 들어오면 이곳에서 확인할 수 있어요."}
          </p>
        </div>
      )}
      {initial.pageCount > 1 && (
        <nav className="library-market-pagination" aria-label="구매 내역 페이지">
          {initial.page > 1 && (
            <Link
              href={`/archive/purchases?scope=${scope}&page=${initial.page - 1}`}
              aria-label="이전 페이지"
            >
              <ChevronLeft size={16} />
            </Link>
          )}
          {Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i).map(
            (page) => (
              <Link
                key={page}
                href={`/archive/purchases?scope=${scope}&page=${page}`}
                aria-current={initial.page === page ? "page" : undefined}
              >
                {page}
              </Link>
            ),
          )}
          {initial.page < initial.pageCount && (
            <Link
              href={`/archive/purchases?scope=${scope}&page=${initial.page + 1}`}
              aria-label="다음 페이지"
            >
              <ChevronRight size={16} />
            </Link>
          )}
        </nav>
      )}
      <p className="library-market-caption">
        결제와 환불은 외부 구매 플랫폼에서 처리해요. Sliper는 확인 결과와 자료 이용 권한을 기록해요.
      </p>
    </ParticipationShell>
  );
}

export function LibraryMarketDetail({ initial }: { initial: PurchaseDetail }) {
  const [purchase, setPurchase] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [copied, setCopied] = useState(false),
    [unavailable, setUnavailable] = useState(false),
    busyRef = useRef(false);
  useEffect(() => {
    setPurchase(initial);
    setUnavailable(false);
  }, [initial]);
  async function work(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "처리하지 못했어요.");
      if (
        cause instanceof RequestError &&
        ["FORBIDDEN", "UNAUTHENTICATED", "NOT_FOUND"].includes(cause.code ?? "")
      )
        setUnavailable(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    setPurchase(await appRequest<PurchaseDetail>(`/api/library-market/${purchase.id}`));
  }
  async function mutate(path: string, body: unknown, message: string) {
    await appRequest(`/api/library-market/${purchase.id}${path}`, "POST", body);
    await refresh();
    setNotice(message);
  }
  async function copy() {
    void work(async () => {
      await navigator.clipboard.writeText(purchase.id);
      setCopied(true);
      setNotice("Sliper 구매 ID를 복사했어요.");
    });
  }
  function decide(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void work(() =>
      mutate(
        "/decision",
        {
          action: f.get("action"),
          expectedUpdatedAt: purchase.updatedAt,
          note: String(f.get("note") ?? ""),
          paymentChecked: f.get("paymentChecked") === "on",
        },
        "구매 확인 내역을 저장했어요.",
      ),
    );
  }
  function openDispute(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    void work(async () => {
      await mutate(
        "/disputes",
        { kind: f.get("kind"), body: String(f.get("body") ?? "") },
        "문의가 접수되었어요.",
      );
      form.reset();
    });
  }
  if (unavailable) return <LibraryMarketUnavailable message={error} />;
  const actions =
    purchase.status === "pending"
      ? [
          { value: "approve", name: "결제 확인 · 이용 승인" },
          { value: "reject", name: "구매 확인 반려" },
          { value: "refund", name: "외부 전액 환불 완료 확인" },
        ]
      : purchase.status === "paid"
        ? [
            { value: "revoke", name: "이용 권한 회수" },
            { value: "refund", name: "외부 전액 환불 완료 확인" },
          ]
        : purchase.status === "revoked" || purchase.status === "rejected"
          ? [{ value: "refund", name: "외부 전액 환불 완료 확인" }]
          : [];
  return (
    <ParticipationShell advertising={false}>
      <Link
        href={`/archive/purchases?scope=${purchase.isSeller ? "selling" : purchase.canReviewDisputes ? "disputes" : "buying"}`}
        className="library-market-back"
      >
        <ArrowLeft size={16} /> 구매와 판매
      </Link>
      <header className="library-market-header">
        <div>
          <span className={`library-market-status is-${purchase.status}`}>
            {statusNames[purchase.status]}
          </span>
          <h1>{purchase.snapshot.title}</h1>
          <p>
            구매 요청 당시 v{purchase.snapshot.versionNumber} · {money(purchase.amountKRW)}
          </p>
        </div>
        <button
          className="participation-secondary"
          type="button"
          disabled={busy}
          onClick={() => void work(refresh)}
        >
          <RefreshCw size={15} /> 새로고침
        </button>
      </header>
      {error && (
        <p className="library-market-feedback" role="alert">
          {error}
        </p>
      )}
      {purchase.provider === "local-test" && (
        <p className="library-market-feedback">
          테스트 구매 내역이에요. 실제 결제나 금액 청구는 발생하지 않았어요.
        </p>
      )}
      {notice && (
        <p className="library-market-feedback" role="status">
          {notice}
        </p>
      )}
      <section className="library-market-section">
        <h2>구매 확인 정보</h2>
        <dl className="library-market-facts">
          <div className="library-market-id">
            <dt>Sliper 구매 ID</dt>
            <dd>
              <code>{purchase.id}</code>
              <button
                type="button"
                onClick={() => void copy()}
                disabled={busy}
                aria-label="Sliper 구매 ID 복사"
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </dd>
          </div>
          <div>
            <dt>외부 구매 번호</dt>
            <dd>{purchase.externalReference}</dd>
          </div>
          <div>
            <dt>구매자</dt>
            <dd>{purchase.buyer}</dd>
          </div>
          <div>
            <dt>판매자</dt>
            <dd>{purchase.seller}</dd>
          </div>
          <div>
            <dt>요청 시각</dt>
            <dd>{date(purchase.createdAt)}</dd>
          </div>
          {purchase.paymentId && (
            <div>
              <dt>연동 결제 번호</dt>
              <dd>{purchase.paymentId}</dd>
            </div>
          )}
          {purchase.provider && (
            <div>
              <dt>확인 플랫폼</dt>
              <dd>{purchase.provider}</dd>
            </div>
          )}
          {purchase.note && (
            <div className="library-market-wide">
              <dt>구매 요청 내용</dt>
              <dd className="library-market-text">{purchase.note}</dd>
            </div>
          )}
        </dl>
        <p className="library-market-caption">
          외부 플랫폼과 연결할 때 이 구매 ID로 확인 내역을 매칭할 수 있어요.
        </p>
        <div className="marketplace-actions">
          <Link
            href={`/archive/${purchase.entryId}?version=${purchase.snapshot.versionNumber}`}
            className="participation-secondary"
          >
            구매 버전 보기 <ArrowUpRight size={15} />
          </Link>
          {purchase.isBuyer && (
            <a
              href={purchase.snapshot.purchaseUrl}
              className="participation-secondary"
              target="_blank"
              rel="noopener noreferrer"
            >
              외부 구매 플랫폼 <ArrowUpRight size={15} />
            </a>
          )}
        </div>
      </section>
      <section className="library-market-section">
        <h2>구매 당시 이용 조건</h2>
        <LibraryUsageTerms
          usageTerms={purchase.snapshot.usageTerms}
          allowDerivatives={purchase.snapshot.allowDerivatives}
          allowCommercialUse={purchase.snapshot.allowCommercialUse}
        />
        <p className="library-market-caption">
          작성자가 자료를 수정해도 이 구매 내역의 버전·금액·이용 조건은 유지돼요.
        </p>
      </section>
      {purchase.canDecide && actions.length > 0 && (
        <section className="library-market-section">
          <h2>판매 확인 처리</h2>
          <form
            className="library-market-form"
            key={`${purchase.id}:${purchase.status}:${purchase.updatedAt}`}
            onSubmit={decide}
          >
            <label>
              처리 방식
              <select name="action">
                {actions.map((action) => (
                  <option value={action.value} key={action.value}>
                    {action.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              확인 내용·처리 사유
              <textarea
                name="note"
                rows={3}
                required
                minLength={2}
                maxLength={500}
                placeholder="외부 플랫폼에서 확인한 내용과 처리 사유를 적어주세요."
              />
            </label>
            <label className="library-market-consent">
              <input name="paymentChecked" type="checkbox" />
              외부 플랫폼에서 {money(purchase.amountKRW)}의 결제 또는 전액 환불 완료를 확인했어요.
            </label>
            <p className="library-market-caption">
              승인·환불 확인에는 외부 처리 확인이 필요해요. 이 버튼은 실제 결제나 환불을 실행하지
              않아요.
            </p>
            <button className="participation-primary" disabled={busy}>
              {busy ? "저장 중…" : "처리 내역 저장"}
            </button>
          </form>
        </section>
      )}
      <section className="library-market-section">
        <h2>문의·분쟁</h2>
        <p className="library-market-caption">
          구매자와 판매자가 자료 제공·이용 조건을 확인하고, 해결이 필요하면 운영 담당자가 처리
          내역을 검토해요.
        </p>
        <div className="library-market-disputes">
          {purchase.disputes.map((dispute) => (
            <DisputeCard
              key={`${dispute.id}:${dispute.updatedAt}`}
              dispute={dispute}
              busy={busy}
              onMutate={(path, body, message) => work(() => mutate(path, body, message))}
            />
          ))}
          {!purchase.disputes.length && (
            <p className="library-market-caption">접수된 문의가 없어요.</p>
          )}
        </div>
        {purchase.canOpenDispute && (
          <details className="library-market-disclosure">
            <summary>새 문의 작성</summary>
            <form className="library-market-form" onSubmit={openDispute}>
              <label>
                문의 주제
                <select name="kind">
                  {Object.entries(disputeNames).map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                상세 내용
                <textarea
                  name="body"
                  rows={4}
                  required
                  minLength={10}
                  maxLength={3000}
                  placeholder="어떤 문제가 있었고 어떤 해결을 원하는지 알려주세요. 카드 번호나 민감한 결제 정보는 적지 말아주세요."
                />
              </label>
              <button className="participation-primary" disabled={busy}>
                문의 접수
              </button>
            </form>
          </details>
        )}
      </section>
      <section className="library-market-section">
        <h2>처리 이력</h2>
        <ol className="library-market-audit">
          {purchase.audit.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{auditName(item.action)}</strong>
                <span>
                  {item.actor} · {date(item.createdAt)}
                </span>
              </div>
              {item.note && <p className="library-market-text">{item.note}</p>}
            </li>
          ))}
        </ol>
        {!purchase.audit.length && (
          <p className="library-market-caption">아직 처리 이력이 없어요.</p>
        )}
      </section>
    </ParticipationShell>
  );
}

function auditName(action: string) {
  const labels: Record<string, string> = {
    requested: "구매 확인 요청",
    approve: "이용 승인",
    reject: "확인 반려",
    revoke: "이용 권한 회수",
    refund: "전액 환불 확인",
    created: "구매 확인 요청",
    paid: "결제 확인",
    refunded: "전액 환불 확인",
    dispute_opened: "문의 접수",
    dispute_responded: "판매자 답변",
    dispute_resolved: "운영 검토 완료",
    dispute_withdrawn: "문의 철회",
  };
  return labels[action] ?? "처리 내역 기록";
}
function DisputeCard({
  dispute,
  busy,
  onMutate,
}: {
  dispute: PurchaseDispute;
  busy: boolean;
  onMutate: (path: string, body: unknown, message: string) => Promise<void>;
}) {
  function respond(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void onMutate(
      `/disputes/${dispute.id}/response`,
      { expectedUpdatedAt: dispute.updatedAt, body: String(f.get("body") ?? "") },
      "답변을 저장했어요.",
    );
  }
  function resolve(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void onMutate(
      `/disputes/${dispute.id}/resolve`,
      {
        expectedUpdatedAt: dispute.updatedAt,
        outcome: f.get("outcome"),
        note: String(f.get("note") ?? ""),
        paymentChecked: f.get("paymentChecked") === "on",
      },
      "운영 검토 내역을 저장했어요.",
    );
  }
  return (
    <article className="library-market-dispute">
      <header>
        <strong>{disputeNames[dispute.kind]}</strong>
        <span>
          {dispute.status === "open"
            ? "검토 중"
            : dispute.status === "withdrawn"
              ? "구매자 철회"
              : "처리 완료"}{" "}
          · {date(dispute.createdAt)}
        </span>
      </header>
      <p className="library-market-text">{dispute.body}</p>
      {dispute.sellerResponse && (
        <div className="library-market-response">
          <strong>판매자 답변</strong>
          <p className="library-market-text">{dispute.sellerResponse}</p>
        </div>
      )}
      {dispute.resolutionNote && (
        <div className="library-market-response">
          <strong>
            운영 검토 결과 ·{" "}
            {dispute.outcome === "refund_confirmed"
              ? "외부 전액 환불 확인"
              : dispute.outcome === "revoke"
                ? "이용 권한 회수"
                : "권한 유지"}
          </strong>
          <p className="library-market-text">{dispute.resolutionNote}</p>
        </div>
      )}
      {dispute.canRespond && (
        <details className="library-market-disclosure">
          <summary>판매자 답변 작성</summary>
          <form className="library-market-form" onSubmit={respond}>
            <label>
              답변
              <textarea
                name="body"
                defaultValue={dispute.sellerResponse}
                rows={3}
                required
                minLength={5}
                maxLength={3000}
              />
            </label>
            <button className="participation-secondary" disabled={busy}>
              답변 저장
            </button>
          </form>
        </details>
      )}
      {dispute.canResolve && (
        <details className="library-market-disclosure">
          <summary>운영 담당자 검토</summary>
          <form className="library-market-form" onSubmit={resolve}>
            <label>
              처리 결과
              <select name="outcome">
                <option value="no_action">이용 권한 유지</option>
                <option value="revoke">이용 권한 회수</option>
                <option value="refund_confirmed">외부 전액 환불 완료 확인</option>
              </select>
            </label>
            <label>
              판단 근거
              <textarea name="note" rows={3} required minLength={5} maxLength={500} />
            </label>
            <label className="library-market-consent">
              <input type="checkbox" name="paymentChecked" />
              외부 플랫폼의 전액 환불 완료를 확인했어요.
            </label>
            <p className="library-market-caption">
              실제 환불은 외부 플랫폼에서 먼저 처리해야 해요.
            </p>
            <button className="participation-primary" disabled={busy}>
              검토 결과 저장
            </button>
          </form>
        </details>
      )}
      {dispute.canWithdraw && (
        <button
          className="participation-secondary"
          type="button"
          disabled={busy}
          onClick={() =>
            void onMutate(
              `/disputes/${dispute.id}/withdraw`,
              { expectedUpdatedAt: dispute.updatedAt },
              "문의를 철회했어요.",
            )
          }
        >
          문의 철회
        </button>
      )}
    </article>
  );
}
