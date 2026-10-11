import Link from "next/link";
export function PolicyLinks() {
  return (
    <nav className="policy-links" aria-label="이용·운영 안내">
      <Link href="/help">이용 안내</Link>
      <Link href="/policies/community">이용규칙</Link>
      <Link href="/policies/privacy">개인정보 안내</Link>
      <Link href="/support">문의하기</Link>
      <Link href="/settings/account">계정·안전 설정</Link>
    </nav>
  );
}
