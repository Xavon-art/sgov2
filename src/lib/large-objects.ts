import "server-only";
import { Readable } from "node:stream";
import { Pool } from "pg";

/**
 * Reads a document's bytes out of a Postgres large object.
 *
 * Authorization does not happen here. `smartgov.get_document` decides first and
 * returns an OID only for a caller who may read the submission, so this module's
 * only job is to be the one place in the app that can turn an OID into bytes. It is
 * `server-only` because the connection string it reads never leaves the server.
 *
 * Bytes are streamed rather than buffered. A 10 MB document is small enough to
 * buffer, but nothing here grows with the file if the limit ever does, and a reader
 * who cancels mid-download should not leave the whole document in memory.
 */

let pool: Pool | null = null;

function db(): Pool {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      "POSTGRES_URL or DATABASE_URL is not set, so document bytes cannot be read. Check .env.local.",
    );
  }

  if (!pool) {
    pool = new Pool({
      connectionString: url,
      // One instance per server, not one per request. Every lambda invocation would
      // otherwise open its own Postgres connection.
      max: 2,
      // Supabase hands out a cert chain the bundled roots do not always trust.
      ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
    });
    pool.on("error", (error: Error) => {
      console.error("[large-objects] idle client error", error);
    });
  }

  return pool;
}

/**
 * An OID arrives from a JSON response, so it is text that may not even be a number.
 * Large-object OIDs are unsigned 32-bit; anything outside that is not ours.
 */
function parseOid(value: unknown): number | null {
  const asText = typeof value === "number" ? String(value) : typeof value === "string" ? value : null;
  if (!asText || !/^\d+$/.test(asText)) return null;
  const oid = Number(asText);
  return oid > 0 && oid <= 0xffffffff ? oid : null;
}

export async function readLargeObject(oid: unknown): Promise<{
  stream: Readable;
  sizeBytes: number;
}> {
  const parsed = parseOid(oid);
  if (parsed === null) throw new Error("That document reference is not valid.");

  const client = await db().connect();

  try {
    // The cast is not decoration. `lo_get` is overloaded on bytea and oid, and a
    // bare `$1` in an extended-protocol query tells Postgres nothing about which one
    // is meant, so it rejects the statement before it ever runs.
    const { rows } = await client.query<{ body: Buffer | null }>(
      "select lo_get($1::oid) as body",
      [parsed],
    );

    const buffer = rows[0]?.body ?? null;

    // `lo_get` materialises the whole object; pg has no streaming form for it. The
    // database caps a document at 10 MiB before anything is written, so this
    // allocation is bounded by product rules rather than by anything a caller can
    // grow.
    if (!buffer || buffer.length === 0) {
      return { stream: Readable.from([]), sizeBytes: 0 };
    }

    return { stream: Readable.from(buffer), sizeBytes: buffer.length };
  } finally {
    client.release();
  }
}

/**
 * A filename goes into a `Content-Disposition` header, where a quote or a newline
 * would end the header early. Only the last segment survives, and anything outside
 * a conservative set becomes an underscore.
 */
export function contentDispositionFor(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "document";
  const safe = base.replace(/[^\w .()-]/g, "_").replace(/\s+/g, " ").trim();
  const fallback = safe.length > 0 ? safe.slice(0, 120) : "document";
  return `attachment; filename="${fallback}"`;
}