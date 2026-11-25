export type Inline = {
  t: string;
  b?: boolean;
  i?: boolean;
  sup?: boolean;
  sub?: boolean;
  /** Only http(s) or in-document (#) links survive parsing. */
  href?: string;
};

export type Block =
  | { id: string; type: "heading"; level: number; inlines: Inline[]; page?: number }
  | { id: string; type: "paragraph"; inlines: Inline[]; page?: number; footnoteKey?: string }
  | { id: string; type: "list"; ordered: boolean; items: Inline[][]; page?: number }
  | { id: string; type: "table"; rows: Inline[][][]; page?: number }
  | { id: string; type: "figure"; src: string; alt: string; page?: number }
  | { id: string; type: "code"; text: string; page?: number }
  | { id: string; type: "quote"; inlines: Inline[]; page?: number };

export interface Metadata {
  title: string;
  authors: string[];
  abstract: string;
  publicationDate: string;
  year: number | null;
  doi: string;
  publisher: string;
  keywords: string[];
  originalUrl: string;
}

export interface ParsedDocument {
  parser: "builtin-pdf" | "builtin-docx" | "builtin-text" | "builtin-markdown" | "grobid+builtin-pdf";
  metadata: Metadata;
  blocks: Block[];
  references: string[];
  /** Honest statements about what could not be reconstructed. */
  fidelity: string[];
  pageCount: number | null;
}

export type Classification =
  | "observation"
  | "derived"
  | "interpretation"
  | "forecast"
  | "constant"
  | "sample"
  | "unrelated";

export type UnitKind =
  | "years"
  | "percent"
  | "pct_gdp"
  | "people"
  | "usd"
  | "usd_per_person"
  | "intl_usd_per_person"
  | "ug_m3"
  | "t_per_person"
  | "tonnes"
  | "per_1000_births"
  | "per_100000_births"
  | "births_per_woman"
  | "kg_per_ha"
  | "kwh_per_person"
  | "unknown";

export interface QuantClaim {
  id: string;
  blockId: string;
  page?: number;
  sentence: string;
  /** The numeric text exactly as written in the paper. */
  raw: string;
  value: number;
  /** Number of decimal places as written, scaled for magnitude words; used for rounding tolerance. */
  precision: number;
  unit: UnitKind;
  unitText: string;
  year: number | null;
  classification: Classification;
  classificationReason: string;
}

export interface Geography {
  iso3: string;
  name: string;
}

export type MappingStatus = "verified" | "review" | "contextual" | "unsupported" | "rejected";

export type Dimension =
  | "concept"
  | "unit"
  | "geography"
  | "temporal"
  | "population"
  | "methodology"
  | "refresh"
  | "reproducibility"
  | "traceability";

export interface Check {
  dimension: Dimension;
  result: "pass" | "warn" | "fail";
  detail: string;
}

export interface CalculationSpec {
  id: "pct_change" | "abs_change";
  version: string;
  fromYear: number;
  toYear: number;
  formula: string;
}

export interface Candidate {
  indicatorId: string;
  seriesKey: string;
  status: MappingStatus;
  checks: Check[];
  /** Source value for the paper's own reference year, when available. */
  sourceValueAtPaperYear: number | null;
}

export interface Parameter {
  id: string;
  claimId: string;
  blockId: string;
  name: string;
  definition: string;
  originalRaw: string;
  originalValue: number;
  originalUnitText: string;
  unit: UnitKind;
  sentence: string;
  page?: number;
  geography: Geography | null;
  geographyBasis: "sentence" | "study-wide inference" | "none";
  paperYear: number | null;
  kind: "observed" | "calculated";
  calculation: CalculationSpec | null;
  status: MappingStatus;
  statusReason: string;
  candidates: Candidate[];
  selectedIndicatorId: string | null;
  proposedBy: "rules" | "gemini";
  /** Set when an author resolves a flagged item in the optional review panel. */
  authorDecision?: { action: "approve" | "exclude"; indicatorId?: string; at: string };
}

export type EligibilityOutcome = "strong" | "partial" | "contextual" | "not_eligible";

export interface Eligibility {
  outcome: EligibilityOutcome;
  label: string;
  reasons: string[];
  counts: Record<MappingStatus, number> & { live: number; measuredClaims: number; allNumbers: number };
  limitations: string[];
}

export interface Enrichment {
  provider: "OpenAlex";
  status: "matched" | "no_reliable_match" | "unavailable" | "skipped";
  detail: string;
  matchBasis?: "doi" | "exact-title";
  confidence?: "high" | "medium";
  workId?: string;
  retrievedAt: string;
  record?: {
    title: string;
    year: number | null;
    doi: string;
    authors: string[];
    venue: string;
    citedByCount: number;
    topics: string[];
  };
  /** Differences between the document and OpenAlex; never applied automatically. */
  conflicts: string[];
}

export interface Issue {
  severity: "blocking" | "attention" | "note";
  message: string;
  parameterId?: string;
}

export interface Analysis {
  generatedAt: string;
  domain: string[];
  context: {
    studyGeographies: Geography[];
    studyYears: [number, number] | null;
    researchQuestions: string[];
    methodology: string[];
    limitationsNoted: string[];
    keyClaims: string[];
  };
  claims: QuantClaim[];
  parameters: Parameter[];
  eligibility: Eligibility;
  enrichment: Enrichment;
  issues: Issue[];
  tools: { parser: string; gemini: string; grobid: string };
}

export interface Observation {
  /** Reference period of the observation (calendar year). */
  period: number;
  value: number;
}

export interface SourceMeta {
  provider: "World Bank" | "Our World in Data";
  datasetName: string;
  indicatorCode: string;
  title: string;
  unit: string;
  endpoint: string;
  humanUrl: string;
  licence: string;
  citation: string;
  /** Date the provider says it last updated the dataset, if it says so. */
  providerUpdated: string | null;
  frequency: "annual";
}

export interface SeriesRecord {
  key: string;
  indicatorId: string;
  geo: Geography;
  meta: SourceMeta;
  observations: Observation[];
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

export type PaperState = "processing" | "ready" | "failed" | "published" | "archived";

export interface Stage {
  key: "extract" | "identify" | "coverage" | "validate" | "generate";
  label: string;
  state: "waiting" | "running" | "done" | "failed";
  detail?: string;
}

export interface MetaOverrides {
  title?: string;
  authors?: string[];
  abstract?: string;
  year?: number | null;
  publisher?: string;
  doi?: string;
  originalUrl?: string;
}

export interface Settings {
  refreshIntervalHours: number;
}

export interface Paper {
  id: string;
  slug: string | null;
  state: PaperState;
  fileName: string;
  fileKind: "pdf" | "docx" | "txt" | "md";
  fileSize: number;
  fileHash: string;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  stages: Stage[];
  error: string | null;
  analysis: Analysis | null;
  overrides: MetaOverrides;
  settings: Settings;
}

export interface PublishedSnapshot {
  version: number;
  publishedAt: string;
  documentHash: string;
  metadata: Metadata;
  metadataEdits: string[];
  analysis: Analysis;
  settings: Settings;
}

export interface HistoryEntry {
  id: number;
  paperId: string;
  at: string;
  type: "refresh" | "correction" | "methodology" | "editorial" | "publication";
  outcome: "initial" | "new_observation" | "revised" | "recalculated" | "failed" | "published" | "edited";
  parameterId: string | null;
  seriesKey: string | null;
  period: number | null;
  oldValue: number | null;
  newValue: number | null;
  sourceVersion: string | null;
  calcVersion: string | null;
  note: string;
}

export type LiveStatus = "current" | "partially_updated" | "failed" | "stale" | "archived" | "static";
