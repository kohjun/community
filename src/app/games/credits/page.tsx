import Link from "next/link";
import credits from "../../../../public/games/clue/ATTRIBUTIONS.json";
import styles from "@/components/creative-games.module.css";
export const metadata = { title: "단서각 자료 출처 | Sliper" };
export default function Page() {
  return (
    <section className={styles.stage}>
      <div className={styles.heading}>
        <h2>단서각 자료 출처</h2>
        <Link href="/games" className={styles.secondary}>
          게임으로 돌아가기
        </Link>
      </div>
      <p className={styles.muted}>
        사진은 원본 이용 조건에 따라 리사이즈·메타데이터 제거·WebP 변환했어요. 줌 아웃 모드에서는
        일부 영역을 확대해 보여줘요. 각 사진과 변환본에는 아래의 원본 라이선스가 적용돼요.
      </p>
      <div className={styles.gallery}>
        {credits.photos.map((p) => (
          <article key={p.asset} className={styles.frame}>
            <strong>{p.author}</strong>
            <p>{p.title.replaceAll("_", " ")}</p>
            <a href={p.source} target="_blank" rel="noreferrer">
              원본·저작자 확인
            </a>
            <a href={p.licenseUrl} target="_blank" rel="noreferrer">
              {p.license} 이용 조건
            </a>
          </article>
        ))}
      </div>
      <h3>소리 자료</h3>
      <p className={styles.muted}>
        Team Sliper가 직접 합성한 신호·효과음 10개예요. 실제 현장 녹음이 아닌 재현 소리이며, 제3자의
        음원이나 녹음물을 샘플링하지 않았어요.
      </p>
    </section>
  );
}
