import { ParticipationShell } from "@/components/participation-shell";

/** Stream the shell immediately while the destination performs fresh authorized reads. */
export default function Loading() {
  return (
    <ParticipationShell advertising={false}>
      <section className="safety-card" aria-busy="true" aria-label="페이지 불러오기">
        <p role="status" className="mb-6 text-sm text-slate-500">
          페이지를 불러오고 있어요.
        </p>
        <div className="space-y-6 motion-safe:animate-pulse" aria-hidden="true">
          <div className="h-7 w-48 rounded-lg bg-surface-tint-strong" />
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="space-y-3 border-b border-surface-tint-strong pb-5">
              <div className="h-4 w-3/4 rounded bg-surface-tint-strong" />
              <div className="h-3 w-1/2 rounded bg-surface-tint-strong" />
            </div>
          ))}
        </div>
      </section>
    </ParticipationShell>
  );
}
