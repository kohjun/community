"use client";

import { useRef, useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { participationRequest as request } from "@/lib/participation-client";

type Manager = { publicId: string; nickname: string };

export function EventManagerSettings({ postId }: { postId: string }) {
  const [managers, setManagers] = useState<Manager[] | null>(null);
  const [publicId, setPublicId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const url = `/events/${postId}/managers`;

  async function update(id?: string, enabled?: boolean) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const next = id
        ? await request<Manager[]>(url, "PUT", { publicId: id, enabled })
        : await request<Manager[]>(url);
      setManagers(next);
      if (enabled) setPublicId("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "담당자 정보를 다시 확인해주세요.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    void update(publicId.trim(), true);
  }

  return (
    <details
      className="participation-card workspace-disclosure workspace-detail-section event-manager-settings"
      onToggle={(event) => {
        if (event.currentTarget.open && managers === null) void update();
      }}
    >
      <summary>
        <ShieldCheck size={18} aria-hidden="true" />
        담당자 지정
      </summary>
      <p className="participation-muted">
        지정한 담당자는 참가 신청을 확인하고 공지방을 운영할 수 있어요.
      </p>
      <form onSubmit={add}>
        <label>
          회원 공개 프로필 ID
          <input
            required
            value={publicId}
            maxLength={36}
            onChange={(event) => setPublicId(event.target.value)}
            placeholder="회원이 공유한 프로필 ID"
          />
        </label>
        <button className="participation-primary" disabled={busy || !publicId.trim()}>
          담당자 추가
        </button>
      </form>
      {error && (
        <p className="participation-error" role="alert">
          {error}
        </p>
      )}
      {managers?.length === 0 && <p className="participation-muted">지정된 담당자가 없어요.</p>}
      {managers && managers.length > 0 && (
        <ul className="manager-list">
          {managers.map(({ publicId, nickname }) => (
            <li key={publicId}>
              <span>{nickname}</span>
              <button
                type="button"
                className="participation-secondary"
                aria-label={nickname + " 담당자 해제"}
                disabled={busy}
                onClick={() => void update(publicId, false)}
              >
                해제
              </button>
            </li>
          ))}
        </ul>
      )}
      {managers === null && error && (
        <button
          type="button"
          className="participation-secondary"
          disabled={busy}
          onClick={() => void update()}
        >
          목록 다시 불러오기
        </button>
      )}
    </details>
  );
}
