import { marked, type Token, type Tokens } from "marked";
import type { Block, Inline, Metadata, ParsedDocument } from "../types";
import { collectReferences, inferMetadata, safeHref, withIds } from "./common";

type Draft = Omit<Block, "id">;
type Style = Omit<Inline, "t">;

const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " } as Record<string, string>)[e]);

function pushText(out: Inline[], text: string, style: Style) {
  // Footnote markers [^x] become superscript in-document links.
  for (const part of text.split(/(\[\^[\w-]+\])/)) {
    if (!part) continue;
    const note = part.match(/^\[\^([\w-]+)\]$/);
    out.push(note ? { ...style, t: note[1], sup: true, href: `#fn-${note[1]}` } : { ...style, t: decode(part).replace(/\n/g, " ") });
  }
}

function inline(tokens: Token[] | undefined, style: Style = {}, out: Inline[] = [], notes: string[] = []): Inline[] {
  for (const t of tokens ?? []) {
    if (t.type === "strong") inline((t as Tokens.Strong).tokens, { ...style, b: true }, out, notes);
    else if (t.type === "em") inline((t as Tokens.Em).tokens, { ...style, i: true }, out, notes);
    else if (t.type === "link") {
      const href = safeHref((t as Tokens.Link).href);
      inline((t as Tokens.Link).tokens, href ? { ...style, href } : style, out, notes);
    } else if (t.type === "image") {
      notes.push("Images referenced by URL are not fetched; their alt text is shown in place.");
      out.push({ ...style, t: `[Figure not embedded: ${(t as Tokens.Image).text || "no description"}]`, i: true });
    } else if (t.type === "br") out.push({ t: " " });
    else {
      const nested = (t as Tokens.Text).tokens;
      // Raw HTML is kept as literal text; React escapes it, so it can never execute.
      if (nested?.length) inline(nested, style, out, notes);
      else pushText(out, ((t as Tokens.Text).text ?? t.raw) as string, style);
    }
  }
  return out;
}

export function frontMatter(src: string): { meta: Partial<Metadata>; body: string } {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return { meta: {}, body: src };
  const meta: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = ({ title: "title", authors: "authors", author: "authors", year: "year", date: "publicationDate", doi: "doi", publisher: "publisher", journal: "publisher", keywords: "keywords", url: "originalUrl" } as Record<string, string>)[kv[1].toLowerCase()];
    if (!key) continue;
    const v = kv[2].trim().replace(/^["']|["']$/g, "");
    meta[key] = key === "authors" || key === "keywords" ? v.split(/\s*;\s*/).filter(Boolean) : key === "year" ? Number(v) || null : v;
  }
  if (meta.originalUrl && !safeHref(meta.originalUrl as string)) delete meta.originalUrl;
  return { meta: meta as Partial<Metadata>, body: src.slice(m[0].length) };
}

export function parseMarkdown(src: string): ParsedDocument {
  const { meta, body } = frontMatter(src);
  const footnotes: { key: string; text: string }[] = [];
  const stripped = body.replace(/^\[\^([\w-]+)\]:\s*(.+)$/gm, (_, key, text) => { footnotes.push({ key, text }); return ""; });
  const notes: string[] = [];
  const blocks: Draft[] = [];
  for (const t of marked.lexer(stripped)) {
    if (t.type === "heading") blocks.push({ type: "heading", level: t.depth, inlines: inline(t.tokens, {}, [], notes) } as Draft);
    else if (t.type === "paragraph") {
      const math = t.raw.trim().match(/^\$\$([\s\S]+)\$\$$/);
      if (math) {
        blocks.push({ type: "code", text: math[1].trim() } as Draft);
        notes.push("Display equations are shown as their original source notation, not typeset.");
      } else blocks.push({ type: "paragraph", inlines: inline(t.tokens, {}, [], notes) } as Draft);
    } else if (t.type === "list") {
      const list = t as Tokens.List;
      blocks.push({ type: "list", ordered: list.ordered, items: list.items.map((i) => inline(i.tokens, {}, [], notes)) } as Draft);
    } else if (t.type === "table") {
      const table = t as Tokens.Table;
      blocks.push({ type: "table", rows: [table.header, ...table.rows].map((r) => r.map((c) => inline(c.tokens, {}, [], notes))) } as Draft);
    } else if (t.type === "code") blocks.push({ type: "code", text: (t as Tokens.Code).text } as Draft);
    else if (t.type === "blockquote") blocks.push({ type: "quote", inlines: inline((t as Tokens.Blockquote).tokens, {}, [], notes) } as Draft);
    else if (t.type === "html" && t.raw.trim() && !t.raw.trim().startsWith("<!--")) blocks.push({ type: "code", text: t.raw.trim() } as Draft);
  }
  if (footnotes.length) {
    blocks.push({ type: "heading", level: 2, inlines: [{ t: "Notes" }] } as Draft);
    for (const f of footnotes) blocks.push({ type: "paragraph", inlines: [{ t: `${f.key}. `, b: true }, { t: f.text }], footnoteKey: f.key } as unknown as Draft);
  }
  const all = withIds(blocks);
  return { parser: "builtin-markdown", metadata: inferMetadata(all, meta), blocks: all, references: collectReferences(all), fidelity: [...new Set(notes)], pageCount: null };
}

const KNOWN = /^(abstract|introduction|background|literature review|related work|data|data and methods|methods?|methodology|materials and methods|results|findings|discussion|limitations|conclusions?|references|bibliography|acknowledge?ments|appendix.*)$/i;

export function looksLikeHeading(line: string): boolean {
  const s = line.trim();
  if (!s || s.length > 90 || /[.;,:]$/.test(s)) return false;
  if (KNOWN.test(s.replace(/^\d+(\.\d+)*\.?\s*/, ""))) return true;
  if (/^\d+(\.\d+)*\.?\s+[A-Z][^%$]{2,}$/.test(s) && s.split(" ").length <= 10) return true;
  return s.length > 3 && s === s.toUpperCase() && /[A-Z]{3}/.test(s) && s.split(" ").length <= 10;
}

export function parseText(src: string): ParsedDocument {
  const chunks = src.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((c) => c.replace(/^\n+|\s+$/g, "")).filter(Boolean);
  const blocks: Draft[] = [];
  chunks.forEach((chunk, i) => {
    const lines = chunk.split("\n");
    if (lines.length === 1 && (looksLikeHeading(lines[0]) || (i === 0 && lines[0].length <= 250))) {
      blocks.push({ type: "heading", level: i === 0 ? 1 : 2, inlines: [{ t: lines[0].trim() }] } as Draft);
    } else if (lines.some((l) => /\S(\t| {3,})\S/.test(l)) && lines.length > 1) {
      blocks.push({ type: "code", text: chunk } as Draft); // keeps aligned tables intact
    } else if (lines.every((l) => /^(authors?|by|published|publication date|doi|journal|publisher|institution|key\s?words?)\b\s*[:—-]/i.test(l))) {
      for (const l of lines) blocks.push({ type: "paragraph", inlines: [{ t: l }] } as Draft);
    } else blocks.push({ type: "paragraph", inlines: [{ t: lines.join(" ") }] } as Draft);
  });
  const all = withIds(blocks);
  return { parser: "builtin-text", metadata: inferMetadata(all), blocks: all, references: collectReferences(all),
    fidelity: ["Plain text carries no formatting; headings are inferred from line shape."], pageCount: null };
}
