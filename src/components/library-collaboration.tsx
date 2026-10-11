"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown, GitPullRequest, Link2, Search } from "lucide-react";
import type { LibraryDetail, LibraryVersionDetail } from "@/domain/library";
import {
  SUGGESTION_FIELDS,
  type SuggestionField,
  type SuggestionDetail,
  type LibraryCollaborationPage,
} from "@/domain/library-collaboration";
import type { SearchPage } from "@/domain/search";
import { appRequest } from "@/lib/api-client";
const fieldNames: Record<SuggestionField, string> = {
  title: "제목",
  summary: "소개",
  scenario: "시나리오",
  rules: "규칙",
  hostGuide: "진행자 가이드",
};
const statuses = {
  pending: "검토 대기",
  approved: "반영 완료",
  rejected: "반려",
  withdrawn: "철회",
};
export function LibraryCollaborationPanel({
  entry,
  authenticated,
  onChanged,
}: {
  entry: LibraryDetail;
  authenticated: boolean;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<LibraryCollaborationPage | null>(null),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<SuggestionDetail | null>(null),
    [note, setNote] = useState(""),
    [consent, setConsent] = useState(false);
  const [base, setBase] = useState<LibraryVersionDetail | null>(null),
    [field, setField] = useState<SuggestionField>("rules"),
    [replacement, setReplacement] = useState(""),
    [reason, setReason] = useState(""),
    [proposalConsent, setProposalConsent] = useState(false);
  const [q, setQ] = useState(""),
    [searchCategory, setSearchCategory] = useState<"knowledge" | "lab">("knowledge"),
    [results, setResults] = useState<SearchPage | null>(null);
  useEffect(() => {
    if (!open || !authenticated) return;
    const c = new AbortController();
    setBusy(true);
    setError("");
    setData(null);
    setSelected(null);
    appRequest<LibraryCollaborationPage>(
      `/api/library/${entry.id}/collaboration?page=${page}`,
      "GET",
      undefined,
      c.signal,
    )
      .then((v) => {
        if (!c.signal.aborted) setData(v);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setBusy(false);
      });
    return () => c.abort();
  }, [open, authenticated, entry.id, entry.updatedAt, page, revision]);
  useEffect(() => {
    if (!open || !authenticated || entry.isMine || !entry.payload) return;
    const c = new AbortController();
    setBase(null);
    appRequest<LibraryVersionDetail>(
      `/api/library/${entry.id}/versions/${entry.publishedVersion}`,
      "GET",
      undefined,
      c.signal,
    )
      .then((v) => {
        if (!c.signal.aborted) {
          setBase(v);
          setReplacement(v.content?.[field] ?? "");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [open, authenticated, entry.id, entry.updatedAt]);
  async function work(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  async function propose(e: FormEvent) {
    e.preventDefault();
    void work(async () => {
      if (!base?.content) throw new Error("자료 버전의 열람 권한을 확인해주세요.");
      await appRequest(`/api/library/${entry.id}/collaboration`, "POST", {
        version: base.number,
        field,
        replacement,
        reason,
        consent: proposalConsent,
      });
      setReason("");
      setProposalConsent(false);
      setRevision((v) => v + 1);
      setPage(1);
      setNotice("작성자에게 수정 제안을 보냈어요. 승인 전까지 원본은 유지됩니다.");
    });
  }
  function review(id: string) {
    void work(async () => {
      setSelected(await appRequest<SuggestionDetail>(`/api/library/${entry.id}/suggestions/${id}`));
      setNote("");
      setConsent(false);
    });
  }
  function decide(id: string, updatedAt: string, decision: "approve" | "reject" | "withdraw") {
    void work(async () => {
      await appRequest(`/api/library/${entry.id}/suggestions/${id}`, "POST", {
        decision,
        expectedUpdatedAt: updatedAt,
        note: decision === "withdraw" ? "제안자가 철회했습니다." : note,
        ...(decision === "approve"
          ? { expectedLibraryUpdatedAt: entry.updatedAt, publicContentConsent: consent }
          : {}),
      });
      setSelected(null);
      await onChanged();
      setRevision((v) => v + 1);
      setNotice(
        decision === "approve" ? "제안을 반영한 새 버전을 발행했어요." : "제안을 처리했어요.",
      );
    });
  }
  function search(searchPage = 1) {
    void work(async () => {
      const params = new URLSearchParams({
        q: q.trim(),
        type: "story",
        category: searchCategory,
        page: String(searchPage),
      });
      setResults(await appRequest<SearchPage>("/api/search?" + params));
    });
  }
  function link(postId: string, version = entry.publishedVersion, remove = false) {
    void work(async () => {
      await appRequest(`/api/library/${entry.id}/discussions`, remove ? "DELETE" : "POST", {
        postId,
        version,
      });
      setRevision((v) => v + 1);
      setResults(null);
      setNotice(remove ? "연결을 해제했어요." : "자료 버전과 이야기를 연결했어요.");
    });
  }
  return (
    <section className="marketplace-section collaboration-panel">
      <button
        className="collaboration-toggle"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <GitPullRequest size={17} />
        <span>함께 개선하는 아카이브</span>
        <ChevronDown size={16} />
      </button>
      <p className="marketplace-disclaimer">
        지식·연구 이야기를 연결하고, 수정 제안을 검토해 원본을 보존한 새 버전으로 이어가요.
      </p>
      {open && !authenticated && (
        <p>
          <Link href={"/login?returnTo=" + encodeURIComponent("/archive/" + entry.id)}>
            로그인하고 협업 참여하기
          </Link>
        </p>
      )}
      {open && authenticated && (
        <>
          {error && (
            <p className="marketplace-alert" role="alert">
              {error}
              <button type="button" disabled={busy} onClick={() => setRevision((v) => v + 1)}>
                다시 불러오기
              </button>
            </p>
          )}
          {notice && (
            <p className="record-notice" role="status">
              {notice}
            </p>
          )}
          {busy && (
            <p role="status" className="marketplace-disclaimer">
              처리 중이에요…
            </p>
          )}
          {data && (
            <>
              <h3>{data.isOwner ? "받은 수정 제안" : "내 수정 제안"}</h3>
              <p className="marketplace-disclaimer">
                제안 내용은 제안자와 작성자에게만 보여요. 가격·구매 링크·이용 조건은 수정 제안으로
                변경하지 않습니다.
              </p>
              <div className="collaboration-list">
                {data.items.map((s) => (
                  <article key={s.id}>
                    <div>
                      <strong>
                        {fieldNames[s.field]} 개선 · v{s.baseVersion}
                      </strong>
                      <small>
                        {s.proposer} · {statuses[s.status]}
                        {s.publishedVersion && ` → v${s.publishedVersion}`}
                      </small>
                    </div>
                    <div className="collaboration-actions">
                      <button
                        type="button"
                        className="participation-secondary"
                        disabled={busy}
                        onClick={() => review(s.id)}
                      >
                        내용 보기
                      </button>
                      {s.isMine && s.status === "pending" && (
                        <button
                          type="button"
                          className="participation-secondary"
                          disabled={busy}
                          onClick={() => decide(s.id, s.updatedAt, "withdraw")}
                        >
                          철회
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {!data.items.length && (
                <p className="marketplace-disclaimer">아직 수정 제안이 없어요.</p>
              )}
              {data.pageCount > 1 && (
                <div className="collaboration-actions">
                  <button
                    type="button"
                    disabled={busy || page === 1}
                    onClick={() => setPage((v) => v - 1)}
                  >
                    이전
                  </button>
                  <span>
                    {page} / {data.pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={busy || page >= data.pageCount}
                    onClick={() => setPage((v) => v + 1)}
                  >
                    다음
                  </button>
                </div>
              )}
              {selected && (
                <section className="collaboration-review">
                  <h3>{fieldNames[selected.field]} 수정 제안</h3>
                  <p>{selected.reason}</p>
                  <div className="collaboration-diff">
                    <div>
                      <h4>기준 v{selected.baseVersion}</h4>
                      <pre>{selected.before}</pre>
                    </div>
                    <div>
                      <h4>제안 내용</h4>
                      <pre>{selected.replacement}</pre>
                    </div>
                  </div>
                  {selected.decisionNote && <p>처리 메모: {selected.decisionNote}</p>}
                  {selected.stale && (
                    <p className="marketplace-disclaimer">
                      새 버전이 발행됐어요. 최신 버전을 기준으로 다시 제안해주세요.
                    </p>
                  )}
                  {data.isOwner && selected.status === "pending" && (
                    <>
                      <label className="marketplace-field">
                        처리 사유 · 새 버전 변경 내역
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          minLength={2}
                          maxLength={1000}
                          disabled={busy}
                        />
                      </label>
                      <label className="collaboration-consent">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                          disabled={busy}
                        />
                        변경 내용을 확인했고 현재 이용 조건으로 새 버전 발행에 동의합니다.
                      </label>
                      {!selected.canApprove && !selected.stale && (
                        <p className="marketplace-disclaimer">
                          작성 중인 자료 초안을 먼저 발행하거나 정리해주세요.
                        </p>
                      )}
                      <div className="collaboration-actions">
                        <button
                          type="button"
                          className="participation-primary"
                          disabled={
                            busy || !selected.canApprove || !consent || note.trim().length < 2
                          }
                          onClick={() => decide(selected.id, selected.updatedAt, "approve")}
                        >
                          승인하고 새 버전 발행
                        </button>
                        <button
                          type="button"
                          className="participation-secondary"
                          disabled={busy || note.trim().length < 2}
                          onClick={() => decide(selected.id, selected.updatedAt, "reject")}
                        >
                          반려
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}
              {data.canPropose && (
                <form className="collaboration-form" onSubmit={propose}>
                  <h3>수정 제안 보내기</h3>
                  <p className="marketplace-disclaimer">
                    한 번에 한 항목을 제안해요. 기준 v{base?.number ?? entry.publishedVersion}의
                    다른 항목은 유지됩니다.
                  </p>
                  <label className="marketplace-field">
                    개선할 항목
                    <select
                      value={field}
                      disabled={busy || !base?.content}
                      onChange={(e) => {
                        const f = e.target.value as SuggestionField;
                        setField(f);
                        setReplacement(base?.content?.[f] ?? "");
                      }}
                    >
                      {SUGGESTION_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {fieldNames[f]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="marketplace-field">
                    수정 후 내용
                    <textarea
                      rows={7}
                      required
                      value={replacement}
                      maxLength={
                        { title: 120, summary: 600, scenario: 10000, rules: 8000, hostGuide: 8000 }[
                          field
                        ]
                      }
                      disabled={busy || !base?.content}
                      onChange={(e) => setReplacement(e.target.value)}
                    />
                  </label>
                  <label className="marketplace-field">
                    개선 이유
                    <textarea
                      rows={3}
                      required
                      minLength={10}
                      maxLength={1000}
                      value={reason}
                      disabled={busy}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="운영 경험이나 연구 내용을 근거로 개선 이유를 적어주세요."
                    />
                  </label>
                  <label className="collaboration-consent">
                    <input
                      type="checkbox"
                      checked={proposalConsent}
                      onChange={(e) => setProposalConsent(e.target.checked)}
                      disabled={busy}
                    />
                    작성자가 제안 내용을 자료의 새 버전에 반영하는 데 동의합니다.
                  </label>
                  <button
                    className="participation-primary"
                    disabled={busy || !base?.content || !proposalConsent}
                  >
                    수정 제안 제출
                  </button>
                </form>
              )}
              {!data.canPropose && !data.isOwner && (
                <p className="marketplace-disclaimer">
                  유료 자료는 구매 승인 후 수정 제안을 보낼 수 있어요.
                </p>
              )}
              <h3>
                <Link2 size={16} /> 연결된 지식·콘텐츠 연구
              </h3>
              <div className="collaboration-list">
                {data.discussions.map((p) => (
                  <article key={p.postId + ":" + p.version}>
                    <div>
                      <Link href={"/posts/" + p.postId}>{p.title}</Link>
                      <small>
                        {p.author} · 자료 v{p.version}
                      </small>
                    </div>
                    {p.canRemove && (
                      <button
                        type="button"
                        disabled={busy}
                        className="participation-secondary"
                        onClick={() => link(p.postId, p.version, true)}
                      >
                        연결 해제
                      </button>
                    )}
                  </article>
                ))}
              </div>
              <p className="marketplace-disclaimer">
                자료 또는 이야기 작성자가 공개된 지식·연구 글을 연결할 수 있어요. 연결만으로 유료
                자료 열람 권한이 생기지 않습니다.
              </p>
              {(entry.payload || entry.isMine) && (
                <>
                  <div className="collaboration-search">
                    <select
                      aria-label="연결할 이야기 분류"
                      value={searchCategory}
                      disabled={busy}
                      onChange={(e) => {
                        setSearchCategory(e.target.value as "knowledge" | "lab");
                        setResults(null);
                      }}
                    >
                      <option value="knowledge">지식</option>
                      <option value="lab">콘텐츠 연구소</option>
                    </select>
                    <input
                      aria-label="연결할 지식·연구 글 제목"
                      type="search"
                      value={q}
                      maxLength={100}
                      onChange={(e) => {
                        setQ(e.target.value);
                        setResults(null);
                      }}
                      disabled={busy}
                      placeholder="연결할 이야기 제목"
                    />
                    <button
                      type="button"
                      className="participation-secondary"
                      disabled={busy || !q.trim()}
                      onClick={() => search()}
                    >
                      <Search size={14} />
                      찾기
                    </button>
                  </div>
                  <div className="collaboration-list">
                    {results?.items.map((p) => (
                      <article key={p.id}>
                        <strong>{p.title}</strong>
                        <button
                          type="button"
                          className="participation-secondary"
                          disabled={busy}
                          onClick={() => link(p.id)}
                        >
                          현재 버전에 연결
                        </button>
                      </article>
                    ))}
                  </div>
                  {results && !results.items.length && (
                    <p className="marketplace-disclaimer">이 분류에서 일치하는 이야기가 없어요.</p>
                  )}
                  {results && results.pageCount > 1 && (
                    <nav className="collaboration-actions" aria-label="연결할 이야기 검색 페이지">
                      <button
                        type="button"
                        disabled={busy || results.page === 1}
                        onClick={() => search(results.page - 1)}
                      >
                        이전
                      </button>
                      <span>
                        {results.page} / {results.pageCount}
                      </span>
                      <button
                        type="button"
                        disabled={busy || results.page >= results.pageCount}
                        onClick={() => search(results.page + 1)}
                      >
                        다음
                      </button>
                    </nav>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
export function PostLibraryLinks({ postId, enabled }: { postId: string; enabled: boolean }) {
  const [links, setLinks] = useState<
    Array<{ id: string; title: string; kind: string; version: number }>
  >([]);
  useEffect(() => {
    setLinks([]);
    if (!enabled) return;
    const c = new AbortController();
    appRequest<typeof links>(`/api/posts/${postId}/library-links`, "GET", undefined, c.signal)
      .then((v) => {
        if (!c.signal.aborted) setLinks(v);
      })
      .catch(() => {});
    return () => c.abort();
  }, [postId, enabled]);
  if (!enabled || !links.length) return null;
  return (
    <aside className="collaboration-backlinks">
      <h3>이 이야기와 연결된 자료</h3>
      {links.map((p) => (
        <Link key={p.id + ":" + p.version} href={`/archive/${p.id}?version=${p.version}`}>
          <Link2 size={14} />
          {p.title}
          <small>v{p.version}</small>
        </Link>
      ))}
    </aside>
  );
}
