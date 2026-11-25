import { NextResponse } from "next/server";
import { readUpload } from "../db";
import type { Paper } from "../types";

const TYPES = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8" };

/** Always served as a download in a sandbox, so uploaded content is never rendered with this origin's rights. */
export function originalDownload(paper: Paper) {
  return new NextResponse(new Uint8Array(readUpload(paper.id)), {
    headers: {
      "Content-Type": TYPES[paper.fileKind],
      "Content-Disposition": `attachment; filename="${paper.fileName.replace(/[^\w.\-]/g, "_")}"`,
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
