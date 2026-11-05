import Link from "next/link";
import { OperatorContact } from "./operator-contact";
import { PolicyLinks } from "./policy-links";
import { SiteBrand } from "./site-header";

const columns = [
  {
    title: "참여하기",
    links: [
      { href: "/?kind=모집", label: "모집 중인 모임" },
      { href: "/lightning", label: "번개 모임" },
      { href: "/map", label: "이벤트 맵" },
      { href: "/games", label: "웹 게임" },
    ],
  },
  {
    title: "모임 열기",
    links: [
      { href: "/hosting-guide", label: "호스트 가이드" },
      { href: "/archive?kind=template", label: "이벤트 템플릿" },
      { href: "/archive?kind=rulebook", label: "룰북" },
      { href: "/players?tab=crews", label: "크루 찾기" },
    ],
  },
  {
    title: "커뮤니티",
    links: [
      { href: "/stories", label: "이야기" },
      { href: "/ideas", label: "모임 제안" },
      { href: "/policies/community", label: "커뮤니티 이용규칙" },
      { href: "/support", label: "문의하기" },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="sl-footer">
      <div className="sl-footer__inner">
        <div className="sl-footer__brand">
          <SiteBrand />
          <p>
            슬쩍 나와서 리얼하게 노는 퍼블릭 모임.
            <br />
            여러 호스트의 오프라인 모임을 한곳에서 만나요.
          </p>
        </div>
        {columns.map((column) => (
          <nav className="sl-footer__column" key={column.title} aria-label={column.title}>
            <h2>{column.title}</h2>
            {column.links.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
      <div className="sl-footer__legal">
        <PolicyLinks />
        <OperatorContact compact />
        <small>© 2026 Sliper</small>
      </div>
    </footer>
  );
}
