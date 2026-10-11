import { postPath } from "../domain/post-sharing";

export interface PostShareInput {
  postId: string;
  title: string;
  origin: string;
}
export interface PostSharePlatform {
  share?: (data: { title: string; url: string }) => Promise<void>;
  copy?: (url: string) => Promise<void>;
}
export interface PostShareResult {
  status: "shared" | "copied" | "cancelled" | "manual";
  url: string;
}

export function postShareUrl(postId: string, origin: string): string {
  const base = new URL(origin);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password)
    throw new Error("Invalid share origin");
  return new URL(postPath(postId), base.origin).href;
}

// Run the native share API directly within the click handler, before any awaited work.
export async function sharePost(
  input: PostShareInput,
  platform: PostSharePlatform,
): Promise<PostShareResult> {
  const url = postShareUrl(input.postId, input.origin);
  const title = input.title.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) || "Sliper 이야기";
  if (platform.share) {
    try {
      await platform.share({ title, url });
      return { status: "shared", url };
    } catch (error) {
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError")
        return { status: "cancelled", url };
    }
  }
  if (platform.copy) {
    try {
      await platform.copy(url);
      return { status: "copied", url };
    } catch {
      // HTTP on a local Wi-Fi address may not expose the Clipboard API.
    }
  }
  return { status: "manual", url };
}

export function shouldOpenPostModal(event: {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
