"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Flag, UserRoundX } from "lucide-react";
import { appRequest } from "@/lib/api-client";
import { REPORT_REASONS } from "@/domain/safety";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
export function SafetyActions({
  targetType,
  targetId,
  canAct,
  isMine = false,
  onBlocked,
}: {
  targetType: "post" | "comment" | "venue" | "player" | "crew" | "record" | "library";
  targetId: string;
  canAct: boolean;
  isMine?: boolean;
  onBlocked?: () => void;
}) {
  const [mode, setMode] = useState<"report" | "block" | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    gate = useRef(false);
  if (isMine) return null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (gate.current) return;
    const fields = new FormData(event.currentTarget);
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      await appRequest("/api/safety/" + (mode === "report" ? "reports" : "blocks"), "POST", {
        targetType,
        targetId,
        ...(mode === "report"
          ? { reason: fields.get("reason"), detail: fields.get("detail") }
          : {}),
      });
      setSuccess(
        mode === "report"
          ? "신고를 접수했어요. 내 신고 내역에서 처리 상태를 확인할 수 있어요."
          : "차단했어요. 이 사용자의 글과 댓글을 숨깁니다.",
      );
      if (mode === "block") onBlocked?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "요청을 처리하지 못했어요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="safety-actions">
      <button
        type="button"
        onClick={() => {
          setMode("report");
          setError("");
          setSuccess("");
        }}
      >
        <Flag size={13} />
        신고
      </button>
      <button
        type="button"
        onClick={() => {
          setMode("block");
          setError("");
          setSuccess("");
        }}
      >
        <UserRoundX size={13} />
        사용자 차단
      </button>
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setMode(null);
        }}
      >
        <DialogContent
          className="safety-dialog"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <DialogTitle>{mode === "report" ? "함께 지키는 슬리퍼" : "사용자 차단"}</DialogTitle>
          <DialogDescription>
            {mode === "report"
              ? "신고 내용은 운영자에게만 전달돼요. 개인정보는 적지 말아주세요."
              : "차단한 사용자의 글과 댓글은 내 화면에서 숨겨져요. 참가한 행사의 필수 공지는 계속 받을 수 있어요."}
          </DialogDescription>
          {!canAct ? (
            <p>
              <Link href="/login">로그인</Link> 후 이용해주세요.
            </p>
          ) : success ? (
            <div>
              <p role="status">{success}</p>
              <Link href="/settings/account">내 신고·차단 관리</Link>
              <button type="button" className="safety-primary" onClick={() => setMode(null)}>
                확인
              </button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <fieldset disabled={busy}>
                {mode === "report" ? (
                  <>
                    <label>
                      신고 사유
                      <select name="reason" required>
                        {Object.entries(REPORT_REASONS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      추가 설명 <span>(선택)</span>
                      <textarea
                        name="detail"
                        maxLength={2000}
                        rows={4}
                        placeholder="어떤 문제가 있었는지 알려주세요."
                      />
                    </label>
                  </>
                ) : (
                  <p>익명 글의 작성자 정보는 공개되지 않아요. 차단은 해당 계정에 적용됩니다.</p>
                )}
                {error && (
                  <p className="safety-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="safety-form-actions">
                  <button type="button" onClick={() => setMode(null)}>
                    취소
                  </button>
                  <button className="safety-primary" type="submit">
                    {busy ? "처리 중…" : mode === "report" ? "신고 접수" : "차단하기"}
                  </button>
                </div>
              </fieldset>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
