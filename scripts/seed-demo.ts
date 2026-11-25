// Runs the demonstration paper through the real pipeline, with live source retrieval, and publishes it.
import { readFileSync } from "node:fs";
import { createPaper, processPaper } from "../src/lib/pipeline";
import { publish } from "../src/lib/publish";
import { getPaper, listPapers } from "../src/lib/db";

const existing = listPapers().find((p) => p.isDemo);
if (existing) {
  console.log(`A demonstration paper already exists (${existing.state}${existing.slug ? `, /research/${existing.slug}` : ""}).`);
  process.exit(0);
}
const paper = createPaper("air-quality-health-india.md", readFileSync("demo/air-quality-health-india.md"), { isDemo: true });
await processPaper(paper.id);
const done = getPaper(paper.id)!;
if (!done.analysis) throw new Error(done.error ?? "Processing failed");
console.log(done.analysis.eligibility.label, done.analysis.eligibility.counts);
for (const p of done.analysis.parameters) console.log(p.status.padEnd(12), p.originalRaw.padEnd(34), p.name, "|", p.selectedIndicatorId ?? "-", "|", p.statusReason.slice(0, 110));
console.log("Enrichment:", done.analysis.enrichment.status, done.analysis.enrichment.detail);
const { slug } = publish(paper.id);
console.log(`Published at /research/${slug}`);
