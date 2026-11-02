"use client";
import Link from "next/link";
import { useState } from "react";
import type { LibraryPayload } from "@/domain/library";
import { CUE_PHASES } from "@/domain/event-plan";
export function LibraryPreparation({
  payload,
  title,
  version,
}: {
  payload: LibraryPayload;
  title: string;
  version: number;
}) {
  const [checked, setChecked] = useState<string[]>([]);
  const tasks = [
    { id: "rules", label: "규칙과 성공 조건을 읽고 짧게 설명해봤어요" },
    { id: "people", label: "참가 인원·진행자·보조 역할을 확인했어요" },
    { id: "venue", label: "장소 사용 가능 여부와 이동·휴식 동선을 확인했어요" },
    { id: "cost", label: "준비물과 예상 현장 비용을 확인했어요" },
    { id: "rehearsal", label: "타이머와 첫 미션을 시험해봤어요" },
    { id: "arrival", label: "첫 만남 안내와 문의 방법을 참가자에게 알릴 준비가 되었어요" },
  ];
  const timeline = payload.eventPlan?.timeline ?? [];
  return (
    <section className="maturity-panel">
      <h2>이 자료로 진행하기 전, 여섯 가지</h2>
      <p>
        현재 열람 중인 {version > 0 ? `발행 v${version}` : "초안"}을 기준으로 준비해요. 점검은 이
        화면에서만 유지되며 참가 준비 완료 인증은 아니에요.
      </p>
      <div className="marketplace-checklist">
        {tasks.map((task) => (
          <label key={task.id}>
            <input
              type="checkbox"
              checked={checked.includes(task.id)}
              onChange={(e) =>
                setChecked(
                  e.target.checked ? [...checked, task.id] : checked.filter((id) => id !== task.id),
                )
              }
            />
            <span>{task.label}</span>
          </label>
        ))}
      </div>
      <p aria-live="polite">
        {checked.length} / {tasks.length}개 확인
      </p>
      {(!payload.materials.length || !timeline.length) && (
        <p className="form-note">
          {!payload.materials.length
            ? "준비물 목록이 비어 있어요. 준비물이 필요 없는지 작성자에게 확인해주세요. "
            : ""}
          {!timeline.length
            ? "구조화된 큐시트가 아직 없어요. 진행자 가이드에서 순서를 확인해주세요."
            : ""}
        </p>
      )}
      <div className="maturity-actions">
        <button type="button" onClick={() => window.print()}>
          준비물·큐시트 인쇄
        </button>
        <Link href="/hosting-guide">첫 호스트·4주 운영 가이드</Link>
      </div>
      <p className="form-note">
        인쇄본은 열람 중인 자료의 사본이에요. 작성자의 이용 조건을 지켜 사용하고, 이후 변경 사항은
        자료 페이지에서 확인해주세요.
      </p>
      <div className="maturity-print">
        <h1>{title}</h1>
        <p>{version > 0 ? `발행 v${version}` : "작성 중 초안"} · Sliper 진행 준비 사본</p>
        <h2>준비 확인</h2>
        <ul>
          {tasks.map((t) => (
            <li key={t.id}>
              {checked.includes(t.id) ? "☑" : "□"} {t.label}
            </li>
          ))}
        </ul>
        <h2>준비물</h2>
        {payload.materials.length ? (
          <ul>
            {payload.materials.map((v, i) => (
              <li key={i}>□ {v}</li>
            ))}
          </ul>
        ) : (
          <p>준비물 미입력 · 작성자에게 확인</p>
        )}
        <h2>큐시트</h2>
        {timeline.length ? (
          <table>
            <thead>
              <tr>
                <th>시점</th>
                <th>구분·프로그램</th>
                <th>진행 내용</th>
                <th>확인할 점</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((v, i) => (
                <tr key={i}>
                  <td>{v.time}</td>
                  <td>
                    {CUE_PHASES[v.phase]} · {v.program}
                  </td>
                  <td>{v.details}</td>
                  <td>{v.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>구조화된 큐시트가 없어요. 진행자 가이드를 확인해주세요.</p>
        )}
        <p>원저작자의 이용 조건에 따라 사용해주세요. 인쇄 이후 바뀐 내용은 반영되지 않아요.</p>
      </div>
    </section>
  );
}
