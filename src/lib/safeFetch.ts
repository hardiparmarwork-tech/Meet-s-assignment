/**
 * All outbound requests go through here. The application never fetches a URL taken from an
 * upload or from an API response: hosts are a fixed allowlist (plus the operator-configured
 * GROBID_URL), redirects are re-checked, and time and size are bounded.
 */
const ALLOWED_HOSTS = new Set([
  "api.worldbank.org",
  "ourworldindata.org",
  "api.openalex.org",
  "generativelanguage.googleapis.com",
]);

export class FetchError extends Error {
  constructor(message: string, public status?: number, public retryable = false) {
    super(message);
    this.name = "FetchError";
  }
}

export function assertAllowedUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new FetchError("Invalid URL"); }
  const grobid = process.env.GROBID_URL ? new URL(process.env.GROBID_URL) : null;
  if (grobid && url.origin === grobid.origin) return url;
  if (url.protocol !== "https:") throw new FetchError(`Blocked protocol: ${url.protocol}`);
  if (url.username || url.password || url.port) throw new FetchError("Blocked URL form");
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new FetchError(`Blocked host: ${url.hostname}`);
  return url;
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | FormData;
  timeoutMs?: number;
  maxBytes?: number;
  retries?: number;
  /** Base backoff; tests set this to 0. */
  backoffMs?: number;
}

export interface FetchResult { status: number; text: string; headers: Headers; url: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function once(raw: string, o: FetchOptions): Promise<FetchResult> {
  let url = assertAllowedUrl(raw);
  const signal = AbortSignal.timeout(o.timeoutMs ?? 20_000);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      method: o.method ?? "GET",
      headers: { "User-Agent": "live-research-paper/0.1", ...o.headers },
      body: o.body,
      redirect: "manual",
      signal,
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = assertAllowedUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const err = new FetchError(
        res.status === 429 ? "Rate limited by provider (HTTP 429)" : `Provider returned HTTP ${res.status}`,
        res.status, res.status === 429 || res.status >= 500,
      );
      (err as FetchError & { retryAfterMs?: number }).retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 0;
      await res.body?.cancel();
      throw err;
    }
    const max = o.maxBytes ?? 8 * 1024 * 1024;
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new FetchError(`Response exceeded ${max} bytes`);
      }
      chunks.push(value);
    }
    return { status: res.status, text: Buffer.concat(chunks).toString("utf8"), headers: res.headers, url: url.toString() };
  }
  throw new FetchError("Too many redirects");
}

export async function safeFetch(url: string, o: FetchOptions = {}): Promise<FetchResult> {
  const retries = o.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    try {
      return await once(url, o);
    } catch (e) {
      const err = e instanceof FetchError ? e
        : new FetchError((e as Error).name === "TimeoutError" ? "Request timed out" : `Network error: ${(e as Error).message}`, undefined, true);
      const wait = (err as FetchError & { retryAfterMs?: number }).retryAfterMs || (o.backoffMs ?? 800) * 2 ** attempt;
      // A long Retry-After is not worth blocking a job for; report it instead.
      if (!err.retryable || attempt >= retries || wait > 15_000) throw err;
      await sleep(wait);
    }
  }
}
