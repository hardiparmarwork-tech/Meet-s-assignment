import { z } from "zod";
import { FetchError, safeFetch, type FetchOptions } from "../safeFetch";
import type { Observation } from "../types";

export const WB_BASE = "https://api.worldbank.org/v2";

const Row = z.object({
  indicator: z.object({ id: z.string(), value: z.string() }),
  country: z.object({ id: z.string(), value: z.string() }),
  countryiso3code: z.string(),
  date: z.string(),
  value: z.number().nullable(),
});
const Envelope = z.tuple([
  z.object({ page: z.coerce.number(), pages: z.coerce.number(), lastupdated: z.string().optional() }).passthrough(),
  z.array(Row).nullable(),
]);

export function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch {
    // Seen in practice: a bot-protection HTML page in place of JSON. Treated as a failed retrieval.
    throw new FetchError("Provider returned a non-JSON response (possibly an HTML error or bot-protection page)", undefined, true);
  }
}

export interface ProviderSeries {
  observations: Observation[];
  title: string;
  unit: string;
  providerUpdated: string | null;
  endpoint: string;
}

export function parseWorldBankSeries(text: string, code: string, iso3: string): Omit<ProviderSeries, "endpoint" | "unit"> {
  const json = parseJson(text);
  if (Array.isArray(json) && json.length === 1 && (json[0] as { message?: unknown }).message) {
    throw new FetchError("World Bank rejected the query (invalid indicator or country code)");
  }
  const parsed = Envelope.safeParse(json);
  if (!parsed.success) throw new FetchError("World Bank response structure changed or is invalid");
  const [meta, rows] = parsed.data;
  if (meta.pages > 1) throw new FetchError("World Bank response was paginated unexpectedly; refusing a partial series");
  if (!rows?.length) throw new FetchError("World Bank returned no rows for this indicator and geography");
  const byPeriod = new Map<number, number>();
  for (const r of rows) {
    if (r.indicator.id !== code) throw new FetchError("World Bank returned a different indicator than requested");
    if (r.countryiso3code && r.countryiso3code !== iso3) throw new FetchError("World Bank returned a different geography than requested");
    if (!/^\d{4}$/.test(r.date)) throw new FetchError(`Unexpected non-annual period "${r.date}"`);
    if (r.value === null) continue;
    const period = Number(r.date);
    const prior = byPeriod.get(period);
    if (prior !== undefined && prior !== r.value) throw new FetchError(`Conflicting duplicate observations for ${period}`);
    byPeriod.set(period, r.value);
  }
  const observations = [...byPeriod].map(([period, value]) => ({ period, value })).sort((a, b) => a.period - b.period);
  if (!observations.length) throw new FetchError("World Bank has no non-null observations for this indicator and geography");
  return { observations, title: rows[0].indicator.value, providerUpdated: meta.lastupdated ?? null };
}

export async function fetchWorldBankSeries(code: string, iso3: string, o: FetchOptions = {}): Promise<ProviderSeries> {
  const endpoint = `${WB_BASE}/country/${encodeURIComponent(iso3)}/indicator/${encodeURIComponent(code)}?format=json&per_page=1000`;
  const res = await safeFetch(endpoint, o);
  const parsed = parseWorldBankSeries(res.text, code, iso3);
  // The data endpoint has no unit field; the unit is part of the indicator name.
  return { ...parsed, unit: parsed.title, endpoint };
}

export interface Country { iso3: string; iso2: string; name: string; aggregate: boolean }

export async function fetchCountries(o: FetchOptions = {}): Promise<Country[]> {
  const res = await safeFetch(`${WB_BASE}/country?format=json&per_page=400`, o);
  const json = parseJson(res.text) as [unknown, { id: string; iso2Code: string; name: string; region: { value: string } }[]];
  if (!Array.isArray(json?.[1])) throw new FetchError("World Bank country list is invalid");
  return json[1].map((c) => ({ iso3: c.id, iso2: c.iso2Code, name: c.name.trim(), aggregate: c.region.value === "Aggregates" }));
}
