import Link from "next/link";
import Nav from "../../components/Nav.js";

export default function AppLayout({ children }) {
  return (
    <div className="shell">
      <aside className="binding">
        <Link href="/" className="brand">
          <span className="brand__auspice">॥ शुभ लाभ ॥</span>
          <span className="brand__mark foil">Munshi</span>
          <span className="brand__sub">slip se seedha bahi tak</span>
        </Link>
        <Nav />
        <div className="binding__foot">
          <span>Track Desk Stationery · Powered by Sarvam AI</span>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
