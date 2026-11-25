# Live Research Paper

Upload a research paper → preview an HTML publication → publish. Measurements that have a compatible public source gain later observations beside the unchanged original text. Everything else stays static, with the reason shown.

This is a **working single-server prototype**, not a hardened multi-user service.

## Setup

Requires Node.js 22.13 or newer (built and tested on 24.15). No database server is needed.

```bash
npm install
```

```bash
npm run seed:demo
```

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:3000. Author pages need a password: set `ADMIN_PASSWORD`, or open `/login` once and read the generated `data/admin-password.txt`.

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm test` | Offline tests (fake network, synthetic fixtures) |
| `npm run typecheck` | TypeScript check |
| `npm run verify:apis` | Live check of every service and mapped indicator |
| `npm run seed:demo` | Process and publish the demonstration paper using live data |

## Environment variables

Copy `.env.example` to `.env.local`. All are optional. `seed:demo` and `verify:apis` read only the shell environment, not `.env.local`.

| Variable | Effect |
|---|---|
| `ADMIN_PASSWORD` | Author password. Otherwise generated. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Suggests concepts for unmatched sentences (always needs review). **Sends paper excerpts to Google.** |
| `GROBID_URL` | Your GROBID server, for PDF header metadata and references. |
| `OPENALEX_API_KEY` | Larger OpenAlex budget than the shared keyless one. |
| `CRON_SECRET` | Enables `POST /api/cron/refresh` with `Authorization: Bearer <secret>`. |
| `SCHEDULER=0` | Turns off the in-process scheduler. |
| `DATA_DIR` | Database and uploads location (default `./data`). |

## API catalogue

The supplied repository, [nagdasmriti-alt/API-links](https://github.com/nagdasmriti-alt/API-links) (one commit when inspected), holds a single text file of documentation links: GROBID, OpenAlex (twice), World Bank, Our World in Data and Gemini. **No endpoints, code or keys.** Capabilities were established from documentation and live requests on 25 November 2026. `/sources` shows the full record per service and per indicator.

| Service | Used for | Endpoints | Verified live? | Main limitations |
|---|---|---|---|---|
| World Bank Indicators v2 | Observations | `/v2/country/{iso3}/indicator/{code}`, `/v2/country` | Yes: 30/30 indicators (India) | Annual only; no unit field; values get revised; invalid codes return HTTP 200 with a message; one request returned a bot-protection HTML page |
| OWID Chart API | Observations (CO₂) | `/grapher/{slug}.csv`, `.metadata.json` | Yes: 2/2 charts | A renamed chart's redirect dropped the country filter; some files carry old values into newer years |
| OpenAlex | Bibliographic context only | `/works/https://doi.org/{doi}`, `/works?search=` | Yes | Keyless budget is $0.10/day shared per IP. A key is optional |
| GROBID | PDF structure | `/api/processFulltextDocument` | **No.** No reachable instance (the public demos tried did not respond as an API) | Needs your own server; tested against a TEI fixture only |
| Gemini | Suggestions only | `POST /v1beta/interactions` | **No.** No key | Request shape follows the docs; treat as untested |

An OpenAlex response included text asking AI agents to create an API key using the user's email. It was not acted on, and the connector reads only whitelisted fields.

## How eligibility works

1. Every number in the body is classified: observation, derived change, interpretation, forecast, constant, sample or unrelated.
2. Observations and changes are matched to a **curated catalogue** (`src/lib/mapping/concepts.ts`). Nothing outside it is auto-mapped.
3. Each candidate gets checks for concept, unit, geography, population, time, methodology, refresh, reproducibility and traceability.
4. The key test compares the source's value for the paper's own year with the paper's figure. Tolerance: the paper's rounding (capped at 5%) or 2%, whichever is larger. Within 10% → review. Further apart → context only. Agreement is evidence of comparability, not proof of identical methodology.
5. Two sources that both pass are **not** chosen between automatically.

If a sentence names no country and the study has exactly one stated geography, that geography is used. It can be verified only if the values also agree, and the check shows a warning.

Outcomes: **Strong** = at least 2 live parameters and at least 60% of measured claims live. **Partial** = at least 1. **Contextual** = none live, but related or flagged mappings exist. **Not eligible** = otherwise; publishing is blocked.

## Routes

| Route | Access | Purpose |
|---|---|---|
| `/` | Public | Introduction |
| `/research/:slug` | Public | Published paper |
| `/archive` | Public | Search, filters, sorting, pagination |
| `/sources` | Public | API capability catalogue |
| `/login` | Public | Author sign-in |
| `/builder`, `/builder/:id` | Author | Upload, processing stages, eligibility |
| `/preview/:id` | Author | Real rendered preview, publish, optional technical review |
| `/dashboard` | Author | Drafts, published, partial, failures, archived, sources, activity |
| `/api/papers…` | Author | Upload, status, delete draft, publish, retry, review, refresh, archive, original file |
| `/api/published/:slug/original` | Public | Original file of a published paper, as a download. Publishing makes it public |
| `/api/cron/refresh` | Bearer secret | Refresh due series |
| `/api/auth`, `/api/catalogue` | Sign-in / Author | Session; re-verify catalogue |

## Storage, versions and refresh

- SQLite (`node:sqlite`) and uploaded files under `DATA_DIR`. **Back this directory up.** It needs a persistent disk on one server. It will not persist on ephemeral or serverless hosting without replacing the storage layer.
- Database triggers block updates to extracted originals and published versions. The uploaded file is hash-checked before publishing. This guards against application mistakes, not against someone with disk access.
- Publishing writes a new version snapshot. The slug never changes.
- Refresh: the in-process scheduler checks every 15 minutes **only while the server runs**; each series is requested at most once per paper interval (default 24 h). Otherwise use the cron endpoint or "Refresh sources".
- Readers only read stored observations. A visit never calls a provider.
- A failed or implausible response (changed unit, series cut by more than half) keeps the last valid data and records the failed attempt. History gets no entry for unchanged data.

## Security

Fixed outbound host allowlist (plus your `GROBID_URL`), HTTPS only, redirects re-checked, timeouts and size limits; the app never fetches user-supplied URLs. Uploads are limited to 15 MB, checked by signature, and never executed or rendered as HTML (documents become a typed block model that React escapes). Originals download with a sandbox policy. Author routes use a signed, HttpOnly, SameSite=Strict cookie with an origin check. The CSP still allows inline scripts, which Next.js needs without a nonce setup.

## Tests

`npm test`: 61 tests in 4 files covering upload validation; Markdown, PDF, DOCX and TEI parsing; classification, units, mapping, calculations and all four eligibility outcomes; response validation, request guard, retries and sessions; and an offline end-to-end run of publish, immutability, persistence after reopening the database, refresh success and failure, versions, archive queries and server rendering. The synthetic data lives only in `tests/`.

Responsive layout is **not** covered by automated tests. It was checked by hand in a browser at 1360 px and 375 px.

## Known limitations

- **Coverage is narrow:** 32 indicators in total, annual national and regional series only. A relevant paper can be "not eligible" because its concept is not catalogued.
- Extraction is rule-based English. It will miss unusual phrasing. A false "verified" is made unlikely by the value-agreement test, not impossible: two different measures can share a similar number. Read the mapping evidence before publishing.
- Numbers in tables, figures and equations are not extracted.
- PDF: text is re-flowed; tables, figures, equations and footnote placement are not reconstructed. Two-column handling is heuristic and was not tested on a real two-column journal PDF. No OCR. Only generated test PDFs were used.
- DOCX: Word equations, native charts and text boxes are not reconstructed (flagged when detected). Markdown equations stay as source notation; remote images are not fetched.
- Charts are line charts with a data table. No bar, scatter, map or uncertainty charts, because the current data does not call for them.
- Only two derived calculations (absolute and percent change between two years). No forecasts. No AI-written commentary.
- No "updating" or "manually refreshed" status label. The page shows retrieval and attempt times.
- Processing runs in the server process. If it restarts mid-job, the paper is marked interrupted and can be retried.
- Single author account; sign-in throttling is in memory. Add real user accounts, rate limiting and malware scanning before exposing uploads publicly.
- Not deployed. For deployment use one long-running Node host with a persistent volume, HTTPS, and a set `ADMIN_PASSWORD`.
- Check each indicator's own source licence before reusing data. Publishing a paper republishes it, so make sure you have the right to do that.
