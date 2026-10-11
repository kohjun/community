import { permanentRedirect } from "next/navigation";
export default async function Page({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  permanentRedirect(`/archive/events/${encodeURIComponent(postId)}`);
}
