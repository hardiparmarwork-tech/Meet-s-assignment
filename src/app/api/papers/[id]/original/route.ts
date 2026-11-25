import { fail, guardApi } from "@/lib/server/guard";
import { getPaper } from "@/lib/db";
import { originalDownload } from "@/lib/server/download";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const paper = getPaper((await params).id);
  return paper ? originalDownload(paper) : fail(new Error("Not found."), 404);
}
