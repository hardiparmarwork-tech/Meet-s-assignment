import type { Block, Inline, Metadata } from "../types";

export const emptyMetadata = (): Metadata => ({
  title: "", authors: [], abstract: "", publicationDate: "", year: null, doi: "", publisher: "", keywords: [], originalUrl: "",
});

export const plain = (inlines: Inline[]) => inlines.map((i) => i.t).join("");

export function blockText(b: Block): string {
  switch (b.type) {
    case "heading": case "paragraph": case "quote": return plain(b.inlines);
    case "list": return b.items.map(plain).join("\n");
    case "table": return b.rows.map((r) => r.map(plain).join(" | ")).join("\n");
    case "code": return b.text;
    case "figure": return b.alt;
  }
}

export const safeHref = (h: string | undefined | null) =>
  h && (/^https?:\/\//i.test(h) || /^#[\w\-:.]+$/.test(h)) ? h : undefined;

export const isReferencesHeading = (s: string) => /^\s*(\d+\.?\s*)?(references|bibliography|works cited|literature cited)\s*:?\s*$/i.test(s);

/** Assigns stable ids in document order. */
export function withIds(blocks: Omit<Block, "id">[]): Block[] {
  return blocks.map((b, i) => ({ ...b, id: `b${i + 1}` }) as Block);
}

export function collectReferences(blocks: Block[]): string[] {
  const start = blocks.findIndex((b) => b.type === "heading" && isReferencesHeading(blockText(b)));
  if (start < 0) return [];
  const out: string[] = [];
  for (const b of blocks.slice(start + 1)) {
    if (b.type === "heading") break;
    if (b.type === "list") out.push(...b.items.map(plain));
    else if (b.type === "paragraph") out.push(plain(b.inlines));
  }
  return out.filter((s) => s.trim());
}

/**
 * Reads metadata only from things the document states. Anything not stated stays empty;
 * file timestamps are never used as a publication date.
 */
export function inferMetadata(blocks: Block[], given: Partial<Metadata> = {}): Metadata {
  const m: Metadata = { ...emptyMetadata() };
  for (const [k, v] of Object.entries(given)) {
    if (v !== undefined && v !== "" && v !== null && !(Array.isArray(v) && !v.length)) (m as unknown as Record<string, unknown>)[k] = v;
  }
  const front = blocks.slice(0, 40);
  const lines = front.flatMap((b) => blockText(b).split("\n")).map((s) => s.trim()).filter(Boolean);
  const field = (re: RegExp) => lines.map((l) => l.match(re)?.[1]?.trim()).find(Boolean) ?? "";

  if (!m.title) {
    const h = front.find((b) => b.type === "heading" && !/^(abstract|introduction|keywords)/i.test(blockText(b)));
    m.title = h ? blockText(h).trim() : (lines[0] ?? "").slice(0, 300);
  }
  if (!m.authors.length) {
    const labelled = field(/^(?:authors?|by)\s*[:—-]\s*(.+)$/i);
    if (labelled) m.authors = labelled.split(/;|,\s+(?=[A-Z][a-z])|\s+and\s+|\s*&\s*/).map((s) => s.trim()).filter(Boolean);
  }
  if (!m.abstract) {
    const at = blocks.findIndex((b) => b.type === "heading" && /^abstract\b/i.test(blockText(b)));
    if (at >= 0) {
      const parts: string[] = [];
      for (const b of blocks.slice(at + 1)) {
        // An abstract is plain prose: stop at the next heading, table, list or other structure.
        if (b.type !== "paragraph" || /^key\s?words?\b/i.test(blockText(b)) || parts.join(" ").length > 2500) break;
        parts.push(blockText(b));
      }
      m.abstract = parts.join(" ").trim();
    } else m.abstract = field(/^abstract\s*[:.—-]\s*(.{40,})$/i);
  }
  if (!m.doi) m.doi = lines.join("\n").match(/\b10\.\d{4,9}\/[^\s"<>]+/)?.[0]?.replace(/[.,;)\]]+$/, "") ?? "";
  if (!m.publicationDate) m.publicationDate = field(/^(?:published|publication date|date of publication)\s*[:—-]?\s*(.{4,40})$/i);
  if (!m.year) {
    const y = m.publicationDate.match(/\b(19|20)\d{2}\b/)?.[0]
      ?? lines.join("\n").match(/(?:©|copyright|published(?: online)?)[^\n]{0,30}?\b((?:19|20)\d{2})\b/i)?.[1];
    m.year = y ? Number(y) : null;
  }
  if (!m.publisher) m.publisher = field(/^(?:publisher|journal|institution|published by)\s*[:—-]\s*(.+)$/i);
  if (!m.keywords.length) {
    const k = field(/^key\s?words?\s*[:—-]\s*(.+)$/i);
    if (k) m.keywords = k.split(/[;,·]/).map((s) => s.trim()).filter(Boolean);
  }
  return m;
}
