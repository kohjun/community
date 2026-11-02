"use client";
import Link from "next/link";
import { useState, useRef } from "react";
import { appRequest } from "@/lib/api-client";
import { CATEGORIES } from "@/domain/categories";
import { savedSearchSchema, type SavedSearchView } from "@/domain/community-growth";
export function SavedSearches({ initial }: { initial: SavedSearchView[] }) {
  const [items, setItems] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const gate = useRef(false);
  async function work(fn: () => Promise<SavedSearchView[]>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      setItems(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "다시 시도해주세요.");
    } finally {
      setBusy(false);
      gate.current = false;
    }
  }
  return (
    <>
      <header className="participation-heading">
        <h1>내 조건으로 모임 찾기</h1>
        <p>새로 올라오는 모집을 알림함으로 알려드려요. 푸시는 내 알림 설정을 따릅니다.</p>
      </header>
      <section className="maturity-panel">
        <h2>검색 조건 저장</h2>
        <form
          className="growth-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const v = savedSearchSchema.safeParse({
              name: f.get("name"),
              category: f.get("category") || null,
              region: f.get("region"),
              keyword: f.get("keyword"),
              meetupType: f.get("meetupType"),
              maxPrice: f.get("price") === "" ? null : Number(f.get("price")),
              beginnerOnly: f.has("beginner"),
              soloOnly: f.has("solo"),
              frequency: f.get("frequency"),
            });
            if (!v.success) {
              setError("입력 조건을 확인해주세요.");
              return;
            }
            void work(() => appRequest("/api/growth/saved", "POST", v.data));
          }}
        >
          <label>
            조건 이름
            <input name="name" required maxLength={50} placeholder="서울에서 혼자 가는 추리 모임" />
          </label>
          <label>
            지역
            <input name="region" maxLength={60} placeholder="예: 서울, 수원" />
          </label>
          <label>
            카테고리
            <select name="category">
              <option value="">전체</option>
              {CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            검색어
            <input name="keyword" maxLength={60} placeholder="모집 제목·태그" />
          </label>
          <label>
            모임 종류
            <select name="meetupType">
              <option value="all">전체</option>
              <option value="lightning">번개</option>
              <option value="event">행사</option>
            </select>
          </label>
          <label>
            최대 사전 참가비
            <input name="price" type="number" min={0} max={10000000} placeholder="제한 없음" />
          </label>
          <label>
            <input name="beginner" type="checkbox" />
            초보 환영 안내가 있는 모임
          </label>
          <label>
            <input name="solo" type="checkbox" />
            혼자 참가 가능 안내가 있는 모임
          </label>
          <label>
            알림 빈도
            <select name="frequency" defaultValue="daily">
              <option value="daily">하루 한 번</option>
              <option value="instant">새 모집을 찾으면</option>
              <option value="off">알림 끄기</option>
            </select>
          </label>
          <p className="form-note">
            저장 후 새로 등록된 모집부터 알려드려요. 하루 한 번은 조건별 최대 1회이며, 같은 모집은
            중복 안내하지 않아요. 현장 정산 비용은 참가비 상한에 포함되지 않아요.
          </p>
          <button disabled={busy} className="participation-primary">
            조건 저장
          </button>
        </form>
      </section>
      {error && <p role="alert">{error}</p>}
      <div className="growth-list">
        {items.map((item) => {
          const { id, createdAt, ...settings } = item;
          return (
            <article className="maturity-panel" key={id}>
              <h2>{item.name}</h2>
              <p>
                {item.region || "모든 지역"} · {item.keyword || "검색어 제한 없음"} ·{" "}
                {item.maxPrice === null
                  ? "참가비 제한 없음"
                  : item.maxPrice.toLocaleString() + "원 이하"}
              </p>
              <label>
                알림 빈도
                <select
                  disabled={busy}
                  value={item.frequency}
                  onChange={(e) =>
                    void work(() =>
                      appRequest("/api/growth/saved/" + id, "PUT", {
                        ...settings,
                        frequency: e.target.value,
                      }),
                    )
                  }
                >
                  <option value="daily">하루 한 번</option>
                  <option value="instant">새 모집을 찾으면</option>
                  <option value="off">알림 끄기</option>
                </select>
              </label>
              <div className="maturity-actions">
                <Link href={"/discover/saved/" + id}>이 조건의 모임 보기</Link>
                <button
                  disabled={busy}
                  onClick={() => void work(() => appRequest("/api/growth/saved/" + id, "DELETE"))}
                >
                  삭제
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!items.length && <p>저장한 조건이 없어요. 자주 찾는 지역과 취향부터 추가해보세요.</p>}
    </>
  );
}
