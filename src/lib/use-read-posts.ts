"use client";
import { useSyncExternalStore } from "react";
import { readPostsStore } from "./read-posts";
export function useReadPosts() {
  return useSyncExternalStore(
    readPostsStore.subscribe,
    readPostsStore.getSnapshot,
    readPostsStore.getServerSnapshot,
  );
}
export function usePostRead(id: string) {
  return useReadPosts().includes(id.toLowerCase());
}
