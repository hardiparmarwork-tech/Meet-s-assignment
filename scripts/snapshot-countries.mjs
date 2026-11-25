// Regenerates the country/aggregate list from the live World Bank API.
import { writeFileSync } from "node:fs";
const j = await (await fetch("https://api.worldbank.org/v2/country?format=json&per_page=400")).json();
const keepAgg = new Set(["WLD","SSF","SAS","EUU","EAS","LCN","HIC","LIC","LMC","UMC","ARB","MEA","NAC","ECS"]);
const out = j[1].filter(c => c.region.value !== "Aggregates" || keepAgg.has(c.id)).map(c => [c.id, c.name.trim()]);
writeFileSync(new URL("../src/lib/extract/countries.json", import.meta.url), JSON.stringify({ source: "https://api.worldbank.org/v2/country", retrievedAt: new Date().toISOString(), countries: out }));
console.log(out.length, "entries");
