import { prepareImageForUpload } from "./image-precompression";
export async function uploadGameMedia(
  roomId: string,
  host: boolean,
  file: Blob,
  kind: "drawing" | "photo" | "audio" | "video",
  phaseId?: string,
) {
  const prepared =
    kind === "photo" && file instanceof File ? await prepareImageForUpload(file, "post") : file;
  const form = new FormData();
  form.set("file", prepared, "game-media");
  form.set("kind", kind);
  if (phaseId) form.set("phaseId", phaseId);
  const response = await fetch(`/api/games/${roomId}/media${host ? "?host=1" : ""}`, {
    method: "POST",
    credentials: "same-origin",
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error?.message ?? "자료를 올리지 못했어요.");
  return body.data as { id: string; status: string; src: string };
}
