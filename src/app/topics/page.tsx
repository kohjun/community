import { redirect } from "next/navigation";
import { TOPIC_DISCOVERY_HREF } from "@/domain/workspace-navigation";
export default function Page() {
  redirect(TOPIC_DISCOVERY_HREF);
}
