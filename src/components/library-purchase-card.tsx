"use client";

import Link from "next/link";
import { type FormEvent, useId } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ClipboardList,
  Clock3,
  ExternalLink,
  FileText,
  LockKeyhole,
  MessageSquareText,
  RefreshCw,
} from "lucide-react";
import type { LibraryDetail } from "@/domain/library";

interface LibraryPurchaseCardProps {
  entry: LibraryDetail;
  authenticated: boolean;
  localTestPurchase: boolean;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
}

const includedMaterials = [
  { icon: BookOpen, label: "시나리오 전문", detail: "게임의 흐름과 이야기" },
  { icon: FileText, label: "규칙과 승리 조건", detail: "점수·진행 방식까지" },
  { icon: ClipboardList, label: "준비물 체크리스트", detail: "준비부터 빠짐없이" },
  { icon: MessageSquareText, label: "진행자 멘트 가이드", detail: "현장에서 바로 활용" },
  { icon: Clock3, label: "라운드 타이머", detail: "시간에 맞춘 매끄러운 진행" },
];

export function LibraryPurchaseCard({
  entry,
  authenticated,
  localTestPurchase,
  busy,
  onSubmit,
  onRefresh,
}: LibraryPurchaseCardProps) {
  const titleId = useId();
  const pending = entry.myAccess?.status === "pending";
  const decision = entry.myAccess?.status;
  const hasDecision = decision === "rejected" || decision === "revoked";

  return (
    <section className="library-purchase-card" aria-labelledby={titleId} aria-busy={busy}>
      <header className="library-purchase-header">
        <div className="library-purchase-badges">
          <span className="library-purchase-badge">
            <LockKeyhole size={13} aria-hidden="true" />
            전체 가이드
          </span>
          {localTestPurchase && <span className="library-purchase-badge is-test">테스트 구매</span>}
        </div>
        <h2 id={titleId}>완성된 진행 가이드를 만나보세요</h2>
        <p>준비부터 현장 진행까지, 모임에 필요한 자료를 한곳에서 확인하세요.</p>
      </header>

      <div className="library-purchase-price-row">
        <div className="library-purchase-price">
          <span>자료 가격</span>
          <strong>
            {entry.priceKRW.toLocaleString("ko-KR")}
            <small>원</small>
          </strong>
        </div>
        <span className="library-purchase-price-caption">
          {localTestPurchase ? "실제 결제 없음" : `발행 v${entry.publishedVersion}`}
        </span>
      </div>

      <div className="library-purchase-layout">
        <div className="library-purchase-included">
          <h3>구매하면 열리는 자료</h3>
          <ul>
            {includedMaterials.map(({ icon: Icon, label, detail }) => (
              <li key={label}>
                <span className="library-purchase-feature-icon">
                  <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <div>
                  <strong>{label}</strong>
                  <span>{detail}</span>
                </div>
                <Check size={14} className="library-purchase-feature-check" aria-hidden="true" />
              </li>
            ))}
          </ul>
          <p className="library-purchase-fineprint">
            자료의 이용 범위는 위 이용 조건을 확인해주세요.
          </p>
        </div>

        <div className="library-purchase-panel">
          {pending ? (
            <div className="library-purchase-pending" role="status">
              <span className="library-purchase-state-icon">
                <Clock3 size={21} aria-hidden="true" />
              </span>
              <h3>구매 확인을 기다리고 있어요</h3>
              <p>작성자가 구매 내역을 확인하면 전체 가이드가 열려요.</p>
              <div className="library-purchase-pending-actions">
                <button
                  className="library-purchase-button is-secondary"
                  type="button"
                  disabled={busy}
                  onClick={onRefresh}
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  {busy ? "확인 중…" : "확인 상태 새로고침"}
                </button>
                <Link className="library-purchase-text-link" href="/archive/purchases">
                  내 구매에서 기록 보기
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          ) : authenticated ? (
            <form className="library-purchase-form" onSubmit={onSubmit}>
              <h3>{localTestPurchase ? "바로 열람하기" : "구매 확인 요청"}</h3>
              <p className="library-purchase-form-intro">
                {localTestPurchase
                  ? "테스트 구매 후 이 페이지에서 전체 가이드가 바로 열려요."
                  : "외부 플랫폼에서 구매한 뒤 주문 번호를 알려주세요."}
              </p>
              {hasDecision && (
                <div className="library-purchase-decision" role="status">
                  <strong>
                    {decision === "rejected"
                      ? "구매 확인이 반려되었어요."
                      : "자료 이용 권한이 회수되었어요."}
                  </strong>
                  {entry.myAccess?.decisionNote && <p>{entry.myAccess.decisionNote}</p>}
                </div>
              )}
              <fieldset disabled={busy}>
                {!localTestPurchase && (
                  <>
                    {entry.purchaseUrl && (
                      <a
                        className="library-purchase-button is-secondary"
                        href={entry.purchaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        외부 플랫폼에서 구매
                        <ExternalLink size={15} aria-hidden="true" />
                      </a>
                    )}
                    <label className="library-purchase-field">
                      외부 플랫폼 구매 번호
                      <input
                        name="externalReference"
                        required
                        minLength={3}
                        maxLength={160}
                        placeholder="주문 또는 구매 번호"
                        autoComplete="off"
                      />
                    </label>
                  </>
                )}
                <label className="library-purchase-field">
                  <span>
                    작성자에게 전달할 내용 <small>선택</small>
                  </span>
                  <textarea
                    name="note"
                    maxLength={500}
                    rows={2}
                    placeholder="전달할 내용이 있다면 남겨주세요."
                  />
                </label>
                <label className="library-purchase-consent">
                  <input name="consent" type="checkbox" required />
                  <span>
                    위 이용 조건을 확인했으며, 구매 요청 내용을 판매자·운영 담당자에게 전달하는 데
                    동의해요.
                  </span>
                </label>
                <button className="library-purchase-button is-primary" type="submit">
                  {busy
                    ? "처리 중…"
                    : localTestPurchase
                      ? "테스트 구매하고 열람하기"
                      : "구매 확인 요청하기"}
                  {!busy && <ArrowRight size={16} aria-hidden="true" />}
                </button>
              </fieldset>
              <p className="library-purchase-fineprint">
                {localTestPurchase
                  ? "실제 금액이 청구되지 않는 테스트 구매예요."
                  : "결제와 환불은 해당 구매 플랫폼에서 처리해요."}
              </p>
            </form>
          ) : (
            <div className="library-purchase-login">
              <h3>로그인하고 이어서 진행하세요</h3>
              <p>
                {localTestPurchase
                  ? "테스트 구매하면 전체 가이드를 바로 열람할 수 있어요."
                  : "구매 내역을 연결하고 전체 가이드를 열람할 수 있어요."}
              </p>
              <Link
                className="library-purchase-button is-primary"
                href={`/login?returnTo=${encodeURIComponent(`/archive/${entry.id}`)}`}
              >
                {localTestPurchase ? "로그인하고 테스트 구매하기" : "로그인 후 구매 확인 요청"}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
