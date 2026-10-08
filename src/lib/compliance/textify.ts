/**
 * Turns a submitted file's bytes into plain text and a verdict about whether that
 * was even possible. Pure and dependency-isolated so the same code runs under a
 * probe script and inside the route handler.
 *
 * Every fallback is deliberate: a file the engine cannot read is not an error in
 * the caller's code, it is a finding ("unreadable"), because some submitters send
 * scans, password-locked files, or odd formats and a reviewer needs to know.
 */
import { join } from "node:path";
import type { ExtractedDocument } from "./types";

function extensionOf(name?: string): string {
  if (!name) return "";
  const last = name.split(/[\\/]/).pop() ?? "";
  const dot = last.lastIndexOf(".");
  return dot >= 0 ? last.slice(dot + 1).toLowerCase() : "";
}

function magicOf(buffer: Buffer): "pdf" | "zip" | "other" {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) return "zip";
  return "other";
}

const IMAGES = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp"]);
const TEXTLIKE = new Set(["txt", "md", "csv", "json", "log"]);

/** ZIP containers split by their inner package; DOCX and XLSX are both OPC zips. */
async function extractZip(buffer: Buffer, ext: string): Promise<ExtractedDocument> {
  if (ext === "docx") {
    try {
      const { default: mammoth } = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return { format: "docx", text: result.value ?? "" };
    } catch {
      return { format: "docx", text: "", issue: "unreadable" };
    }
  }
  if (ext === "xlsx") {
    try {
      const { default: readXlsxFile } = await import("read-excel-file/node");
      const rows: unknown = await readXlsxFile(buffer);
      const data = Array.isArray(rows)
        ? rows[0] && typeof rows[0] === "object" && "data" in (rows[0] as object)
          ? ((rows[0] as { data: unknown[] }).data ?? [])
          : rows
        : [];
      const lines = (data as unknown[]).map((row) =>
        Array.isArray(row) ? row.map((c) => String(c ?? "")).join("\t") : "",
      );
      return { format: "xlsx", text: lines.join("\n") };
    } catch {
      return { format: "xlsx", text: "", issue: "unreadable" };
    }
  }
  return { format: "zip", text: "", issue: "unsupported_format" };
}

async function extractPdf(buffer: Buffer): Promise<ExtractedDocument> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // The standard-14 fonts ship inside pdfjs-dist/standard_fonts; on the Node
    // path pdfjs reads them straight from disk, so the option is a folder path.
    const fontsDir = join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts").replaceAll("\\", "/");
    const doc = await pdfjs
      .getDocument({
        data: new Uint8Array(buffer),
        standardFontDataUrl: `${fontsDir}/`,
      })
      .promise;
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      try {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const line = content.items
          .map((it) => ("str" in it ? (it as { str: unknown }).str : ""))
          .join(" ");
        parts.push(line);
      } catch (pageError) {
        // One page that fails to give up its text (embedded font without metrics)
        // must not sink the whole document -- the rest may still yield findings.
        console.error("[compliance:pdf:page]", pageError);
      }
    }
    const text = parts.join("\n");
    const isEncrypted = false;
    return { format: "pdf", pageCount: doc.numPages, text, ...(isEncrypted ? { issue: "encrypted_pdf" as const } : {}) };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    // PasswordException and InvalidPDFException carry files that cannot be read.
    if (name === "PasswordException") {
      return { format: "pdf", text: "", issue: "encrypted_pdf" };
    }
    return { format: "pdf", text: "", issue: "unreadable" };
  }
}

export async function extractDocument(
  buffer: Buffer,
  originalName: string | undefined,
): Promise<ExtractedDocument> {
  const ext = extensionOf(originalName);

  if (IMAGES.has(ext)) {
    return { format: "image", text: "", issue: "ocr_pending" };
  }
  if (TEXTLIKE.has(ext)) {
    return { format: "txt", text: buffer.toString("utf8") };
  }
  if (ext === "pdf") {
    return extractPdf(buffer);
  }
  if (ext === "docx" || ext === "xlsx") {
    return extractZip(buffer, ext);
  }

  const magic = magicOf(buffer);
  if (magic === "pdf") return extractPdf(buffer);
  if (magic === "zip") return extractZip(buffer, ext);
  return { format: "other", text: "", issue: "unsupported_format" };
}

/** A short, whitespace-cleaned preview for the review UI. */
export function previewOf(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}