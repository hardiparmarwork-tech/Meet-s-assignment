import { latestVersion, listPapers } from "./db";
import { publicationView } from "./view";
import { OUTCOME_LABEL } from "./eligibility";
import type { LiveStatus } from "./types";

export interface ArchiveRecord {
  slug: string; title: string; summary: string; authors: string[]; domains: string[]; year: number | null; convertedAt: string;
  publishedAt: string; lastSuccessAt: string | null; status: LiveStatus; statusLabel: string; tracked: number; eligibility: string; isDemo: boolean;
}

/** Only published papers. Every field comes from stored records. */
export function archiveRecords(): ArchiveRecord[] {
  return listPapers().filter((p) => p.state === "published" && latestVersion(p.id)).map((p) => {
    const v = publicationView(p, false)!;
    const text = v.metadata.abstract;
    return {
      slug: p.slug!, title: v.metadata.title, summary: text.length > 320 ? `${text.slice(0, 317).trimEnd()}…` : text,
      authors: v.metadata.authors, domains: v.analysis.domain, year: v.metadata.year, convertedAt: p.createdAt, publishedAt: v.publishedAt!,
      lastSuccessAt: v.lastSuccessAt, status: v.status, statusLabel: v.statusLabel, tracked: v.metrics.filter((m) => m.mode === "live").length,
      eligibility: OUTCOME_LABEL[v.analysis.eligibility.outcome], isDemo: p.isDemo,
    };
  });
}

export interface ArchiveQuery { q?: string; domain?: string; year?: string; status?: string; sort?: string; page?: number }
export const PAGE_SIZE = 8;

export function queryArchive(records: ArchiveRecord[], query: ArchiveQuery) {
  const q = (query.q ?? "").trim().toLowerCase();
  const filtered = records.filter((r) =>
    (!q || [r.title, r.summary, ...r.authors, ...r.domains].join(" ").toLowerCase().includes(q)) &&
    (!query.domain || r.domains.includes(query.domain)) &&
    (!query.year || String(r.year) === query.year) &&
    (!query.status || r.status === query.status));
  const sorters: Record<string, (a: ArchiveRecord, b: ArchiveRecord) => number> = {
    newest: (a, b) => b.publishedAt.localeCompare(a.publishedAt),
    updated: (a, b) => (b.lastSuccessAt ?? "").localeCompare(a.lastSuccessAt ?? ""),
    year: (a, b) => (b.year ?? 0) - (a.year ?? 0),
    title: (a, b) => a.title.localeCompare(b.title),
  };
  filtered.sort(sorters[query.sort ?? "newest"] ?? sorters.newest);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Math.floor(query.page || 1)));
  return {
    items: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: filtered.length, page, pages,
    domains: [...new Set(records.flatMap((r) => r.domains))].sort(),
    years: [...new Set(records.map((r) => r.year).filter(Boolean) as number[])].sort((a, b) => b - a),
    statuses: [...new Set(records.map((r) => r.status))],
  };
}
