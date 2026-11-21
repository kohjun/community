import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ParticipationShell } from "@/components/participation-shell";
import { ExampleGallery } from "@/components/example-gallery";
import { MeetupDetailLayout } from "@/components/meetup-detail-layout";
import styles from "@/components/example-gallery.module.css";
import { EXAMPLES, EXAMPLE_LABELS, exampleImage, type ExampleKind } from "@/demo/showcase";
import { EVENT_RECRUITMENTS_HREF } from "@/domain/meetup-types";

type Props = { params: Promise<{ kind: string; exampleId: string }> };
export const metadata: Metadata = {
  title: "슬리퍼 예시 살펴보기",
  robots: { index: false, follow: true },
};
const browseLinks: Record<ExampleKind, string> = {
  event: EVENT_RECRUITMENTS_HREF,
  lightning: "/lightning",
  player: "/players",
};

export function generateStaticParams() {
  return (Object.keys(EXAMPLES) as ExampleKind[]).flatMap((kind) =>
    EXAMPLES[kind].map(({ id: exampleId }) => ({ kind, exampleId })),
  );
}

export default async function Page({ params }: Props) {
  const request = await params;
  if (!Object.hasOwn(EXAMPLES, request.kind)) notFound();
  const kind = request.kind as ExampleKind;
  const example = EXAMPLES[kind].find(({ id }) => id === request.exampleId);
  if (!example) notFound();
  const avatar = kind === "player";
  return (
    <ParticipationShell advertising={false}>
      <MeetupDetailLayout
        label={`예시 · ${example.category}`}
        title={<h1>{example.title}</h1>}
        summary={example.summary}
        cover={{ src: exampleImage(example.id), avatar }}
        facts={example.facts}
        back={
          <Link className="participation-flow-back" href={browseLinks[kind]}>
            ← {EXAMPLE_LABELS[kind]} 둘러보기
          </Link>
        }
      >
        <p>{example.detail}</p>
        <p className={styles.tag}>
          슬리퍼를 둘러보기 위한 가상의 {EXAMPLE_LABELS[kind]} 예시입니다.
        </p>
      </MeetupDetailLayout>
      <ExampleGallery kind={kind} />
    </ParticipationShell>
  );
}
