import { NextResponse } from "next/server";
import { fail, guardApi } from "@/lib/server/guard";
import { getPaper, latestVersion, savePaper } from "@/lib/db";
import { enqueue, initialStages, isProcessing } from "@/lib/pipeline";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const paper = getPaper((await params).id);
  if (!paper) return fail(new Error("Paper not found."), 404);
  if (isProcessing(paper.id)) return fail(new Error("Already processing."), 409);
  if (latestVersion(paper.id)) return fail(new Error("Published papers cannot be reprocessed. Use refresh to update source data."), 409);
  paper.state = "processing";
  paper.stages = initialStages();
  paper.error = null;
  savePaper(paper);
  enqueue(paper.id);
  return NextResponse.json({ ok: true }, { status: 202 });
}
