"use client";
import Link from "next/link";
import { EventLocationField } from "./event-location-field";
import type { VenuePoint } from "@/domain/discovery";
import { meetupVenueLabel } from "@/domain/venue-meetup";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ParticipationShell } from "./participation-shell";
import { templateHostSchema, type LibraryDetail } from "@/domain/library";
import { appRequest } from "@/lib/api-client";
export function TemplateHost({ template }: { template: LibraryDetail }) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [external, setExternal] = useState(false);
  const [venue, setVenue] = useState<VenuePoint | null>(null);
  const [location, setLocation] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const value = {
      title: f.get("title"),
      location: f.get("location"),
      venue,
      startsAt: `${f.get("startsAt")}:00+09:00`,
      endsAt: `${f.get("endsAt")}:00+09:00`,
      amountKRW: Number(f.get("amountKRW")),
      capacity: Number(f.get("capacity")),
      applicationUrl: external ? String(f.get("applicationUrl") ?? "") : null,
      description: f.get("description"),
    };
    const parsed = templateHostSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "입력 내용을 확인해주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await appRequest<{ postId: string }>(
        `/api/library/${template.id}/host`,
        "POST",
        parsed.data,
      );
      router.push(`/management/events/${result.postId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "행사를 개설하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ParticipationShell>
      <div className="marketplace-heading">
        <div>
          <span className="marketplace-kicker">BECOME A HOST</span>
          <h1>우리만의 모임을 열어요</h1>
          <p>
            {template.title} · 원저작자 {template.author}
          </p>
        </div>
        <Link className="participation-secondary" href={`/archive/${template.id}`}>
          자료로 돌아가기
        </Link>
      </div>
      <form className="marketplace-form" onSubmit={submit}>
        <section className="marketplace-section">
          <h2>모임 기본 정보</h2>
          <label className="marketplace-field">
            모집 제목
            <input
              name="title"
              required
              minLength={2}
              maxLength={120}
              defaultValue={`${template.title} 함께해요`.slice(0, 120)}
            />
          </label>
          <label className="marketplace-field">
            장소
            <input
              name="location"
              required
              minLength={2}
              maxLength={120}
              placeholder="지역 · 구체적인 장소"
              value={location}
              onChange={(event) => {
                setLocation(event.target.value);
                setVenue((before) =>
                  before ? { latitude: before.latitude, longitude: before.longitude } : null,
                );
              }}
            />
          </label>
          <EventLocationField
            value={venue}
            onChange={setVenue}
            onPlaceSelected={(place) => setLocation(meetupVenueLabel(place))}
            disabled={busy}
            purpose="venue"
          />
          <p className="participation-muted">
            행사장 위치를 지정하면 내 주변 이벤트와 거리순 탐색에 표시돼요.
          </p>
          <div className="marketplace-form-grid">
            <label className="marketplace-field">
              시작 (한국시간)
              <input name="startsAt" type="datetime-local" required step={60} />
            </label>
            <label className="marketplace-field">
              종료 (한국시간)
              <input name="endsAt" type="datetime-local" required step={60} />
            </label>
            <label className="marketplace-field">
              참가비 (원)
              <input
                name="amountKRW"
                type="number"
                required
                min={0}
                max={10000000}
                defaultValue={0}
              />
            </label>
            <label className="marketplace-field">
              정원
              <input
                name="capacity"
                type="number"
                required
                min={template.minPlayers}
                max={template.maxPlayers}
                defaultValue={template.maxPlayers}
              />
              <small>
                이 자료의 권장 인원: {template.minPlayers}–{template.maxPlayers}명
              </small>
            </label>
          </div>
          <label className="marketplace-field">
            참가자에게 안내할 내용
            <textarea
              name="description"
              required
              minLength={10}
              maxLength={10000}
              rows={6}
              placeholder="어떤 분위기로 진행되는지, 준비할 것이 있는지, 만나는 방법과 유의사항을 알려주세요."
            />
          </label>
        </section>
        <section className="marketplace-section">
          <h2>신청 방식</h2>
          <div className="marketplace-actions">
            <label>
              <input
                type="radio"
                name="applicationMode"
                checked={!external}
                onChange={() => setExternal(false)}
              />
              슬리퍼에서 참가 신청
            </label>
            <label>
              <input
                type="radio"
                name="applicationMode"
                checked={external}
                onChange={() => setExternal(true)}
              />
              외부 플랫폼에서 신청 · 결제
            </label>
          </div>
          {external && (
            <label className="marketplace-field">
              외부 신청 링크
              <input
                name="applicationUrl"
                required
                type="url"
                maxLength={2048}
                placeholder="https://"
              />
            </label>
          )}
          <p>
            {external
              ? "외부 플랫폼에서 신청·결제한 참가자를 관리 페이지에서 승인하면 행사 공지방에 자동 초대돼요."
              : "참가 신청은 슬리퍼에서 진행해요. 유료 행사의 결제·정산은 연결할 결제 플랫폼에서 처리하고, 결제 확인 후 공지방에 자동 초대돼요."}
          </p>
        </section>
        <section className="marketplace-section">
          <h2>참가자에게 안내되는 환불 기준</h2>
          <div className="marketplace-meta">
            <span>5일 전까지 100%</span>
            <span>4일 전 80%</span>
            <span>3일 전 60%</span>
            <span>2일 전 40%</span>
            <span>1일 전 20%</span>
            <span>당일 이후 0%</span>
          </div>
          <p>
            한국시간 행사 시작일의 달력날짜를 기준으로 해요. 실제 환불·정산은 결제 플랫폼에서
            처리합니다.
          </p>
          <small>
            원본 자료가 변경돼도 이 행사에 복제한 규칙·진행 가이드는 개설 시점의 내용으로 보존돼요.
            담당자만 행사 진행 가이드를 볼 수 있어요.
          </small>
        </section>
        {error && (
          <p className="marketplace-alert" role="alert">
            {error}
          </p>
        )}
        <button className="participation-primary" disabled={busy}>
          {busy ? "모임 만드는 중…" : "호스트가 되어 모임 열기"}
        </button>
      </form>
    </ParticipationShell>
  );
}
