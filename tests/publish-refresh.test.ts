import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { closeDb, db, getOriginal, getPaper, getSeries, latestVersion, listHistory, listPapers } from "@/lib/db";
import { createPaper, processPaper } from "@/lib/pipeline";
import { decideParameter, editMetadata, publish, publishGate, removeDraft, setArchived } from "@/lib/publish";
import { isDue, refreshPaper } from "@/lib/refresh";
import { publicationView, liveStatus } from "@/lib/view";
import { archiveRecords, queryArchive } from "@/lib/archive";
import { Publication } from "@/components/Publication";
import { baseTable, fakeNetwork, PAPER, tempData } from "./helpers";

const state = { table: baseTable(), down: new Set<string>() };
let cleanup: () => void;
let id: string;
beforeAll(() => { cleanup = tempData(); fakeNetwork(state); });
afterAll(() => { vi.unstubAllGlobals(); cleanup(); });

const view = () => publicationView(getPaper(id)!, false)!;
const life = () => view().metrics.find((m) => m.name.startsWith("Life"))!;

describe("vertical slice: upload → preview → publish → refresh → archive", () => {
  it("processes an upload into a ready preview", async () => {
    id = createPaper("study.md", Buffer.from(PAPER)).id;
    await processPaper(id);
    const p = getPaper(id)!;
    expect(p.state).toBe("ready");
    expect(p.stages.every((s) => s.state === "done")).toBe(true);
    expect(p.analysis!.eligibility.outcome).toBe("strong");
    expect(publishGate(p).canPublish).toBe(true);
    expect(archiveRecords()).toEqual([]); // drafts are never public
  });

  it("will not let the extracted original be changed", () => {
    expect(() => db().prepare("UPDATE originals SET doc='{}'").run()).toThrow(/immutable/);
  });

  it("publishes a stable URL with provenance, and persists across restarts", () => {
    const first = publish(id);
    expect(first).toEqual({ slug: "a-test-study-of-two-indicators-in-india", version: 1 });
    closeDb();
    expect(getPaper(id)!.slug).toBe(first.slug);
    expect(latestVersion(id)!.documentHash).toBe(getOriginal(id)!.hash);
    expect(() => db().prepare("UPDATE versions SET snapshot='{}'").run()).toThrow(/immutable/);
    expect(archiveRecords()[0]).toMatchObject({ slug: first.slug, tracked: 2, status: "current", year: 2017 });
    expect(life().latest).toMatchObject({ period: 2020, value: 70.5 });
  });

  it("adds no history when nothing changed", async () => {
    const before = listHistory(id).length;
    expect(await refreshPaper(getPaper(id)!)).toMatchObject({ succeeded: 2, failed: 0, changes: 0 });
    expect(listHistory(id)).toHaveLength(before);
  });

  it("a successful refresh updates metrics and records new and revised values", async () => {
    state.table["SP.DYN.LE00.IN"] = { 2000: 60, 2015: 69.4, 2020: 70.5, 2021: 71 };
    expect((await refreshPaper(getPaper(id)!)).changes).toBe(2);
    expect(life().latest).toMatchObject({ period: 2021, value: 71 });
    const h = listHistory(id);
    expect(h.find((e) => e.outcome === "new_observation")).toMatchObject({ period: 2021, newValue: 71, sourceVersion: "2026-01-01" });
    expect(h.find((e) => e.outcome === "revised")).toMatchObject({ type: "correction", oldValue: 69.3, newValue: 69.4 });
    expect(life().originalRaw).toBe("69.3 years");
  });

  it("a failed refresh keeps the last valid data and reports partial failure", async () => {
    state.down.add("SP.DYN.LE00.IN");
    expect(await refreshPaper(getPaper(id)!)).toMatchObject({ succeeded: 1, failed: 1 });
    expect(life().latest).toMatchObject({ period: 2021, value: 71 });
    expect(life().error).toBeTruthy();
    expect(view().status).toBe("partially_updated");
    const s = getSeries("wb:SP.DYN.LE00.IN@IND")!;
    expect(Date.parse(s.lastAttemptAt!)).toBeGreaterThan(Date.parse(s.lastSuccessAt!));
    expect(listHistory(id)[0].outcome).toBe("failed");
    state.down.clear();
  });

  it("refuses a silently redefined or truncated series", async () => {
    const good = state.table["SP.DYN.LE00.IN"];
    state.table["SP.DYN.LE00.IN"] = { 2015: 1 };
    expect((await refreshPaper(getPaper(id)!)).failed).toBe(1);
    expect(life().series).toHaveLength(4);
    state.table["SP.DYN.LE00.IN"] = good;
    await refreshPaper(getPaper(id)!);
    expect(view().status).toBe("current");
  });

  it("applies due and staleness rules", () => {
    expect(isDue(null, 24)).toBe(true);
    expect(isDue(new Date().toISOString(), 24)).toBe(false);
    expect(liveStatus("published", [{ lastError: null, lastSuccessAt: "2020-01-01T00:00:00Z" }], 24)).toBe("stale");
    expect(liveStatus("published", [{ lastError: "x", lastSuccessAt: null }], 24)).toBe("failed");
  });

  it("keeps draft edits off the public page until a new version", () => {
    editMetadata(id, { title: "Edited title" });
    expect(view().metadata.title).toBe("A Test Study Of Two Indicators In India");
    expect(publish(id)).toMatchObject({ version: 2, slug: "a-test-study-of-two-indicators-in-india" });
    expect(view().metadataEdits).toEqual(["title"]);
    expect(getOriginal(id)!.doc.metadata.title).toBe("A Test Study Of Two Indicators In India");
  });

  it("renders the original text, both columns and provenance", () => {
    const html = renderToStaticMarkup(createElement(Publication, { view: view() }));
    expect(html).toContain('class="article"');
    expect(html).toContain('aria-label="Key indicators"');
    expect(html).toContain("Life expectancy at birth in India was ");
    expect(html).toContain("End of the original paper");
    expect(html).toContain("Last attempted refresh");
  });

  it("filters, sorts and paginates the archive; archiving removes the record", () => {
    const records = archiveRecords();
    expect(queryArchive(records, { q: "edited" }).total).toBe(1);
    expect(queryArchive(records, { year: "1999" }).total).toBe(0);
    expect(queryArchive(records, { page: 99 }).page).toBe(1);
    setArchived(id, true);
    expect(archiveRecords()).toEqual([]);
    setArchived(id, false);
    expect(archiveRecords()).toHaveLength(1);
    expect(() => removeDraft(id)).toThrow(/never been published/);
  });
});

describe("review and rejection", () => {
  it("blocks publishing an ineligible paper and allows deleting its draft", async () => {
    const p = createPaper("essay.txt", Buffer.from("An Essay On The Nature Of Justice\n\nThis is a theoretical essay with 3 arguments and no measurements at all."));
    await processPaper(p.id);
    expect(getPaper(p.id)!.analysis!.eligibility.outcome).toBe("not_eligible");
    expect(() => publish(p.id)).toThrow(/Not eligible/);
    removeDraft(p.id);
    expect(listPapers().some((x) => x.id === p.id)).toBe(false);
  });

  it("makes an ambiguous mapping live only after an explicit choice; incompatible ones cannot be forced", async () => {
    const p = createPaper("co2.md", Buffer.from("# Emissions In India A Short Note\n\nCO2 emissions per capita in India were 1.7 tonnes in 2015. Life expectancy in India was 80% in 2015."));
    await processPaper(p.id);
    const [co2, bad] = getPaper(p.id)!.analysis!.parameters;
    expect(co2.status).toBe("review");
    expect(() => decideParameter(p.id, bad.id, "approve", "wb:SP.DYN.LE00.IN")).toThrow(/cannot be overridden/);
    expect(() => decideParameter(p.id, co2.id, "approve")).toThrow(/Choose one/);
    decideParameter(p.id, co2.id, "approve", "owid:co-emissions-per-capita");
    expect(getPaper(p.id)!.analysis!.eligibility.counts.live).toBe(1);
    decideParameter(p.id, co2.id, "reset");
    expect(getPaper(p.id)!.analysis!.parameters[0].selectedIndicatorId).toBeNull();
  });

  it("reports a corrupt upload as a recoverable failure", async () => {
    const p = createPaper("broken.pdf", Buffer.from("%PDF-1.4 garbage"));
    await processPaper(p.id);
    expect(getPaper(p.id)).toMatchObject({ state: "failed" });
    expect(getPaper(p.id)!.stages[0].state).toBe("failed");
  });
});
