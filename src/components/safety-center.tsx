"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { appRequest } from "@/lib/api-client";
import {
  REPORT_REASONS,
  SUPPORT_CATEGORIES,
  type ReportView,
  type SupportView,
  type BlockView,
} from "@/domain/safety";
import { ParticipationShell } from "./participation-shell";
type Page<T> = { items: T[]; hasMore: boolean; page: number };
type AuditView = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  createdAt: string;
};
const date = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
const status = (value: string) =>
  ({
    open: "접수·검토 중",
    actioned: "조치 완료",
    dismissed: "검토 완료",
    answered: "답변 완료",
    closed: "처리 완료",
  })[value] ?? value;
export function SafetyCenter({
  kind,
  initial,
  account,
}: {
  kind: "account" | "support" | "admin";
  initial: Page<ReportView> | Page<SupportView>;
  account?: {
    status: string;
    reason: string;
    suspendedUntil: string | null;
    role: string | null;
    blocks: BlockView[];
  };
}) {
  const [tab, setTab] = useState<string>(kind === "admin" ? "reports" : kind),
    [data, setData] = useState<Page<ReportView | SupportView | AuditView>>(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [blocks, setBlocks] = useState(account?.blocks ?? []),
    [withdraw, setWithdraw] = useState(false),
    gate = useRef(false);
  const base = kind === "admin" ? "/api/safety/admin/" : "/api/safety/";
  async function run(work: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "처리하지 못했어요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function load(nextTab: string, page = 1) {
    await run(async () => {
      const resource = nextTab === "account" ? "reports" : nextTab;
      const next = await appRequest<Page<ReportView | SupportView | AuditView>>(
        base + resource + "?page=" + page,
      );
      setData(next);
      setTab(nextTab);
    });
  }
  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      fields = new FormData(form);
    await run(async () => {
      await appRequest("/api/safety/support", "POST", {
        category: fields.get("category"),
        subject: fields.get("subject"),
        body: fields.get("body"),
      });
      setData(await appRequest("/api/safety/support"));
      form.reset();
      setNotice("문의를 접수했어요. 아래에서 답변과 처리 상태를 확인해주세요.");
    });
  }
  async function resolve(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    await run(async () => {
      await appRequest(base + "reports/" + id, "POST", {
        action: fields.get("action"),
        reason: fields.get("reason"),
        days: Number(fields.get("days")),
      });
      setData(await appRequest(base + "reports?page=" + data.page));
      setNotice("처리 사유와 운영 이력을 저장했어요.");
    });
  }
  async function reply(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = event.currentTarget,
      fields = new FormData(form);
    await run(async () => {
      await appRequest(base + "support/" + id, "POST", {
        body: fields.get("body"),
        close: fields.get("close") === "yes",
      });
      setData(await appRequest(base + "support?page=" + data.page));
      form.reset();
      setNotice("답변을 저장했어요.");
    });
  }
  return (
    <ParticipationShell>
      {kind === "admin" && account?.role === "admin" && (
        <Link className="record-backlink" href="/admin/metrics">
          커뮤니티 이용 현황 →
        </Link>
      )}
      <div className="safety-page">
        <div className="safety-heading">
          <div>
            <p className="safety-eyebrow">
              {kind === "admin" ? "운영 공간" : "함께 지키는 슬리퍼"}
            </p>
            <h1>
              {kind === "admin"
                ? "커뮤니티 운영"
                : kind === "support"
                  ? "문의와 도움"
                  : "계정·안전 설정"}
            </h1>
            <p>
              {kind === "admin"
                ? "신고와 문의를 살피고, 모든 조치에 이유를 남겨요."
                : kind === "support"
                  ? "결제·환불부터 계정 이용까지, 필요한 도움을 요청하세요."
                  : "계정 상태와 신고 진행 상황, 차단한 사용자를 확인하세요."}
            </p>
          </div>
          <Link href="/help">이용 안내 →</Link>
        </div>
        {kind === "admin" && (
          <nav className="safety-tabs" aria-label="운영 항목">
            {(
              [
                ["reports", "신고함"],
                ["support", "문의함"],
                ["audit", "처리 이력"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                aria-current={tab === key ? "page" : undefined}
                disabled={busy}
                onClick={() => load(key)}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
        {error && (
          <p role="alert" className="safety-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="safety-notice">
            {notice}
          </p>
        )}
        {kind === "account" && account && (
          <>
            <section className="safety-card">
              <h2>내 계정</h2>
              <p className="safety-badge">
                {account.status === "active"
                  ? "정상 이용 중"
                  : account.status === "closed"
                    ? "탈퇴한 계정"
                    : "이용 제한 중"}
              </p>
              {account.reason && <p>{account.reason}</p>}
              {account.suspendedUntil && account.status === "suspended" && (
                <p>이용 제한 종료: {date(account.suspendedUntil)}</p>
              )}
              <div className="safety-links">
                <Link href="/mypage">프로필·알림 설정</Link>
                <Link href="/support">문의·이의신청</Link>
                {account.role && <Link href="/admin">운영자 화면</Link>}
              </div>
            </section>
            <section className="safety-card">
              <h2>
                차단한 사용자 <span>{blocks.length}</span>
              </h2>
              {!blocks.length ? (
                <p>차단한 사용자가 없어요.</p>
              ) : (
                blocks.map((block) => (
                  <div className="safety-list-row" key={block.id}>
                    <span>{block.label}</span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await appRequest("/api/safety/blocks/" + block.id, "DELETE");
                          setBlocks((current) => current.filter((item) => item.id !== block.id));
                          setNotice("차단을 해제했어요.");
                        })
                      }
                    >
                      차단 해제
                    </button>
                  </div>
                ))
              )}
            </section>
          </>
        )}
        {kind === "support" && (
          <section className="safety-card">
            <h2>새 문의 보내기</h2>
            <p>
              비밀번호·결제카드 정보는 적지 마세요. 결제 관련 문의에는 행사 이름과 외부 플랫폼의
              주문번호를 적어주세요.
            </p>
            <form onSubmit={submitTicket}>
              <fieldset disabled={busy}>
                <label>
                  문의 종류
                  <select name="category">
                    {Object.entries(SUPPORT_CATEGORIES).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  제목
                  <input
                    name="subject"
                    minLength={3}
                    maxLength={100}
                    required
                    placeholder="어떤 도움이 필요하세요?"
                  />
                </label>
                <label>
                  내용
                  <textarea name="body" minLength={10} maxLength={3000} required rows={5} />
                </label>
                <button type="submit" className="safety-primary">
                  {busy ? "접수 중…" : "문의 접수"}
                </button>
              </fieldset>
            </form>
          </section>
        )}
        <section className="safety-card">
          <h2>
            {tab === "audit"
              ? "운영 조치 이력"
              : tab === "support"
                ? "문의 내역"
                : kind === "account"
                  ? "내 신고 내역"
                  : "접수된 신고"}
          </h2>
          {!data.items.length && (
            <div className="safety-empty">
              <h3>아직 내역이 없어요</h3>
              <p>
                {tab === "support"
                  ? "접수한 문의와 운영자의 답변이 여기에 표시돼요."
                  : tab === "audit"
                    ? "운영자가 처리한 조치가 순서대로 기록돼요."
                    : "신고가 접수되면 진행 상황과 처리 사유를 확인할 수 있어요."}
              </p>
            </div>
          )}
          {data.items.map((item) =>
            "action" in item ? (
              <article className="safety-entry" key={item.id}>
                <p className="safety-badge">{item.action}</p>
                <p>{item.reason}</p>
                <small>{date(item.createdAt)}</small>
              </article>
            ) : "subject" in item ? (
              <article className="safety-entry" key={item.id}>
                <div className="safety-entry-heading">
                  <h3>{item.subject}</h3>
                  <span className="safety-badge">{status(item.status)}</span>
                </div>
                <small>
                  {SUPPORT_CATEGORIES[item.category as keyof typeof SUPPORT_CATEGORIES]} ·{" "}
                  {date(item.createdAt)}
                </small>
                <p className="safety-preserve">{item.body}</p>
                {item.replies.map((message: { id: string; body: string; createdAt: string }) => (
                  <div className="safety-answer" key={message.id}>
                    <b>슬리퍼 운영팀</b>
                    <p className="safety-preserve">{message.body}</p>
                    <small>{date(message.createdAt)}</small>
                  </div>
                ))}
                {kind === "admin" && (
                  <form onSubmit={(event) => reply(event, item.id)}>
                    <fieldset disabled={busy}>
                      <label>
                        답변
                        <textarea name="body" minLength={5} maxLength={3000} required rows={3} />
                      </label>
                      <label>
                        처리 상태
                        <select name="close">
                          <option value="no">답변 완료</option>
                          <option value="yes">처리 완료</option>
                        </select>
                      </label>
                      <button type="submit" className="safety-primary">
                        답변 저장
                      </button>
                    </fieldset>
                  </form>
                )}
              </article>
            ) : (
              <article className="safety-entry" key={item.id}>
                <div className="safety-entry-heading">
                  <h3>{REPORT_REASONS[item.reason as keyof typeof REPORT_REASONS]}</h3>
                  <span className="safety-badge">{status(item.status)}</span>
                </div>
                <small>{date(item.createdAt)}</small>
                {item.snapshot && (
                  <details>
                    <summary>신고 당시 콘텐츠 확인</summary>
                    <p className="safety-preserve">{item.snapshot}</p>
                  </details>
                )}
                {item.detail && <p className="safety-preserve">{item.detail}</p>}
                {item.resolution && (
                  <div className="safety-answer">
                    <b>처리 안내</b>
                    <p>{item.resolution}</p>
                  </div>
                )}
                {kind === "admin" && (
                  <form onSubmit={(event) => resolve(event, item.id)}>
                    <fieldset disabled={busy}>
                      <label>
                        운영 조치
                        <select
                          name="action"
                          defaultValue={
                            item.status === "open"
                              ? "dismiss"
                              : item.targetType === "player"
                                ? "reinstate"
                                : "restore"
                          }
                        >
                          {item.status === "open" ? (
                            <>
                              <option value="dismiss">위반 없음 · 검토 완료</option>
                              {item.targetType !== "player" && (
                                <option value="hide">콘텐츠 숨기기</option>
                              )}
                              <option value="warn">작성자에게 경고</option>
                              <option value="suspend">작성자 이용 제한</option>
                            </>
                          ) : (
                            item.targetType !== "player" && (
                              <option value="restore">콘텐츠 다시 공개</option>
                            )
                          )}
                          {account?.role === "admin" && (
                            <option value="reinstate">작성자 이용 제한 해제</option>
                          )}
                        </select>
                      </label>
                      <label>
                        제한 기간
                        <select name="days">
                          <option value="1">1일</option>
                          <option value="7">7일</option>
                          <option value="30">30일</option>
                        </select>
                      </label>
                      <label>
                        처리 사유
                        <textarea
                          name="reason"
                          required
                          minLength={5}
                          maxLength={1000}
                          rows={3}
                          placeholder="신고자와 당사자가 확인할 수 있는 설명을 작성해주세요."
                        />
                      </label>
                      <button
                        type="submit"
                        className="safety-primary"
                        disabled={
                          item.status !== "open" &&
                          item.targetType === "player" &&
                          account?.role !== "admin"
                        }
                      >
                        조치 저장
                      </button>
                    </fieldset>
                  </form>
                )}
              </article>
            ),
          )}
          {(data.page > 1 || data.hasMore) && (
            <nav className="safety-pagination" aria-label="내역 페이지">
              <button disabled={busy || data.page === 1} onClick={() => load(tab, data.page - 1)}>
                이전
              </button>
              <span>{data.page} 페이지</span>
              <button disabled={busy || !data.hasMore} onClick={() => load(tab, data.page + 1)}>
                다음
              </button>
            </nav>
          )}
        </section>
        {kind === "admin" && account?.role === "admin" && (
          <section className="safety-card">
            <h2>이용 제한 해제</h2>
            <p>
              이의신청을 검토한 후 공개 플레이어 ID로 제한을 해제할 수 있어요. 탈퇴한 계정은
              복구하지 않습니다.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const fields = new FormData(event.currentTarget);
                void run(async () => {
                  await appRequest(base + "reinstate/" + String(fields.get("publicId")), "POST", {
                    reason: fields.get("reason"),
                  });
                  setNotice("이용 제한을 해제하고 이력을 저장했어요.");
                });
              }}
            >
              <fieldset disabled={busy}>
                <label>
                  플레이어 ID
                  <input name="publicId" required />
                </label>
                <label>
                  해제 사유
                  <input name="reason" minLength={5} maxLength={1000} required />
                </label>
                <button className="safety-primary" type="submit">
                  제한 해제
                </button>
              </fieldset>
            </form>
          </section>
        )}
        {kind === "account" && account?.status === "active" && (
          <section className="safety-card">
            <h2>회원 탈퇴</h2>
            <p>
              프로필과 연락처를 지우고 로그인을 제한합니다. 과거 신청 답변과 결제 처리 기록은
              유지됩니다. 작성한 글과 댓글은 남으므로 공개를 원하지 않는 글은 먼저 삭제해주세요.
              진행 중인 신청·환불·모집은 먼저 정리해야 합니다.
            </p>
            {!withdraw ? (
              <button type="button" disabled={busy} onClick={() => setWithdraw(true)}>
                탈퇴 안내 확인하기
              </button>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const fields = new FormData(event.currentTarget);
                  void run(async () => {
                    await appRequest("/api/safety/account", "DELETE", {
                      confirm: fields.get("confirm"),
                    });
                    await appRequest("/api/auth/logout", "POST", {});
                    window.location.assign("/login?withdrawn=1");
                  });
                }}
              >
                <fieldset disabled={busy}>
                  <label>
                    계속하려면 ‘탈퇴’를 입력해주세요
                    <input name="confirm" required pattern="탈퇴" autoComplete="off" />
                  </label>
                  <div className="safety-form-actions">
                    <button type="button" onClick={() => setWithdraw(false)}>
                      돌아가기
                    </button>
                    <button type="submit">회원 탈퇴</button>
                  </div>
                </fieldset>
              </form>
            )}
          </section>
        )}
      </div>
    </ParticipationShell>
  );
}
