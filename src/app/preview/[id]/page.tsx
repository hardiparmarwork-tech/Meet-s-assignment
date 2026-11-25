import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/server/guard";
import { getPaper } from "@/lib/db";
import { effectiveMetadata, publishGate } from "@/lib/publish";
import { publicationView } from "@/lib/view";
import { Publication } from "@/components/Publication";
import { PreviewControls } from "@/components/PreviewControls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preview", robots: { index: false } };

export default async function Preview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAuth(`/preview/${id}`);
  const paper = getPaper(id);
  if (!paper) notFound();
  const view = publicationView(paper, true);
  if (!view || paper.state === "processing") redirect(`/builder/${id}`);
  const a = paper.analysis!;
  return (
    <>
      <PreviewControls id={id} gate={publishGate(paper)} outcomeLabel={a.eligibility.label} reasons={a.eligibility.reasons} issues={a.issues}
        parameters={a.parameters} metadata={effectiveMetadata(paper).metadata} refreshIntervalHours={paper.settings.refreshIntervalHours}
        slug={paper.slug} tools={a.tools} enrichment={a.enrichment.detail} />
      <Publication view={view} />
    </>
  );
}
