export const MY_EVENTS_HREF = "/mypage?tab=events";
export const HOSTED_EVENTS_HREF = "/mypage?tab=events&view=hosting";
export const ARCHIVE_RECORDS_HREF = "/archive?tab=records";
export const TOPIC_DISCOVERY_HREF = "/search#topics";
export type MyPageSection = "profile" | "participating" | "hosting";
export function myPageSection(
  params: Record<string, string | string[] | undefined>,
): MyPageSection {
  if (params.tab !== "events") return "profile";
  return params.view === "hosting" ? "hosting" : "participating";
}
export function archiveRecordsHref(libraryId?: string) {
  const params = new URLSearchParams({ tab: "records" });
  if (libraryId) params.set("libraryId", libraryId);
  return "/archive?" + params;
}
export const WORKSPACE_REDIRECTS = [
  { source: "/topics", destination: TOPIC_DISCOVERY_HREF, permanent: true },
  { source: "/records", destination: ARCHIVE_RECORDS_HREF, permanent: true },
  { source: "/management", destination: HOSTED_EVENTS_HREF, permanent: true },
  { source: "/participation", destination: MY_EVENTS_HREF, permanent: true },
] as const;
