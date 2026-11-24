import Link from "next/link";
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
        단서각 기본 문제는 실제 거리를 촬영한 네이버 거리뷰예요. 네이버 지도 API의 거리뷰 화면으로
        보여주며, 사진을 따로 내려받거나 저장하지 않아요. 거리뷰 이미지의 권리는 NAVER Corp.에
        있어요.
      </p>
      <p className={styles.muted}>
        호스트가 직접 출제한 문제와 ‘우리 사진’ 모드의 사진은 참가자가 올린 자료이며, 게임 종료 후
        24시간이 지나면 삭제돼요.
      </p>
      <a
        className={styles.secondary}
        href="https://www.ncloud.com/product/applicationService/maps"
        target="_blank"
        rel="noreferrer"
      >
        네이버 지도 API 안내
      </a>
    </section>
  );
}
