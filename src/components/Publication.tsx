"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MetricView, PublicationView, StaticItem } from "@/lib/view";
import { fmtNumber } from "@/lib/mapping/validate";
import { fmtDate } from "@/lib/format";
import { OUTCOME_LABEL } from "@/lib/eligibility";
import { blockText } from "@/lib/parse/common";
import { ArticleBlock, type Mark } from "./Article";
import { LineChart, Sparkline } from "./Chart";

const KIND = { observed: "Observed", calculated: "Calculated" } as const;
export const STATUS_WORD: Record<string, string> = {
  verified: "Verified", review: "Needs review", contextual: "Context only", unsupported: "Unsupported", rejected: "Rejected", excluded: "Excluded by author",
};

export function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function MetricCard({ m, active, onOpen }: { m: MetricView; active: boolean; onOpen: () => void }) {
  const latestLabel = m.calculation
    ? `Recalculated ${m.calculation.fromYear}–${m.latest?.period}`
    : m.newerThanPaper ? `Later observation, ${m.latest?.period}` : `Latest in source, ${m.latest?.period}`;
  return (
    <article className={`metric metric-${m.mode}${active ? " is-active" : ""}`} data-metric={m.id}>
      <header>
        <h3>{m.name} <span>· {m.geography}</span></h3>
        <div><Badge tone={m.mode}>{m.mode === "live" ? "Tracked" : "Context only"}</Badge><Badge tone="kind">{KIND[m.kind]}</Badge></div>
      </header>
      <div className="metric-body">
        <dl>
          <dt>Paper{m.paperYear ? `, ${m.paperYear}` : ""}</dt>
          <dd className="original">{m.originalRaw}</dd>
          <dt>{latestLabel}</dt>
          <dd className="latest">{m.latest ? <>{m.latest.text} <small>{m.unit}</small></> : "No value"}</dd>
        </dl>
        <Sparkline m={m} />
      </div>
      {m.change && <p className="delta">{m.change.text} <small>since {m.paperYear}, source to source</small></p>}
      {!m.change && m.mode === "live" && !m.newerThanPaper && !m.calculation && m.paperYear && <p className="note">No observation later than {m.paperYear} yet.</p>}
      {m.mode === "contextual" && <p className="note">Not comparable with the paper&rsquo;s figure, so no change is shown.</p>}
      {m.error && <p className="warn" role="note">⚠ Last attempt failed. Showing the last valid data.</p>}
      <footer>
        <span>{m.source.provider} · retrieved {fmtDate(m.retrievedAt)}</span>
        <button type="button" onClick={onOpen}>Details &amp; chart</button>
      </footer>
    </article>
  );
}

function Details({ m, all, onClose }: { m: MetricView; all: MetricView[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="drawer" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-labelledby="detail-title">
      <div className="drawer-inner">
        <div className="drawer-head">
          <h2 id="detail-title">{m.name} <span>· {m.geography}</span></h2>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <p>{m.definition}</p>
        <p className="quote">From the paper: &ldquo;{m.sentence}&rdquo;</p>
        {m.notComparable && <p className="warn">{m.notComparable}</p>}
        {m.revisionNote && <p className="note">{m.revisionNote}</p>}
        {m.change && <p><strong>Change: {m.change.text}.</strong> {m.change.basis}</p>}
        {m.calculation && <p><strong>Calculation v{m.calculation.version}:</strong> {m.calculation.formula}, with start year {m.calculation.fromYear}. The chart shows the input series.</p>}
        {m.authorConfirmed && <p className="note">This mapping was flagged and then confirmed by the author.</p>}
        <LineChart metric={m} others={all} />
        <h3>Source and provenance</h3>
        <dl className="facts">
          <dt>Provider</dt><dd>{m.source.provider} — {m.source.datasetName}</dd>
          <dt>Indicator</dt><dd><code>{m.source.indicatorCode}</code> {m.source.title}</dd>
          <dt>Endpoint</dt><dd><a href={m.source.endpoint} target="_blank" rel="noreferrer noopener">{m.source.endpoint}</a></dd>
          <dt>Public page</dt><dd><a href={m.source.humanUrl} target="_blank" rel="noreferrer noopener">{m.source.humanUrl}</a></dd>
          <dt>Observation period</dt><dd>{m.latest?.period ?? "—"} (annual)</dd>
          <dt>Provider updated</dt><dd>{m.source.providerUpdated ?? "not stated"}</dd>
          <dt>Last successful retrieval</dt><dd>{fmtDate(m.retrievedAt, true)}</dd>
          <dt>Last attempt</dt><dd>{fmtDate(m.attemptedAt, true)}{m.error ? ` — failed: ${m.error}` : " — succeeded"}</dd>
          <dt>Licence</dt><dd>{m.source.licence}</dd>
        </dl>
        <h3>Compatibility checks</h3>
        <ul className="checks">
          {m.checks.map((c, i) => <li key={i} className={`check-${c.result}`}><b>{c.result === "pass" ? "✓" : c.result === "warn" ? "!" : "✕"}</b><span><strong>{c.dimension}</strong> {c.detail}</span></li>)}
        </ul>
      </div>
    </dialog>
  );
}

export function Publication({ view }: { view: PublicationView }) {
  const { metadata: meta, document: doc, analysis, metrics, statics } = view;
  const [section, setSection] = useState("top");
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [explaining, setExplaining] = useState<StaticItem | null>(null);
  const [sheet, setSheet] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState("");
  const dock = useRef<HTMLElement>(null);

  // The title is shown in the header; skip an identical opening heading rather than repeat it.
  const body = useMemo(() => {
    const first = doc.blocks[0];
    return first?.type === "heading" && blockText(first).trim() === meta.title.trim() ? doc.blocks.slice(1) : doc.blocks;
  }, [doc, meta.title]);

  const { sections, marks } = useMemo(() => {
    const sections: { id: string; title: string; metrics: string[] }[] = [{ id: "top", title: "Opening", metrics: [] }];
    const owner = new Map<string, number>();
    for (const b of body) {
      if (b.type === "heading") sections.push({ id: b.id, title: blockText(b), metrics: [] });
      owner.set(b.id, sections.length - 1);
    }
    for (const m of metrics) sections[owner.get(m.blockId) ?? 0]?.metrics.push(m.id);
    const marks = new Map<string, Mark[]>();
    const add = (blockId: string, mark: Mark) => marks.set(blockId, [...(marks.get(blockId) ?? []), mark]);
    for (const m of metrics) add(m.blockId, { id: m.id, sentence: m.sentence, raw: m.originalRaw, tone: m.mode, label: `${m.mode === "live" ? "Tracked parameter" : "Contextual data"}: ${m.name}` });
    for (const s of statics) {
      const sentence = analysis.parameters.find((p) => p.id === s.id)!.sentence;
      add(s.blockId, { id: s.id, sentence, raw: s.raw, tone: "static", label: `Static figure: why “${s.raw}” is not updated` });
    }
    return { sections, marks };
  }, [body, metrics, statics, analysis]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = "top";
      for (const el of document.querySelectorAll<HTMLElement>("[data-section]")) {
        if (el.getBoundingClientRect().top < window.innerHeight * 0.3) current = el.dataset.section!;
        else break;
      }
      setSection(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => { setActive(null); if (dock.current) dock.current.scrollTop = 0; }, [section]);

  // Fallback: a section without parameters keeps the most recent ones, and says so.
  const at = Math.max(0, sections.findIndex((s) => s.id === section));
  const here = sections[at];
  const fallback = sections.slice(0, at).reverse().find((s) => s.metrics.length);
  const ids = showAll ? metrics.map((m) => m.id) : here.metrics.length ? here.metrics : fallback?.metrics ?? metrics.slice(0, 3).map((m) => m.id);
  const visible = ids.map((id) => metrics.find((m) => m.id === id)!).filter(Boolean);
  const dockNote = showAll ? "All tracked and contextual parameters" : here.metrics.length ? `For this section: ${here.title}`
    : fallback ? `No parameters in “${here.title}”. Still showing “${fallback.title}”.` : "Key indicators in this paper";

  const onMark = (id: string) => {
    const s = statics.find((x) => x.id === id);
    if (s) return setExplaining(s);
    setActive(id);
    setSheet(true);
    const owner = sections.find((x) => x.metrics.includes(id));
    if (owner && !ids.includes(id)) setSection(owner.id);
    setTimeout(() => dock.current?.querySelector(`[data-metric="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), 60);
  };

  const share = async () => {
    const url = `${location.origin}/research/${view.slug}`;
    try {
      if (navigator.share) await navigator.share({ title: meta.title, url });
      else { await navigator.clipboard.writeText(url); setCopied("Link copied"); }
    } catch { /* dismissed */ }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/research/${view.slug}`); setCopied("Link copied"); }
    catch { setCopied("Copy failed — copy the address bar"); }
  };

  const live = metrics.filter((m) => m.mode === "live").length;
  const outcome = analysis.eligibility.outcome;
  const originalHref = view.preview ? `/api/papers/${view.paperId}/original` : `/api/published/${view.slug}/original`;
  const opened = metrics.find((m) => m.id === open);

  return (
    <div className="publication">
      {view.isDemo && <div className="demo-banner" role="note"><strong>Demonstration paper.</strong> The text and its 2017 publication date were written for this demo and are not real research. Source observations are real data retrieved from the named providers. Figures in the text marked “for illustration” are synthetic and are not tracked as live.</div>}
      <header className="pub-header">
        <p className="kicker">{analysis.domain.join(" · ") || "Research"}{meta.year ? ` · Originally published ${meta.year}` : " · Publication year not stated"}</p>
        <h1>{meta.title}</h1>
        <p className="authors">{meta.authors.join(", ") || "Authors not identified in the document"}</p>
        <p className="meta-line">
          {meta.publisher && <span>{meta.publisher}</span>}
          {meta.publicationDate && <span>{meta.publicationDate}</span>}
          {meta.doi && <a href={`https://doi.org/${encodeURI(meta.doi)}`} target="_blank" rel="noreferrer noopener">doi:{meta.doi}</a>}
          {meta.originalUrl && <a href={meta.originalUrl} target="_blank" rel="noreferrer noopener">Original publication</a>}
        </p>
        {view.metadataEdits.length > 0 && <p className="note">Metadata edited by the author after extraction: {view.metadataEdits.join(", ")}.</p>}
        {meta.abstract && !body.some((b) => b.type === "heading" && /^abstract/i.test(blockText(b))) && <p className="abstract">{meta.abstract}</p>}

        <div className={`status-panel outcome-${outcome}`}>
          <div className="status-row">
            <Badge tone={outcome}>{OUTCOME_LABEL[outcome]}</Badge>
            <Badge tone={`state-${view.status}`}>{view.statusLabel}</Badge>
          </div>
          <p>
            {outcome === "contextual"
              ? <><strong>Contextual version.</strong> The paper&rsquo;s own results are not updated. Related observations appear separately beside the text.</>
              : <><strong>{live} of {analysis.parameters.length} measured claims are tracked.</strong> {outcome === "partial" && "The paper as a whole is not continuously updated. "}Everything else stays as published.</>}
            {" "}The original text is never rewritten. Sources are annual: this is not real-time data.
          </p>
          <dl className="retrieval">
            <div><dt>Last successful data retrieval</dt><dd>{fmtDate(view.lastSuccessAt, true)}</dd></div>
            <div><dt>Last attempted refresh</dt><dd>{fmtDate(view.lastAttemptAt, true)}</dd></div>
            <div><dt>{view.preview ? "State" : "Page version"}</dt><dd>{view.preview ? "Unpublished preview" : `v${view.version}, ${fmtDate(view.publishedAt, true)}`}</dd></div>
          </dl>
          {view.providerNote && <p className="small">{view.providerNote}</p>}
        </div>
        <p className="actions">
          {!view.preview && <><button type="button" onClick={share}>Share</button><button type="button" onClick={copy}>Copy link</button></>}
          <a href={originalHref}>Download original ({view.fileKind.toUpperCase()})</a>
          <a href="#evidence">Evidence &amp; methodology</a>
          <a href="#history">Update history</a>
          <span role="status">{copied}</span>
        </p>
        <p className="key"><span className="claim-live">●</span> tracked <span className="claim-contextual">◐</span> context only <span className="claim-static">○</span> static, with reason</p>
      </header>

      <div className="columns">
        <main id="content" className="article">
          <p className="original-label">The original paper</p>
          {doc.fidelity.length > 0 && <aside className="annotation"><b>Reproduction note</b> {doc.fidelity.join(" ")}</aside>}
          {body.map((b) => <ArticleBlock key={b.id} block={b} marks={marks.get(b.id) ?? []} onMark={onMark} active={active} />)}
          {doc.references.length === 0 && <aside className="annotation"><b>Note</b> No reference list was identified in the document.</aside>}
          <p className="original-label end">End of the original paper. Everything below was added by Live Research Paper.</p>

          <section id="evidence" data-section="evidence" className="appendix">
            <h2>Evidence and methodology</h2>
            <p>Mappings are made by deterministic rules against a curated catalogue, then tested on real source responses. The main test compares the source&rsquo;s value for the paper&rsquo;s own year with the paper&rsquo;s figure. {analysis.tools.gemini === "Not configured. Rule-based extraction only." ? "No AI model was used." : `AI assistance: ${analysis.tools.gemini}`} No AI-generated commentary appears on this page.</p>
            <h3>Tracked and contextual parameters</h3>
            {metrics.length === 0 ? <p>None.</p> : (
              <div className="scroll"><table>
                <thead><tr><th>Parameter</th><th>Paper</th><th>Latest</th><th>Source</th><th>Transformation</th><th></th></tr></thead>
                <tbody>{metrics.map((m) => (
                  <tr key={m.id}>
                    <th scope="row">{m.name}<small>{m.geography} · {m.mode === "live" ? "tracked" : "context only"}</small></th>
                    <td>{m.originalRaw}{m.paperYear ? ` (${m.paperYear})` : ""}</td>
                    <td>{m.latest ? `${fmtNumber(m.latest.value)} ${m.unit} (${m.latest.period})` : "—"}</td>
                    <td><code>{m.source.indicatorCode}</code><small>{m.source.provider}</small></td>
                    <td>{m.calculation ? m.calculation.formula : "none"}</td>
                    <td><button type="button" onClick={() => setOpen(m.id)}>Inspect</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <h3>What is not updated, and why</h3>
            {statics.length === 0 ? <p>Every measured claim that was identified is listed above.</p> : (
              <ul>{statics.map((s) => <li key={s.id}><Badge tone={s.status}>{STATUS_WORD[s.status]}</Badge> <strong>{s.raw}</strong> ({s.name}). {s.reason}</li>)}</ul>
            )}
            <details>
              <summary>All {analysis.claims.length} numbers found in the paper and how each was classified</summary>
              <div className="scroll"><table>
                <thead><tr><th>As written</th><th>Class</th><th>Reason</th></tr></thead>
                <tbody>{analysis.claims.map((c) => <tr key={c.id}><td>{c.raw}</td><td>{c.classification}</td><td>{c.classificationReason}</td></tr>)}</tbody>
              </table></div>
            </details>
            <h3>Limitations and uncertainty</h3>
            <ul>
              {analysis.eligibility.limitations.map((l) => <li key={l}>{l}</li>)}
              <li>Sources publish estimates, many of them modelled, and revise them. No confidence intervals are shown because none were retrieved.</li>
              <li>Later observations do not confirm or refute the paper&rsquo;s interpretations, and no statistical significance or causation is implied.</li>
              <li>No forecasts are produced by this application.</li>
            </ul>
            <h3>Scholarly record (OpenAlex)</h3>
            <p>{analysis.enrichment.detail} <small>Checked {fmtDate(analysis.enrichment.retrievedAt)}.</small></p>
            {analysis.enrichment.record && <p>{analysis.enrichment.record.title} — {analysis.enrichment.record.venue || "venue not listed"}, {analysis.enrichment.record.year}. Cited by {analysis.enrichment.record.citedByCount} (at retrieval). Match basis: {analysis.enrichment.matchBasis}, confidence {analysis.enrichment.confidence}.</p>}
            {analysis.enrichment.conflicts.map((c) => <p key={c} className="warn">{c}</p>)}
            <p className="small">Extracted-text hash <code>{view.documentHash.slice(0, 32)}</code><br />Original file hash <code>{view.fileHash.slice(0, 32)}</code></p>
          </section>

          <section id="history" data-section="history" className="appendix">
            <h2>Update history</h2>
            <p className="small">Only real events: publications, editorial decisions, changes in source data and failed attempts. Checks that found nothing new add no entry. Checks run every {view.refreshIntervalHours} hours at most.</p>
            {view.history.length === 0 ? <p>No events recorded yet.</p> : (
              <ol className="history">{view.history.map((h) => (
                <li key={h.id}>
                  <time dateTime={h.at}>{fmtDate(h.at, true)}</time>
                  <Badge tone={h.outcome === "failed" ? "rejected" : "kind"}>{h.type} · {h.outcome.replace("_", " ")}</Badge>
                  <p>{h.note}
                    {h.oldValue !== null && <> Old: {fmtNumber(h.oldValue)}.</>}
                    {h.newValue !== null && <> {h.oldValue !== null ? "New" : "Value"}: {fmtNumber(h.newValue)}{h.period ? ` (${h.period})` : ""}.</>}
                  </p>
                  <small>{[h.seriesKey, h.sourceVersion && `dataset ${h.sourceVersion}`, h.calcVersion && `calculation v${h.calcVersion}`].filter(Boolean).join(" · ")}</small>
                </li>
              ))}</ol>
            )}
          </section>
        </main>

        <aside ref={dock} className={`dock${sheet ? " is-open" : ""}`} aria-label="Key indicators">
          <button type="button" className="dock-toggle" aria-expanded={sheet} onClick={() => setSheet(!sheet)}>
            <span>Metrics for this section ({visible.length})</span><span aria-hidden>{sheet ? "▾" : "▴"}</span>
          </button>
          <div className="dock-body">
            <div className="dock-head">
              <p aria-live="polite">{dockNote}</p>
              {metrics.length > visible.length || showAll ? <button type="button" aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? "Follow sections" : `All (${metrics.length})`}</button> : null}
            </div>
            {visible.map((m) => <MetricCard key={m.id} m={m} active={active === m.id} onOpen={() => setOpen(m.id)} />)}
            {!metrics.length && <p className="note">This paper has no tracked parameters.</p>}
          </div>
        </aside>
      </div>

      {opened && <Details m={opened} all={metrics} onClose={() => setOpen(null)} />}
      {explaining && (
        <div className="toast" role="dialog" aria-label="Why this figure is static">
          <Badge tone={explaining.status}>{STATUS_WORD[explaining.status]}</Badge>
          <p><strong>{explaining.raw}</strong> stays as published. {explaining.reason}</p>
          <button type="button" onClick={() => setExplaining(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
