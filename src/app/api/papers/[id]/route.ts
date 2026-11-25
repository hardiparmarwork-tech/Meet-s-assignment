import { NextResponse } from "next/server";
import { fail, guardApi } from "@/lib/server/guard";
import { getPaper, savePaper } from "@/lib/db";
import { isProcessing } from "@/lib/pipeline";
import { publishGate, removeDraft } from "@/lib/publish";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const paper = getPaper((await params).id);
  if (!paper) return fail(new Error("Paper not found."), 404);
  if (paper.state === "processing" && !isProcessing(paper.id)) {
    // The server restarted mid-job. Say so instead of spinning forever.
    paper.state = "failed";
    paper.error = "Processing was interrupted (the server restarted). Retry to continue.";
    for (const s of paper.stages) if (s.state === "running") s.state = "failed";
    savePaper(paper);
  }
  const { analysis, ...rest } = paper;
  return NextResponse.json({
    ...rest,
    eligibility: analysis?.eligibility ?? null,
    parameters: analysis?.parameters.map((p) => ({ id: p.id, name: p.name, raw: p.originalRaw, status: p.status, reason: p.statusReason, geography: p.geography?.name ?? null, selected: p.selectedIndicatorId, decision: p.authorDecision?.action ?? null })) ?? [],
    issues: analysis?.issues ?? [],
    gate: analysis ? publishGate(paper) : null,
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = await guardApi(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    if (isProcessing(id)) throw new Error("Wait for processing to finish before deleting.");
    removeDraft(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
