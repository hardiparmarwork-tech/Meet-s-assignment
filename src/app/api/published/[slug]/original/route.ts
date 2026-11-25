import { fail } from "@/lib/server/guard";
import { getPaperBySlug } from "@/lib/db";
import { originalDownload } from "@/lib/server/download";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const paper = getPaperBySlug((await params).slug);
  return paper && (paper.state === "published" || paper.state === "archived") ? originalDownload(paper) : fail(new Error("Not found."), 404);
}
