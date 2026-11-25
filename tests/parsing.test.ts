import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseDocument, validateUpload, UploadError } from "@/lib/parse";
import { parseTei } from "@/lib/connectors/grobid";
import { makePdf } from "../scripts/make-test-pdf";
import { blockText } from "@/lib/parse/common";

describe("upload validation", () => {
  it("rejects unsupported, mislabelled, binary and oversized files", () => {
    expect(() => validateUpload("a.exe", Buffer.from("x"))).toThrow(UploadError);
    expect(() => validateUpload("a.pdf", Buffer.from("<html>"))).toThrow(/not a PDF/);
    expect(() => validateUpload("a.docx", Buffer.from("plain"))).toThrow(/not a DOCX/);
    expect(() => validateUpload("a.txt", Buffer.from([65, 0, 66]))).toThrow(/binary/);
    expect(() => validateUpload("a.md", Buffer.alloc(15 * 1024 * 1024 + 1, 97))).toThrow(/15 MB/);
    expect(() => validateUpload("a.md", Buffer.alloc(0))).toThrow(/empty/);
    expect(validateUpload("A.MARKDOWN", Buffer.from("# x"))).toBe("md");
  });
});

describe("parsing", () => {
  it("keeps markdown structure, wording, tables and footnotes; neutralises active content", async () => {
    const d = await parseDocument("md", Buffer.from(
      "# My Paper Title Here\n\nAuthors: Ann A; Bo B\n\n## Abstract\n\nShort abstract.\n\n## Body\n\nText with **bold**, a [bad](javascript:alert(1)) link[^1].\n\n<script>alert(1)</script>\n\n| a | b |\n|--|--|\n| 1 | 2 |\n\n![x](https://evil.test/x.png)\n\n## References\n\n- First ref\n\n[^1]: The note.\n"));
    expect(d.metadata).toMatchObject({ title: "My Paper Title Here", authors: ["Ann A", "Bo B"], abstract: "Short abstract.", year: null });
    expect(d.blocks.some((b) => b.type === "table" && b.rows.length === 2)).toBe(true);
    expect(d.references).toContain("First ref");
    expect(JSON.stringify(d)).not.toContain("javascript:");
    // Raw HTML survives only as inert literal text.
    expect(d.blocks.find((b) => b.type === "code")).toMatchObject({ text: "<script>alert(1)</script>" });
    expect(d.blocks.some((b) => b.type === "paragraph" && b.footnoteKey === "1")).toBe(true);
    expect(d.fidelity.join()).toContain("not fetched");
  });

  it("parses a text PDF and states its fidelity limits", async () => {
    const pdf = await makePdf([{ text: "A Study Of Something Quite Important", size: 18, bold: true }, { text: "Authors: Jo Doe" }, { text: "Published: 2019" }, { text: "Abstract", size: 13, bold: true }, { text: "We describe a thing. ".repeat(20) }]);
    const d = await parseDocument("pdf", Buffer.from(pdf));
    expect(d.metadata.title).toBe("A Study Of Something Quite Important");
    expect(d.metadata.authors).toEqual(["Jo Doe"]);
    expect(d.metadata.year).toBe(2019);
    expect(d.fidelity.join()).toMatch(/NOT reliably reconstructed/);
  });

  it("reports a scanned or empty PDF as a recoverable failure", async () => {
    const pdf = await makePdf([{ text: "tiny" }]);
    await expect(parseDocument("pdf", Buffer.from(pdf))).rejects.toThrow(/OCR is not supported/);
  });

  it("parses DOCX and flags equations it cannot reconstruct", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p><w:r><w:t>A Word Document About Testing</w:t></w:r></w:p><w:p><w:r><w:t>Body paragraph.</w:t></w:r></w:p><w:p><m:oMath/></w:p></w:body></w:document>');
    const d = await parseDocument("docx", await zip.generateAsync({ type: "nodebuffer" }));
    expect(d.blocks.map(blockText)).toContain("Body paragraph.");
    expect(d.fidelity.join()).toContain("equations");
  });

  it("reads GROBID TEI header metadata (fixture only; no live GROBID tested)", () => {
    const t = parseTei('<TEI><teiHeader><fileDesc><titleStmt><title>T</title></titleStmt><publicationStmt><date type="published" when="2020-02-01"/></publicationStmt><sourceDesc><biblStruct><analytic><author><persName><forename>A</forename><surname>B</surname></persName></author></analytic><idno type="DOI">10.1/x</idno></biblStruct></sourceDesc></fileDesc></teiHeader></TEI>');
    expect(t.metadata).toMatchObject({ title: "T", authors: ["A B"], year: 2020, doi: "10.1/x" });
  });
});
