import { currentActor } from "@/server/identity";
import { LibraryEditor } from "@/components/library-editor";
import { ParticipationLogin } from "@/components/participation-shell";
import { LIBRARY_KINDS } from "@/domain/library";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string | string[] }>;
}) {
  if (!(await currentActor())) return <ParticipationLogin />;
  const query = await searchParams,
    kind = LIBRARY_KINDS.find((value) => value === query.kind) ?? "rulebook";
  return <LibraryEditor key={kind} kind={kind} />;
}
