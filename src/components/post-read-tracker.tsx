"use client";
import { useEffect } from "react";
import { markPostRead } from "@/lib/read-posts";
// Mount only after a detail page has successfully loaded its public content.
export function PostReadTracker({ postId }: { postId: string }) {
  useEffect(() => {
    markPostRead(postId);
  }, [postId]);
  return null;
}
