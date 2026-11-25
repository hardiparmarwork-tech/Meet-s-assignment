import { clauseAround, findNumbers } from "../extract/claims";
import { findGeographies, SUBNATIONAL } from "../extract/geography";
import { CONCEPTS, indicator, type Concept } from "./concepts";
import type { CalculationSpec, Geography, QuantClaim, UnitKind } from "../types";

export interface Mention { concept: Concept; start: number; end: number }

/** Concept mentions in a sentence; where two overlap, the earlier (more specific) concept wins. */
export function findConcepts(sentence: string): Mention[] {
  const out: Mention[] = [];
  for (const concept of CONCEPTS) {
    for (const m of sentence.matchAll(new RegExp(concept.match.source, "gi"))) {
      const span = { concept, start: m.index, end: m.index + m[0].length };
      if (!out.some((o) => span.start < o.end && o.start < span.end)) out.push(span);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export const unitsOf = (concept: Concept): UnitKind[] => [...new Set(concept.indicators.map((i) => indicator(i).unit))];

/** A bare number such as "1.33 billion" can satisfy a head-count concept. */
export function unitCompatible(claim: Pick<QuantClaim, "unit" | "value">, unit: UnitKind): boolean {
  return claim.unit === unit || (unit === "people" && claim.unit === "unknown" && claim.value >= 10_000);
}

/** Picks the concept a number belongs to: compatible unit first, then proximity (preferring a preceding mention). */
export function conceptFor(claim: { unit: UnitKind; value: number }, at: number, mentions: Mention[]): { mention: Mention; unitOk: boolean } | null {
  if (!mentions.length) return null;
  const distance = (m: Mention) => (m.end <= at ? at - m.end : (m.start - at) * 2.5);
  const compatible = mentions.filter((m) => unitsOf(m.concept).some((u) => unitCompatible(claim, u))).sort((a, b) => distance(a) - distance(b));
  if (compatible[0]) return { mention: compatible[0], unitOk: true };
  return { mention: [...mentions].sort((a, b) => distance(a) - distance(b))[0], unitOk: false };
}

export function conceptMismatch(concept: Concept, sentence: string, at: number): string | null {
  const clause = clauseAround(sentence, at).text;
  return concept.mismatch?.find((m) => m.pattern.test(clause))?.reason ?? null;
}

export function candidateIndicators(concept: Concept, sentence: string): string[] {
  const narrowed = concept.narrow?.find((n) => n.pattern.test(sentence));
  return narrowed ? narrowed.keep : concept.indicators;
}

export function populationProblem(concept: Concept, sentence: string, at: number): string | null {
  const clause = clauseAround(sentence, at).text;
  const place = clause.match(SUBNATIONAL)?.[0];
  if (place) return `The claim refers to a sub-national population ("${place}"); the source reports national or regional aggregates.`;
  if (concept.id !== "urban" && /\b(urban|rural) (areas?|populations?|residents|households|women|children)\b|\bin (urban|rural)\b/i.test(clause))
    return "The claim is limited to an urban or rural population; the source reports the whole population.";
  const gendered = concept.id === "life-female" || concept.id === "life-male" || concept.id === "maternal";
  if (!gendered && /\b(among|for|of) (women|men|females|males|children|adolescents|adults|the elderly|youth)\b|\b(female|male)s?\b|\baged \d+/i.test(clause) && !["literacy", "under5", "infant"].includes(concept.id))
    return "The claim is limited to a demographic subgroup; the source reports the total population.";
  return null;
}

export interface GeoChoice { geography: Geography | null; basis: "sentence" | "study-wide inference" | "none"; ambiguous: boolean }

export function geographyFor(sentence: string, at: number, studyGeographies: Geography[]): GeoChoice {
  const found = findGeographies(sentence);
  const distinct = [...new Set(found.map((f) => f.geo.iso3))];
  if (distinct.length === 1) return { geography: found[0].geo, basis: "sentence", ambiguous: false };
  if (distinct.length > 1) {
    const clause = clauseAround(sentence, at);
    const inClause = found.filter((f) => f.index >= clause.start && f.index < clause.start + clause.text.length);
    const pick = inClause.filter((f) => f.index < at).at(-1) ?? inClause[0] ?? found.filter((f) => f.index < at).at(-1) ?? found[0];
    return { geography: pick.geo, basis: "sentence", ambiguous: new Set(inClause.map((f) => f.geo.iso3)).size !== 1 };
  }
  if (studyGeographies.length === 1) return { geography: studyGeographies[0], basis: "study-wide inference", ambiguous: false };
  return { geography: null, basis: "none", ambiguous: false };
}

export const CALC_VERSION = "1.0.0";

/**
 * Recognises only changes whose formula is unambiguous and whose inputs are two annual values:
 * "... increased by 3.1 years between 2000 and 2015".
 */
export function calculationFor(sentence: string, claim: { unit: UnitKind }, at: number, conceptUnit: UnitKind): { spec: CalculationSpec; ambiguous: string | null } | null {
  const years = sentence.match(/\b(?:between|from)\s+((?:19|20)\d{2})\s+(?:and|to|until)\s+((?:19|20)\d{2})\b/i);
  if (!years) return null;
  const [fromYear, toYear] = [Number(years[1]), Number(years[2])];
  if (toYear <= fromYear) return null;
  const points = /percentage points?/i.test(findNumbers(sentence).find((n) => n.start <= at && n.end >= at)?.unitText ?? "");
  const percentIndicator = conceptUnit === "percent" || conceptUnit === "pct_gdp";
  let id: CalculationSpec["id"] | null = null;
  let ambiguous: string | null = null;
  if (claim.unit === "percent" && !percentIndicator) id = "pct_change";
  else if (claim.unit === "percent" && percentIndicator) {
    id = "abs_change";
    if (!points) ambiguous = 'A "percent" change in a percentage indicator could mean percentage points or relative change.';
  } else if (claim.unit === conceptUnit) id = "abs_change";
  if (!id) return null;
  return {
    spec: { id, version: CALC_VERSION, fromYear, toYear, formula: id === "pct_change" ? "(value[end] − value[start]) ÷ value[start] × 100" : "value[end] − value[start]" },
    ambiguous,
  };
}
