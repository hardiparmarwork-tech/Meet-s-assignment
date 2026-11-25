import { getOriginal, getPaper, insertPaper, newId, now, readUpload, saveOriginal, savePaper, saveUpload, sha256 } from "./db";
import { parseDocument, validateUpload } from "./parse";
import { blockText } from "./parse/common";
import { extractClaims, splitSentences, subAnnual } from "./extract/claims";
import { findGeographies, geographyByIso } from "./extract/geography";
import { enrich } from "./connectors/openalex";
import { grobidConfigured, grobidExtract } from "./connectors/grobid";
import { geminiConfigured, geminiModel, suggestConcepts } from "./connectors/gemini";
import { CONCEPTS, indicator, type Concept } from "./mapping/concepts";
import { calculationFor, candidateIndicators, conceptFor, conceptMismatch, findConcepts, geographyFor, populationProblem, unitCompatible, unitsOf } from "./mapping/match";
import { decide, validateCandidate, type ValidationInput } from "./mapping/validate";
import { getOrFetchSeries, type RefreshResult } from "./series";
import { assess } from "./eligibility";
import type { Analysis, Candidate, Geography, Issue, Metadata, Paper, Parameter, ParsedDocument, QuantClaim, Stage } from "./types";

export const initialStages = (): Stage[] => [
  { key: "extract", label: "Extracting the paper", state: "waiting" },
  { key: "identify", label: "Identifying parameters", state: "waiting" },
  { key: "coverage", label: "Checking API coverage", state: "waiting" },
  { key: "validate", label: "Validating source data", state: "waiting" },
  { key: "generate", label: "Generating the publication", state: "waiting" },
];

export function createPaper(fileName: string, buf: Buffer, opts: { isDemo?: boolean } = {}): Paper {
  const clean = fileName.replace(/[^\w.\- ()]/g, "_").slice(-150);
  const kind = validateUpload(clean, buf);
  const paper: Paper = {
    id: newId(), slug: null, state: "processing", fileName: clean, fileKind: kind, fileSize: buf.length, fileHash: sha256(buf),
    isDemo: !!opts.isDemo, createdAt: now(), updatedAt: now(), stages: initialStages(), error: null, analysis: null, overrides: {},
    settings: { refreshIntervalHours: 24 },
  };
  saveUpload(paper.id, buf);
  insertPaper(paper);
  return paper;
}

function setStage(paper: Paper, key: Stage["key"], state: Stage["state"], detail?: string): void {
  const s = paper.stages.find((x) => x.key === key)!;
  s.state = state;
  if (detail !== undefined) s.detail = detail;
  savePaper(paper);
}

/* ---------- study context ---------- */

const DOMAIN_ORDER = (parameters: Parameter[]) => {
  const count = new Map<string, number>();
  for (const p of parameters) {
    const concept = CONCEPTS.find((c) => p.selectedIndicatorId && c.indicators.includes(p.selectedIndicatorId));
    if (concept) count.set(concept.domain, (count.get(concept.domain) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d);
};

function studyContext(doc: ParsedDocument, claims: QuantClaim[]): Analysis["context"] {
  const lead = `${doc.metadata.title}. ${doc.metadata.abstract}`;
  let geos = findGeographies(lead).map((f) => f.geo).filter((g) => g.iso3 !== "WLD");
  if (!geos.length) {
    // Fall back to the body only when one country clearly dominates it.
    const counts = new Map<string, number>();
    for (const b of doc.blocks) for (const f of findGeographies(blockText(b))) if (f.geo.iso3 !== "WLD") counts.set(f.geo.iso3, (counts.get(f.geo.iso3) ?? 0) + 1);
    const ranked = [...counts].sort((a, b) => b[1] - a[1]);
    if (ranked[0] && ranked[0][1] >= 2 && ranked[0][1] >= 3 * (ranked[1]?.[1] ?? 0)) geos = [geographyByIso(ranked[0][0])];
  }
  const study: Geography[] = [...new Map(geos.map((g) => [g.iso3, g])).values()];
  const years = claims.map((c) => c.year).filter((y): y is number => y !== null && y >= 1900 && (!doc.metadata.year || y <= doc.metadata.year));
  const sentences = doc.blocks.filter((b) => b.type === "paragraph").flatMap((b) => splitSentences(blockText(b)));
  const pick = (re: RegExp) => sentences.filter((s) => re.test(s) && s.length < 400).slice(0, 4);
  return {
    studyGeographies: study,
    studyYears: years.length ? [Math.min(...years), Math.max(...years)] : null,
    researchQuestions: pick(/\b(this (paper|study|article) (asks|examines|investigates|assesses|explores|analy[sz]es|reviews|describes)|research question|we (ask|examine|investigate|assess))\b/i),
    methodology: pick(/\b(we (use|used|apply|applied|compare|compiled|conducted|estimate)|method(ology)? |data (were|are) (drawn|obtained|taken)|regression|survey)\b/i),
    limitationsNoted: pick(/\b(limitation|caveat|cannot (establish|determine)|should be interpreted with caution|we were unable)\b/i),
    keyClaims: pick(/\b(we (find|show|conclude)|our (findings|results)|in conclusion|results (show|suggest|indicate))\b/i),
  };
}

/* ---------- mapping ---------- */

interface Plan {
  claim: ReturnType<typeof extractClaims>[number];
  concept: Concept | null;
  proposedBy: "rules" | "gemini";
  unitOk: boolean;
}

export function planMappings(claims: ReturnType<typeof extractClaims>): Plan[] {
  const plans: Plan[] = [];
  for (const claim of claims) {
    if (!["observation", "derived", "unrelated"].includes(claim.classification)) continue;
    const mentions = findConcepts(claim.sentence);
    const found = conceptFor(claim, claim.start, mentions);
    if (claim.classification === "unrelated") {
      // A unit-less number is promoted only when it is plainly a head count for a population concept.
      if (!(claim.classificationReason.startsWith("No recognisable") && found?.unitOk && found.mention.concept.id === "population" && unitCompatible(claim, "people"))) continue;
      claim.classification = "observation";
      claim.classificationReason = "A head count attached to a population concept.";
    }
    // "30% of the population" uses the word only as a denominator; it is not a head-count claim.
    if (found && !found.unitOk && found.mention.concept.id === "population") {
      plans.push({ claim, concept: null, proposedBy: "rules", unitOk: false });
      continue;
    }
    plans.push({ claim, concept: found?.mention.concept ?? null, proposedBy: "rules", unitOk: found?.unitOk ?? false });
  }
  return plans;
}

export type SeriesLoader = (indicatorId: string, geo: Geography) => Promise<RefreshResult>;

export async function buildParameter(plan: Plan, study: Geography[], load: SeriesLoader): Promise<Parameter> {
  const { claim, concept } = plan;
  const geo = geographyFor(claim.sentence, claim.start, study);
  const base: Parameter = {
    id: `p-${claim.id}`, claimId: claim.id, blockId: claim.blockId, name: concept?.label ?? "Unmatched measurement",
    definition: "", originalRaw: claim.raw, originalValue: claim.value, originalUnitText: claim.unitText, unit: claim.unit,
    sentence: claim.sentence, page: claim.page, geography: geo.geography, geographyBasis: geo.basis, paperYear: claim.year,
    kind: claim.classification === "derived" ? "calculated" : "observed", calculation: null, status: "unsupported",
    statusReason: "No concept in the verified catalogue covers this measurement.", candidates: [], selectedIndicatorId: null, proposedBy: plan.proposedBy,
  };
  if (!concept) return base;

  const ids = candidateIndicators(concept, claim.sentence);
  base.definition = indicator(ids[0]).definition;
  let calculation = null as ReturnType<typeof calculationFor>;
  if (claim.classification === "derived") {
    calculation = calculationFor(claim.sentence, claim, claim.start, unitsOf(concept)[0]);
    if (!calculation) {
      return { ...base, statusReason: "This change cannot be reproduced: its formula or its two reference years are not stated unambiguously." };
    }
    base.calculation = calculation.spec;
    base.paperYear = calculation.spec.toYear;
    base.name = `Change in ${concept.label.toLowerCase()}, ${calculation.spec.fromYear}–${calculation.spec.toYear}`;
  }

  const candidates: Candidate[] = [];
  for (const id of ids) {
    const ind = indicator(id);
    const input: ValidationInput = {
      paperValue: claim.value, precision: claim.precision, paperUnit: claim.unit,
      unitOk: calculation ? true : unitCompatible(claim, ind.unit),
      paperYear: base.paperYear, subAnnual: subAnnual(claim.sentence), geographyBasis: geo.basis,
      geographyName: geo.geography?.name ?? null, geographyAmbiguous: geo.ambiguous,
      conceptMismatch: conceptMismatch(concept, claim.sentence, claim.start),
      populationProblem: populationProblem(concept, claim.sentence, claim.start),
      proposedBy: plan.proposedBy, calculation: calculation?.spec ?? null, calculationAmbiguity: calculation?.ambiguous ?? null,
    };
    // Incompatible candidates are rejected before any request is made.
    const result = !input.conceptMismatch && input.unitOk && geo.geography ? await load(id, geo.geography) : null;
    const series = result && result.record.observations.length && result.ok ? result.record : null;
    candidates.push(validateCandidate(input, ind, series, result?.error ?? null));
  }
  const verdict = decide(candidates);
  const selected = verdict.selected ?? null;
  return {
    ...base, candidates, status: verdict.status, statusReason: verdict.reason, selectedIndicatorId: selected,
    definition: indicator(selected ?? ids[0]).definition,
  };
}

export function buildIssues(parameters: Parameter[], meta: Metadata, doc: ParsedDocument): Issue[] {
  const issues: Issue[] = [];
  if (!meta.title.trim()) issues.push({ severity: "blocking", message: "No title could be extracted. Add one under “Review technical details”." });
  if (!meta.authors.length) issues.push({ severity: "attention", message: "No authors were identified in the document." });
  if (!meta.year) issues.push({ severity: "attention", message: "No publication year is stated in the document. Forecasts cannot be separated by date until one is set." });
  for (const p of parameters.filter((x) => x.status === "review" && !x.authorDecision)) {
    issues.push({ severity: "attention", parameterId: p.id, message: `“${p.originalRaw}” (${p.name}) is not live until reviewed: ${p.statusReason}` });
  }
  for (const note of doc.fidelity) issues.push({ severity: "note", message: note });
  return issues;
}

export async function analyse(doc: ParsedDocument, load: SeriesLoader, opts: { offline?: boolean } = {}): Promise<{ analysis: Analysis; plans: number }> {
  const claims = extractClaims(doc.blocks, doc.metadata.year);
  const plans = planMappings(claims);
  const context = studyContext(doc, claims);

  let gemini = "Not configured. Rule-based extraction only.";
  if (geminiConfigured() && !opts.offline) {
    const unmatched = plans.filter((p) => !p.concept);
    if (!unmatched.length) gemini = "Configured; not needed.";
    else try {
      const suggestions = await suggestConcepts(unmatched.map((p) => ({ id: p.claim.id, sentence: p.claim.sentence, raw: p.claim.raw })));
      for (const p of unmatched) {
        const concept = CONCEPTS.find((c) => c.id === suggestions.get(p.claim.id));
        if (concept) Object.assign(p, { concept, proposedBy: "gemini", unitOk: unitsOf(concept).some((u) => unitCompatible(p.claim, u)) });
      }
      gemini = `${geminiModel()} suggested ${suggestions.size} candidate mapping(s); each still requires author review.`;
    } catch (e) {
      gemini = `Gemini request failed (${(e as Error).message}). Rule-based extraction only.`;
    }
  }

  const parameters: Parameter[] = [];
  for (const plan of plans.slice(0, 80)) parameters.push(await buildParameter(plan, context.studyGeographies, load));

  const issues = buildIssues(parameters, doc.metadata, doc);
  if (plans.length > 80) issues.push({ severity: "attention", message: `Only the first 80 of ${plans.length} measured claims were evaluated.` });

  const publicClaims: QuantClaim[] = claims.map(({ start: _s, context: _c, ...c }) => c);
  const enrichment = opts.offline
    ? { provider: "OpenAlex" as const, status: "skipped" as const, detail: "Skipped in offline mode.", retrievedAt: now(), conflicts: [] }
    : await enrich(doc.metadata);
  return {
    plans: plans.length,
    analysis: {
      generatedAt: now(), domain: DOMAIN_ORDER(parameters), context, claims: publicClaims, parameters,
      eligibility: assess(parameters, publicClaims), enrichment, issues,
      tools: { parser: doc.parser, gemini, grobid: grobidConfigured() ? "Configured" : "Not configured." },
    },
  };
}

/* ---------- the job ---------- */

export async function processPaper(id: string): Promise<void> {
  const paper = getPaper(id);
  if (!paper) return;
  let current: Stage["key"] = "extract";
  try {
    paper.state = "processing";
    paper.error = null;
    paper.stages = initialStages();
    setStage(paper, "extract", "running");
    let doc = getOriginal(id)?.doc;
    if (!doc) {
      const buf = readUpload(id);
      doc = await parseDocument(paper.fileKind, buf);
      if (paper.fileKind === "pdf" && grobidConfigured()) {
        try {
          const g = await grobidExtract(buf);
          for (const [k, v] of Object.entries(g.metadata)) if (v && (!Array.isArray(v) || v.length)) (doc.metadata as unknown as Record<string, unknown>)[k] = v;
          if (g.references.length) doc.references = g.references;
          doc.parser = "grobid+builtin-pdf";
        } catch (e) {
          doc.fidelity.push(`GROBID was unavailable (${(e as Error).message}); the built-in parser was used.`);
        }
      }
      saveOriginal(id, doc);
    }
    setStage(paper, "extract", "done", `${doc.blocks.length} content blocks, ${doc.references.length} references (${doc.parser}).`);

    current = "identify";
    setStage(paper, "identify", "running");
    const claims = extractClaims(doc.blocks, doc.metadata.year);
    const plans = planMappings(claims);
    setStage(paper, "identify", "done", `${claims.length} numbers found; ${plans.length} are measured values or changes.`);

    current = "coverage";
    setStage(paper, "coverage", "running");
    const retrieved = new Map<string, boolean>();
    const load: SeriesLoader = async (indicatorId, geo) => {
      if (paper.stages.find((s) => s.key === "validate")!.state === "waiting") {
        current = "validate";
        setStage(paper, "coverage", "done", `${plans.filter((p) => p.concept).length} claim(s) match a catalogue concept.`);
        setStage(paper, "validate", "running");
      }
      const r = await getOrFetchSeries(indicatorId, geo);
      retrieved.set(r.key, r.ok);
      setStage(paper, "validate", "running", `${retrieved.size} source series requested.`);
      return r;
    };
    const { analysis } = await analyse(doc, load);
    if (paper.stages.find((s) => s.key === "coverage")!.state === "running") setStage(paper, "coverage", "done", `${plans.filter((p) => p.concept).length} claim(s) match a catalogue concept.`);
    const failed = [...retrieved.values()].filter((ok) => !ok).length;
    setStage(paper, "validate", "done", retrieved.size ? `${retrieved.size - failed} series retrieved and validated${failed ? `, ${failed} failed` : ""}.` : "No source data needed to be requested.");

    current = "generate";
    setStage(paper, "generate", "running");
    paper.analysis = analysis;
    paper.state = "ready";
    setStage(paper, "generate", "done", analysis.eligibility.label);
  } catch (e) {
    const fresh = getPaper(id)!;
    fresh.state = "failed";
    fresh.error = (e as Error).message;
    const stage = fresh.stages.find((s) => s.key === current)!;
    stage.state = "failed";
    stage.detail = fresh.error;
    savePaper(fresh);
  }
}

const running = new Set<string>();
export function enqueue(id: string): void {
  if (running.has(id)) return;
  running.add(id);
  void processPaper(id).finally(() => running.delete(id));
}
export const isProcessing = (id: string) => running.has(id);
