export function extractJsonObject(raw: string): unknown {
  let text = raw.trim();
  const fenced = text.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  if (fenced) text = fenced[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) {
    throw new Error("No JSON object found in model output");
  }

  return JSON.parse(text.slice(start, end + 1));
}
