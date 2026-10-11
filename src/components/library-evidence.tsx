"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpenCheck, ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import type { LibraryEvidencePage } from "@/domain/library-evidence";
import { appRequest } from "@/lib/api-client";
import { CATEGORIES } from "@/domain/categories";

function dateLabel(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" }).format(
        new Date(value),
      )
    : "일정 기록 없음";
}

export function LibraryEvidencePanel({
  entryId,
  authenticated,
}: {
  entryId: string;
  authenticated: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState("");
  const [data, setData] = useState<LibraryEvidencePage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setData(null);
    setPage(1);
    setVersion("");
  }, [entryId, authenticated]);
  useEffect(() => {
    if (!open || !authenticated) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const query = new URLSearchParams({ page: String(page), ...(version ? { version } : {}) });
    appRequest<LibraryEvidencePage>(
      `/api/library/${entryId}/evidence?${query}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((next) => {
        if (!controller.signal.aborted) setData(next);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setData(null);
          setError(cause instanceof Error ? cause.message : "운영 사례를 불러오지 못했어요.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [entryId, authenticated, open, page, version, revision]);
  return (
    <section className="marketplace-section collaboration-panel">
      <button
        type="button"
        className="collaboration-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <BookOpenCheck size={18} />
        <strong>출석 확인된 운영 사례</strong>
        <span>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>
      <p className="record-note">
        실제 완료된 행사와 참가 인증 후기에서 이 자료의 활용 경험을 확인해요.
      </p>
      {open &&
        (!authenticated ? (
          <Link
            className="record-backlink"
            href={`/login?returnTo=${encodeURIComponent(`/archive/${entryId}`)}`}
          >
            로그인하고 운영 사례 보기
            <ArrowRight size={14} />
          </Link>
        ) : (
          <>
            <div className="record-filters">
              <label>
                사용 버전
                <select
                  value={version}
                  disabled={busy}
                  onChange={(event) => {
                    setVersion(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">모든 버전</option>
                  {data?.versions.map((item) => (
                    <option key={item.number} value={item.number}>
                      v{item.number} · {item.caseCount}개 행사
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="participation-secondary"
                disabled={busy}
                onClick={() => setRevision(revision + 1)}
              >
                새로고침
              </button>
            </div>
            {error && (
              <p className="participation-error" role="alert">
                {error}
              </p>
            )}
            {busy ? (
              <p className="record-note" role="status">
                운영 사례를 불러오는 중…
              </p>
            ) : (
              data && (
                <>
                  <p className="record-note">
                    완료·회원 공개 행사 {data.total}개
                    {data.legacyCount > 0 && ` · 버전 기록 이전 ${data.legacyCount}개`}. 출석 확인은
                    자료의 품질 보증을 의미하지 않아요.
                  </p>
                  {data.items.length ? (
                    <ul className="record-list">
                      {data.items.map((item) => (
                        <li key={item.postId} className="record-list-item">
                          <div className="record-list-item-main">
                            <div className="record-tags">
                              <span className="record-status">
                                {item.versionNumber === null
                                  ? "버전 기록 이전"
                                  : `v${item.versionNumber}`}
                              </span>
                              <span className="record-note">
                                {CATEGORIES.find((category) => category.slug === item.category)
                                  ?.name ?? item.category}
                              </span>
                            </div>
                            <Link href={`/records/${item.postId}`}>
                              <h3>{item.title}</h3>
                            </Link>
                            <div className="record-meta">
                              <span>{dateLabel(item.startsAt)}</span>
                              <span>{item.location}</span>
                            </div>
                            <p className="record-note">
                              참가 {item.attended}명 · QR {item.qrAttended}명 / 담당자 확인{" "}
                              {item.managerAttended}명
                            </p>
                          </div>
                          <div className="record-list-item-side">
                            <span className="record-small-stat">
                              <strong>
                                {item.averageRating === null
                                  ? "평점 없음"
                                  : `${item.averageRating.toFixed(2)} / 5`}
                              </strong>
                              참가 인증 후기 {item.reviewCount}개
                            </span>
                            <Link className="record-backlink" href={`/records/${item.postId}`}>
                              행사 기록
                              <ArrowRight size={13} />
                            </Link>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="record-note">아직 회원에게 공개된 완료 행사 사례가 없어요.</p>
                  )}
                  {data.pageCount > 1 && (
                    <nav className="record-pagination" aria-label="운영 사례 페이지">
                      <button
                        type="button"
                        disabled={busy || page <= 1}
                        onClick={() => setPage(page - 1)}
                      >
                        이전
                      </button>
                      <span>
                        {page} / {data.pageCount}
                      </span>
                      <button
                        type="button"
                        disabled={busy || page >= data.pageCount}
                        onClick={() => setPage(page + 1)}
                      >
                        다음
                      </button>
                    </nav>
                  )}
                </>
              )
            )}
          </>
        ))}
    </section>
  );
}
