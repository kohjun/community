"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Handshake } from "lucide-react";
import { ParticipationShell } from "./participation-shell";
import { CATEGORIES } from "@/domain/categories";
import { crewInputSchema, type CrewDetail } from "@/domain/crew";
import { appRequest } from "@/lib/api-client";
export function CrewCreateForm({ canWrite }: { canWrite: boolean }) {
  const router = useRouter(),
    gate = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [recruiting, setRecruiting] = useState(true);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (gate.current) return;
    const form = new FormData(event.currentTarget);
    const parsed = crewInputSchema.safeParse({
      name: form.get("name"),
      description: form.get("description"),
      category: form.get("category"),
      region: form.get("region"),
      capacity: Number(form.get("capacity")),
      recruiting,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "입력 내용을 확인해주세요.");
      return;
    }
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      const crew = await appRequest<CrewDetail>("/api/crews", "POST", parsed.data);
      router.push("/crews/" + crew.id);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "크루를 만들지 못했어요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  return (
    <ParticipationShell>
      <Link className="crew-back-link" href="/players?tab=crews">
        <ArrowLeft size={15} />
        크루 둘러보기
      </Link>
      <section className="crew-hero">
        <div>
          <span className="crew-eyebrow">
            <Handshake size={15} />
            새로운 팀의 시작
          </span>
          <h1>우리 크루를 만들어볼까요?</h1>
          <p>팀을 소개하고 함께할 사람을 모아보세요.</p>
        </div>
      </section>
      {!canWrite ? (
        <section className="crew-panel crew-empty">
          <h2>로그인하고 크루를 만들어보세요.</h2>
          <Link className="participation-primary" href="/login?next=/crews/new">
            로그인 안내
          </Link>
        </section>
      ) : (
        <form className="crew-panel crew-form" onSubmit={submit}>
          <label>
            크루 이름
            <input
              name="name"
              placeholder="우리 팀을 부를 이름"
              minLength={2}
              maxLength={40}
              required
              disabled={busy}
            />
          </label>
          <label>
            크루 소개
            <textarea
              name="description"
              placeholder="어떤 이벤트를 함께 만들고 싶은지, 어떤 사람을 기다리는지 적어주세요."
              minLength={10}
              maxLength={2000}
              rows={6}
              required
              disabled={busy}
            />
            <small>10~2,000자 · 소개와 구성원 닉네임은 커뮤니티에 공개됩니다.</small>
          </label>
          <div className="crew-form-row">
            <label>
              관심 주제
              <select name="category" defaultValue="party" disabled={busy}>
                {CATEGORIES.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              주 활동 지역
              <input name="region" placeholder="예: 서울 · 성수" maxLength={80} disabled={busy} />
            </label>
            <label>
              최대 인원
              <input
                name="capacity"
                type="number"
                min={2}
                max={100}
                defaultValue={20}
                required
                disabled={busy}
              />
            </label>
          </div>
          <div className="crew-switch-row">
            <div>
              <strong>새 멤버 모집</strong>
              <small>끄면 새로운 가입 신청을 받지 않아요.</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={recruiting}
              aria-label="새 멤버 모집"
              className={"crew-switch " + (recruiting ? "is-on" : "")}
              onClick={() => setRecruiting((v) => !v)}
              disabled={busy}
            >
              <span />
            </button>
          </div>
          <p className="crew-form-note">
            크루를 만들면 내가 리더가 됩니다. 내 닉네임과 프로필 아이콘이 구성원 목록에 공개되고,
            연락처는 공개되지 않아요.
          </p>
          {error && (
            <p role="alert" className="crew-alert">
              {error}
            </p>
          )}
          <div className="crew-form-actions">
            <Link className="participation-secondary" href="/players?tab=crews">
              취소
            </Link>
            <button className="participation-primary" disabled={busy}>
              {busy ? "만드는 중…" : "크루 만들기"}
            </button>
          </div>
        </form>
      )}
    </ParticipationShell>
  );
}
