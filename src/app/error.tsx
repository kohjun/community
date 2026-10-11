"use client";
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <main className="error-page">
      <h1>이야기를 불러오지 못했어요.</h1>
      <p>잠시 후 다시 시도해주세요.</p>
      <button onClick={retry}>다시 불러오기</button>
    </main>
  );
}
