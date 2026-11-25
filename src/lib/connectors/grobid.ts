import { parse as parseHtml } from "node-html-parser";
import { safeFetch, type FetchOptions } from "../safeFetch";
import type { Metadata } from "../types";

/**
 * Optional connector for an operator-run GROBID service. Used for header metadata and references;
 * body text still comes from the built-in extractor. Tested only against a TEI fixture:
 * no GROBID instance was reachable when this was built.
 */
export const grobidConfigured = () => !!process.env.GROBID_URL;

export function parseTei(tei: string): { metadata: Partial<Metadata>; references: string[] } {
  // Lower-casing tag names makes the selectors reliable for TEI's camelCase elements.
  const doc = parseHtml(tei.replace(/<(\/?)([A-Za-z][\w:.-]*)/g, (_, slash, name: string) => `<${slash}${name.toLowerCase()}`));
  const header = doc.querySelector("teiheader");
  const text = (s: string) => header?.querySelector(s)?.text.replace(/\s+/g, " ").trim() ?? "";
  const authors = (header?.querySelectorAll("sourcedesc author persname") ?? [])
    .map((p) => p.childNodes.map((n) => n.text.trim()).filter(Boolean).join(" "));
  const date = header?.querySelector('publicationstmt date[type="published"]')?.getAttribute("when") ?? "";
  const references = doc.querySelectorAll("listbibl biblstruct").map((b) =>
    b.querySelectorAll("title, surname, date, idno").map((n) => (n.getAttribute("when") ?? n.text).trim()).filter(Boolean).join(". "));
  return {
    metadata: {
      title: text("titlestmt title"), authors, abstract: text("profiledesc abstract"), publicationDate: date,
      year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null, doi: text('idno[type="DOI"]'), publisher: text("publicationstmt publisher"),
    },
    references,
  };
}

export async function grobidExtract(pdf: Buffer, o: FetchOptions = {}) {
  const form = new FormData();
  form.append("input", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), "paper.pdf");
  const url = new URL("api/processFulltextDocument", process.env.GROBID_URL!.replace(/\/?$/, "/")).toString();
  const res = await safeFetch(url, { ...o, method: "POST", body: form, timeoutMs: 90_000, retries: 1 });
  if (res.status === 204 || !res.text.includes("<TEI")) throw new Error("GROBID extracted nothing");
  return parseTei(res.text);
}
