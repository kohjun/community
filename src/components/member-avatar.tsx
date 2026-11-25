"use client";
import { useState, type ReactNode } from "react";
import { getProfileAvatar } from "@/domain/profile-avatars";
import { cn } from "@/lib/utils";

export function MemberAvatar({
  nickname,
  avatar,
  photoSrc = null,
  className,
  fallback,
}: {
  nickname: string;
  avatar: string;
  photoSrc?: string | null;
  className?: string;
  fallback?: ReactNode;
}) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const [failedArt, setFailedArt] = useState<string | null>(null);
  const option = getProfileAvatar(avatar);
  const art = "src" in option ? option.src : null;
  const upload = photoSrc && photoSrc !== failedPhoto ? photoSrc : null;
  const source = upload ?? (art !== failedArt ? art : null);
  return (
    <span
      className={cn("member-avatar", className)}
      role="img"
      aria-label={nickname + (upload ? "의 프로필 사진" : "의 프로필 아이콘")}
    >
      {source ? (
        <img
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => (upload ? setFailedPhoto(upload) : setFailedArt(source))}
        />
      ) : (
        (fallback ?? ("symbol" in option ? option.symbol : "✦"))
      )}
    </span>
  );
}
