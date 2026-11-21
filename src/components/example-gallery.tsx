import Link from "next/link";
import { EXAMPLES, EXAMPLE_LABELS, exampleImage, type ExampleKind } from "@/demo/showcase";
import styles from "./example-gallery.module.css";

export function ExampleGallery({
  kind,
  mobileSwipe = false,
}: {
  kind: ExampleKind;
  mobileSwipe?: boolean;
}) {
  const title = `${EXAMPLE_LABELS[kind]} 예시`;
  const avatar = kind === "player";
  return (
    <section className={styles.examples} aria-label={title}>
      <h3>{title}</h3>
      <div className={styles.grid} data-meetup-swipe={mobileSwipe ? "examples" : undefined}>
        {EXAMPLES[kind].map((example) => (
          <Link
            className={styles.card}
            key={example.id}
            href={`/examples/${kind}/${example.id}`}
            prefetch={false}
          >
            <img
              className={avatar ? styles.avatar : styles.cover}
              src={exampleImage(example.id)}
              width={avatar ? 320 : 768}
              height={avatar ? 320 : 432}
              loading="lazy"
              decoding="async"
              alt=""
            />
            <div className={styles.copy}>
              <span className={styles.tag}>예시 · {example.category}</span>
              <strong>{example.title}</strong>
              <p>{example.summary}</p>
              <small>{example.facts[0]?.[1]}</small>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
