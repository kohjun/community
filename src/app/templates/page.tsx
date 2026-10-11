import { permanentRedirect } from "next/navigation";
export default function Page() {
  permanentRedirect("/archive?kind=template");
}
