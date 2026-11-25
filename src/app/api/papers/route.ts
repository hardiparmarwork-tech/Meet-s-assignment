import { NextResponse } from "next/server";
import { fail, guardApi } from "@/lib/server/guard";
import { createPaper, enqueue } from "@/lib/pipeline";
import { MAX_UPLOAD_BYTES } from "@/lib/parse";

export async function POST(req: Request) {
  const denied = await guardApi(req);
  if (denied) return denied;
  try {
    // Refuse oversized bodies before buffering them.
    if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) return fail(new Error("The file is larger than the 15 MB limit."), 413);
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) return fail(new Error("Choose a file to upload."));
    const paper = createPaper(file.name, Buffer.from(await file.arrayBuffer()));
    enqueue(paper.id);
    return NextResponse.json({ id: paper.id }, { status: 202 });
  } catch (e) {
    return fail(e);
  }
}
