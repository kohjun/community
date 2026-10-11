"use client";
import { useRef, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { sharePost } from "@/lib/post-sharing";

export function PostShareButton({ postId, title }: { postId: string; title: string }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function share() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setCopied(false);
    setError("");
    try {
      const result = await sharePost(
        { postId, title, origin: window.location.origin },
        {
          ...(typeof navigator.share === "function"
            ? { share: (data: { title: string; url: string }) => navigator.share(data) }
            : {}),
          ...(navigator.clipboard && typeof navigator.clipboard.writeText === "function"
            ? { copy: (url: string) => navigator.clipboard.writeText(url) }
            : {}),
        },
      );
      if (result.status === "copied") setCopied(true);
      if (result.status === "manual") setManualUrl(result.url);
    } catch {
      setError("공유 링크를 만들지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={share}
        aria-label={copied ? "글 링크 복사 완료" : "글 공유하기"}
      >
        {copied ? <Check size={17} /> : <Share2 size={17} />}
        {copied ? "링크 복사됨" : "공유"}
      </Button>
      {copied && (
        <span className="sr-only" role="status">
          글 링크를 복사했어요.
        </span>
      )}
      {error && (
        <span className="post-share-error" role="alert">
          {error}
        </span>
      )}
      <Dialog
        open={!!manualUrl}
        onOpenChange={(open) => {
          if (!open) setManualUrl("");
        }}
      >
        <DialogContent className="utility-dialog post-share-dialog">
          <DialogTitle className="utility-title">글 링크 공유</DialogTitle>
          <DialogDescription className="utility-description">
            아래 링크를 길게 누르거나 전체 선택한 뒤 복사해주세요.
          </DialogDescription>
          <label className="post-share-copy-label">
            <Copy size={16} /> 공유 주소
            <input
              type="text"
              readOnly
              value={manualUrl}
              aria-label="공유할 글 주소"
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
            />
          </label>
        </DialogContent>
      </Dialog>
    </>
  );
}
