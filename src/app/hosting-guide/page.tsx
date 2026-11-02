import { publicPageMetadata } from "@/domain/search-visibility";
import { HostingGuide } from "@/components/hosting-guide";
export default function Page() {
  return <HostingGuide />;
}

export function generateMetadata() {
  return publicPageMetadata("/hosting-guide");
}
