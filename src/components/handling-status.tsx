import Link from "next/link";
import { handlingExplanation } from "@/domain/community-maturity";
export function HandlingStatus({
  status,
  kind,
  id,
  createdAt,
  resolvedAt,
}: {
  status: string;
  kind: "report" | "support";
  id: string;
  createdAt: string;
  resolvedAt?: string | null;
}) {
  const state = handlingExplanation(status, kind);
  return (
    <div className="maturity-handling">
      <strong>{state.title}</strong>
      <p>{state.text}</p>
      <p className="form-note">
        접수 {new Date(createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
        {resolvedAt &&
          " · 결과 등록 " +
            new Date(resolvedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
      </p>
      <details>
        <summary>추가 문의에 필요한 정보</summary>
        <p>문의할 때 아래 번호를 함께 알려주세요.</p>
        <code className="maturity-reference">{id}</code>
        <div className="maturity-actions">
          <Link href="/support">추가 도움 요청</Link>
          <Link href="/settings/appeals">내 이용 제한·이의신청</Link>
          <Link href="/help#handling">처리 절차 보기</Link>
        </div>
      </details>
    </div>
  );
}
