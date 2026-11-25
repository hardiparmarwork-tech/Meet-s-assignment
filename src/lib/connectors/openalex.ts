import { safeFetch, type FetchOptions } from "../safeFetch";
import { parseJson } from "./worldbank";
import type { Enrichment, Metadata } from "../types";

const BASE = "https://api.openalex.org";
const SELECT = "id,doi,title,publication_year,authorships,primary_location,cited_by_count,topics";

interface Work {
  id: string; doi: string | null; title: string | null; publication_year: number | null; cited_by_count: number;
  authorships?: { author: { display_name: string } }[];
  primary_location?: { source?: { display_name?: string } | null } | null;
  topics?: { display_name: string }[];
}

export const normalizeTitle = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

// Only whitelisted fields are read. Anything else in a response (including free-text notices) is ignored.
function record(w: Work): NonNullable<Enrichment["record"]> {
  return {
    title: w.title ?? "", year: w.publication_year, doi: (w.doi ?? "").replace("https://doi.org/", ""),
    authors: (w.authorships ?? []).slice(0, 20).map((a) => a.author.display_name),
    venue: w.primary_location?.source?.display_name ?? "", citedByCount: w.cited_by_count,
    topics: (w.topics ?? []).slice(0, 3).map((t) => t.display_name),
  };
}

function conflicts(doc: Metadata, r: NonNullable<Enrichment["record"]>): string[] {
  const out: string[] = [];
  if (r.title && doc.title && normalizeTitle(r.title) !== normalizeTitle(doc.title)) out.push(`Title differs: OpenAlex has "${r.title}".`);
  if (r.year && doc.year && r.year !== doc.year) out.push(`Year differs: document ${doc.year}, OpenAlex ${r.year}.`);
  return out;
}

export async function enrich(meta: Metadata, o: FetchOptions = {}): Promise<Enrichment> {
  const base = { provider: "OpenAlex" as const, retrievedAt: new Date().toISOString(), conflicts: [] as string[] };
  const key = process.env.OPENALEX_API_KEY;
  const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  try {
    if (/^10\.\d{4,9}\/\S+$/.test(meta.doi)) {
      try {
        const res = await safeFetch(`${BASE}/works/https://doi.org/${encodeURI(meta.doi)}?select=${SELECT}`, { ...o, headers, retries: 1 });
        const w = parseJson(res.text) as Work;
        const r = record(w);
        const same = normalizeTitle(r.title) === normalizeTitle(meta.title);
        return { ...base, status: "matched", matchBasis: "doi", confidence: same ? "high" : "medium", workId: w.id, record: r,
          conflicts: conflicts(meta, r), detail: same ? "Matched by DOI; titles agree." : "Matched by DOI, but titles differ. Check that the DOI belongs to this paper." };
      } catch (e) {
        if ((e as { status?: number }).status !== 404) throw e;
      }
    }
    if (normalizeTitle(meta.title).split(" ").length < 4) {
      return { ...base, status: "skipped", detail: "Title too short for a reliable title match." };
    }
    const q = encodeURIComponent(normalizeTitle(meta.title));
    const res = await safeFetch(`${BASE}/works?search=${q}&per_page=5&select=${SELECT}`, { ...o, headers, retries: 1 });
    const works = ((parseJson(res.text) as { results?: Work[] }).results ?? [])
      .filter((w) => normalizeTitle(w.title ?? "") === normalizeTitle(meta.title))
      .filter((w) => !meta.year || !w.publication_year || Math.abs(w.publication_year - meta.year) <= 1);
    if (works.length !== 1) {
      return { ...base, status: "no_reliable_match", detail: works.length ? "Several works share this exact title; none was selected." : "No work with an exactly matching title was found. Nothing was filled in." };
    }
    const r = record(works[0]);
    return { ...base, status: "matched", matchBasis: "exact-title", confidence: "medium", workId: works[0].id, record: r,
      conflicts: conflicts(meta, r), detail: "Matched on exact title. Document metadata was not overwritten." };
  } catch (e) {
    return { ...base, status: "unavailable", detail: `OpenAlex could not be queried: ${(e as Error).message}` };
  }
}
