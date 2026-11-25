import type { Block, Classification, QuantClaim, UnitKind } from "../types";
import { blockText, isReferencesHeading } from "../parse/common";

export function splitSentences(text: string): string[] {
  return text
    .replace(/\b(e\.g|i\.e|et al|vs|approx|Fig|Eq|No|Dr|Prof)\./g, "$1․")
    .split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/)
    .map((s) => s.replace(/․/g, ".").trim())
    .filter(Boolean);
}

// A number not embedded in an identifier such as PM2.5, CO2, SP.POP or under-5.
const NUMBER = /(?<![\w.,\-–/])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?![\d]|,\d|\.\d)/g;
const MAGNITUDE: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const MONTHS = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(of\s+)?(19|20)\d{2}\b|\bQ[1-4]\b|\b(first|second|third|fourth) quarter\b|\bfiscal year\b|\bFY ?\d{2}|\b(19|20)\d{2}[–-]\d{2}\b/i;

export interface NumberToken { raw: string; start: number; end: number; value: number; precision: number; unit: UnitKind; unitText: string }

export function readUnit(sentence: string, start: number, end: number, digits: string): NumberToken {
  const before = sentence.slice(Math.max(0, start - 12), start);
  const after = sentence.slice(end, end + 70);
  const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
  let value = Number(digits.replace(/,/g, ""));
  let precision = 10 ** -decimals;
  let consumed = 0;
  let unit: UnitKind = "unknown";
  let unitText = "";
  const take = (re: RegExp) => {
    const m = after.slice(consumed).match(re);
    if (m) consumed += m[0].length;
    return m;
  };
  const mag = take(/^[\s-]?(thousand|million|billion|trillion)\b/i);
  if (mag) { const k = MAGNITUDE[mag[1].toLowerCase()]; value *= k; precision *= k; }

  const currency = /(US\s?\$|\$|USD\s?)$/.test(before) ? before.match(/(US\s?\$|\$|USD\s?)$/)![0] : "";
  const tail = after.slice(consumed);
  const perPerson = /\bper[- ](capita|person)\b/i.test(sentence);
  const m = (re: RegExp, kind: UnitKind) => {
    if (unit !== "unknown") return;
    const found = tail.match(re);
    if (found) { unit = kind; unitText = found[0].trim(); consumed += found[0].length; }
  };

  if (currency || /^\s*(US )?dollars\b|^\s*(current |constant )?(US\$|USD)\b|^\s*international dollars/i.test(tail)) {
    const intl = /\bPPP\b|purchasing power|international dollar/i.test(sentence);
    unit = perPerson ? (intl ? "intl_usd_per_person" : "usd_per_person") : "usd";
    unitText = `${currency}${currency ? "" : tail.match(/^\s*[A-Za-z$ ]+?(dollars|US\$|USD)/i)?.[0] ?? ""}`.trim();
  }
  m(/^\s*(%|per ?cent)\s+of\s+(the\s+)?(GDP|gross domestic product)/i, "pct_gdp");
  m(/^\s*(%|per ?cent\b|percentage points?\b)/i, "percent");
  m(/^\s*(deaths\s+)?per\s+(1,000|1000|thousand)\s+live\s+births/i, "per_1000_births");
  m(/^\s*((maternal )?deaths\s+)?per\s+(100,000|100000)\s+live\s+births/i, "per_100000_births");
  m(/^\s*(live\s+)?(births|children)\s+per\s+woman/i, "births_per_woman");
  m(/^\s*(µg|μg|ug)\s?\/\s?m(3|³)|^\s*micrograms\s+per\s+cubic\s+met(er|re)/i, "ug_m3");
  m(/^\s*(kg\s?\/\s?ha\b|kg\s+per\s+hectare|kilograms\s+per\s+hectare)/i, "kg_per_ha");
  m(/^\s*kWh(\s+per\s+(person|capita))?/i, "kwh_per_person");
  if (unit === "unknown") {
    const perHa = tail.match(/^\s*(metric\s+)?(tonnes|tons|t)\s*(\/\s?ha\b|per\s+hectare)/i);
    if (perHa) { unit = "kg_per_ha"; unitText = perHa[0].trim(); value *= 1000; precision *= 1000; consumed += perHa[0].length; }
  }
  if (unit === "unknown") {
    const t = tail.match(/^\s*(metric\s+)?(tonnes?|tons?\b|t\b|Mt\b|Gt\b)(\s*(of\s+)?(CO2|CO₂|carbon dioxide)e?)?(\s+per\s+(capita|person))?/i);
    if (t) {
      unitText = t[0].trim();
      consumed += t[0].length;
      const scale = /\bMt\b/.test(t[2]) ? 1e6 : /\bGt\b/.test(t[2]) ? 1e9 : 1;
      value *= scale; precision *= scale;
      unit = t[6] || (perPerson && value < 1000) ? "t_per_person" : "tonnes";
    }
  }
  m(/^[\s-]*years?\b(?!\s*(old|of age|ago|later|period|earlier))/i, "years");
  m(/^\s*(people|inhabitants|persons|residents)\b/i, "people");

  const raw = sentence.slice(start - currency.length, end + consumed).trim();
  return { raw, start: start - currency.length, end: end + consumed, value, precision, unit, unitText };
}

export function findNumbers(sentence: string): NumberToken[] {
  const out: NumberToken[] = [];
  let consumedTo = 0;
  for (const m of sentence.matchAll(NUMBER)) {
    if (m.index < consumedTo) continue; // e.g. the "1,000" inside "per 1,000 live births"
    const digits = m[1] + (m[2] ?? "");
    const token = readUnit(sentence, m.index, m.index + m[0].length, digits);
    consumedTo = token.end;
    out.push(token);
  }
  return out;
}

const isYearToken = (t: NumberToken) => t.unit === "unknown" && /^(1[89]|20)\d{2}$/.test(t.raw);

/** The reference year of a number: the one that follows it directly, else the closest in the sentence. */
export function yearFor(sentence: string, token: NumberToken, numbers: NumberToken[]): number | null {
  const years = numbers.filter(isYearToken);
  if (!years.length) return null;
  if (years.length === 1) return years[0].value;
  // "from A to B between Y1 and Y2": the two values belong to the two years, in order.
  const range = sentence.match(/\bfrom\s+\S*\d[^;]*?\bto\s+\S*\d[^;]*?\b(?:between\s+(?:19|20)\d{2}\s+and|from\s+(?:19|20)\d{2}\s+to)\s+(?:19|20)\d{2}/i);
  const measured = numbers.filter((n) => !isYearToken(n));
  if (range && years.length === 2 && measured.length === 2) return years[measured.indexOf(token)]?.value ?? null;
  const next = numbers[numbers.indexOf(token) + 1];
  if (next && isYearToken(next) && /^\s*(\(?\s*)?(in|during|for|by|\()\s*(the year\s*)?$/i.test(sentence.slice(token.end, next.start))) return next.value;
  const preceding = years.filter((y) => y.start < token.start);
  return (preceding.at(-1) ?? years[0]).value;
}

/** Splits at contrast and clause boundaries so wording applies only to its own part of a sentence. */
export function clauseAround(sentence: string, index: number): { text: string; start: number } {
  const cuts = [0, ...[...sentence.matchAll(/;\s|,?\s(?=(?:while|whereas|whilst|but|although|compared with|compared to|against|versus)\b)/gi)].map((m) => m.index + m[0].length), sentence.length];
  const i = cuts.findIndex((c, k) => index >= c && index < (cuts[k + 1] ?? Infinity));
  return { text: sentence.slice(cuts[i], cuts[i + 1]), start: cuts[i] };
}

export function classify(sentence: string, token: NumberToken, year: number | null, publicationYear: number | null): { classification: Classification; reason: string } {
  const is = (classification: Classification, reason: string) => ({ classification, reason });
  const clause = clauseAround(sentence, token.start).text;
  const before = sentence.slice(Math.max(0, token.start - 30), token.start);
  const after = sentence.slice(token.end, token.end + 30);
  if (isYearToken(token)) return is("unrelated", "Calendar year.");
  if (/(table|figure|fig\.|section|chapter|equation|eq\.|page|pp?\.|wave|phase|model|step|appendix)\s*$/i.test(before)) return is("unrelated", "Document cross-reference.");
  if (/\[[\d,\s–-]*$/.test(before) && /^[\d,\s–-]*\]/.test(after)) return is("unrelated", "Citation marker.");
  if (/\b(ISO|SDG|COVID-)\s*$/.test(before)) return is("unrelated", "Part of a name or standard.");
  if (/\bn\s*=\s*$/i.test(before) || /\b(our (study )?sample|sample of|respondents|participants|we (surveyed|interviewed|recruited|sampled)|households? (were )?(surveyed|interviewed|sampled)|patients (were )?(enrolled|included))\b/i.test(clause))
    return is("sample", "Describes the study's own sample; it cannot be refreshed from an external source.");
  if (/\bp\s*[<>=≤]\s*$|\b(r|r²|r2|β|beta|t|F|OR|HR|RR)\s*[=:]\s*$/i.test(before) || /^%?\s*(confidence interval|CI\b)/i.test(after) || /\bCI\b[^)]{0,12}$/.test(before))
    return is("unrelated", "Statistical test output or confidence-interval notation.");
  if ((year !== null && publicationYear !== null && year > publicationYear) || /\b(projected|projections?|forecast|is expected|are expected|expected to|will (reach|rise|fall|be|increase|decrease|grow|exceed)|is likely to|by 20[3-9]\d)\b/i.test(clause))
    return is("forecast", "A projection or future statement; later observations do not replace a forecast.");
  if (/\b(guideline|threshold|standard|target of|target value|limit of|legal limit|poverty line|defined as|benchmark|recommended)\b/i.test(clause))
    return is("constant", "A fixed reference value such as a guideline, target or definition.");
  if (/\b(we estimate|we find|our (model|analysis|estimates?)|attributable|associated with|odds|risk of|coefficient|elasticity|explains?|accounts? for \d)\b/i.test(clause))
    return is("interpretation", "A finding produced by the study's own analysis; external series cannot reproduce it.");
  const growthLevel = /growth( rate)?|inflation|grew/i.test(clause);
  const change = /\b(increas(ed?|ing)|decreas(ed?|ing)|rose|risen|fell|fallen|declin(ed?|ing)|improv(ed?|ing)|dropp?(ed)?|reduc(ed|tion)|gain(ed)?|change[ds]?)\b[^.]{0,25}\bby\s+(about\s+|approximately\s+|roughly\s+|nearly\s+)?(US\$|\$)?$/i.test(before) || /percentage points?/i.test(token.unitText);
  if (change && !growthLevel) return is("derived", "A change computed between two points.");
  if (/\baged?\s*$|\bages\s*$|\bunder\s*$/i.test(before)) return is("constant", "An age bound that defines a population.");
  if (token.unit === "unknown") return is("unrelated", "No recognisable measurement unit.");
  return is("observation", "A measured value with a recognisable unit.");
}

export function extractClaims(blocks: Block[], publicationYear: number | null): (QuantClaim & { start: number; context: string })[] {
  const out: (QuantClaim & { start: number; context: string })[] = [];
  let inReferences = false;
  let context = "";
  for (const b of blocks) {
    if (b.type === "heading") {
      inReferences = isReferencesHeading(blockText(b));
      continue;
    }
    if (inReferences || (b.type !== "paragraph" && b.type !== "list" && b.type !== "quote")) continue;
    if (b.type === "paragraph" && b.footnoteKey) continue;
    const text = blockText(b);
    if (/^(authors?|published|publication date|doi|journal|publisher|institution|key\s?words?)\s*[:—]/i.test(text)) continue;
    for (const sentence of text.split("\n").flatMap(splitSentences)) {
      const numbers = findNumbers(sentence);
      for (const token of numbers) {
        const year = yearFor(sentence, token, numbers);
        const { classification, reason } = classify(sentence, token, year, publicationYear);
        out.push({
          id: `c${out.length + 1}`, blockId: b.id, page: b.page, sentence, raw: token.raw, value: token.value,
          precision: token.precision, unit: token.unit, unitText: token.unitText,
          year: MONTHS.test(sentence) ? null : year,
          classification, classificationReason: reason, start: token.start, context,
        });
      }
      context = sentence;
    }
  }
  return out;
}

export const subAnnual = (sentence: string) => MONTHS.test(sentence);
