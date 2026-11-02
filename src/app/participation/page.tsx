import { redirect } from "next/navigation";
import { MY_EVENTS_HREF } from "@/domain/workspace-navigation";
export default function Page() {
  redirect(MY_EVENTS_HREF);
}
