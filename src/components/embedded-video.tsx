"use client";

import { useState } from "react";
import { ArrowUpRight, Play, Video } from "lucide-react";
import { parseVideoUrl, safeExternalLink } from "../domain/post-document";

export function EmbeddedVideo({ url }: { url: string }) {
  const [activatedUrl, setActivatedUrl] = useState<string | null>(null);
  const video = parseVideoUrl(url);
  const originalUrl = video?.url ?? safeExternalLink(url);
  if (!originalUrl) return null;
  const provider =
    video?.provider === "youtube"
      ? "YouTube"
      : video?.provider === "vimeo"
        ? "Vimeo"
        : video?.provider === "file"
          ? "첨부 영상"
          : "영상 링크";
  const host = new URL(originalUrl).hostname;
  const activated = activatedUrl === originalUrl;
  return (
    <figure className="post-video">
      {video ? (
        <div className="post-video-player">
          {activated ? (
            video.provider === "file" ? (
              <video src={video.url} controls playsInline preload="none" aria-label={provider} />
            ) : video.embedUrl ? (
              <iframe
                src={video.embedUrl}
                title={provider + " 영상"}
                loading="lazy"
                allow="encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                sandbox="allow-scripts allow-same-origin allow-presentation"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : null
          ) : (
            <button
              type="button"
              className="post-video-activate"
              onClick={() => setActivatedUrl(originalUrl)}
              aria-label={provider + " 영상 불러오기"}
            >
              <span className="post-video-play">
                <Play size={22} fill="currentColor" aria-hidden="true" />
              </span>
              <strong>{provider} 영상</strong>
              <span>눌러서 영상을 불러오세요</span>
              <small>재생하면 영상 제공 사이트에 연결됩니다.</small>
            </button>
          )}
        </div>
      ) : (
        <div className="post-video-link-card">
          <span className="post-video-link-icon">
            <Video size={22} aria-hidden="true" />
          </span>
          <div>
            <strong>첨부한 영상 링크</strong>
            <span>{host}</span>
          </div>
        </div>
      )}
      <figcaption className="post-video-caption">
        <span>{provider}</span>
        <a href={originalUrl} target="_blank" rel="noopener noreferrer">
          원본 링크 열기 <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </figcaption>
    </figure>
  );
}
