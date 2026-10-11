import { permanentRedirect } from "next/navigation";
export default function Page() {
  permanentRedirect("/archive/new?kind=template");
}
