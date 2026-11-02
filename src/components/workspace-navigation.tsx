"use client";
import Link from "next/link";
import { BookOpen, BookOpenCheck, CalendarDays, Layers3, UserRound } from "lucide-react";
import type { LibraryKind } from "@/domain/library";
import {
  ARCHIVE_RECORDS_HREF,
  HOSTED_EVENTS_HREF,
  MY_EVENTS_HREF,
  type MyPageSection,
} from "@/domain/workspace-navigation";
import { libraryFilterParams, type LibraryFilterState } from "./library-discovery-query";
import styles from "./workspace-navigation.module.css";

const ARCHIVE_TABS = [
  { kind: "", label: "전체 자료", icon: BookOpen },
  { kind: "rulebook", label: "룰북", icon: BookOpen },
  { kind: "template", label: "이벤트 템플릿", icon: Layers3 },
  { kind: "records", label: "행사 기록", icon: BookOpenCheck },
] as const;
export function ArchiveNavigation({
  active,
  filters,
  busy = false,
  onKindChange,
}: {
  active: LibraryKind | "" | "records";
  filters?: LibraryFilterState;
  busy?: boolean;
  onKindChange?: (kind: LibraryKind | "") => void;
}) {
  return (
    <nav className={styles.tabs} aria-label="아카이브 구분">
      {ARCHIVE_TABS.map(({ kind, label, icon: Icon }) => {
        const params =
          filters && kind !== "records"
            ? libraryFilterParams({ ...filters, kind })
            : new URLSearchParams(kind && kind !== "records" ? { kind } : {});
        const href =
          kind === "records"
            ? ARCHIVE_RECORDS_HREF
            : "/archive" + (params.size ? "?" + params : "");
        return (
          <Link
            key={kind}
            href={href}
            aria-current={active === kind ? "page" : undefined}
            aria-disabled={busy && kind !== "records" ? true : undefined}
            onClick={(event) => {
              if (
                !onKindChange ||
                kind === "records" ||
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              if (!busy) onKindChange(kind);
            }}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
export function MyPageNavigation({ section }: { section: MyPageSection }) {
  return (
    <div className={styles.accountNavigation}>
      <nav className={styles.tabs} aria-label="마이페이지 구분">
        <Link href="/mypage" aria-current={section === "profile" ? "page" : undefined}>
          <UserRound size={17} aria-hidden="true" />
          프로필·활동
        </Link>
        <Link href={MY_EVENTS_HREF} aria-current={section !== "profile" ? "page" : undefined}>
          <CalendarDays size={17} aria-hidden="true" />내 행사
        </Link>
      </nav>
      {section !== "profile" && (
        <nav className={styles.subTabs} aria-label="내 행사 구분">
          <Link
            href={MY_EVENTS_HREF}
            aria-current={section === "participating" ? "page" : undefined}
          >
            신청·참가한 행사
          </Link>
          <Link href={HOSTED_EVENTS_HREF} aria-current={section === "hosting" ? "page" : undefined}>
            운영·관리하는 행사
          </Link>
        </nav>
      )}
    </div>
  );
}
