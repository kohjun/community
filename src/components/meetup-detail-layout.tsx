import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./example-gallery.module.css";

export function MeetupDetailLayout({
  label,
  title,
  back,
  summary,
  meta,
  cover,
  facts,
  children,
  className,
}: {
  label: string;
  title: ReactNode;
  back?: ReactNode;
  summary?: string | undefined;
  meta?: ReactNode;
  cover?: { src: string; avatar?: boolean; alt?: string } | undefined;
  facts: readonly (readonly [string, ReactNode])[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={cn(styles.detail, className)} data-meetup-detail>
      <header className="participation-heading">
        {back}
        <span className={styles.tag}>{label}</span>
        {title}
        {summary && <p>{summary}</p>}
        {meta}
      </header>
      {cover && (
        <img
          className={cover.avatar ? styles.avatar : styles.cover}
          src={cover.src}
          width={cover.avatar ? 320 : 768}
          height={cover.avatar ? 320 : 432}
          alt={cover.alt ?? ""}
          decoding="async"
        />
      )}
      {facts.length > 0 && (
        <dl className={styles.facts} aria-label="모임 기본 정보">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </article>
  );
}
