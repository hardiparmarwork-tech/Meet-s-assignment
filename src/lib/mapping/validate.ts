import type { Indicator } from "./concepts";
import type { CalculationSpec, Candidate, Check, MappingStatus, Observation, SeriesRecord, UnitKind } from "../types";

export const valueAt = (obs: Observation[], period: number) => obs.find((o) => o.period === period)?.value ?? null;

export function compute(spec: CalculationSpec, obs: Observation[], toYear = spec.toYear): number | null {
  const a = valueAt(obs, spec.fromYear), b = valueAt(obs, toYear);
  if (a === null || b === null) return null;
  if (spec.id === "abs_change") return b - a;
  return a === 0 ? null : ((b - a) / Math.abs(a)) * 100;
}

export const fmtNumber = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)} trillion`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)} billion`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)} million`;
  return v.toLocaleString("en-US", { maximumFractionDigits: abs >= 100 ? 1 : 2 });
};

export const BACKCAST = { relativeTolerance: 0.02, roundingCap: 0.05, reviewBand: 0.1 };

/**
 * Compares the paper's value with what the source reports for the paper's own year. This is the
 * main evidence that both measure the same thing. "match" allows for the paper's rounding.
 */
export function backcast(paperValue: number, precision: number, sourceValue: number): { verdict: "match" | "close" | "differs"; relative: number } {
  const diff = Math.abs(Math.abs(paperValue) - Math.abs(sourceValue));
  const scale = Math.abs(sourceValue) || 1;
  const rounding = Math.min(precision / 2, scale * BACKCAST.roundingCap);
  const allowed = Math.max(rounding * 1.0001, scale * BACKCAST.relativeTolerance);
  const relative = diff / scale;
  return { verdict: diff <= allowed ? "match" : relative <= BACKCAST.reviewBand ? "close" : "differs", relative };
}

export interface ValidationInput {
  paperValue: number;
  precision: number;
  paperUnit: UnitKind;
  unitOk: boolean;
  paperYear: number | null;
  subAnnual: boolean;
  geographyBasis: "sentence" | "study-wide inference" | "none";
  geographyName: string | null;
  geographyAmbiguous: boolean;
  conceptMismatch: string | null;
  populationProblem: string | null;
  proposedBy: "rules" | "gemini";
  calculation: CalculationSpec | null;
  calculationAmbiguity: string | null;
}

/** Deterministic status for one claim–indicator pair. AI suggestions can never raise it. */
export function validateCandidate(input: ValidationInput, ind: Indicator, series: SeriesRecord | null, fetchError: string | null): Candidate {
  const checks: Check[] = [];
  const add = (dimension: Check["dimension"], result: Check["result"], detail: string) => checks.push({ dimension, result, detail });
  const key = series?.key ?? "";
  const done = (status: MappingStatus, sourceValue: number | null = null): Candidate =>
    ({ indicatorId: ind.id, seriesKey: key, status, checks, sourceValueAtPaperYear: sourceValue });

  if (input.conceptMismatch) { add("concept", "fail", input.conceptMismatch); return done("rejected"); }
  if (input.proposedBy === "gemini") add("concept", "warn", `Concept suggested by Gemini, not matched by the rule set: ${ind.name}.`);
  else add("concept", "pass", `Wording matches the curated concept for "${ind.name}". ${ind.definition}`);

  if (!input.unitOk) {
    add("unit", "fail", `The paper's unit (${input.paperUnit}) cannot be compared with the source unit (${ind.unit}).`);
    return done("rejected");
  }
  if (input.paperUnit === "unknown") add("unit", "warn", `No unit is written; read as ${ind.unit} from context.`);
  else add("unit", "pass", input.calculation ? `The change is reproducible from the source unit (${ind.unit}).` : `Paper and source both use ${ind.unit}.`);

  if (input.geographyBasis === "none") { add("geography", "fail", "No country or region can be attached to this claim."); return done("unsupported"); }
  if (input.geographyAmbiguous) add("geography", "warn", `Several places are named; ${input.geographyName} was read as the subject.`);
  else if (input.geographyBasis === "study-wide inference") add("geography", "warn", `The sentence names no place; ${input.geographyName} is the study's only stated geography.`);
  else add("geography", "pass", `The sentence names ${input.geographyName}.`);

  if (input.populationProblem) add("population", "fail", input.populationProblem);
  else add("population", "pass", "No sub-national, subgroup or sample restriction was detected in the clause.");

  if (!series || !series.observations.length) {
    add("traceability", "fail", `The source could not be retrieved or validated: ${fetchError ?? "no data"}.`);
    return done("unsupported");
  }
  add("traceability", "pass", `${series.meta.provider}, ${series.meta.indicatorCode}, retrieved ${series.lastSuccessAt}.`);

  if (!series.meta.unit.includes(ind.unitGuard) && !series.meta.title.includes(ind.unitGuard)) {
    add("unit", "fail", `The provider's stated unit or title no longer contains "${ind.unitGuard}".`);
    return done("rejected");
  }

  const latest = series.observations.at(-1)!;
  const referenceYear = input.calculation ? input.calculation.toYear : input.paperYear;
  let temporal: "ok" | "missing-year" | "sub-annual" | "not-covered" = "ok";
  if (input.subAnnual) { temporal = "sub-annual"; add("temporal", "fail", "The claim refers to a month, quarter or split year; the source is calendar-annual."); }
  else if (referenceYear === null) { temporal = "missing-year"; add("temporal", "warn", "The claim states no reference year."); }
  else if (valueAt(series.observations, referenceYear) === null) { temporal = "not-covered"; add("temporal", "fail", `The source has no observation for ${referenceYear}.`); }
  else add("temporal", "pass", `The source covers ${referenceYear}; its latest observation is ${latest.period}.`);

  add("refresh", referenceYear !== null && latest.period > referenceYear ? "pass" : "warn",
    referenceYear !== null && latest.period > referenceYear
      ? `Annual series with ${series.observations.filter((o) => o.period > referenceYear).length} observation(s) later than the paper's reference year.`
      : "Annual series; no observation later than the paper's reference year yet.");

  let sourceValue: number | null = null;
  let agreement: "match" | "close" | "differs" | null = null;
  if (temporal === "ok") {
    sourceValue = input.calculation ? compute(input.calculation, series.observations) : valueAt(series.observations, referenceYear!);
    if (sourceValue === null) add("reproducibility", "fail", "The calculation's inputs are not both available in the source.");
    else {
      const signless = input.calculation ? Math.abs(sourceValue) : sourceValue;
      const result = backcast(input.paperValue, input.precision, signless);
      agreement = result.verdict;
      const what = input.calculation ? `recomputed ${input.calculation.id} ${input.calculation.fromYear}–${input.calculation.toYear}` : `value for ${referenceYear}`;
      add("methodology", agreement === "match" ? "pass" : agreement === "close" ? "warn" : "fail",
        `Source ${what}: ${fmtNumber(sourceValue)}; paper: ${fmtNumber(input.paperValue)} (${(result.relative * 100).toFixed(1)}% apart). ${ind.methodology}`);
      add("reproducibility", "pass", input.calculation ? `Formula v${input.calculation.version}: ${input.calculation.formula}.` : "Direct observation; no transformation.");
    }
  } else add("methodology", "warn", `Agreement with the source cannot be tested. ${ind.methodology}`);
  if (input.calculationAmbiguity) add("reproducibility", "warn", input.calculationAmbiguity);

  if (input.populationProblem || temporal === "sub-annual" || temporal === "not-covered" || agreement === "differs") return done("contextual", sourceValue);
  const needsHuman = input.proposedBy === "gemini" || input.paperUnit === "unknown" && ind.unit !== "people" || input.geographyAmbiguous
    || temporal === "missing-year" || agreement !== "match" || !!input.calculationAmbiguity;
  return done(needsHuman ? "review" : "verified", sourceValue);
}

const RANK: Record<MappingStatus, number> = { verified: 4, review: 3, contextual: 2, unsupported: 1, rejected: 0 };

/** Combines candidates. Two sources that both pass are ambiguous and are not chosen between silently. */
export function decide(candidates: Candidate[]): { status: MappingStatus; selected: string | null; reason: string } {
  if (!candidates.length) return { status: "unsupported", selected: null, reason: "No concept in the verified catalogue covers this measurement." };
  const verified = candidates.filter((c) => c.status === "verified");
  if (verified.length > 1) {
    return { status: "review", selected: null, reason: `${verified.length} sources with different definitions are all consistent with the paper's value. One must be chosen by the author.` };
  }
  const best = [...candidates].sort((a, b) => RANK[b.status] - RANK[a.status] || severity(a) - severity(b))[0];
  const problem = best.checks.find((c) => c.result === "fail") ?? best.checks.find((c) => c.result === "warn" && c.dimension !== "geography" && c.dimension !== "refresh");
  return {
    status: best.status,
    selected: best.status === "rejected" || best.status === "unsupported" ? null : best.indicatorId,
    reason: best.status === "verified" ? "All compatibility checks passed and the source agrees with the paper for its own reference year." : problem?.detail ?? "Needs author review.",
  };
}

const severity = (c: Candidate) => c.checks.reduce((n, k) => n + (k.result === "fail" ? 10 : k.result === "warn" ? 1 : 0), 0);
