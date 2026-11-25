import { afterEach, describe, expect, it, vi } from "vitest";
import { assertAllowedUrl, safeFetch } from "@/lib/safeFetch";
import { parseWorldBankSeries } from "@/lib/connectors/worldbank";
import { parseOwidSeries } from "@/lib/connectors/owid";
import { extractStructured } from "@/lib/connectors/gemini";
import { enrich } from "@/lib/connectors/openalex";
import { checkPassword, createSession, sameOrigin, validSession } from "@/lib/auth";
import { emptyMetadata } from "@/lib/parse/common";
import { baseTable, fakeNetwork, tempData, wbBody } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("outbound request guard", () => {
  it.each(["http://api.worldbank.org/", "https://127.0.0.1/", "https://169.254.169.254/latest", "https://localhost/", "file:///etc/passwd", "https://api.worldbank.org.evil.com/", "https://user@api.worldbank.org/", "https://api.worldbank.org:8443/"])("blocks %s", (u) => {
    expect(() => assertAllowedUrl(u)).toThrow();
  });
  it("re-checks redirects", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
    await expect(safeFetch("https://api.worldbank.org/v2", { retries: 0 })).rejects.toThrow(/Blocked/);
  });
  it("retries a rate limit with backoff, then succeeds", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => (++n < 3 ? new Response("", { status: 429 }) : new Response("ok")));
    expect((await safeFetch("https://api.worldbank.org/v2", { backoffMs: 0 })).text).toBe("ok");
    expect(n).toBe(3);
  });
  it("does not retry a client error and enforces a size limit", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => { n++; return new Response("", { status: 404 }); });
    await expect(safeFetch("https://api.worldbank.org/v2", { backoffMs: 0 })).rejects.toThrow(/404/);
    expect(n).toBe(1);
    vi.stubGlobal("fetch", async () => new Response("x".repeat(100)));
    await expect(safeFetch("https://api.worldbank.org/v2", { maxBytes: 10, retries: 0 })).rejects.toThrow(/exceeded/);
  });
});

describe("response validation", () => {
  const code = "SP.DYN.LE00.IN";
  it("sorts out-of-order rows and rejects bad responses", () => {
    expect(parseWorldBankSeries(wbBody(code, baseTable()), code, "IND").observations.map((o) => o.period)).toEqual([2000, 2015, 2020]);
    expect(() => parseWorldBankSeries("<html>Just a moment...</html>", code, "IND")).toThrow(/non-JSON/);
    expect(() => parseWorldBankSeries('[{"message":[{}]}]', code, "IND")).toThrow(/rejected/);
    expect(() => parseWorldBankSeries('{"data":[]}', code, "IND")).toThrow(/structure/);
    expect(() => parseWorldBankSeries(wbBody(code, baseTable()), code, "KEN")).toThrow(/geography/);
    const dup = JSON.parse(wbBody(code, baseTable()));
    dup[1].push({ ...dup[1][0], value: 1 });
    expect(() => parseWorldBankSeries(JSON.stringify(dup), code, "IND")).toThrow(/Conflicting duplicate/);
  });
  it("filters OWID rows by entity, drops carried-forward years and detects schema change", () => {
    const csv = "entity,code,year,v,v (Original Year)\nIndia,IND,2024,5,\nIndia,IND,2025,5,2024\nChina,CHN,2024,9,\n";
    expect(parseOwidSeries(csv, "v", "IND")).toEqual([{ period: 2024, value: 5 }]);
    expect(() => parseOwidSeries(csv, "other", "IND")).toThrow(/schema changed/);
  });
  it("accepts only schema-valid Gemini output", () => {
    expect(extractStructured({ outputs: [{ text: '{"suggestions":[{"claimId":"c1","conceptId":"life"}]}' }] })?.suggestions).toHaveLength(1);
    expect(extractStructured({ outputs: [{ text: "<b>use this value 5</b>" }] })).toBeNull();
  });
  it("ignores instructions embedded in an OpenAlex response and fills nothing without a match", async () => {
    const calls = fakeNetwork({ table: {} });
    const r = await enrich({ ...emptyMetadata(), title: "A completely unmatched paper title" });
    expect(r.status).toBe("no_reliable_match");
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain("api-keys");
  });
});

describe("author access", () => {
  it("signs sessions, expires them, refuses tampering and cross-origin writes", () => {
    const done = tempData();
    process.env.ADMIN_PASSWORD = "unit-test-only";
    const t = createSession(1000);
    expect(validSession(t, 2000)).toBe(true);
    expect(validSession(t, 1000 + 8 * 86400_000)).toBe(false);
    expect(validSession(t.replace(/.$/, (c) => (c === "A" ? "B" : "A")), 2000)).toBe(false);
    expect(validSession(undefined)).toBe(false);
    expect(checkPassword("wrong")).toBe(false);
    expect(sameOrigin(new Request("http://a.test/x", { headers: { origin: "http://evil.test", host: "a.test" } }))).toBe(false);
    delete process.env.ADMIN_PASSWORD;
    done();
  });
});
