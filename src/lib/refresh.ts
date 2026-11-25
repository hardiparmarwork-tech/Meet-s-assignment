import { getSeries, kvGet, kvSet, latestVersion, listPapers } from "./db";
import { keyOf, refreshSeries, trackedParameters, type RefreshResult } from "./series";
import { geographyByIso } from "./extract/geography";
import type { Paper } from "./types";

interface Job { indicatorId: string; iso3: string; intervalHours: number }

function jobsFor(papers: Paper[]): Map<string, Job> {
  const jobs = new Map<string, Job>();
  for (const paper of papers) {
    const snapshot = latestVersion(paper.id);
    const analysis = snapshot?.analysis ?? paper.analysis;
    if (!analysis) continue;
    for (const p of trackedParameters(analysis.parameters)) {
      const key = keyOf(p);
      if (!key) continue;
      const interval = paper.settings.refreshIntervalHours;
      const existing = jobs.get(key);
      jobs.set(key, { indicatorId: p.selectedIndicatorId!, iso3: p.geography!.iso3, intervalHours: Math.min(interval, existing?.intervalHours ?? interval) });
    }
  }
  return jobs;
}

export const isDue = (lastAttemptAt: string | null, intervalHours: number, at = Date.now()) =>
  !lastAttemptAt || at - Date.parse(lastAttemptAt) >= intervalHours * 3600_000;

async function run(jobs: Job[]): Promise<RefreshResult[]> {
  const results: RefreshResult[] = [];
  // One at a time, which is gentle on the providers' public endpoints.
  for (const j of jobs) results.push(await refreshSeries(j.indicatorId, geographyByIso(j.iso3)));
  return results;
}

export const summarise = (results: RefreshResult[]) => ({
  requested: results.length,
  succeeded: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
  changes: results.reduce((n, r) => n + r.changes.length, 0),
});

export async function refreshPaper(paper: Paper) {
  return summarise(await run([...jobsFor([paper]).values()]));
}

export async function refreshDue(trigger: "scheduler" | "cron") {
  const jobs = [...jobsFor(listPapers().filter((p) => p.state === "published"))]
    .filter(([key, job]) => isDue(getSeries(key)?.lastAttemptAt ?? null, job.intervalHours))
    .map(([, job]) => job);
  const summary = summarise(await run(jobs));
  kvSet("scheduler:last", { at: new Date().toISOString(), trigger, ...summary });
  return summary;
}

export const lastScheduledRun = () => kvGet<{ at: string; trigger: string; requested: number; failed: number }>("scheduler:last", Number.MAX_SAFE_INTEGER);

type G = typeof globalThis & { __lrpScheduler?: NodeJS.Timeout };
export const schedulerEnabled = () => process.env.SCHEDULER !== "0";

/** Runs only while this server process runs. Use POST /api/cron/refresh where it does not stay up. */
export function startScheduler(): void {
  const g = globalThis as G;
  if (g.__lrpScheduler || !schedulerEnabled()) return;
  const tick = () => void refreshDue("scheduler").catch((e) => console.error("[scheduler]", e));
  g.__lrpScheduler = setInterval(tick, 15 * 60_000);
  g.__lrpScheduler.unref();
  setTimeout(tick, 20_000).unref();
}
