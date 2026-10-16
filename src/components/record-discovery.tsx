"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpenCheck, CheckCircle2 } from "lucide-react";
import type { RecordDetail, RecordPage } from "@/domain/records";
import { appRequest, RequestError } from "@/lib/api-client";
import { RecordCard, recordStatus } from "./event-records";
export function LatestEventRecords({ enabled }: { enabled: boolean }) {
  const [data, setData] = useState<RecordPage | null>(null);
  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }
    const controller = new AbortController();
    appRequest<RecordPage>("/api/records", "GET", undefined, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setData(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setData(null);
      });
    return () => controller.abort();
  }, [enabled]);
  return (
    <section className="record-home-section" aria-labelledby="latest-records-title">
      <div className="section-heading">
        <h2 id="latest-records-title">최근 완료된 행사 기록</h2>
        <Link className="record-backlink" href="/records">
          모든 기록
          <ArrowRight size={14} />
        </Link>
      </div>
      <p className="record-note">함께 만든 순간과 다음 행사를 위한 운영 노하우를 만나요.</p>
      {enabled ? (
        data?.items.length ? (
          <ul className="record-list">
            {data.items.slice(0, 3).map((item) => (
              <RecordCard key={item.postId} item={item} />
            ))}
          </ul>
        ) : (
          <p className="record-note" style={{ marginTop: 12 }}>
            완료 후 공개된 첫 행사 기록을 기다리고 있어요.
          </p>
        )
      ) : (
        <Link className="record-backlink" href="/login?returnTo=%2Frecords">
          로그인하고 행사 회고 보기
          <ArrowRight size={14} />
        </Link>
      )}
    </section>
  );
}
export function RecordBacklink({ postId }: { postId: string }) {
  const [record, setRecord] = useState<RecordDetail | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setRecord(null);
    appRequest<RecordDetail>("/api/records/" + postId, "GET", undefined, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setRecord(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setRecord(null);
      });
    return () => controller.abort();
  }, [postId]);
  return record ? (
    <Link className="record-backlink" href={"/records/" + postId}>
      <BookOpenCheck size={14} />
      {record.status === "published" ? "완료된 행사 기록 보기" : "행사 기록 초안 보기"}
      <ArrowRight size={13} />
    </Link>
  ) : null;
}
export function EventCompletionPanel({
  postId,
  endsAt,
  onCompleted,
}: {
  postId: string;
  endsAt: string | null | undefined;
  onCompleted?: () => void | Promise<void>;
}) {
  const [record, setRecord] = useState<RecordDetail | null>(null),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const gate = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setRecord(null);
    appRequest<RecordDetail>("/api/records/" + postId, "GET", undefined, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setRecord(next);
      })
      .catch((cause) => {
        if (
          !controller.signal.aborted &&
          cause instanceof RequestError &&
          cause.code !== "NOT_FOUND"
        )
          setError(cause.message);
      });
    return () => controller.abort();
  }, [postId]);
  async function complete() {
    if (!checked || gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await appRequest("/api/participation/events/" + postId + "/finalize", "POST", {});
      setRecord(await appRequest<RecordDetail>("/api/records/" + postId));
      setChecked(false);
      setNotice(
        "행사 완료를 확인하고 기록 초안을 만들었어요. QR 참가 전적이 반영되고 모집이 마감되었습니다.",
      );
      await onCompleted?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "완료 확인을 저장하지 못했어요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  const ended = !!endsAt && new Date(endsAt).getTime() <= Date.now();
  return (
    <section className="record-panel" id="event-completion">
      <div className="record-completion-panel">
        <div>
          <h2>
            <CheckCircle2 size={17} />
            {record
              ? recordStatus(record.status)
              : ended
                ? "행사 완료 확인이 필요해요"
                : "행사가 끝나면 기록을 남겨요"}
          </h2>
          <p>
            {record
              ? "참가 경험과 운영 노하우가 하나의 행사 기록으로 이어집니다."
              : "종료 시각 이후 완료를 확인하면 QR 참가 전적을 반영하고 모집을 마감하며 기록 초안을 만듭니다."}
          </p>
        </div>
        {record && (
          <Link
            className="participation-primary"
            href={
              "/records/" +
              postId +
              (record.canEdit && record.status !== "published" ? "/edit" : "")
            }
          >
            {record.canEdit && record.status !== "published" ? "회고 작성·발행" : "행사 기록 보기"}
          </Link>
        )}
      </div>
      {error && (
        <p className="participation-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="record-notice" role="status">
          {notice}
        </p>
      )}
      {!record && ended && (
        <div style={{ marginTop: 14 }}>
          <label className="participation-checkbox">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
              disabled={busy}
            />
            실제 행사가 종료되었으며, 참가 기록을 확인했어요.
          </label>
          <button
            className="participation-primary"
            disabled={busy || !checked}
            onClick={() => void complete()}
          >
            {busy ? "완료 확인 중…" : "완료 확인하고 기록 시작"}
          </button>
        </div>
      )}
    </section>
  );
}

export function LibraryRecordBacklinks({
  libraryId,
  enabled,
}: {
  libraryId: string;
  enabled: boolean;
}) {
  const [items, setItems] = useState<RecordPage | null>(null);
  useEffect(() => {
    if (!enabled) {
      setItems(null);
      return;
    }
    const controller = new AbortController();
    appRequest<RecordPage>(
      "/api/records?libraryId=" + libraryId,
      "GET",
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setItems(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setItems(null);
      });
    return () => controller.abort();
  }, [libraryId, enabled]);
  return items?.items.length ? (
    <section className="record-panel">
      <h2>이 자료와 연결된 행사 기록</h2>
      <ul className="record-list">
        {items.items.slice(0, 3).map((item) => (
          <RecordCard key={item.postId} item={item} />
        ))}
      </ul>
      <Link className="record-backlink" href={"/records?libraryId=" + libraryId}>
        관련 기록 모두 보기
        <ArrowRight size={14} />
      </Link>
    </section>
  ) : null;
}
