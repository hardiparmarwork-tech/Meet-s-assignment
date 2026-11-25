// Builds a text-based PDF used to exercise the upload flow. The text is a test fixture, not research.
import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fetchWorldBankSeries } from "../src/lib/connectors/worldbank";

export async function makePdf(paragraphs: { text: string; size?: number; bold?: boolean }[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.TimesRoman), bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  let page = pdf.addPage([595, 842]), y = 780;
  for (const p of paragraphs) {
    const size = p.size ?? 11, font = p.bold ? bold : regular;
    let line = "";
    const lines: string[] = [];
    for (const word of p.text.split(" ")) {
      if (font.widthOfTextAtSize(`${line} ${word}`, size) > 470) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
    for (const l of lines) {
      if (y < 60) { page = pdf.addPage([595, 842]); y = 780; }
      page.drawText(l, { x: 60, y, size, font });
      y -= size * 1.3;
    }
    y -= size * 1.2;
  }
  return pdf.save();
}

if (process.argv[2]) {
  const at = async (code: string) => (await fetchWorldBankSeries(code, "KEN")).observations.find((o) => o.period === 2016)!.value;
  const [le, el, net] = [await at("SP.DYN.LE00.IN"), await at("EG.ELC.ACCS.ZS"), await at("IT.NET.USER.ZS")];
  writeFileSync(process.argv[2], await makePdf([
    { text: "Upload Test: Household Connectivity and Health in Kenya", size: 18, bold: true },
    { text: "Authors: Test Fixture" },
    { text: "Published: 2018" },
    { text: "Abstract", size: 13, bold: true },
    { text: "This is a test fixture for the upload flow, not research. It records a few national figures for Kenya in 2016." },
    { text: "Results", size: 13, bold: true },
    { text: `Life expectancy at birth in Kenya was ${le.toFixed(1)} years in 2016. Access to electricity in Kenya reached ${el.toFixed(1)}% of the population in 2016.` },
    { text: `In Kenya, ${net.toFixed(1)}% of individuals were using the Internet in 2016. The unemployment rate in Kenya was 40.0% in 2016.` },
    { text: "In our sample of 412 households, 61% of respondents owned a radio." },
  ]));
  console.log("written", process.argv[2]);
}
