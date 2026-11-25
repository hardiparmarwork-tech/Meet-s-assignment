import { addHistory, db, deleteDraft, getOriginal, getPaper, getSeries, insertVersion, latestVersion, now, readUpload, savePaper, sha256 } from "./db";
import { assess, isLive } from "./eligibility";
import { buildIssues } from "./pipeline";
import { keyOf, trackedParameters } from "./series";
import type { MetaOverrides, Metadata, Paper, Parameter, PublishedSnapshot } from "./types";
import { safeHref } from "./parse/common";

export function effectiveMetadata(paper: Paper): { metadata: Metadata; edits: string[] } {
  const original = getOriginal(paper.id)!.doc.metadata;
  const metadata: Metadata = { ...original };
  const edits: string[] = [];
  for (const [key, value] of Object.entries(paper.overrides)) {
    if (value === undefined || JSON.stringify(value) === JSON.stringify(original[key as keyof Metadata])) continue;
    (metadata as unknown as Record<string, unknown>)[key] = value;
    edits.push(key);
  }
  return { metadata, edits };
}

export interface Gate { canPublish: boolean; mode: "live" | "contextual" | null; checks: { name: string; ok: boolean; detail: string }[] }

/** Mandatory integrity checks, re-run at publish time rather than trusted from the preview. */
export function publishGate(paper: Paper): Gate {
  const checks: Gate["checks"] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const a = paper.analysis;
  const original = getOriginal(paper.id);
  if (!a || !original || paper.state === "processing" || paper.state === "failed") {
    add("Processing complete", false, "The paper has not been processed successfully.");
    return { canPublish: false, mode: null, checks };
  }
  let fileOk = false;
  try { fileOk = sha256(readUpload(paper.id)) === paper.fileHash; } catch { /* missing file */ }
  add("Original file unchanged", fileOk, fileOk ? `SHA-256 ${paper.fileHash.slice(0, 16)}…` : "The stored upload is missing or altered.");
  const docOk = sha256(JSON.stringify(original.doc)) === original.hash;
  add("Extracted text unchanged", docOk, docOk ? "Matches the hash recorded at extraction." : "The extracted content no longer matches its hash.");
  const { metadata } = effectiveMetadata(paper);
  add("Title present", !!metadata.title.trim(), metadata.title.trim() ? metadata.title : "Add a title in the technical review.");

  const outcome = a.eligibility.outcome;
  add("Eligibility", outcome !== "not_eligible", a.eligibility.label);
  const tracked = trackedParameters(a.parameters);
  const untraceable = tracked.filter((p) => {
    const s = getSeries(keyOf(p) ?? "");
    return !s?.lastSuccessAt || !s.observations.length || !s.meta.endpoint;
  });
  add("Every displayed value is traceable", !untraceable.length,
    untraceable.length ? `${untraceable.length} parameter(s) have no retrieved source data.` : `${tracked.length} tracked parameter(s), each with a stored source response.`);
  const bad = a.parameters.filter((p) => isLive(p) && p.candidates.find((c) => c.indicatorId === p.selectedIndicatorId)?.checks.some((c) => c.result === "fail"));
  add("No live parameter has a failed compatibility check", !bad.length, bad.length ? bad.map((p) => p.name).join(", ") : "Confirmed.");
  const ok = checks.every((c) => c.ok);
  return { canPublish: ok, mode: ok ? (outcome === "contextual" ? "contextual" : "live") : null, checks };
}

export const slugify = (title: string) =>
  title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70).replace(/-$/, "") || "paper";

function uniqueSlug(title: string): string {
  const base = slugify(title);
  let slug = base;
  for (let n = 2; db().prepare("SELECT 1 FROM papers WHERE slug=?").get(slug); n++) slug = `${base}-${n}`;
  return slug;
}

export function publish(id: string): { slug: string; version: number } {
  const paper = getPaper(id);
  if (!paper) throw new Error("Paper not found");
  const gate = publishGate(paper);
  if (!gate.canPublish) throw new Error(`Cannot publish: ${gate.checks.filter((c) => !c.ok).map((c) => `${c.name} — ${c.detail}`).join("; ")}`);
  const { metadata, edits } = effectiveMetadata(paper);
  const previous = latestVersion(id);
  const at = now();
  const version = (previous?.version ?? 0) + 1;
  const snapshot: PublishedSnapshot = {
    version, publishedAt: at, documentHash: getOriginal(id)!.hash, metadata, metadataEdits: edits,
    analysis: paper.analysis!, settings: paper.settings,
  };
  insertVersion(id, snapshot);
  paper.slug ??= uniqueSlug(metadata.title);
  paper.state = "published";
  savePaper(paper);

  const log = (e: { type: "publication" | "methodology"; outcome: "published" | "edited" | "initial"; note: string; parameterId?: string; seriesKey?: string; period?: number; newValue?: number; sourceVersion?: string | null }) =>
    addHistory({ paperId: id, at, parameterId: null, seriesKey: null, period: null, oldValue: null, newValue: null, sourceVersion: null, calcVersion: null, ...e });
  log({ type: "publication", outcome: "published", note: `Version ${version} published (${paper.analysis!.eligibility.label}). Document hash ${snapshot.documentHash.slice(0, 16)}…` });

  const before = new Set(previous ? trackedParameters(previous.analysis.parameters).map((p) => `${p.id}|${keyOf(p)}|${isLive(p)}`) : []);
  const after = trackedParameters(snapshot.analysis.parameters);
  for (const p of after) {
    if (before.has(`${p.id}|${keyOf(p)}|${isLive(p)}`)) continue;
    const s = getSeries(keyOf(p)!)!;
    const last = s.observations.at(-1)!;
    log({ type: previous ? "methodology" : "publication", outcome: "initial", parameterId: p.id, seriesKey: s.key, period: last.period, newValue: last.value,
      sourceVersion: s.meta.providerUpdated, note: `${p.name}: ${isLive(p) ? "tracking started" : "added as context only"}. Latest observation at publication.` });
  }
  if (previous) {
    const now_ = new Set(after.map((p) => p.id));
    for (const p of trackedParameters(previous.analysis.parameters).filter((x) => !now_.has(x.id)))
      log({ type: "methodology", outcome: "edited", parameterId: p.id, note: `${p.name} is no longer tracked from version ${version}.` });
  }
  return { slug: paper.slug, version };
}

/* ---------- optional advanced review ---------- */

function reassess(paper: Paper): void {
  const a = paper.analysis!;
  a.eligibility = assess(a.parameters, a.claims);
  a.issues = buildIssues(a.parameters, effectiveMetadata(paper).metadata, getOriginal(paper.id)!.doc);
}

const editorial = (paperId: string, note: string, parameterId: string | null = null) =>
  addHistory({ paperId, at: now(), type: "editorial", outcome: "edited", parameterId, seriesKey: null, period: null, oldValue: null, newValue: null, sourceVersion: null, calcVersion: null, note });

/** Candidates an author may approve: never a rejected, unsupported or incompatible one. */
export const approvable = (p: Parameter) => p.candidates.filter((c) => (c.status === "review" || c.status === "verified") && !c.checks.some((k) => k.result === "fail"));

export function decideParameter(id: string, parameterId: string, action: "approve" | "exclude" | "reset", indicatorId?: string): void {
  const paper = getPaper(id);
  const p = paper?.analysis?.parameters.find((x) => x.id === parameterId);
  if (!paper || !p) throw new Error("Parameter not found");
  const originalSelection = () => {
    const verified = p.candidates.filter((c) => c.status === "verified");
    if (p.status === "review" && verified.length > 1) return null;
    return p.candidates.find((c) => c.status === p.status && c.status !== "rejected" && c.status !== "unsupported")?.indicatorId ?? null;
  };
  if (action === "approve") {
    if (p.status !== "review") throw new Error("Only mappings flagged for review can be approved. Incompatible mappings cannot be overridden.");
    const choice = approvable(p).find((c) => c.indicatorId === (indicatorId ?? p.selectedIndicatorId));
    if (!choice) throw new Error("Choose one of the compatible candidate sources.");
    p.selectedIndicatorId = choice.indicatorId;
    p.authorDecision = { action, indicatorId: choice.indicatorId, at: now() };
    editorial(id, `Author approved the mapping of “${p.originalRaw}” to ${choice.indicatorId}.`, p.id);
  } else if (action === "exclude") {
    p.authorDecision = { action, at: now() };
    editorial(id, `Author excluded “${p.originalRaw}” (${p.name}) from tracking.`, p.id);
  } else {
    delete p.authorDecision;
    p.selectedIndicatorId = originalSelection();
    editorial(id, `Author reset the decision on “${p.originalRaw}”.`, p.id);
  }
  reassess(paper);
  savePaper(paper);
}

export function editMetadata(id: string, patch: MetaOverrides, refreshIntervalHours?: number): void {
  const paper = getPaper(id);
  if (!paper?.analysis) throw new Error("Paper not found");
  if (patch.originalUrl && !safeHref(patch.originalUrl)) throw new Error("The original URL must start with http:// or https://");
  const before = effectiveMetadata(paper).metadata as unknown as Record<string, unknown>;
  const changed = Object.entries(patch).filter(([k, v]) => v !== undefined && JSON.stringify(v) !== JSON.stringify(before[k]));
  paper.overrides = { ...paper.overrides, ...Object.fromEntries(changed) };
  if (changed.length) editorial(id, `Metadata edited: ${changed.map(([k]) => k).join(", ")}. The extracted original is unchanged.`);
  if (refreshIntervalHours && refreshIntervalHours !== paper.settings.refreshIntervalHours) {
    paper.settings = { refreshIntervalHours: Math.min(24 * 90, Math.max(24, Math.round(refreshIntervalHours))) };
    editorial(id, `Refresh check interval set to ${paper.settings.refreshIntervalHours} hours.`);
  }
  reassess(paper);
  savePaper(paper);
}

export function setArchived(id: string, archived: boolean): void {
  const paper = getPaper(id);
  if (!paper) throw new Error("Paper not found");
  if (archived) paper.state = "archived";
  else paper.state = latestVersion(id) ? "published" : paper.analysis ? "ready" : "failed";
  savePaper(paper);
  editorial(id, archived ? "Paper archived: removed from the public archive and scheduled refresh." : "Paper restored from the archive.");
}

export function removeDraft(id: string): void {
  if (!deleteDraft(id)) throw new Error("Only drafts that have never been published can be deleted.");
}
