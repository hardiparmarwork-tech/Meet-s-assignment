import type { ParsedDocument, Paper } from "../types";
import { parseMarkdown, parseText } from "./markdown";
import { parseDocx } from "./docx";
import { parsePdf } from "./pdf";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const KINDS: Record<string, Paper["fileKind"]> = { pdf: "pdf", docx: "docx", txt: "txt", md: "md", markdown: "md" };

export class UploadError extends Error {}

/** Checks extension, size and content signature. Uploaded content is only ever read, never run. */
export function validateUpload(fileName: string, buf: Buffer): Paper["fileKind"] {
  const kind = KINDS[fileName.split(".").pop()?.toLowerCase() ?? ""];
  if (!kind) throw new UploadError("Unsupported file type. Upload a PDF, DOCX, TXT or Markdown file.");
  if (!buf.length) throw new UploadError("The file is empty.");
  if (buf.length > MAX_UPLOAD_BYTES) throw new UploadError("The file is larger than the 15 MB limit.");
  if (kind === "pdf" && buf.subarray(0, 5).toString() !== "%PDF-") throw new UploadError("The file is named .pdf but is not a PDF.");
  if (kind === "docx" && buf.subarray(0, 4).toString("hex") !== "504b0304") throw new UploadError("The file is named .docx but is not a DOCX.");
  if (kind === "txt" || kind === "md") {
    if (buf.includes(0)) throw new UploadError("The file appears to be binary, not text.");
    try { new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { throw new UploadError("Text files must be UTF-8 encoded."); }
  }
  return kind;
}

export async function parseDocument(kind: Paper["fileKind"], buf: Buffer): Promise<ParsedDocument> {
  if (kind === "pdf") return parsePdf(buf);
  if (kind === "docx") return parseDocx(buf);
  const text = buf.toString("utf8").replace(/^﻿/, "");
  return kind === "md" ? parseMarkdown(text) : parseText(text);
}
