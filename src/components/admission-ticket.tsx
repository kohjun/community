"use client";
import { useRef, useState } from "react";
import { QrCode, RefreshCw, Download } from "lucide-react";
import type { TicketView } from "@/domain/event-operations";
import { appRequest } from "@/lib/api-client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
export function AdmissionTicket({
  postId,
  applicationId,
}: {
  postId: string;
  applicationId: string;
}) {
  const [open, setOpen] = useState(false),
    [ticket, setTicket] = useState<TicketView | null>(null),
    [image, setImage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const gate = useRef(false);
  async function issue() {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    setImage("");
    setTicket(null);
    setOpen(true);
    try {
      const next = await appRequest<TicketView>(
        `/api/participation/events/${postId}/ticket`,
        "POST",
        { applicationId },
      );
      const QRCode = (await import("qrcode")).default;
      const qr = await QRCode.toDataURL(
        `${window.location.origin}/management/events/${postId}/check-in#ticket=${next.code}`,
        {
          width: 360,
          margin: 4,
          errorCorrectionLevel: "M",
          color: { dark: "#10243c", light: "#ffffff" },
        },
      );
      setTicket(next);
      setImage(qr);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "입장권을 발급하지 못했어요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="participation-secondary"
        onClick={() => void issue()}
        disabled={busy}
      >
        <QrCode size={18} />
        QR 입장권 보기
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="admission-ticket-dialog">
          <DialogTitle>나의 QR 입장권</DialogTitle>
          <DialogDescription>
            현장에서 담당자에게 보여주세요. 담당자가 참가자 정보를 확인하면 입장이 완료돼요.
          </DialogDescription>
          {busy && <p role="status">입장권을 준비하고 있어요…</p>}
          {error && (
            <p className="participation-error" role="alert">
              {error}
            </p>
          )}
          {ticket && image && (
            <>
              <div className="admission-ticket">
                <span className="ops-eyebrow">SLIPER · EVENT PASS</span>
                <h3>{ticket.title}</h3>
                <img src={image} width={280} height={280} alt="행사 담당자에게 보여줄 QR 입장권" />
                <strong>{ticket.attendeeName}</strong>
                <small>{new Date(ticket.expiresAt).toLocaleString("ko-KR")}까지</small>
              </div>
              <div className="ops-actions">
                <a
                  className="participation-secondary"
                  href={image}
                  download="sliper-event-pass.png"
                >
                  <Download size={15} />
                  입장권 저장
                </a>
                <button
                  className="participation-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => void issue()}
                >
                  <RefreshCw size={15} />
                  다시 발급
                </button>
              </div>
              <details className="ops-code">
                <summary>QR을 읽지 못하면 입장 코드 전달</summary>
                <input
                  aria-label="입장 코드"
                  value={ticket.code}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
              </details>
              <p className="ops-note">
                다시 발급하면 이전 QR은 사용할 수 없어요. 입장권은 다른 사람에게 공유하지 마세요.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
