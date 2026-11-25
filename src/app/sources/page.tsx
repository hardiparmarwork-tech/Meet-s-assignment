import { cachedCatalogue, SERVICES, verifyCatalogue } from "@/lib/capabilities";
import { INDICATORS } from "@/lib/mapping/concepts";
import { isAuthed } from "@/lib/server/guard";
import { ActionButton } from "@/components/Actions";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data sources" };

let first: Promise<unknown> | null = null;

export default async function Sources() {
  const report = cachedCatalogue();
  // First visit after deployment: verify in the background.
  if (!report) first ??= verifyCatalogue().finally(() => { first = null; });
  const authed = await isAuthed();
  return (
    <main id="content" className="page">
      <h1>API capability catalogue</h1>
      <p>The configured repository (<a href="https://github.com/nagdasmriti-alt/API-links" target="_blank" rel="noreferrer">nagdasmriti-alt/API-links</a>) contains one file of documentation links: GROBID, OpenAlex (listed twice, treated as one), World Bank, Our World in Data and Gemini. It contains no endpoints, code or keys, so each capability below was established from provider documentation and live requests.</p>
      <p className="note">{report ? `Last live verification ${fmtDate(report.checkedAt, true)} (probe geography ${report.probeGeography}).` : "Verification is running; reload in a few seconds."}</p>
      {authed && <ActionButton url="/api/catalogue">Verify again now</ActionButton>}
      {SERVICES.map((s) => {
        const health = report?.services[s.id];
        return (
          <section key={s.id} className="service">
            <h2>{s.provider} <small>{s.role}</small> <span className={`badge badge-${health?.state === "ok" ? "verified" : health?.state === "failed" ? "rejected" : "kind"}`}>{health?.state.replace("_", " ") ?? "pending"}</span></h2>
            {health && <p className="small">{health.detail}</p>}
            <dl className="facts">
              <dt>Statistical observations</dt><dd>{s.statistics ? "Yes" : "No"}</dd>
              <dt>Base URL</dt><dd><code>{s.baseUrl}</code></dd>
              <dt>Endpoints used</dt><dd>{s.endpoints.map((e) => <div key={e}><code>{e}</code></div>)}</dd>
              <dt>Returns</dt><dd>{s.returns}</dd><dt>Coverage</dt><dd>{s.coverage}</dd><dt>Cadence</dt><dd>{s.cadence}</dd><dt>Query pattern</dt><dd>{s.query}</dd>
              <dt>Authentication</dt><dd>{s.auth}</dd><dt>Limits</dt><dd>{s.limits}</dd><dt>Licence</dt><dd>{s.licence}</dd><dt>Restrictions</dt><dd>{s.restrictions}</dd>
              <dt>Documentation</dt><dd><a href={s.docs} target="_blank" rel="noreferrer">{s.docs}</a></dd>
            </dl>
          </section>
        );
      })}
      <h2>Mapped indicators ({INDICATORS.length})</h2>
      <p>This list is the eligibility surface. A paper can only be tracked against these.</p>
      <div className="scroll"><table>
        <thead><tr><th>Indicator</th><th>ID</th><th>Coverage ({report?.probeGeography ?? "probe"})</th><th>Provider updated</th><th>Check</th></tr></thead>
        <tbody>{INDICATORS.map((i) => { const v = report?.indicators[i.id]; return <tr key={i.id}><th scope="row">{i.name}<small>{i.definition}</small></th><td><code>{i.id}</code></td><td>{v?.first ? `${v.first}–${v.latest}, annual` : "—"}</td><td>{v?.providerUpdated ?? "—"}</td><td>{v ? (v.state === "ok" ? "✓ verified" : `✕ ${v.detail}`) : "pending"}</td></tr>; })}</tbody>
      </table></div>
    </main>
  );
}
