import { listItems } from "../../../lib/data.js";
import ScanFlow from "../../../components/ScanFlow.js";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const items = await listItems();
  return (
    <>
      <header className="page-head rise">
        <div>
          <h1>Slip se hisaab.</h1>
          <p className="annot">A handwritten slip. A place in your bahi-khata.</p>
        </div>
      </header>
      <ScanFlow items={items} />
    </>
  );
}
