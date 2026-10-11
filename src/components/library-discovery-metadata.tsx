import type { LibraryDiscoveryMetadata } from "@/domain/library";
import styles from "./library-discovery.module.css";

export const LIBRARY_DIFFICULTY_LABELS = { easy: "쉬움", standard: "보통", advanced: "높음" };
export const LIBRARY_ENVIRONMENT_LABELS = { indoor: "실내", outdoor: "실외", mixed: "실내·외" };

export function LibraryDiscoveryConditions({
  metadata,
}: {
  metadata?: LibraryDiscoveryMetadata | null;
}) {
  return (
    <dl className={styles.metadata} aria-label="공개 운영 조건">
      <div>
        <dt>준비 난이도</dt>
        <dd>
          {metadata?.preparationDifficulty
            ? LIBRARY_DIFFICULTY_LABELS[metadata.preparationDifficulty]
            : "미입력"}
        </dd>
      </div>
      <div>
        <dt>환경</dt>
        <dd>
          {metadata?.environment ? LIBRARY_ENVIRONMENT_LABELS[metadata.environment] : "미입력"}
        </dd>
      </div>
      <div>
        <dt>추가 스태프</dt>
        <dd>{metadata?.requiredStaff != null ? `${metadata.requiredStaff}명` : "미입력"}</dd>
      </div>
    </dl>
  );
}
