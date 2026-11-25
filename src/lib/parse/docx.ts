import mammoth from "mammoth";
import JSZip from "jszip";
import { parse as parseHtml, HTMLElement, TextNode, type Node } from "node-html-parser";
import type { Block, Inline, ParsedDocument } from "../types";
import { collectReferences, inferMetadata, safeHref, withIds } from "./common";

type Draft = Omit<Block, "id">;
const MAX_UNCOMPRESSED = 120 * 1024 * 1024;

function inlines(node: Node, style: Omit<Inline, "t"> = {}, out: Inline[] = []): Inline[] {
  if (node instanceof TextNode) {
    if (node.text) out.push({ ...style, t: node.text });
    return out;
  }
  const el = node as HTMLElement;
  const tag = el.tagName?.toLowerCase();
  const next = { ...style };
  if (tag === "strong" || tag === "b") next.b = true;
  if (tag === "em" || tag === "i") next.i = true;
  if (tag === "sup") next.sup = true;
  if (tag === "sub") next.sub = true;
  if (tag === "a") { const href = safeHref(el.getAttribute("href")); if (href) next.href = href; }
  if (tag === "br") out.push({ t: " " });
  for (const child of el.childNodes) inlines(child, next, out);
  return out;
}

const SAFE_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

export async function parseDocx(buf: Buffer): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(buf);
  const total = Object.values(zip.files).reduce((n, f) => n + ((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0);
  if (total > MAX_UNCOMPRESSED) throw new Error("This DOCX expands to an unreasonably large size and was not processed.");
  const documentXml = zip.file("word/document.xml");
  if (!documentXml) throw new Error("This file is not a valid DOCX document.");
  const xml = await documentXml.async("string");
  const fidelity: string[] = [];
  if (xml.includes("<m:oMath")) fidelity.push("This document contains Word equations, which could NOT be reconstructed. Consult the original file.");
  if (xml.includes("<w:txbxContent")) fidelity.push("Text boxes may be missing or out of order. Consult the original file.");
  if (xml.includes("<c:chart")) fidelity.push("Native Word charts could NOT be reconstructed. Consult the original file.");

  const { value: html } = await mammoth.convertToHtml({ buffer: buf }, { styleMap: ["p[style-name='Title'] => h1:fresh"] });
  const blocks: Draft[] = [];
  const walk = (el: HTMLElement) => {
    for (const node of el.childNodes) {
      if (!(node instanceof HTMLElement)) continue;
      const tag = node.tagName.toLowerCase();
      const images = tag === "img" ? [node] : node.querySelectorAll("img");
      if (/^h[1-6]$/.test(tag)) blocks.push({ type: "heading", level: Number(tag[1]), inlines: inlines(node) } as Draft);
      else if (tag === "p") {
        const content = inlines(node);
        if (content.some((i) => i.t.trim())) blocks.push({ type: "paragraph", inlines: content } as Draft);
      } else if (tag === "ul" || tag === "ol") blocks.push({ type: "list", ordered: tag === "ol", items: node.querySelectorAll("li").map((li) => inlines(li)) } as Draft);
      else if (tag === "table") blocks.push({ type: "table", rows: node.querySelectorAll("tr").map((tr) => tr.querySelectorAll("td,th").map((td) => inlines(td))) } as Draft);
      else if (tag !== "img") walk(node);
      if (tag !== "ul" && tag !== "ol") {
        for (const img of images) {
          const src = img.getAttribute("src") ?? "";
          if (SAFE_IMAGE.test(src)) blocks.push({ type: "figure", src, alt: img.getAttribute("alt") ?? "Figure from the original document" } as Draft);
          else fidelity.push("An embedded figure used an unsupported image format and is not shown.");
        }
      }
    }
  };
  walk(parseHtml(html));
  const all = withIds(blocks);
  return { parser: "builtin-docx", metadata: inferMetadata(all), blocks: all, references: collectReferences(all), fidelity: [...new Set(fidelity)], pageCount: null };
}
