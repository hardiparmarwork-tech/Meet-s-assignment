import Link from "next/link";
import { archiveRecords, queryArchive, type ArchiveQuery } from "@/lib/archive";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Archive" };

export default async function Archive({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const query: ArchiveQuery = { q: sp.q, domain: sp.domain, year: sp.year, status: sp.status, sort: sp.sort, page: Number(sp.page) };
  const all = archiveRecords();
  const r = queryArchive(all, query);
  const href = (page: number) => `/archive?${new URLSearchParams(Object.entries({ ...sp, page: String(page) }).filter(([, v]) => v) as [string, string][])}`;
  const select = (name: string, label: string, options: (string | number)[]) => (
    <label>{label}
      <select name={name} defaultValue={sp[name] ?? ""}><option value="">All</option>{options.map((o) => <option key={o} value={o}>{String(o).replace("_", " ")}</option>)}</select>
    </label>
  );
  return (
    <main id="content" className="page">
      <h1>Archive</h1>
      <form className="filters" method="get" action="/archive">
        <label className="grow">Search<input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Title, author, abstract or domain" /></label>
        {select("domain", "Domain", r.domains)}
        {select("year", "Original year", r.years)}
        {select("status", "Live status", r.statuses)}
        <label>Sort<select name="sort" defaultValue={sp.sort ?? "newest"}><option value="newest">Newest published</option><option value="updated">Recently retrieved</option><option value="year">Original year</option><option value="title">Title</option></select></label>
        <button type="submit">Apply</button>
      </form>
      <p className="small" role="status">{r.total} of {all.length} published paper(s)</p>
      {r.items.length === 0 && (
        <div className="empty">
          {all.length === 0 ? <p>No papers have been published yet. <Link href="/builder">Upload the first one.</Link></p> : <p>No published paper matches these filters. <Link href="/archive">Clear filters</Link></p>}
        </div>
      )}
      <ul className="records">
        {r.items.map((p) => (
          <li key={p.slug}>
            <h2><Link href={`/research/${p.slug}`}>{p.title}</Link>{p.isDemo && <span className="badge badge-demo">Demonstration</span>}</h2>
            <p className="authors">{p.authors.join(", ") || "Authors not identified"}</p>
            <p>{p.summary || "No abstract was identified."}</p>
            <p className="meta-line">
              <span>{p.domains.join(", ") || "No domain"}</span><span>Original {p.year ?? "year not stated"}</span><span>Converted {fmtDate(p.convertedAt)}</span>
              <span>Last successful retrieval {fmtDate(p.lastSuccessAt)}</span><span>{p.tracked} tracked parameter(s)</span><span>{p.eligibility}</span><span>{p.statusLabel}</span>
            </p>
          </li>
        ))}
      </ul>
      {r.pages > 1 && <nav className="pager" aria-label="Pagination">{r.page > 1 && <Link href={href(r.page - 1)}>← Previous</Link>}<span>Page {r.page} of {r.pages}</span>{r.page < r.pages && <Link href={href(r.page + 1)}>Next →</Link>}</nav>}
    </main>
  );
}
