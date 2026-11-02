import { redirect } from "next/navigation";
import { HOSTED_EVENTS_HREF } from "@/domain/workspace-navigation";
export default function Page() {
  redirect(HOSTED_EVENTS_HREF);
}
