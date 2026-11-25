"use client";
import type { ReactNode } from "react";
import type { Block, Inline } from "@/lib/types";

export interface Mark { id: string; sentence: string; raw: string; tone: "live" | "contextual" | "static"; label: string }

interface Span { start: number; end: number; mark: Mark }

/** Locates each claim inside its own sentence, so repeated numbers mark the right occurrence. */
export function locateMarks(text: string, marks: Mark[]): Span[] {
  const spans: Span[] = [];
  for (const mark of marks) {
    const sentenceAt = text.indexOf(mark.sentence);
    if (sentenceAt < 0) continue;
    let at = mark.sentence.indexOf(mark.raw);
    while (at >= 0 && spans.some((s) => s.start === sentenceAt + at)) at = mark.sentence.indexOf(mark.raw, at + 1);
    if (at >= 0) spans.push({ start: sentenceAt + at, end: sentenceAt + at + mark.raw.length, mark });
  }
  return spans.sort((a, b) => a.start - b.start).filter((s, i, all) => i === 0 || s.start >= all[i - 1].end);
}

function styled(i: Inline, text: string, key: string): ReactNode {
  let node: ReactNode = text;
  if (i.b) node = <strong>{node}</strong>;
  if (i.i) node = <em>{node}</em>;
  if (i.sub) node = <sub>{node}</sub>;
  if (i.sup) node = <sup>{node}</sup>;
  if (i.href) node = <a href={i.href} {...(i.href.startsWith("#") ? {} : { target: "_blank", rel: "noreferrer noopener" })}>{node}</a>;
  return <span key={key}>{node}</span>;
}

function Rich({ inlines, marks, onMark, active }: { inlines: Inline[]; marks: Mark[]; onMark: (id: string) => void; active: string | null }) {
  const spans = locateMarks(inlines.map((i) => i.t).join(""), marks);
  const out: ReactNode[] = [];
  let offset = 0;
  inlines.forEach((inline, n) => {
    const end = offset + inline.t.length;
    let cursor = offset;
    for (const s of spans.filter((s) => s.start < end && s.end > offset)) {
      if (s.start > cursor) out.push(styled(inline, inline.t.slice(cursor - offset, s.start - offset), `${n}-${cursor}`));
      const from = Math.max(s.start, cursor), to = Math.min(s.end, end);
      // The paper's own characters are wrapped, never replaced.
      out.push(
        <span key={`${n}-m${from}`} className={`claim claim-${s.mark.tone}${active === s.mark.id ? " is-active" : ""}`}>
          {styled(inline, inline.t.slice(from - offset, to - offset), "t")}
          {to === s.end && (
            <button type="button" className="claim-key" onClick={() => onMark(s.mark.id)} aria-label={s.mark.label}>
              {s.mark.tone === "live" ? "●" : s.mark.tone === "contextual" ? "◐" : "○"}
            </button>
          )}
        </span>,
      );
      cursor = to;
    }
    if (cursor < end) out.push(styled(inline, inline.t.slice(cursor - offset), `${n}-r${cursor}`));
    offset = end;
  });
  return <>{out}</>;
}

export function ArticleBlock({ block, marks, onMark, active }: { block: Block; marks: Mark[]; onMark: (id: string) => void; active: string | null }) {
  const rich = (inlines: Inline[]) => <Rich inlines={inlines} marks={marks} onMark={onMark} active={active} />;
  switch (block.type) {
    case "heading": {
      const Tag = (`h${Math.min(5, Math.max(2, block.level))}`) as "h2";
      return <Tag id={block.id} data-section={block.id}>{rich(block.inlines)}</Tag>;
    }
    case "paragraph": return <p id={block.footnoteKey ? `fn-${block.footnoteKey}` : block.id}>{rich(block.inlines)}</p>;
    case "quote": return <blockquote id={block.id}>{rich(block.inlines)}</blockquote>;
    case "list": {
      const items = block.items.map((item, i) => <li key={i}>{rich(item)}</li>);
      return block.ordered ? <ol id={block.id}>{items}</ol> : <ul id={block.id}>{items}</ul>;
    }
    case "table": return (
      <div className="scroll" id={block.id}>
        <table><tbody>{block.rows.map((r, i) => (
          <tr key={i}>{r.map((cell, k) => (i === 0 ? <th key={k}>{rich(cell)}</th> : <td key={k}>{rich(cell)}</td>))}</tr>
        ))}</tbody></table>
      </div>
    );
    // eslint-disable-next-line @next/next/no-img-element
    case "figure": return <figure id={block.id}><img src={block.src} alt={block.alt} /></figure>;
    case "code": return <pre id={block.id} className="scroll">{block.text}</pre>;
  }
}
