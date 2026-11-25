import Link from "next/link";
import { archiveRecords } from "@/lib/archive";

export const dynamic = "force-dynamic";

export default function Home() {
  const records = archiveRecords();
  const demo = records.find((r) => r.isDemo);
  return (
    <main id="content" className="page narrow">
      <h1 className="hero">A paper is a snapshot. Keep the snapshot, and show what happened next.</h1>
      <p className="lede">Upload a research paper. Where its measurements have a compatible public source, later observations appear beside the original text, each one labelled and traceable. The paper itself is never rewritten.</p>
      <ol className="steps"><li><b>1</b> Upload the paper</li><li><b>2</b> Preview the generated page</li><li><b>3</b> Publish</li></ol>
      <p className="actions"><Link className="button primary" href="/builder">Upload a paper</Link>{demo && <Link className="button" href={`/research/${demo.slug}`}>Read the demonstration</Link>}<Link className="button" href="/archive">Browse the archive</Link></p>
      <h2>What it will and will not do</h2>
      <ul>
        <li>It tracks only measurements whose concept, unit, geography, population and period match a verified source.</li>
        <li>Many papers will be only partly eligible, or not eligible. The reasons are shown.</li>
        <li>The statistical sources are annual. Nothing here is real-time.</li>
        <li>Eligibility describes data suitability. It does not judge a paper&rsquo;s quality or truth.</li>
      </ul>
    </main>
  );
}
