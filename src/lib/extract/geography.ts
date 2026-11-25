import snapshot from "./countries.json";
import type { Geography } from "../types";

const ALIASES: Record<string, string[]> = {
  USA: ["United States", "United States of America", "USA", "U.S.", "the US"],
  GBR: ["United Kingdom", "the UK", "Britain"],
  KOR: ["South Korea", "Republic of Korea"], PRK: ["North Korea"],
  VNM: ["Vietnam", "Viet Nam"], IRN: ["Iran"], RUS: ["Russia"], EGY: ["Egypt"], TUR: ["Turkey", "Türkiye"],
  VEN: ["Venezuela"], YEM: ["Yemen"], SYR: ["Syria"], LAO: ["Laos"], SVK: ["Slovakia"], KGZ: ["Kyrgyzstan"],
  COD: ["Democratic Republic of the Congo", "DR Congo"], COG: ["Republic of the Congo"], GMB: ["Gambia"], BHS: ["Bahamas"],
  CIV: ["Ivory Coast", "Côte d'Ivoire"], CZE: ["Czech Republic", "Czechia"], HKG: ["Hong Kong"],
  WLD: ["globally", "worldwide", "the world", "world's", "global population", "global average", "Globally", "Worldwide", "Global CO2", "Global CO₂", "Global life", "Global GDP", "global life", "global GDP", "global CO2", "global CO₂"],
  SSF: ["Sub-Saharan Africa", "sub-Saharan Africa"], SAS: ["South Asia"], EUU: ["European Union"],
};

const names = new Map<string, string>();
const display = new Map<string, string>();
for (const [iso3, name] of snapshot.countries as [string, string][]) {
  display.set(iso3, ALIASES[iso3] && !["WLD", "SSF", "SAS", "EUU"].includes(iso3) ? ALIASES[iso3][0] : name.trim());
  if (!name.includes(",") && !name.includes("(")) names.set(name.trim(), iso3);
}
display.set("WLD", "World");
display.delete("");
for (const [iso3, list] of Object.entries(ALIASES)) for (const alias of list) names.set(alias, iso3);
names.delete("World");
names.delete("High income");
names.delete("Low income");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERN = new RegExp(`(?<![\\w])(${[...names.keys()].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![\\w$])`, "g");

export const geographyByIso = (iso3: string): Geography => ({ iso3, name: display.get(iso3) ?? iso3 });

export function findGeographies(text: string): { geo: Geography; index: number }[] {
  return [...text.matchAll(PATTERN)].map((m) => ({ geo: geographyByIso(names.get(m[1])!), index: m.index }));
}

/** Phrases that indicate a sub-national population, which national series cannot represent. */
export const SUBNATIONAL = /\b(Delhi|Mumbai|Kolkata|Chennai|Bengaluru|Bangalore|Hyderabad|Pune|Ahmedabad|Kanpur|Lucknow|Patna|Beijing|Shanghai|Guangzhou|London|Paris|New York|Los Angeles|Chicago|Lagos|Nairobi|Cairo|Dhaka|Karachi|Lahore|Jakarta|Manila|Bangkok|Tokyo|Seoul|S[ãa]o Paulo|Mexico City|Johannesburg|Kerala|Bihar|Maharashtra|Gujarat|Punjab|Tamil Nadu|Uttar Pradesh|West Bengal|California|Texas|England|Scotland|Wales)\b|\b(city|district|province|county|municipality|village|metropolitan area)\b|\bstate of\b/i;
