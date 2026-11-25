import { FetchError, safeFetch, type FetchOptions } from "../safeFetch";
import { parseJson, type ProviderSeries } from "./worldbank";
import type { Observation } from "../types";

export const OWID_BASE = "https://ourworldindata.org";

export const owidEntity = (iso3: string) => (iso3 === "WLD" ? "OWID_WRL" : iso3);

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

export function parseOwidSeries(csv: string, column: string, entityCode: string): Observation[] {
  if (/^\s*</.test(csv)) throw new FetchError("OWID returned HTML instead of CSV", undefined, true);
  const [header, ...rows] = parseCsv(csv);
  const codeAt = header?.indexOf("code") ?? -1;
  const yearAt = header?.indexOf("year") ?? -1;
  const valueAt = header?.indexOf(column) ?? -1;
  if (codeAt < 0 || yearAt < 0 || valueAt < 0) throw new FetchError(`OWID CSV schema changed: expected columns code, year, ${column}`);
  const originalYearAt = header.findIndex((h) => /original.?year/i.test(h));
  const byPeriod = new Map<number, number>();
  for (const r of rows) {
    // Filter here as well: a renamed chart's redirect has been seen to drop the country filter.
    if (r[codeAt] !== entityCode || r[valueAt] === "" || r[valueAt] === undefined) continue;
    const period = Number(r[yearAt]);
    // A value carried forward from an earlier year is not an observation of this year.
    if (originalYearAt >= 0 && r[originalYearAt] && Number(r[originalYearAt]) !== period) continue;
    const value = Number(r[valueAt]);
    if (!Number.isInteger(period) || !Number.isFinite(value)) throw new FetchError("OWID CSV contains an invalid year or value");
    const prior = byPeriod.get(period);
    if (prior !== undefined && prior !== value) throw new FetchError(`Conflicting duplicate observations for ${period}`);
    byPeriod.set(period, value);
  }
  if (!byPeriod.size) throw new FetchError("OWID has no observations for this geography");
  return [...byPeriod].map(([period, value]) => ({ period, value })).sort((a, b) => a.period - b.period);
}

export interface OwidSeries extends ProviderSeries { citation: string }

export async function fetchOwidSeries(slug: string, column: string, iso3: string, o: FetchOptions = {}): Promise<OwidSeries> {
  const entity = owidEntity(iso3);
  const endpoint = `${OWID_BASE}/grapher/${slug}.csv?csvType=filtered&country=~${encodeURIComponent(entity)}&useColumnShortNames=true`;
  const metaRes = await safeFetch(`${OWID_BASE}/grapher/${slug}.metadata.json`, o);
  const meta = parseJson(metaRes.text) as {
    columns?: Record<string, { shortName?: string; unit?: string; lastUpdated?: string; citationShort?: string; titleShort?: string }>;
  };
  const col = Object.values(meta.columns ?? {}).find((c) => c.shortName === column);
  if (!col) throw new FetchError(`OWID metadata no longer lists column ${column}`);
  const res = await safeFetch(endpoint, { ...o, maxBytes: 12 * 1024 * 1024 });
  return {
    observations: parseOwidSeries(res.text, column, entity),
    title: col.titleShort ?? slug,
    unit: col.unit ?? "",
    providerUpdated: col.lastUpdated ?? null,
    citation: col.citationShort ?? "Our World in Data",
    endpoint,
  };
}
