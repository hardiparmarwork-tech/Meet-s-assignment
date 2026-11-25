"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Issue, MetaOverrides, Parameter } from "@/lib/types";
import type { Gate } from "@/lib/publish";
import { Badge, STATUS_WORD } from "./Publication";

interface Props {
  id: string;
  gate: Gate;
  outcomeLabel: string;
  reasons: string[];
  issues: Issue[];
  parameters: Parameter[];
  metadata: Required<Omit<MetaOverrides, "year">> & { year: number | null };
  refreshIntervalHours: number;
  slug: string | null;
  tools: Record<string, string>;
  enrichment: string;
}

export function PreviewControls(props: Props) {
  const { id, gate, parameters, issues, metadata } = props;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [review, setReview] = useState(false);
  const [choice, setChoice] = useState<Record<string, string>>({});

  const call = async (path: string, body?: unknown) => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/papers/${id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      return json;
    } catch (e) {
      setMessage((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    const result = await call("publish");
    if (result) router.push(`/research/${result.slug}`);
  };
  const decide = async (parameterId: string, action: string, indicatorId?: string) => {
    if (await call("review", { type: "parameter", parameterId, action, indicatorId })) router.refresh();
  };
  const refresh = async () => {
    const r = await call("refresh");
    if (r) { setMessage(`Refresh finished: ${r.succeeded} of ${r.requested} series retrieved, ${r.changes} data change(s).`); router.refresh(); }
  };

  const flagged = issues.filter((i) => i.severity !== "note");
  const failed = gate.checks.filter((c) => !c.ok);
  return (
    <div className="preview-bar">
      <div className="preview-row">
        <div>
          <strong>Preview</strong> · {props.outcomeLabel}
          {flagged.length > 0 && <> · <span className="warn-inline">{flagged.length} item(s) flagged</span></>}
        </div>
        <div className="actions">
          <button type="button" onClick={() => setReview(!review)} aria-expanded={review}>Review technical details</button>
          <button type="button" onClick={refresh} disabled={busy}>Refresh source data</button>
          <Link href={`/builder/${id}`}>Back to processing</Link>
          <button type="button" className="primary" onClick={publish} disabled={busy || !gate.canPublish}>
            {gate.mode === "contextual" ? "Publish contextual version" : props.slug ? "Publish new version" : "Publish"}
          </button>
        </div>
      </div>
      {!gate.canPublish && <p className="warn" role="alert">Publishing is disabled. {failed.map((c) => `${c.name}: ${c.detail}`).join(" ")} {props.reasons.join(" ")}</p>}
      {gate.canPublish && gate.mode === "contextual" && <p className="warn">This will be labelled a contextual version. It does not claim the research is live.</p>}
      {gate.canPublish && props.outcomeLabel.includes("partial") && <p className="warn">Partial match: the published page states which figures are tracked and which stay static.</p>}
      {message && <p role="status" className="note">{message}</p>}
      {review && (
        <div className="review">
          <p className="note">Optional. Publishing does not require anything here. Items flagged for review stay static unless approved.</p>
          {flagged.map((i, n) => <p key={n} className="warn">{i.message}</p>)}
          <h2>Integrity checks</h2>
          <ul className="checks">{gate.checks.map((c) => <li key={c.name} className={`check-${c.ok ? "pass" : "fail"}`}><b>{c.ok ? "✓" : "✕"}</b><span><strong>{c.name}</strong> {c.detail}</span></li>)}</ul>
          <h2>Source mappings</h2>
          {parameters.map((p) => {
            const options = p.candidates.filter((c) => (c.status === "review" || c.status === "verified") && !c.checks.some((k) => k.result === "fail"));
            const selected = choice[p.id] ?? p.selectedIndicatorId ?? "";
            return (
              <details key={p.id} open={p.status === "review" && !p.authorDecision}>
                <summary><Badge tone={p.status}>{STATUS_WORD[p.status]}</Badge> <strong>{p.originalRaw}</strong> {p.name}{p.authorDecision ? ` — author: ${p.authorDecision.action}d` : ""}</summary>
                <p className="quote">&ldquo;{p.sentence}&rdquo;</p>
                <p>{p.statusReason}</p>
                {p.candidates.map((c) => (
                  <div key={c.indicatorId} className="candidate">
                    <label>
                      {p.status === "review" && options.includes(c) && <input type="radio" name={p.id} checked={selected === c.indicatorId} onChange={() => setChoice({ ...choice, [p.id]: c.indicatorId })} />}
                      <code>{c.indicatorId}</code> — {STATUS_WORD[c.status]}
                    </label>
                    <ul className="checks">{c.checks.map((k, n) => <li key={n} className={`check-${k.result}`}><b>{k.result === "pass" ? "✓" : k.result === "warn" ? "!" : "✕"}</b><span><strong>{k.dimension}</strong> {k.detail}</span></li>)}</ul>
                  </div>
                ))}
                <p className="actions">
                  {p.status === "review" && options.length > 0 && p.authorDecision?.action !== "approve" && <button type="button" disabled={busy || !selected} onClick={() => decide(p.id, "approve", selected)}>Approve selected source</button>}
                  {p.authorDecision?.action !== "exclude" && p.selectedIndicatorId && <button type="button" disabled={busy} onClick={() => decide(p.id, "exclude")}>Exclude from tracking</button>}
                  {p.authorDecision && <button type="button" disabled={busy} onClick={() => decide(p.id, "reset")}>Undo decision</button>}
                </p>
              </details>
            );
          })}
          <h2>Metadata and refresh</h2>
          <p className="note">Edits are shown as edits. The extracted original is never changed.</p>
          <form className="meta-form" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const s = (k: string) => String(f.get(k) ?? "").trim();
            const ok = await call("review", {
              type: "metadata",
              patch: { title: s("title"), authors: s("authors").split(";").map((a) => a.trim()).filter(Boolean), year: s("year") ? Number(s("year")) : null, publisher: s("publisher"), doi: s("doi"), originalUrl: s("originalUrl"), abstract: s("abstract") },
              refreshIntervalHours: Number(s("interval")),
            });
            if (ok) { setMessage("Saved."); router.refresh(); }
          }}>
            <label>Title<input name="title" defaultValue={metadata.title} /></label>
            <label>Authors (separate with ;)<input name="authors" defaultValue={metadata.authors.join("; ")} /></label>
            <label>Publication year<input name="year" type="number" defaultValue={metadata.year ?? ""} /></label>
            <label>Publisher<input name="publisher" defaultValue={metadata.publisher} /></label>
            <label>DOI<input name="doi" defaultValue={metadata.doi} /></label>
            <label>Original URL<input name="originalUrl" defaultValue={metadata.originalUrl} /></label>
            <label className="wide">Abstract<textarea name="abstract" rows={4} defaultValue={metadata.abstract} /></label>
            <label>Check sources every
              <select name="interval" defaultValue={props.refreshIntervalHours}>
                <option value="24">day</option><option value="168">week</option><option value="720">30 days</option>
              </select>
            </label>
            <button type="submit" disabled={busy}>Save</button>
          </form>
          <p className="small">Parser: {props.tools.parser}. Gemini: {props.tools.gemini} GROBID: {props.tools.grobid} OpenAlex: {props.enrichment}</p>
        </div>
      )}
    </div>
  );
}
