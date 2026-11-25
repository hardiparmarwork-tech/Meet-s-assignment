"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Eligibility, Issue, Paper } from "@/lib/types";
import type { Gate } from "@/lib/publish";
import { Badge, STATUS_WORD } from "./Publication";

const ACCEPT = [".pdf", ".docx", ".txt", ".md", ".markdown"];
const LIMIT = 15 * 1024 * 1024;
const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export function Uploader({ geminiOn }: { geminiOn: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);

  const upload = (f: File) => {
    setFile(f);
    setError("");
    if (!ACCEPT.some((e) => f.name.toLowerCase().endsWith(e))) return setError("Unsupported file type. Choose a PDF, DOCX, TXT or Markdown file.");
    if (f.size > LIMIT) return setError("The file is larger than the 15 MB limit.");
    const data = new FormData();
    data.append("file", f);
    const xhr = new XMLHttpRequest(); // reports real bytes sent
    xhr.upload.onprogress = (e) => e.lengthComputable && setSent(Math.min(e.loaded, f.size));
    xhr.onload = () => {
      let body: { id?: string; error?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 202 && body.id) router.push(`/builder/${body.id}`);
      else { setSent(null); setError(body.error ?? `Upload failed (HTTP ${xhr.status}).`); }
    };
    xhr.onerror = () => { setSent(null); setError("The upload could not reach the server. Check your connection and try again."); };
    setSent(0);
    xhr.open("POST", "/api/papers");
    xhr.send(data);
  };

  return (
    <>
      <div className={`drop${drag ? " is-drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}>
        <p>Drop a paper here</p>
        <button type="button" className="primary" onClick={() => input.current?.click()} disabled={sent !== null}>Browse files</button>
        <input ref={input} type="file" accept={ACCEPT.join(",")} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        <p className="small">PDF, DOCX, TXT or Markdown · up to 15 MB · text-based PDFs only (no OCR)</p>
      </div>
      {file && (
        <div className="file-row" role="status">
          <strong>{file.name}</strong> <span>{size(file.size)} · {file.name.split(".").pop()?.toUpperCase()}</span>
          {sent !== null && <><progress value={sent} max={file.size} /> <span>{sent >= file.size ? "Uploaded. Starting…" : `${size(sent)} of ${size(file.size)} sent`}</span></>}
        </div>
      )}
      {error && <p className="warn" role="alert">{error}</p>}
      {geminiOn && <p className="note">Gemini is configured: excerpts containing unmatched numbers will be sent to Google for suggestions.</p>}
    </>
  );
}

type Status = Omit<Paper, "analysis"> & {
  eligibility: Eligibility | null;
  parameters: { id: string; name: string; raw: string; status: string; reason: string; geography: string | null; selected: string | null; decision: string | null }[];
  issues: Issue[];
  gate: Gate | null;
};

export function Processing({ id }: { id: string }) {
  const router = useRouter();
  const [paper, setPaper] = useState<Status | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/papers/${id}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setPaper(body);
      setError("");
      return body as Status;
    } catch (e) {
      setError(`Could not read the processing status: ${(e as Error).message}`);
      return null;
    }
  }, [id]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const p = await load();
      if (!stop && (!p || p.state === "processing")) timer = setTimeout(poll, 1200);
    };
    void poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [load]);

  const retry = async () => {
    const res = await fetch(`/api/papers/${id}/retry`, { method: "POST" });
    if (!res.ok) return setError((await res.json()).error);
    location.reload();
  };

  if (!paper) return <p role="status">{error || "Loading…"}</p>;
  const e = paper.eligibility;
  const partialFailure = paper.parameters.some((p) => p.status === "unsupported" && /could not be retrieved/.test(p.reason));
  return (
    <>
      <p className="file-row"><strong>{paper.fileName}</strong> <span>{size(paper.fileSize)} · {paper.fileKind.toUpperCase()}</span></p>
      <ol className="timeline" aria-live="polite">
        {paper.stages.map((s) => (
          <li key={s.key} className={`stage-${s.state}`}>
            <b aria-hidden>{s.state === "done" ? "✓" : s.state === "failed" ? "✕" : s.state === "running" ? "…" : "○"}</b>
            <div><strong>{s.label}</strong> <span className="sr-only">{s.state}</span>{s.detail && <p>{s.detail}</p>}</div>
          </li>
        ))}
      </ol>
      {paper.state === "processing" && <p className="note">You can leave this page; processing continues on the server and the paper stays in your dashboard.</p>}
      {error && <p className="warn" role="alert">{error}</p>}
      {paper.state === "failed" && (
        <div className="status-panel outcome-not_eligible" role="alert">
          <p><strong>Processing failed.</strong> {paper.error}</p>
          <p className="actions"><button type="button" className="primary" onClick={retry}>Retry processing</button><Link href="/builder">Upload a different file</Link></p>
        </div>
      )}
      {e && paper.state !== "processing" && (
        <section className={`status-panel outcome-${e.outcome}`}>
          <Badge tone={e.outcome}>{e.label}</Badge>
          <ul>{e.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <dl className="retrieval">
            <div><dt>Live</dt><dd>{e.counts.live}</dd></div>
            <div><dt>Context only</dt><dd>{e.counts.contextual}</dd></div>
            <div><dt>Needs review</dt><dd>{e.counts.review}</dd></div>
            <div><dt>Unsupported or rejected</dt><dd>{e.counts.unsupported + e.counts.rejected}</dd></div>
            <div><dt>Numbers examined</dt><dd>{e.counts.allNumbers}</dd></div>
          </dl>
          {paper.issues.filter((i) => i.severity !== "note").map((i, n) => <p key={n} className="warn">{i.severity === "blocking" ? "Blocking: " : "Flagged: "}{i.message}</p>)}
          {paper.parameters.length > 0 && (
            <details>
              <summary>Matched and unsupported parameters ({paper.parameters.length})</summary>
              <ul>{paper.parameters.map((p) => <li key={p.id}><Badge tone={p.status}>{STATUS_WORD[p.status]}</Badge> <strong>{p.raw}</strong> {p.name}{p.geography ? `, ${p.geography}` : ""}{p.selected ? <> — <code>{p.selected}</code></> : null}. {p.reason}</li>)}</ul>
            </details>
          )}
          <p className="actions">
            <button type="button" className="primary" onClick={() => router.push(`/preview/${id}`)}>Preview publication</button>
            {partialFailure && !paper.slug && <button type="button" onClick={retry}>Retry failed source retrievals</button>}
          </p>
          {e.outcome === "not_eligible" && <p><strong>This paper cannot be published as a live paper.</strong> The preview shows why.</p>}
        </section>
      )}
    </>
  );
}
