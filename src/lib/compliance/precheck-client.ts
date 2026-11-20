import type {
  PrecheckItem,
  PrecheckRequest,
} from "./precheck-request";
import type { PreflightReport } from "./types";

export type PrecheckFilePayload = Omit<PrecheckItem, "itemId" | "itemKind">;

export type PrecheckResponse =
  | {
      ok: true;
      aiConfigured: boolean;
      report: PreflightReport;
      advice: string | null;
      fixes: string[];
      model: string | null;
    }
  | { ok: false; message: string };

const MAX_ITEM_TEXT = 120_000;
const MAX_IMAGE_DATA_URL = 2 * 1024 * 1024;
const IMAGE_EDGE = 1600;
const IMAGE_QUALITY = 0.8;
const LEGACY = new Set(["doc", "xls", "ppt", "pptx", "zip"]);

export async function extractForPrecheck(file: File): Promise<PrecheckFilePayload> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const base = { fileName: file.name, sizeBytes: file.size };

  try {
    if (file.type === "application/pdf" || extension === "pdf") {
      return { ...base, format: "pdf", text: clip(await pdfText(file)) };
    }

    if (
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      extension === "docx"
    ) {
      return { ...base, format: "docx", text: clip(await docxText(file)) };
    }

    if (
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      extension === "xlsx"
    ) {
      return { ...base, format: "xlsx", text: clip(await xlsxText(file)) };
    }

    if (isImage(file, extension)) {
      return { ...base, format: "image", ...(await imageDataUrl(file)) };
    }

    if (LEGACY.has(extension)) {
      return { ...base, issue: "unsupported_format" };
    }

    if (
      file.type.startsWith("text/") ||
      extension === "txt" ||
      extension === "csv" ||
      extension === "md"
    ) {
      return { ...base, format: "txt", text: clip(await file.text()) };
    }

    return { ...base, issue: "unsupported_format" };
  } catch {
    return { ...base, issue: "unreadable" };
  }
}

export async function runPrecheck(body: PrecheckRequest): Promise<PrecheckResponse> {
  const response = await fetch("/api/compliance/precheck", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as PrecheckResponse | null;
  if (!json) {
    return { ok: false, message: "The requirement check could not be completed." };
  }
  return json;
}

function clip(text: string): string {
  return text.slice(0, MAX_ITEM_TEXT);
}

async function pdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const document = await task.promise;
  try {
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => {
          const value = (item as { str?: unknown }).str;
          return typeof value === "string" ? value : "";
        })
        .join(" ");
      pages.push(text);
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}

async function docxText(file: File): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

async function xlsxText(file: File): Promise<string> {
  const { readSheet } = await import("read-excel-file/browser");
  const rows = await readSheet(file);
  return rows
    .map((row) => row.map((cell) => (cell === null ? "" : String(cell))).join("\t"))
    .join("\n");
}

function isImage(file: File, extension: string): boolean {
  return (
    file.type === "image/jpeg" ||
    file.type === "image/png" ||
    file.type === "image/webp" ||
    extension === "jpg" ||
    extension === "jpeg" ||
    extension === "png" ||
    extension === "webp"
  );
}

async function imageDataUrl(file: File): Promise<PrecheckFilePayload> {
  if (
    file.type !== "image/jpeg" &&
    file.type !== "image/png" &&
    file.type !== "image/webp"
  ) {
    return { issue: "unsupported_format" };
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return { issue: "unreadable" };
    context.drawImage(bitmap, 0, 0, width, height);

    let dataUrl = canvas.toDataURL("image/jpeg", IMAGE_QUALITY);
    if (dataUrl.length > MAX_IMAGE_DATA_URL) {
      dataUrl = canvas.toDataURL("image/jpeg", 0.6);
    }
    if (dataUrl.length > MAX_IMAGE_DATA_URL) return { issue: "unreadable" };
    return { imageDataUrl: dataUrl };
  } finally {
    bitmap.close();
  }
}
