import { describe, expect, it } from "vitest";
import { extractClaims, findNumbers } from "@/lib/extract/claims";
import { findGeographies } from "@/lib/extract/geography";
import { buildParameter, planMappings } from "@/lib/pipeline";
import { backcast, compute, decide } from "@/lib/mapping/validate";
import { assess } from "@/lib/eligibility";
import { indicator } from "@/lib/mapping/concepts";
import type { Block, Observation, SeriesRecord } from "@/lib/types";

const blocks = (...texts: string[]): Block[] => texts.map((t, i) => ({ id: `b${i}`, type: "paragraph", inlines: [{ t }] }));
const claims = (text: string, year = 2018) => extractClaims(blocks(text), year);
const kinds = (text: string) => claims(text).map((c) => [c.raw, c.classification]);

describe("numbers and units", () => {
  it.each([
    ["was 69.3 years", "years", 69.3],
    ["was 1.33 billion people", "people", 1.33e9],
    ["was 36.3 deaths per 1,000 live births", "per_1000_births", 36.3],
    ["was 51.4 µg/m³", "ug_m3", 51.4],
    ["was US$1,584 per capita", "usd_per_person", 1584],
    ["was 4.1% of GDP", "pct_gdp", 4.1],
    ["was 1.7 tonnes per capita", "t_per_person", 1.7],
    ["was 3.2 tonnes per hectare", "kg_per_ha", 3200],
    ["was 2.2 Gt", "tonnes", 2.2e9],
  ])("%s", (text, unit, value) => {
    const n = findNumbers(`It ${text} then.`);
    expect(n).toHaveLength(1);
    expect(n[0].unit).toBe(unit);
    expect(n[0].value).toBeCloseTo(value as number);
  });
  it("does not read digits inside identifiers", () => {
    expect(findNumbers("PM2.5 and CO2 and under-5 and SP.POP.")).toEqual([]);
  });
});

describe("classification", () => {
  it("separates measurements from other numbers", () => {
    expect(kinds("See Table 3.")).toEqual([["3", "unrelated"]]);
    expect(kinds("We surveyed 412 households.")).toEqual([["412", "sample"]]);
    expect(kinds("The WHO guideline is 5 µg/m³.")[0][1]).toBe("constant");
    expect(kinds("The share is projected to reach 40% by 2030.")[0][1]).toBe("forecast");
    expect(kinds("We estimate that 12% of deaths were attributable to smoke.")[0][1]).toBe("interpretation");
    expect(kinds("Life expectancy increased by 6.6 years between 2000 and 2015.")[0][1]).toBe("derived");
    expect(kinds("The effect was significant (p < 0.05).")[0][1]).toBe("unrelated");
  });
  it("pairs two values with two years in order, and reads a capitalised Global", () => {
    expect(claims("Access to electricity rose from 60% to 88% in India between 2000 and 2015.").map((c) => c.year).filter((_, i) => i < 2)).toEqual([2000, 2015]);
    expect(findGeographies("Global CO2 emissions per capita were high.")[0].geo.iso3).toBe("WLD");
  });
  it("does not treat 'share of the population' as a population count", () => {
    const [plan] = planMappings(claims("In India, 30% of the population were smokers in 2015."));
    expect(plan.concept).toBeNull();
  });
  it("skips the reference list", () => {
    const b: Block[] = [{ id: "h", type: "heading", level: 2, inlines: [{ t: "References" }] }, ...blocks("Vol 12, 45% of it.")];
    expect(extractClaims(b, 2018)).toEqual([]);
  });
  it("detects geography without reading US$ as a country", () => {
    expect(findGeographies("It cost US$5 in India.").map((g) => g.geo.iso3)).toEqual(["IND"]);
  });
});

/* ---------- mapping, with synthetic series ---------- */

const DATA: Record<string, Observation[]> = {
  "wb:SP.DYN.LE00.IN": [{ period: 2000, value: 62.7 }, { period: 2015, value: 69.33 }, { period: 2022, value: 71.7 }],
  "wb:EN.GHG.CO2.PC.CE.AR5": [{ period: 2015, value: 1.72 }],
  "owid:co-emissions-per-capita": [{ period: 2015, value: 1.68 }],
  "wb:EN.ATM.PM25.MC.M3": [{ period: 2015, value: 51.4 }],
  "wb:SL.UEM.TOTL.ZS": [{ period: 2015, value: 7.6 }],
  "wb:SI.POV.DDAY": [{ period: 2015, value: 18 }],
};
const load = async (id: string) => {
  const ind = indicator(id);
  const record: SeriesRecord = { key: `${id}@IND`, indicatorId: id, geo: { iso3: "IND", name: "India" }, observations: DATA[id] ?? [], lastSuccessAt: "2026-01-01T00:00:00Z", lastAttemptAt: "2026-01-01T00:00:00Z", lastError: null,
    meta: { provider: ind.provider, datasetName: "t", indicatorCode: ind.code, title: ind.unitGuard, unit: ind.unitGuard, endpoint: "https://x", humanUrl: "https://x", licence: "", citation: "", providerUpdated: null, frequency: "annual" } };
  return { key: record.key, ok: !!DATA[id], error: DATA[id] ? null : "no data", changes: [], record };
};
const map = async (text: string) => {
  const plans = planMappings(claims(text));
  return Promise.all(plans.map((p) => buildParameter(p, [], load)));
};

describe("mapping and validation", () => {
  it("verifies a compatible claim whose source agrees for the paper's year", async () => {
    const [p] = await map("Life expectancy at birth in India was 69.3 years in 2015.");
    expect(p).toMatchObject({ status: "verified", selectedIndicatorId: "wb:SP.DYN.LE00.IN", paperYear: 2015 });
  });
  it("makes a materially different value contextual", async () => {
    const [p] = await map("The unemployment rate in India was 40.0% in 2015.");
    expect(p.status).toBe("contextual");
  });
  it("flags a missing year instead of guessing", async () => {
    const [p] = await map("Life expectancy at birth in India is 69.3 years.");
    expect(p.status).toBe("review");
  });
  it("does not choose silently between two plausible sources", async () => {
    const [p] = await map("CO2 emissions per capita in India were 1.7 tonnes in 2015.");
    expect(p.status).toBe("review");
    expect(p.selectedIndicatorId).toBeNull();
    expect(p.candidates.filter((c) => c.status === "verified")).toHaveLength(2);
  });
  it("treats a city value as context only", async () => {
    const [p] = await map("Annual PM2.5 in Delhi, India was 51.4 µg/m³ in 2015.");
    expect(p.status).toBe("contextual");
    expect(p.candidates[0].checks.some((c) => c.dimension === "population" && c.result === "fail")).toBe(true);
  });
  it("rejects an incompatible unit, an incompatible concept and a different poverty line", async () => {
    expect((await map("Life expectancy in India was 80% in 2015."))[0].status).toBe("rejected");
    expect((await map("Daily PM2.5 in India was 51.4 µg/m³ in 2015."))[0].status).toBe("rejected");
    expect((await map("The poverty rate in India below the $2.15 line was 18% in 2015."))[0].status).toBe("rejected");
  });
  it("leaves a claim with no geography or no concept unsupported", async () => {
    expect((await map("Life expectancy at birth was 69.3 years in 2015."))[0].status).toBe("unsupported");
    expect((await map("In India 40% of homes had a monitor in 2015."))[0].status).toBe("unsupported");
  });
  it("recomputes a derived change from source inputs", async () => {
    const [p] = await map("Life expectancy at birth in India increased by 6.6 years between 2000 and 2015.");
    expect(p).toMatchObject({ kind: "calculated", status: "verified", calculation: { id: "abs_change", fromYear: 2000, toYear: 2015 } });
    expect(compute(p.calculation!, DATA["wb:SP.DYN.LE00.IN"], 2022)).toBeCloseTo(9);
  });
  it("applies rounding tolerance without letting coarse rounding match anything", () => {
    expect(backcast(1.33e9, 5e6, 1.328e9).verdict).toBe("match");
    expect(backcast(1e9, 5e8, 1.4e9).verdict).toBe("differs");
    expect(decide([]).status).toBe("unsupported");
  });
});

describe("eligibility", () => {
  const run = async (text: string) => assess(await map(text), claims(text)).outcome;
  it("covers all four outcomes", async () => {
    const good = "Life expectancy at birth in India was 69.3 years in 2015. ";
    expect(await run(good + "Life expectancy at birth in India was 62.7 years in 2000.")).toBe("strong");
    expect(await run(good + "In India 40% of homes had a monitor in 2015.")).toBe("partial");
    expect(await run("The unemployment rate in India was 40.0% in 2015.")).toBe("contextual");
    expect(await run("This theoretical essay discusses 3 ideas about justice.")).toBe("not_eligible");
  });
});
