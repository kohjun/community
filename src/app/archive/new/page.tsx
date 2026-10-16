import { redirect } from "next/navigation";
import { currentActor } from "@/server/identity";
import { LibraryEditor } from "@/components/library-editor";
import { LIBRARY_KINDS } from "@/domain/library";
import { topicForSlug } from "@/domain/topics";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string | string[]; topic?: string | string[] }>;
}) {
  const query = await searchParams,
    kind = LIBRARY_KINDS.find((value) => value === query.kind) ?? "rulebook",
    topic = typeof query.topic === "string" ? topicForSlug(query.topic) : null;
  if (!(await currentActor())) {
    const returnParams = new URLSearchParams({ kind });
    if (topic) returnParams.set("topic", topic.slug);
    redirect("/login?returnTo=" + encodeURIComponent("/archive/new?" + returnParams));
  }
  return (
    <LibraryEditor
      key={kind + ":" + (topic?.slug ?? "")}
      kind={kind}
      {...(topic ? { initialTopic: topic.slug } : {})}
    />
  );
}
