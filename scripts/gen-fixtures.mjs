/**
 * Generates the static fixtures used by scripts/check-compliance.mjs.
 *
 * The PDFs are hand-assembled with correct xref offsets; the DOCX and XLSX are
 * minimal OPC zips written with stored (uncompressed) entries so the test has no
 * dependency on a zip writer library. Run with `node scripts/gen-fixtures.mjs`.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { crc32 } from "node:zlib";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
mkdirSync(OUT, { recursive: true });

function buildPdf(objects, trailer = {}) {
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
  }
  const xrefPos = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailerKeys = Object.entries(trailer).map(([k, v]) => `/${k} ${v}`).join("\n");
  body += `trailer\n<<\n${trailerKeys}\n>>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return body;
}

function pdfWithText(text, pageCount = 1) {
  const objects = [
    { id: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { id: 2, body: `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(" ")}] /Count ${pageCount} >>` },
  ];
  // Real documents emit one operator per visible line; pdfjs clips a single
  // over-long literal string at the page width, so the fixture must lay the text
  // out on lines the way a word processor would.
  const lines = wrapLines(text, 68);
  for (let p = 0; p < pageCount; p++) {
    const contentId = 4 + p * 2;
    const fontId = contentId + 1;
    const ops = lines
      .map((ln, i) => `${i === 0 ? "BT /F1 12 Tf 72 720 Td" : "0 -16 Td"} (${ln}) Tj`)
      .join("\n");
    const stream = pageCount === 1 ? `${ops}\nET` : p === 0 ? `${ops}\nET` : "";
    const len = Buffer.byteLength(stream, "latin1");
    const body = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    objects.push({ id: 3 + p, body });
    objects.push({
      id: contentId,
      body: `<< /Length ${len} >>\nstream\n${stream}\nendstream`,
    });
    objects.push({
      id: fontId,
      body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    });
  }
  return buildPdf(objects, { Size: objects.length + 1, Root: "1 0 R" });
}

function wrapLines(text, width) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/** Minimal store-only ZIP (method 0). Entries is [{ name, data }]. */
function storeZip(entries, buffers) {
  const localParts = [];
  const central = [];
  const encoder = new TextEncoder();
  let offset = 0;
  for (const { name } of entries) {
    const nameBytes = encoder.encode(name);
    const dataBytes = buffers[name];
    const crc = crc32(dataBytes) >>> 0;
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0x0800, 6);
    lfh.writeUInt16LE(0, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(dataBytes.length, 18);
    lfh.writeUInt32LE(dataBytes.length, 22);
    lfh.writeUInt16LE(nameBytes.length, 26);
    lfh.writeUInt16LE(0, 28);
    localParts.push(Buffer.concat([lfh, nameBytes, dataBytes]));

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(dataBytes.length, 20);
    cdh.writeUInt32LE(dataBytes.length, 24);
    cdh.writeUInt16LE(nameBytes.length, 28);
    cdh.writeUInt32LE(offset, 42);
    central.push({ cdh, nameBytes });
    offset += 30 + nameBytes.length + dataBytes.length;
  }
  const local = Buffer.concat(localParts);
  let centralBytes = Buffer.alloc(0);
  for (const { cdh, nameBytes } of central) {
    centralBytes = Buffer.concat([centralBytes, cdh, nameBytes]);
  }
const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, centralBytes, eocd]);
}

const text = (s) => Buffer.from(s, "utf8");

// ---- PDFs ----
const letterText =
  "LETTER OF INTENT This is a letter of intent from the Computer Studies Council to the Office of Student Affairs requesting approval to hold the Color Run 2026 during University Week at the Main Campus Oval. Ref No. RO-2026-001. Event date October 8, 2026. The program includes a schedule, a venue permit, an attendance sheet, an endorsement, and a budget breakdown of Fifteen Thousand Pesos PHP 15,000.";
writeFileSync(join(OUT, "letter.pdf"), pdfWithText(letterText.replace(/[()\\]/g, "\\$&")));
writeFileSync(join(OUT, "blank.pdf"), pdfWithText(""));

// ---- DOCX (one paragraph) ----
const docxEntries = ["[Content_Types].xml", "_rels/.rels", "word/document.xml"].map((name) => ({ name }));
const docxDoc =
  "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
  "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
  "<w:body><w:p><w:r><w:t>Program flow for the University Week. Sequence of activities, schedule, venue permit requested from OSA. Budget breakdown PHP 5,000. Attendance sheet will be attached.</w:t></w:r></w:p></w:body></w:document>";
const docxBuffers = {
  "[Content_Types].xml": text(
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
      "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
      "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
      "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
      "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>" +
      "</Types>"),
  "_rels/.rels": text(
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
      "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
      "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
      "</Relationships>"),
  "word/document.xml": text(docxDoc),
};

// ---- XLSX (one sheet, inline strings) ----
const xlsxEntries = [
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/worksheets/sheet1.xml",
].map((name) => ({ name }));
const xlsxBuffers = {
  "[Content_Types].xml": text(
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
      "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
      "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
      "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
      "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
      "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" +
      "</Types>"),
  "_rels/.rels": text(
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
      "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
      "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>" +
      "</Relationships>"),
  "xl/workbook.xml": text(
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
      "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
      "<sheets><sheet name=\"Budget\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"),
  "xl/_rels/workbook.xml.rels": text(
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
      "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
      "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>" +
      "</Relationships>"),
  "xl/worksheets/sheet1.xml": text(
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
      "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
      "<sheetData>" +
      "<row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>Financial Statement for Color Run 2026</t></is></c></row>" +
      "<row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>Budget breakdown as approved by the Council</t></is></c></row>" +
      "<row r=\"3\"><c r=\"A3\" t=\"inlineStr\"><is><t>Item</t></is></c><c r=\"B3\" t=\"inlineStr\"><is><t>Amount</t></is></c></row>" +
      "<row r=\"4\"><c r=\"A4\" t=\"inlineStr\"><is><t>Venue</t></is></c><c r=\"B4\"><v>3000</v></c></row>" +
      "<row r=\"5\"><c r=\"A5\" t=\"inlineStr\"><is><t>Food</t></is></c><c r=\"B5\"><v>2000</v></c></row>" +
      "<row r=\"6\"><c r=\"A6\" t=\"inlineStr\"><is><t>Prizes</t></is></c><c r=\"B6\"><v>1500</v></c></row>" +
      "<row r=\"7\"><c r=\"A7\" t=\"inlineStr\"><is><t>Printing</t></is></c><c r=\"B7\"><v>400</v></c></row>" +
      "<row r=\"8\"><c r=\"A8\" t=\"inlineStr\"><is><t>Misc</t></is></c><c r=\"B8\"><v>600</v></c></row>" +
      "<row r=\"9\"><c r=\"A9\" t=\"inlineStr\"><is><t>Total budget</t></is></c><c r=\"B9\"><v>7500</v></c></row>" +
      "<row r=\"10\"><c r=\"A10\" t=\"inlineStr\"><is><t>Statement prepared by the Treasurer</t></is></c></row>" +
      "</sheetData></worksheet>"),
};

writeFileSync(join(OUT, "letter.docx"), storeZip(docxEntries, docxBuffers));
writeFileSync(join(OUT, "budget.xlsx"), storeZip(xlsxEntries, xlsxBuffers));

// ---- Text ----
writeFileSync(join(OUT, "placeholder.txt"), text("lorem ipsum tbd sample only xxxx this text is not final, do not use"));
writeFileSync(join(OUT, "blank.txt"), text("   \n\n  "));
writeFileSync(join(OUT, "letter.txt"), text(letterText));

console.log("Fixtures written to", OUT);