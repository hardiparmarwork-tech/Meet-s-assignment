import { getOriginal, getSeries, latestVersion, listHistory } from "./db";
import { isContextual, isLive } from "./eligibility";
import { indicator } from "./mapping/concepts";
import { backcast, compute, fmtNumber, valueAt } from "./mapping/validate";
import { keyOf } from "./series";
import { effectiveMetadata } from "./publish";
import type {
  Analysis, Check, HistoryEntry, LiveStatus, Metadata, Observation, Paper, Parameter, ParsedDocument, SeriesRecord, SourceMeta,
} from "./types";

export const UNIT_LABEL: Record<string, string> = {
  years: "years", percent: "%", pct_gdp: "% of GDP", people: "people", usd: "US$", usd_per_person: "US$ per person",
  intl_usd_per_person: "international $ per person", ug_m3: "µg/m³", t_per_person: "tonnes per person", tonnes: "tonnes",
  per_1000_births: "per 1,000 live births", per_100000_births: "per 100,000 live births", births_per_woman: "births per woman",
  kg_per_ha: "kg per hectare", kwh_per_person: "kWh per person", unknown: "",
};

export type ValueKind = "observed" | "calculated";

export interface MetricView {
  id: string;
  blockId: string;
  name: string;
  definition: string;
  mode: "live" | "contextual";
  kind: ValueKind;
  unit: string;
  geography: string;
  originalRaw: string;
  sentence: string;
  paperYear: number | null;
  /** The newest value: an observation, or the recomputed change for calculated parameters. */
  latest: { value: number; period: number; text: string } | null;
  newerThanPaper: boolean;
  /** Present only when the comparison is like-for-like. */
  change: { text: string; basis: string } | null;
  notComparable: string | null;
  series: Observation[];
  seriesUnit: string;
  source: SourceMeta;
  sourceName: string;
  methodology: string;
  checks: Check[];
  retrievedAt: string | null;
  attemptedAt: string | null;
  error: string | null;
  revisionNote: string | null;
  calculation: { formula: string; version: string; fromYear: number } | null;
  authorConfirmed: boolean;
}

export interface StaticItem { id: string; blockId: string; raw: string; name: string; status: string; reason: string }

export function metricView(p: Parameter, series: SeriesRecord): MetricView {
  const ind = indicator(p.selectedIndicatorId!);
  const live = isLive(p);
  const unit = p.calculation ? (p.calculation.id === "pct_change" ? "%" : ind.unit === "percent" || ind.unit === "pct_gdp" ? "percentage points" : UNIT_LABEL[ind.unit]) : UNIT_LABEL[ind.unit];
  const last = series.observations.at(-1);
  const calcValue = p.calculation && last ? compute(p.calculation, series.observations, last.period) : null;
  const value = p.calculation ? calcValue : last?.value ?? null;
  const latest = last && value !== null ? { value, period: last.period, text: fmtNumber(value) } : null;
  const newer = !!latest && p.paperYear !== null && latest.period > p.paperYear;
  const candidate = p.candidates.find((c) => c.indicatorId === p.selectedIndicatorId)!;

  let change: MetricView["change"] = null;
  let notComparable: string | null = null;
  if (!live) notComparable = `Not comparable with the paper's figure. ${p.statusReason}`;
  else if (!latest) notComparable = "No current value is available from the stored observations.";
  else if (p.calculation) change = null;
  else if (p.paperYear === null) notComparable = "The paper states no reference year, so no change over time is computed.";
  else if (newer) {
    const base = valueAt(series.observations, p.paperYear);
    if (base !== null) {
      const diff = latest.value - base;
      const points = ind.unit === "percent" || ind.unit === "pct_gdp";
      const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
      const rel = !points && base !== 0 ? ` (${sign}${Math.abs((diff / base) * 100).toFixed(1)}%)` : "";
      change = {
        text: `${sign}${fmtNumber(Math.abs(diff))} ${points ? "percentage points" : unit}${rel}`,
        basis: `Source ${latest.period} minus source ${p.paperYear} (${fmtNumber(base)}), both from the same current dataset release.`,
      };
    }
  }

  // The source may since have revised the paper's own year.
  let revisionNote: string | null = null;
  if (live && p.paperYear !== null) {
    const nowAtPaper = p.calculation ? compute(p.calculation, series.observations) : valueAt(series.observations, p.paperYear);
    if (nowAtPaper !== null && backcast(p.originalValue, 0, p.calculation ? Math.abs(nowAtPaper) : nowAtPaper).relative > 0.001)
      revisionNote = `The current dataset gives ${fmtNumber(nowAtPaper)} for ${p.calculation ? "this period" : p.paperYear}; the paper reported ${p.originalRaw}. The paper's figure is left as published.`;
  }

  return {
    id: p.id, blockId: p.blockId, name: live ? p.name : `${p.name} (related context only)`, definition: p.definition, mode: live ? "live" : "contextual",
    kind: p.calculation ? "calculated" : "observed", unit, geography: p.geography!.name, originalRaw: p.originalRaw, sentence: p.sentence,
    paperYear: p.paperYear, latest, newerThanPaper: newer, change, notComparable, series: series.observations, seriesUnit: UNIT_LABEL[ind.unit],
    source: series.meta, sourceName: ind.name, methodology: ind.methodology, checks: candidate.checks,
    retrievedAt: series.lastSuccessAt, attemptedAt: series.lastAttemptAt, error: series.lastError, revisionNote,
    calculation: p.calculation ? { formula: p.calculation.formula, version: p.calculation.version, fromYear: p.calculation.fromYear } : null,
    authorConfirmed: p.authorDecision?.action === "approve",
  };
}

export const STATUS_LABEL: Record<LiveStatus, string> = {
  current: "Current as of last retrieval", partially_updated: "Partially updated: some sources failed", failed: "Latest refresh failed",
  stale: "Stale: no recent successful retrieval", archived: "Archived", static: "No tracked sources",
};

export function liveStatus(state: Paper["state"], series: Pick<SeriesRecord, "lastError" | "lastSuccessAt">[], intervalHours: number, at = Date.now()): LiveStatus {
  if (state === "archived") return "archived";
  if (!series.length) return "static";
  const errored = series.filter((s) => s.lastError).length;
  if (errored === series.length) return "failed";
  if (errored) return "partially_updated";
  const limit = Math.max(intervalHours * 3, 72) * 3600_000;
  return series.some((s) => !s.lastSuccessAt || at - Date.parse(s.lastSuccessAt) > limit) ? "stale" : "current";
}

export interface PublicationView {
  paperId: string;
  slug: string | null;
  isDemo: boolean;
  preview: boolean;
  version: number | null;
  publishedAt: string | null;
  createdAt: string;
  metadata: Metadata;
  metadataEdits: string[];
  document: ParsedDocument;
  documentHash: string;
  fileKind: Paper["fileKind"];
  fileHash: string;
  analysis: Analysis;
  metrics: MetricView[];
  statics: StaticItem[];
  status: LiveStatus;
  statusLabel: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  providerNote: string;
  history: HistoryEntry[];
  refreshIntervalHours: number;
}

const maxDate = (list: (string | null)[]) => list.filter(Boolean).sort().at(-1) ?? null;

/** preview=true renders the working draft; otherwise the latest immutable published version. */
export function publicationView(paper: Paper, preview: boolean): PublicationView | null {
  const original = getOriginal(paper.id);
  const snapshot = preview ? null : latestVersion(paper.id);
  const analysis = preview ? paper.analysis : snapshot?.analysis;
  if (!original || !analysis) return null;
  const { metadata, edits } = snapshot ? { metadata: snapshot.metadata, edits: snapshot.metadataEdits } : effectiveMetadata(paper);

  const metrics: MetricView[] = [];
  const series = new Map<string, SeriesRecord>();
  for (const p of analysis.parameters.filter((x) => isLive(x) || isContextual(x))) {
    const s = getSeries(keyOf(p) ?? "");
    if (!s?.observations.length) continue;
    series.set(s.key, s);
    metrics.push(metricView(p, s));
  }
  const shown = new Set(metrics.map((m) => m.id));
  const statics = analysis.parameters.filter((p) => !shown.has(p.id)).map((p) => ({
    id: p.id, blockId: p.blockId, raw: p.originalRaw, name: p.name,
    status: p.authorDecision?.action === "exclude" ? "excluded" : p.status, reason: p.statusReason,
  }));
  const interval = (snapshot?.settings ?? paper.settings).refreshIntervalHours;
  const status = liveStatus(paper.state, [...series.values()], interval);
  return {
    paperId: paper.id, slug: paper.slug, isDemo: paper.isDemo, preview, version: snapshot?.version ?? null,
    publishedAt: snapshot?.publishedAt ?? null, createdAt: paper.createdAt, metadata, metadataEdits: edits, document: original.doc,
    documentHash: original.hash, fileKind: paper.fileKind, fileHash: paper.fileHash, analysis, metrics, statics, status,
    statusLabel: STATUS_LABEL[status],
    lastSuccessAt: maxDate([...series.values()].map((s) => s.lastSuccessAt)),
    lastAttemptAt: maxDate([...series.values()].map((s) => s.lastAttemptAt)),
    providerNote: [...new Set([...series.values()].filter((s) => s.meta.providerUpdated).map((s) => `${s.meta.provider} dataset updated ${s.meta.providerUpdated}`))].join(" · "),
    history: listHistory(paper.id), refreshIntervalHours: interval,
  };
}
