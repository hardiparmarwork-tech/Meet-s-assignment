import Link from "next/link";
import { requireAuth } from "@/lib/server/guard";
import { getSeries, latestVersion, listHistory, listPapers } from "@/lib/db";
import { keyOf, trackedParameters } from "@/lib/series";
import { liveStatus, STATUS_LABEL } from "@/lib/view";
import { lastScheduledRun, schedulerEnabled } from "@/lib/refresh";
import { ActionButton, SignOut } from "@/components/Actions";
import { fmtDate } from "@/lib/format";
import type { Paper, SeriesRecord } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard", robots: { index: false } };

const VIEWS: Record<string, string> = { all: "All", drafts: "Drafts", published: "Published", partial: "Partial matches", failed: "Failures", archived: "Archived" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireAuth("/dashboard");
  const view = (await searchParams).view ?? "all";
  const rows = listPapers().map((paper) => {
    const analysis = (paper.state === "published" ? latestVersion(paper.id)?.analysis : paper.analysis) ?? paper.analysis;
    const series = analysis ? [...new Set(trackedParameters(analysis.parameters).map(keyOf))].map((k) => getSeries(k ?? "")).filter(Boolean) as SeriesRecord[] : [];
    return { paper, analysis, series, failures: series.filter((s) => s.lastError), status: liveStatus(paper.state, series, paper.settings.refreshIntervalHours) };
  });
  const filters: Record<string, (r: (typeof rows)[number]) => boolean> = {
    all: () => true,
    drafts: (r) => !r.paper.slug && r.paper.state !== "archived",
    published: (r) => r.paper.state === "published",
    partial: (r) => r.analysis?.eligibility.outcome === "partial",
    failed: (r) => r.paper.state === "failed" || r.failures.length > 0,
    archived: (r) => r.paper.state === "archived",
  };
  const shown = rows.filter(filters[view] ?? filters.all);
  const sources = [...new Map(rows.flatMap((r) => r.series).map((s) => [s.key, s])).values()];
  const titles = new Map(rows.map((r) => [r.paper.id, r.analysis ? (latestVersion(r.paper.id)?.metadata.title ?? r.paper.fileName) : r.paper.fileName]));
  const last = lastScheduledRun();
  const title = (p: Paper) => p.overrides.title ?? titles.get(p.id)!;

  return (
    <main id="content" className="page">
      <div className="head-row"><h1>Dashboard</h1><div className="actions"><Link className="button primary" href="/builder">New paper</Link><SignOut /></div></div>
      <p className="note">Scheduler: {schedulerEnabled() ? "on while this server process is running (checks every 15 minutes for series that are due)" : "off — refresh manually or call the cron endpoint"}.{last ? ` Last scheduled run ${fmtDate(last.at, true)}: ${last.requested} due, ${last.failed} failed.` : " No scheduled run recorded yet."}</p>
      <nav className="tabs" aria-label="Filter papers">{Object.entries(VIEWS).map(([k, label]) => <Link key={k} href={`/dashboard?view=${k}`} aria-current={view === k ? "page" : undefined}>{label} ({rows.filter(filters[k]).length})</Link>)}</nav>
      {shown.length === 0 ? <p className="empty">Nothing here.</p> : (
        <ul className="records">
          {shown.map(({ paper, analysis, failures, status }) => (
            <li key={paper.id}>
              <h2>{title(paper)}{paper.isDemo && <span className="badge badge-demo">Demonstration</span>}</h2>
              <p className="meta-line"><span>{paper.state}</span>{analysis && <span>{analysis.eligibility.label}</span>}{paper.slug && <span>{STATUS_LABEL[status]}</span>}<span>{paper.fileName}</span><span>Updated {fmtDate(paper.updatedAt, true)}</span></p>
              {paper.error && <p className="warn">{paper.error}</p>}
              {failures.map((f) => <p key={f.key} className="warn"><code>{f.key}</code>: {f.lastError} Attempted {fmtDate(f.lastAttemptAt, true)}; last success {fmtDate(f.lastSuccessAt, true)}.</p>)}
              <div className="actions">
                {analysis ? <Link href={`/preview/${paper.id}`}>Preview &amp; edit</Link> : <Link href={`/builder/${paper.id}`}>Processing status</Link>}
                {paper.slug && <Link href={`/research/${paper.slug}`}>Open published page</Link>}
                {paper.slug && <Link href={`/research/${paper.slug}#history`}>History</Link>}
                {!paper.slug && analysis && analysis.eligibility.outcome !== "not_eligible" && <ActionButton url={`/api/papers/${paper.id}/publish`}>Publish</ActionButton>}
                {analysis && paper.state !== "archived" && <ActionButton url={`/api/papers/${paper.id}/refresh`} result="refresh">Refresh sources</ActionButton>}
                {paper.state !== "archived" ? <ActionButton url={`/api/papers/${paper.id}/archive`} body={{ archived: true }} confirm="Archive this paper? It leaves the public archive and stops scheduled refreshes. Its link keeps working.">Archive</ActionButton>
                  : <ActionButton url={`/api/papers/${paper.id}/archive`} body={{ archived: false }}>Restore</ActionButton>}
                {!paper.slug && <ActionButton url={`/api/papers/${paper.id}`} method="DELETE" confirm={`Permanently delete the draft “${title(paper)}” and its uploaded file? This cannot be undone.`}>Delete draft</ActionButton>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <h2>Tracked sources ({sources.length})</h2>
      {sources.length === 0 ? <p>No sources are in use.</p> : (
        <div className="scroll"><table><thead><tr><th>Series</th><th>Latest period</th><th>Last success</th><th>Last attempt</th><th>State</th></tr></thead>
          <tbody>{sources.map((s) => <tr key={s.key}><th scope="row"><code>{s.key}</code></th><td>{s.observations.at(-1)?.period ?? "—"}</td><td>{fmtDate(s.lastSuccessAt, true)}</td><td>{fmtDate(s.lastAttemptAt, true)}</td><td>{s.lastError ?? "OK"}</td></tr>)}</tbody></table></div>
      )}
      <h2>Recent activity</h2>
      <ol className="history">{listHistory(undefined, 25).map((h) => <li key={h.id}><time dateTime={h.at}>{fmtDate(h.at, true)}</time><span className="badge badge-kind">{h.type} · {h.outcome.replace("_", " ")}</span><p><strong>{titles.get(h.paperId) ?? "Deleted draft"}:</strong> {h.note}</p></li>)}</ol>
    </main>
  );
}
