import { kvGet, kvSet, now } from "./db";
import { INDICATORS } from "./mapping/concepts";
import { retrieve } from "./series";
import { safeFetch } from "./safeFetch";
import { grobidConfigured } from "./connectors/grobid";
import { geminiConfigured, geminiModel } from "./connectors/gemini";

export interface Health { state: "ok" | "failed" | "not_configured" | "not_tested"; detail: string; checkedAt: string | null }

export interface Service {
  id: string; provider: string; role: string; baseUrl: string; endpoints: string[]; returns: string; coverage: string;
  cadence: string; query: string; auth: string; limits: string; licence: string; restrictions: string; docs: string;
  statistics: boolean;
}

export const SERVICES: Service[] = [
  { id: "worldbank", provider: "World Bank", role: "Indicators API (v2)", baseUrl: "https://api.worldbank.org/v2", statistics: true,
    endpoints: ["GET /country/{iso3}/indicator/{code}?format=json&per_page=1000", "GET /country?format=json&per_page=400"],
    returns: "Raw annual observations and indicator metadata.", coverage: "Countries and aggregates; about 29,500 indicator codes across all databases listed by the API, of which this application maps a curated subset. Time coverage varies by indicator.",
    cadence: "Periodic dataset releases; the response carries a 'lastupdated' date. Observations used here are annual.", query: "ISO3 geography and indicator code. JSON is [metadata, rows]; invalid codes return HTTP 200 with a 'message' object.",
    auth: "None.", limits: "No published rate limit found. Documented limits: 60 indicators per call, 4,000-character URL. A bot-protection HTML page has been observed in place of JSON on one request.",
    licence: "World Bank terms of use; most WDI data CC BY 4.0, some third-party series differ.", restrictions: "No unit field on observations; the unit is in the indicator name. Values are revised between releases.", docs: "https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation" },
  { id: "owid", provider: "Our World in Data", role: "Chart API", baseUrl: "https://ourworldindata.org", statistics: true,
    endpoints: ["GET /grapher/{slug}.csv?csvType=filtered&country=~{CODE}&useColumnShortNames=true", "GET /grapher/{slug}.metadata.json"],
    returns: "Processed observations (CSV) and column metadata (unit, lastUpdated, citation).", coverage: "Per chart. Only the two CO2 charts are mapped here.",
    cadence: "Per dataset; metadata gives lastUpdated and nextUpdate. CO2 data are annual.", query: "Chart slug and entity code (World is OWID_WRL).",
    auth: "None.", limits: "No rate limit stated in the documentation.", licence: "CC BY 4.0 for OWID work; third-party source licences apply. Non-redistributable charts return 403.",
    restrictions: "Renamed charts redirect and the redirect can drop the country filter (observed), so rows are filtered again here. '(Original Year)' columns mark carried-forward values, which are discarded.", docs: "https://docs.owid.io/projects/etl/api/" },
  { id: "openalex", provider: "OpenAlex", role: "Scholarly metadata (not a statistics source)", baseUrl: "https://api.openalex.org", statistics: false,
    endpoints: ["GET /works/https://doi.org/{doi}", "GET /works?search={title}&per_page=5"],
    returns: "Works, authors, venues, topics and citation counts.", coverage: "Scholarly literature across disciplines.", cadence: "Continuously maintained index; not a source of research statistics.",
    query: "DOI lookup or title search with 'select' fields.", auth: "Optional API key (OPENALEX_API_KEY), sent as a bearer token.",
    limits: "Keyless use shares a $0.10/day budget per IP address (reported by the API); a free key has a larger daily budget. Search calls cost budget; single-record lookups are free.", licence: "CC0.",
    restrictions: "Used only to enrich bibliographic context. Never overwrites document metadata.", docs: "https://help.openalex.org/api/" },
  { id: "grobid", provider: "GROBID", role: "Scholarly PDF parsing (self-hosted)", baseUrl: "GROBID_URL (not part of the API repository)", statistics: false,
    endpoints: ["POST /api/processFulltextDocument", "GET /api/isalive"], returns: "TEI XML structure of a PDF.", coverage: "PDF documents.", cadence: "Not a data source.",
    query: "multipart field 'input'.", auth: "None on a default install.", limits: "Returns 503 when all workers are busy.", licence: "Apache 2.0 software.",
    restrictions: "The repository links only documentation, not a running service. Without GROBID_URL the built-in parser is used. This connector has only been tested against a TEI fixture.", docs: "https://grobid.readthedocs.io/en/latest/Grobid-service/" },
  { id: "gemini", provider: "Google Gemini", role: "Assisted interpretation (not a data source)", baseUrl: "https://generativelanguage.googleapis.com/v1beta", statistics: false,
    endpoints: ["POST /interactions"], returns: "Model output constrained to a JSON schema.", coverage: "Not applicable.", cadence: "Not a data source.",
    query: "model, input, response_format.", auth: "Required: GEMINI_API_KEY in the x-goog-api-key header.", limits: "Depends on the account's quota.", licence: "Google API terms. Enabling it sends paper excerpts to Google.",
    restrictions: "Only suggests which curated concept a sentence refers to; suggestions always need author review. Not exercised against the live service in this build.", docs: "https://ai.google.dev/gemini-api/docs" },
];

export interface CatalogueReport {
  checkedAt: string;
  services: Record<string, Health>;
  indicators: Record<string, { state: "ok" | "failed"; detail: string; title: string; unit: string; first: number | null; latest: number | null; providerUpdated: string | null }>;
  probeGeography: string;
}

const KEY = "catalogue:v1";
export const cachedCatalogue = () => kvGet<CatalogueReport>(KEY, Number.MAX_SAFE_INTEGER);

/** Live verification of every mapped indicator and service. */
export async function verifyCatalogue(probeGeography = "IND"): Promise<CatalogueReport> {
  const checkedAt = now();
  const indicators: CatalogueReport["indicators"] = {};
  const queue = [...INDICATORS];
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let ind = queue.shift(); ind; ind = queue.shift()) {
      try {
        const r = await retrieve(ind, probeGeography);
        const guarded = r.meta.unit.includes(ind.unitGuard) || r.meta.title.includes(ind.unitGuard);
        indicators[ind.id] = { state: guarded ? "ok" : "failed", detail: guarded ? `${r.observations.length} observations for ${probeGeography}.` : `Unit guard "${ind.unitGuard}" not found.`,
          title: r.meta.title, unit: r.meta.unit, first: r.observations[0].period, latest: r.observations.at(-1)!.period, providerUpdated: r.meta.providerUpdated };
      } catch (e) {
        indicators[ind.id] = { state: "failed", detail: (e as Error).message, title: ind.name, unit: "", first: null, latest: null, providerUpdated: null };
      }
    }
  }));
  const health = (state: Health["state"], detail: string): Health => ({ state, detail, checkedAt });
  const fromIndicators = (prefix: string) => {
    const list = Object.entries(indicators).filter(([id]) => id.startsWith(prefix));
    const ok = list.filter(([, v]) => v.state === "ok").length;
    return health(ok === list.length ? "ok" : "failed", `${ok}/${list.length} mapped indicators verified.`);
  };
  const ping = async (url: string, headers: Record<string, string> = {}) => {
    try { await safeFetch(url, { headers, retries: 1, timeoutMs: 15_000 }); return health("ok", "Responded."); }
    catch (e) { return health("failed", (e as Error).message); }
  };
  const report: CatalogueReport = {
    checkedAt, probeGeography, indicators,
    services: {
      worldbank: fromIndicators("wb:"),
      owid: fromIndicators("owid:"),
      openalex: await ping("https://api.openalex.org/works/https://doi.org/10.1038/s41586-020-2649-2?select=id"),
      grobid: grobidConfigured() ? await ping(new URL("api/isalive", process.env.GROBID_URL!.replace(/\/?$/, "/")).toString()) : health("not_configured", "GROBID_URL is not set."),
      gemini: geminiConfigured() ? health("not_tested", `Key present (model ${geminiModel()}). It is not called until a paper needs it.`) : health("not_configured", "GEMINI_API_KEY is not set."),
    },
  };
  kvSet(KEY, report);
  return report;
}
