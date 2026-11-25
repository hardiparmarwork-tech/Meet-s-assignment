import { NextResponse } from "next/server";
import { fail, guardApi } from "@/lib/server/guard";
import { getPaper } from "@/lib/db";
import { refreshPaper } from "@/lib/refresh";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const paper = getPaper((await params).id);
  if (!paper) return fail(new Error("Paper not found."), 404);
  try {
    return NextResponse.json(await refreshPaper(paper));
  } catch (e) {
    return fail(e, 502);
  }
}
