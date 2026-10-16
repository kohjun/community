/** Only permitted event summary fields cross into the next event form. */
export interface TemplateHostOrigin {
  postId: string;
  title: string;
  location: string;
  completedAt: string;
  previousTemplateVersion: number | null;
}
export function templateRehostingUrl(entryId: string, postId: string) {
  return (
    "/archive/" + encodeURIComponent(entryId) + "/host?fromRecord=" + encodeURIComponent(postId)
  );
}
