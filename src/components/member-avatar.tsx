"use client";
import { useState } from "react";
import { AVATAR_SYMBOLS } from "@/domain/boards";
import { cn } from "@/lib/utils";

export function MemberAvatar({
  nickname,
  avatar,
  photoSrc,
  className,
}: {
  nickname: string;
  avatar: string;
  photoSrc: string | null;
  className?: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const showPhoto = !!photoSrc && photoSrc !== failedSource;
  return (
    <span
      className={cn("member-avatar", className)}
      role="img"
      aria-label={nickname + (showPhoto ? "의 프로필 사진" : "의 프로필 아이콘")}
    >
      {showPhoto ? (
        <img
          src={photoSrc}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedSource(photoSrc)}
        />
      ) : (
        (AVATAR_SYMBOLS[avatar as keyof typeof AVATAR_SYMBOLS] ?? "✦")
      )}
    </span>
  );
}
