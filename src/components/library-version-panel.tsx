"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, History, LockKeyhole } from "lucide-react";
import type { LibraryVersionDetail, LibraryVersionPage } from "@/domain/library";
import { appRequest } from "@/lib/api-client";
import { LibraryPlaybook } from "./library-playbook";

export function LibraryUsageTerms({
  usageTerms,
  allowDerivatives,
  allowCommercialUse,
}: {
  usageTerms: string;
  allowDerivatives: boolean;
  allowCommercialUse: boolean;
}) {
  return (
    <div className="library-usage-terms">
      <p>{usageTerms}</p>
      <div className="marketplace-tags">
        <span>{allowDerivatives ? "파생 자료 제작 허용" : "파생 자료 제작은 작성자 문의"}</span>
        <span>{allowCommercialUse ? "상업적 이용 허용" : "상업적 이용은 작성자 문의"}</span>
      </div>
    </div>
  );
}

export function LibraryVersionPanel({
  entryId,
  currentVersion,
  accessRevision,
  onDerive,
  deriving = false,
}: {
  entryId: string;
  currentVersion: number;
  accessRevision: string;
  onDerive: (version: number) => Promise<void>;
  deriving?: boolean;
}) {
  const search = useSearchParams();
  const requested = Number(search.get("version"));
  const initialVersion = Number.isSafeInteger(requested) && requested > 0 ? requested : null;
  const [open, setOpen] = useState(initialVersion !== null),
    [page, setPage] = useState(1),
    [history, setHistory] = useState<LibraryVersionPage | null>(null),
    [selected, setSelected] = useState<number | null>(initialVersion),
    [version, setVersion] = useState<LibraryVersionDetail | null>(null),
    [busy, setBusy] = useState(false),
    [versionBusy, setVersionBusy] = useState(false),
    [error, setError] = useState(""),
    [versionError, setVersionError] = useState(""),
    [historyRetry, setHistoryRetry] = useState(0),
    [versionRetry, setVersionRetry] = useState(0);
  useEffect(() => {
    setSelected(initialVersion);
    if (initialVersion) setOpen(true);
  }, [initialVersion]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    appRequest<LibraryVersionPage>(
      `/api/library/${entryId}/versions?page=${page}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setHistory(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setHistory(null);
          setError(cause instanceof Error ? cause.message : "버전 이력을 불러오지 못했어요.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [entryId, open, page, currentVersion, accessRevision, historyRetry]);
  useEffect(() => {
    setVersion(null);
    setVersionError("");
    if (!selected) {
      setVersionBusy(false);
      return;
    }
    const controller = new AbortController();
    setVersionBusy(true);
    appRequest<LibraryVersionDetail>(
      `/api/library/${entryId}/versions/${selected}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setVersion(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setVersionError(cause instanceof Error ? cause.message : "버전을 불러오지 못했어요.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setVersionBusy(false);
      });
    return () => controller.abort();
  }, [entryId, selected, currentVersion, accessRevision, versionRetry]);
  function view(number: number | null) {
    if (number === selected) return;
    setVersion(null);
    setVersionError("");
    setSelected(number);
    const url = new URL(window.location.href);
    if (number) url.searchParams.set("version", String(number));
    else url.searchParams.delete("version");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  return (
    <section className="marketplace-section library-version-panel">
      <button
        className="library-version-heading"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          <History size={18} />
          버전 이력 · 현재 v{currentVersion}
        </span>
        <ChevronDown size={18} className={open ? "is-open" : ""} />
      </button>
      {open && (
        <>
          <p>
            발행한 버전과 변경 내용을 보존해요. 선택한 버전의 배포 조건과 구매 승인 상태를 확인한 뒤
            본문을 보여드려요.
          </p>
          {error && (
            <div className="marketplace-alert" role="alert">
              <p>{error}</p>
              <button
                type="button"
                className="participation-secondary"
                disabled={busy}
                onClick={() => setHistoryRetry((value) => value + 1)}
              >
                버전 이력 다시 불러오기
              </button>
            </div>
          )}
          {busy && !history && <p role="status">버전 이력을 불러오고 있어요.</p>}
          <div className="library-version-list" aria-busy={busy}>
            {history?.items.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={selected === item.number}
                onClick={() => view(item.number)}
              >
                <span className="library-version-label">
                  v{item.number}
                  {item.number === currentVersion ? " · 현재" : ""}
                </span>
                <span>
                  <strong>{item.changeSummary}</strong>
                  <small>
                    {new Date(item.publishedAt).toLocaleDateString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}
                    {item.legacy ? " · 기존 자료 보존본" : ""}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {history && history.pageCount > 1 && (
            <nav className="library-version-pagination" aria-label="자료 버전 페이지">
              <button
                type="button"
                className="participation-secondary"
                disabled={busy || page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                <ChevronLeft size={15} />
                이전
              </button>
              <span>
                {history.page} / {history.pageCount}
              </span>
              <button
                type="button"
                className="participation-secondary"
                disabled={busy || page >= history.pageCount}
                onClick={() => setPage((value) => value + 1)}
              >
                다음
                <ChevronRight size={15} />
              </button>
            </nav>
          )}
          {versionBusy && selected && <p role="status">선택한 버전을 불러오고 있어요.</p>}
          {versionError && (
            <div className="marketplace-alert" role="alert">
              <p>{versionError}</p>
              <button
                type="button"
                className="participation-secondary"
                disabled={versionBusy}
                onClick={() => setVersionRetry((value) => value + 1)}
              >
                선택한 버전 다시 불러오기
              </button>
            </div>
          )}
          {version && version.number === selected && (
            <div className="library-version-preview">
              <div className="marketplace-heading">
                <div>
                  <h3>
                    v{version.number} · {version.title}
                  </h3>
                  <p>{version.summary}</p>
                </div>
                <button
                  type="button"
                  className="participation-secondary"
                  onClick={() => view(null)}
                >
                  버전 닫기
                </button>
              </div>
              <p className="marketplace-disclaimer">
                {new Date(version.publishedAt).toLocaleDateString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })}
                {version.legacy ? " · 기존 자료 보존본" : ""} · {version.changeSummary}
              </p>
              <LibraryUsageTerms
                usageTerms={version.usageTerms}
                allowDerivatives={version.allowDerivatives}
                allowCommercialUse={version.allowCommercialUse}
              />
              {version.sourceVersion && (
                <Link
                  className="library-source-link"
                  href={`/archive/${version.sourceVersion.entryId}?version=${version.sourceVersion.number}`}
                >
                  원본: {version.sourceVersion.title} · v{version.sourceVersion.number}
                </Link>
              )}
              {version.sourceRecordPostId && (
                <Link
                  className="library-source-link"
                  href={"/records/" + version.sourceRecordPostId}
                >
                  운영 경험의 바탕이 된 행사 기록
                </Link>
              )}
              {version.payload ? (
                <LibraryPlaybook
                  key={version.id}
                  payload={version.payload}
                  summary={version.summary}
                />
              ) : (
                <p className="library-version-locked">
                  <LockKeyhole size={17} />
                  유료 자료의 전문은 구매 확인 후 볼 수 있어요.
                </p>
              )}
              {version.canDerive && (
                <button
                  type="button"
                  className="participation-primary"
                  disabled={deriving}
                  onClick={() => void onDerive(version.number)}
                >
                  이 버전으로 파생 자료 만들기
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
