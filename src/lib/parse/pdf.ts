import { getDocumentProxy } from "unpdf";
import type { Block, ParsedDocument } from "../types";
import { collectReferences, inferMetadata, withIds } from "./common";
import { looksLikeHeading } from "./markdown";

type Draft = Omit<Block, "id">;
interface Item { str: string; x: number; y: number; w: number; size: number }
interface Line { text: string; x: number; y: number; size: number; page: number; column: number }

const MAX_PAGES = 150;

function toLines(items: Item[], page: number, column: number): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: Item[][] = [];
  for (const it of sorted) {
    const g = groups.at(-1);
    if (g && Math.abs(g[0].y - it.y) < Math.max(2, it.size * 0.45)) g.push(it);
    else groups.push([it]);
  }
  return groups.map((g) => {
    g.sort((a, b) => a.x - b.x);
    let text = "", end = g[0].x;
    for (const it of g) {
      if (text && it.x - end > it.size * 0.15 && !text.endsWith(" ")) text += " ";
      text += it.str;
      end = it.x + it.w;
    }
    const size = [...g].sort((a, b) => b.str.length - a.str.length)[0].size;
    return { text: text.replace(/\s+/g, " ").trim(), x: g[0].x, y: g[0].y, size, page, column };
  }).filter((l) => l.text);
}

/** Splits a page into two columns only when the gutter is clearly empty. */
function pageLines(items: Item[], width: number, page: number): Line[] {
  const mid = width / 2;
  const left = items.filter((i) => i.x + i.w <= mid + 5);
  const right = items.filter((i) => i.x >= mid - 5);
  const crossing = items.length - left.length - right.length;
  if (left.length > 20 && right.length > 20 && crossing < items.length * 0.08) {
    const spanning = items.filter((i) => !left.includes(i) && !right.includes(i));
    return [...toLines(spanning, page, 0), ...toLines(left, page, 1), ...toLines(right, page, 2)];
  }
  return toLines(items, page, 0);
}

export function linesToBlocks(lines: Line[], pageCount: number): Draft[] {
  // Drop running headers, footers and page numbers.
  const key = (t: string) => t.replace(/\d+/g, "#").toLowerCase();
  const seen = new Map<string, Set<number>>();
  for (const l of lines) (seen.get(key(l.text)) ?? seen.set(key(l.text), new Set()).get(key(l.text))!).add(l.page);
  const kept = lines.filter((l) => !(pageCount > 2 && (seen.get(key(l.text))?.size ?? 0) > pageCount * 0.5) && !/^(page )?\d{1,4}( of \d+)?$/i.test(l.text));

  const sizes = new Map<number, number>();
  for (const l of kept) sizes.set(Math.round(l.size), (sizes.get(Math.round(l.size)) ?? 0) + l.text.length);
  const body = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;

  const blocks: Draft[] = [];
  let buf: Line[] = [];
  const flush = () => {
    if (!buf.length) return;
    const text = buf.reduce((acc, l) => (/[a-z]-$/.test(acc) && /^[a-z]/.test(l.text) ? acc.slice(0, -1) + l.text : acc ? `${acc} ${l.text}` : l.text), "");
    blocks.push({ type: "paragraph", inlines: [{ t: text }], page: buf[0].page } as Draft);
    buf = [];
  };
  let previous: Line | undefined;
  for (const line of kept) {
    const big = line.size >= body * 1.15;
    const heading = line.text.length < 200 && (big || looksLikeHeading(line.text));
    const labelled = /^(authors?|by|published|publication date|doi|journal|publisher|institution|key\s?words?|abstract)\b\s*[:—]/i.test(line.text);
    const gap = previous && previous.page === line.page && previous.column === line.column ? previous.y - line.y : 0;
    if (heading) {
      flush();
      const last = blocks.at(-1) as (Draft & { type: string; level?: number; inlines?: { t: string }[] }) | undefined;
      const level = line.size >= body * 1.5 ? 1 : 2;
      // A title wrapped over several lines stays one heading.
      if (big && last?.type === "heading" && previous && Math.abs(previous.size - line.size) < 0.5 && gap > 0 && gap < line.size * 1.8) {
        last.inlines![0].t += ` ${line.text}`;
      } else blocks.push({ type: "heading", level, inlines: [{ t: line.text }], page: line.page } as Draft);
    } else {
      if (labelled || gap > line.size * 1.7 || (previous && line.x - previous.x > line.size * 1.2 && /[.!?]$/.test(previous.text))) flush();
      if (previous && previous.page !== line.page && /[.!?]$/.test(previous.text)) flush();
      buf.push(line);
    }
    previous = line;
  }
  flush();
  return blocks;
}

export async function parsePdf(buf: Buffer): Promise<ParsedDocument> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  if (pdf.numPages > MAX_PAGES) throw new Error(`PDF has ${pdf.numPages} pages; the limit is ${MAX_PAGES}.`);
  const lines: Line[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: Item[] = (content.items as { str?: string; transform: number[]; width: number; height: number }[])
      .filter((i) => typeof i.str === "string" && i.str.trim())
      .map((i) => ({ str: i.str!, x: i.transform[4], y: i.transform[5], w: i.width, size: Math.abs(i.transform[3]) || i.height || 10 }));
    lines.push(...pageLines(items, page.getViewport({ scale: 1 }).width, p));
  }
  if (lines.reduce((n, l) => n + l.text.length, 0) < 200) {
    throw new Error("No extractable text was found. This looks like a scanned PDF; OCR is not supported. Upload a text-based PDF or a DOCX.");
  }
  const all = withIds(linesToBlocks(lines, pdf.numPages));
  const info = ((await pdf.getMetadata().catch(() => null))?.info ?? {}) as { Title?: string };
  const largest = all.find((b) => b.type === "heading" && b.level === 1);
  return {
    parser: "builtin-pdf",
    metadata: inferMetadata(all, !largest && info.Title && info.Title.split(" ").length > 3 ? { title: info.Title } : {}),
    blocks: all,
    references: collectReferences(all),
    fidelity: [
      "PDF text was extracted and re-flowed. Tables, figures, equations and footnote placement are NOT reliably reconstructed.",
      "The original PDF is preserved unchanged and linked from the publication; it is the authoritative version.",
    ],
    pageCount: pdf.numPages,
  };
}
