import { ParticipationShell } from "@/components/participation-shell";
import { MapPin } from "lucide-react";
export default function Loading() {
  return (
    <ParticipationShell>
      <section className="record-page record-empty" role="status" aria-live="polite">
        <MapPin size={30} />
        <h1>장소의 행사 기록을 불러오고 있어요</h1>
        <p>완료 행사와 장소 운영 경험을 확인하고 있어요.</p>
      </section>
    </ParticipationShell>
  );
}
