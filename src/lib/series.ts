import { addHistory, getSeries, latestVersion, listPapers, now, putSeries } from "./db";
import { fetchWorldBankSeries } from "./connectors/worldbank";
import { fetchOwidSeries } from "./connectors/owid";
import { indicator, type Indicator } from "./mapping/concepts";
import { compute, fmtNumber } from "./mapping/validate";
import { isContextual, isLive } from "./eligibility";
import { geographyByIso } from "./extract/geography";
import type { FetchOptions } from "./safeFetch";
import type { Geography, HistoryEntry, Observation, Paper, Parameter, SeriesRecord, SourceMeta } from "./types";

export const seriesKey = (indicatorId: string, iso3: string) => `${indicatorId}@${iso3}`;

export interface Retrieved { observations: Observation[]; meta: SourceMeta }

export async function retrieve(ind: Indicator, iso3: string, o: FetchOptions = {}): Promise<Retrieved> {
  if (ind.provider === "World Bank") {
    const s = await fetchWorldBankSeries(ind.code, iso3, o);
    return {
      observations: s.observations,
      meta: {
        provider: "World Bank", datasetName: "World Development Indicators", indicatorCode: ind.code, title: s.title, unit: s.unit,
        endpoint: s.endpoint, humanUrl: `https://data.worldbank.org/indicator/${ind.code}?locations=${iso3}`,
        licence: "World Bank open data terms (typically CC BY 4.0; check the indicator's source terms)",
        citation: `World Bank, World Development Indicators, ${ind.code}`, providerUpdated: s.providerUpdated, frequency: "annual",
      },
    };
  }
  const s = await fetchOwidSeries(ind.code, ind.column!, iso3, o);
  return {
    observations: s.observations,
    meta: {
      provider: "Our World in Data", datasetName: s.title, indicatorCode: ind.code, title: s.title, unit: s.unit, endpoint: s.endpoint,
      humanUrl: `https://ourworldindata.org/grapher/${ind.code}`, licence: "CC BY 4.0 (OWID processing); underlying source terms apply",
      citation: s.citation, providerUpdated: s.providerUpdated, frequency: "annual",
    },
  };
}

export interface Change { outcome: "new_observation" | "revised"; period: number; oldValue: number | null; newValue: number | null }

export function diffObservations(before: Observation[], after: Observation[]): Change[] {
  const old = new Map(before.map((o) => [o.period, o.value]));
  const fresh = new Map(after.map((o) => [o.period, o.value]));
  const out: Change[] = [];
  for (const [period, value] of fresh) {
    const prior = old.get(period);
    if (prior === undefined) out.push({ outcome: "new_observation", period, oldValue: null, newValue: value });
    // Ignore floating-point noise.
    else if (Math.abs(prior - value) > Math.abs(prior) * 1e-9) out.push({ outcome: "revised", period, oldValue: prior, newValue: value });
  }
  for (const [period, value] of old) if (!fresh.has(period)) out.push({ outcome: "revised", period, oldValue: value, newValue: null });
  return out.sort((a, b) => a.period - b.period);
}

/** Rejects responses that parse but are not a plausible continuation of what we hold. */
export function checkContinuity(prior: SeriesRecord | null, next: Retrieved, ind: Indicator): string | null {
  if (!next.meta.unit.includes(ind.unitGuard) && !next.meta.title.includes(ind.unitGuard))
    return `Provider unit or definition changed: expected "${ind.unitGuard}", got "${next.meta.unit || next.meta.title}".`;
  if (prior?.observations.length) {
    if (prior.meta.unit && next.meta.unit !== prior.meta.unit) return `Provider unit changed from "${prior.meta.unit}" to "${next.meta.unit}".`;
    if (next.observations.length < prior.observations.length / 2) return "The new response has less than half the observations previously held.";
  }
  return null;
}

const placeholderMeta = (ind: Indicator): SourceMeta => ({
  provider: ind.provider, datasetName: ind.name, indicatorCode: ind.code, title: ind.name, unit: "", endpoint: "", humanUrl: "",
  licence: "", citation: "", providerUpdated: null, frequency: "annual",
});

type Retriever = (ind: Indicator, iso3: string, o?: FetchOptions) => Promise<Retrieved>;

export interface RefreshResult { key: string; ok: boolean; error: string | null; changes: Change[]; record: SeriesRecord }

const inflight = new Map<string, Promise<RefreshResult>>();

/** Retrieves one series. On any failure the last valid observations are kept untouched. */
export function refreshSeries(indicatorId: string, geo: Geography, retriever: Retriever = retrieve): Promise<RefreshResult> {
  const key = seriesKey(indicatorId, geo.iso3);
  const running = inflight.get(key);
  if (running) return running;
  const job = (async (): Promise<RefreshResult> => {
    const ind = indicator(indicatorId);
    const prior = getSeries(key);
    const attemptedAt = now();
    try {
      const next = await retriever(ind, geo.iso3);
      const problem = checkContinuity(prior, next, ind);
      if (problem) throw new Error(problem);
      const changes = prior?.observations.length ? diffObservations(prior.observations, next.observations) : [];
      const record: SeriesRecord = { key, indicatorId, geo, meta: next.meta, observations: next.observations, lastSuccessAt: attemptedAt, lastAttemptAt: attemptedAt, lastError: null };
      putSeries(record);
      if (changes.length) fanOut(record, prior!, changes, attemptedAt);
      return { key, ok: true, error: null, changes, record };
    } catch (e) {
      const error = (e as Error).message;
      const record: SeriesRecord = prior
        ? { ...prior, lastAttemptAt: attemptedAt, lastError: error }
        : { key, indicatorId, geo, meta: placeholderMeta(ind), observations: [], lastSuccessAt: null, lastAttemptAt: attemptedAt, lastError: error };
      putSeries(record);
      fanOutFailure(record, error, attemptedAt);
      return { key, ok: false, error, changes: [], record };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

export const trackedParameters = (parameters: Parameter[]) => parameters.filter((p) => isLive(p) || isContextual(p));

export const keyOf = (p: Parameter) => (p.selectedIndicatorId && p.geography ? seriesKey(p.selectedIndicatorId, p.geography.iso3) : null);

function usages(key: string): { paper: Paper; param: Parameter }[] {
  return listPapers().filter((p) => p.state === "published").flatMap((paper) => {
    const snapshot = latestVersion(paper.id);
    return snapshot ? trackedParameters(snapshot.analysis.parameters).filter((p) => keyOf(p) === key).map((param) => ({ paper, param })) : [];
  });
}

const entry = (paperId: string, at: string, e: Partial<HistoryEntry> & Pick<HistoryEntry, "type" | "outcome" | "note">) =>
  addHistory({ paperId, at, parameterId: null, seriesKey: null, period: null, oldValue: null, newValue: null, sourceVersion: null, calcVersion: null, ...e });

function fanOut(record: SeriesRecord, prior: SeriesRecord, changes: Change[], at: string): void {
  for (const { paper, param } of usages(record.key)) {
    for (const c of changes) {
      entry(paper.id, at, {
        type: c.outcome === "revised" ? "correction" : "refresh", outcome: c.outcome, parameterId: param.id, seriesKey: record.key,
        period: c.period, oldValue: c.oldValue, newValue: c.newValue, sourceVersion: record.meta.providerUpdated,
        note: c.newValue === null ? `The provider withdrew the ${c.period} observation.` : c.outcome === "revised" ? `The provider revised the ${c.period} value.` : `A new observation for ${c.period} was published.`,
      });
    }
    const spec = param.calculation;
    if (spec && isLive(param)) {
      const last = (obs: Observation[]) => obs.at(-1)!.period;
      const before = compute(spec, prior.observations, last(prior.observations));
      const after = compute(spec, record.observations, last(record.observations));
      if (after !== null && before !== after) {
        entry(paper.id, at, {
          type: "refresh", outcome: "recalculated", parameterId: param.id, seriesKey: record.key, period: last(record.observations),
          oldValue: before, newValue: after, sourceVersion: record.meta.providerUpdated, calcVersion: spec.version,
          note: `Change since ${spec.fromYear} recalculated: ${fmtNumber(after)}.`,
        });
      }
    }
  }
}

function fanOutFailure(record: SeriesRecord, error: string, at: string): void {
  for (const { paper, param } of usages(record.key)) {
    entry(paper.id, at, { type: "refresh", outcome: "failed", parameterId: param.id, seriesKey: record.key,
      note: `Retrieval attempt failed: ${error} ${record.observations.length ? "The last valid observations were kept." : ""}`.trim() });
  }
}

/** Uses the cache when it is recent, so processing several claims does not re-request a series. */
export async function getOrFetchSeries(indicatorId: string, geo: Geography, maxAgeMs = 3600_000): Promise<RefreshResult> {
  const cached = getSeries(seriesKey(indicatorId, geo.iso3));
  if (cached?.lastSuccessAt && !cached.lastError && Date.now() - Date.parse(cached.lastSuccessAt) < maxAgeMs)
    return { key: cached.key, ok: true, error: null, changes: [], record: cached };
  return refreshSeries(indicatorId, geographyByIso(geo.iso3));
}
