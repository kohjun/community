"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { appRequest } from "@/lib/api-client";
import { prepareImageForUpload } from "@/lib/image-precompression";
import { VerifiedEventReviews } from "./verified-event-reviews";
import type { ReunionView } from "@/domain/community-growth";
export function EventReunion({ initial }: { initial: ReunionView }) {
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [page, setPage] = useState(1);
  const own = initial.own,
    [body, setBody] = useState(own?.body ?? ""),
    [nextWish, setNextWish] = useState(own?.nextWish ?? ""),
    [visibility, setVisibility] = useState<"participants" | "members">(
      own?.visibility ?? "participants",
    ),
    [version, setVersion] = useState(own?.version ?? 0),
    [photos, setPhotos] = useState<string[]>(own?.photos ?? []);
  const gate = useRef(false),
    base = "/api/growth/reunion/" + data.postId;
  async function work(fn: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "다시 시도해주세요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <header className="participation-heading">
        <p>모임이 끝난 뒤에도 함께</p>
        <h1>{data.title}</h1>
        <p>경험과 사진을 나누고 다음에 해보고 싶은 활동을 제안해보세요.</p>
      </header>
      <div className="maturity-actions">
        <Link href={"/events/" + data.postId}>행사 정보</Link>
        {data.recordUrl && <Link href={data.recordUrl}>주최자 회고·운영 자료</Link>}
        {data.canWrite && (
          <Link href={"/ideas?sourceEventId=" + data.postId}>다음 활동 제안하기</Link>
        )}
      </div>
      {data.canWrite && (
        <section className="maturity-panel">
          <h2>나의 경험 남기기</h2>
          <form
            className="growth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void work(async () => {
                const v = await appRequest<ReunionView>(base, "PUT", {
                  body,
                  nextWish,
                  visibility,
                  version,
                  photos,
                });
                setData(v);
                setPage(1);
                setVersion(version + 1);
              });
            }}
          >
            <label className="growth-wide">
              기억에 남는 순간
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
                maxLength={2000}
                rows={4}
              />
            </label>
            <label className="growth-wide">
              다음에는 무엇을 해보고 싶나요?
              <textarea
                value={nextWish}
                onChange={(e) => setNextWish(e.target.value)}
                maxLength={500}
                rows={2}
              />
            </label>
            <label>
              공유 범위
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as typeof visibility)}
              >
                <option value="participants">참가 확인된 사람·담당자만</option>
                <option value="members">로그인한 회원</option>
              </select>
            </label>
            <label>
              사진 추가 · 최대 6장
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={busy || photos.length >= 6}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void work(async () => {
                    const form = new FormData();
                    form.append("file", await prepareImageForUpload(file, "post"));
                    const asset = await appRequest<{ id: string }>(
                      "/api/community/uploads",
                      "POST",
                      form,
                    );
                    setPhotos((current) => [...current, asset.id].slice(0, 6));
                  });
                }}
              />
            </label>
            <p className="form-note growth-wide">
              사진에 등장하는 사람의 동의를 확인해주세요. 사진도 선택한 공유 범위를 따릅니다.
              저장해야 다른 사람에게 보입니다.
            </p>
            <div className="growth-photos growth-wide">
              {photos.map((id) => (
                <div key={id}>
                  <img src={"/api/media/" + id} alt="내가 공유할 사진" />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPhotos(photos.filter((p) => p !== id))}
                  >
                    제외
                  </button>
                </div>
              ))}
            </div>
            <div className="maturity-actions">
              <button className="participation-primary" disabled={busy}>
                경험·사진 저장
              </button>
              {version > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void work(async () => {
                      await appRequest(base, "DELETE");
                      setData(await appRequest(base));
                      setBody("");
                      setNextWish("");
                      setPhotos([]);
                      setVersion(0);
                      setPage(1);
                    })
                  }
                >
                  내 경험 삭제
                </button>
              )}
            </div>
          </form>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      <h2>함께 남긴 경험</h2>
      <p className="form-note">
        불편한 공유 내용은 <Link href="/support">운영자에게 문의</Link>해주세요. 모임 주소와 해당
        내용의 작성자를 함께 알려주세요.
      </p>
      {!data.canReadPrivate && (
        <p className="form-note">
          회원 공개로 설정한 경험만 표시합니다. 참가자 명단은 공개하지 않습니다.
        </p>
      )}
      <div className="growth-list">
        {data.notes.map((note) => (
          <article className="maturity-panel" key={note.id}>
            <p>
              {note.nickname} · {note.visibility === "members" ? "회원 공개" : "참가자·담당자 공개"}
            </p>
            <p className="growth-body">{note.body}</p>
            {note.nextWish && <p>다음에는: {note.nextWish}</p>}
            <div className="growth-photos">
              {note.photos.map((id) => (
                <img
                  key={id}
                  src={"/api/media/" + id}
                  alt="참가자가 공유한 행사 사진"
                  loading="lazy"
                />
              ))}
            </div>
          </article>
        ))}
      </div>
      {!data.notes.length && <p>아직 공유된 경험이 없어요.</p>}
      <nav className="maturity-actions" aria-label="경험 페이지">
        <button
          disabled={busy || page === 1}
          onClick={() =>
            void work(async () => {
              setData(await appRequest(base + "?page=" + (page - 1)));
              setPage(page - 1);
            })
          }
        >
          이전
        </button>
        <span>{page}페이지</span>
        <button
          disabled={busy || !data.hasMore}
          onClick={() =>
            void work(async () => {
              setData(await appRequest(base + "?page=" + (page + 1)));
              setPage(page + 1);
            })
          }
        >
          다음
        </button>
      </nav>
      <section className="maturity-panel">
        <h2>다음에 함께하고 싶은 활동</h2>
        {data.relatedIdeas.length ? (
          data.relatedIdeas.map((v) => (
            <p key={v.id}>
              <Link href={"/posts/" + v.id}>{v.title}</Link>
            </p>
          ))
        ) : (
          <p>아직 다음 활동 제안이 없어요.</p>
        )}
        <Link href="/ideas">모임 제안과 연결된 모집 보기</Link>
      </section>
      <VerifiedEventReviews postId={data.postId} />
    </>
  );
}
