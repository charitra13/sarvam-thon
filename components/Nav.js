"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Aaj ka hisaab", hint: "Today" },
  { href: "/invoices", label: "Invoices", hint: "Bills" },
  { href: "/customers", label: "Khata", hint: "Ledger" },
  { href: "/inventory", label: "Inventory", hint: "Stock" },
];

export default function Nav() {
  const path = usePathname();
  const isActive = (href) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className="nav" aria-label="Main">
      {links.map((l) => (
        <Link key={l.href} href={l.href} aria-current={isActive(l.href) ? "page" : undefined}>
          {l.label} <small>{l.hint}</small>
        </Link>
      ))}
      <Link href="/scan" className="nav__cta" aria-current={isActive("/scan") ? "page" : undefined}>
        + Scan a slip
      </Link>
    </nav>
  );
}
