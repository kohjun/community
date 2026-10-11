import { ParticipationShell } from "@/components/participation-shell";
export default function Loading() {
  return (
    <ParticipationShell advertising={false}>
      <section className="crew-panel crew-empty" aria-busy="true">
        <h1>크루를 불러오고 있어요.</h1>
        <p role="status">잠시만 기다려주세요.</p>
      </section>
    </ParticipationShell>
  );
}
