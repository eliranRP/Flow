import { mercuryTransport } from "./client.ts";
import type { ConnectorSession } from "../types.ts";

/**
 * FLOW-957: Mercury's note and attachments on a transaction, for the thread on the line.
 * The sync reads them from the rows it fetched (client.ts remembers them) and copies each attachment
 * into Flow's storage (Mercury's links expire). Read only: an edit of the note stays in Flow
 * (owner, 2026-10-25), so nothing is ever written to Mercury.
 */
/** Mercury caps a note at 5,000 characters; the thread keeps the same. */
export const MERCURY_NOTE_LIMIT = 5000;
/** The bucket's own cap (transaction-files): 20 MB a file. */
export const MERCURY_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
/** At most this many attachments are copied a run; the rest wait for the next run. */
export const MERCURY_ATTACHMENTS_PER_RUN = 25;

/** The kinds the bucket takes, by Mercury's content type or, failing that, the file's extension. */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
};
const ALLOWED_MIME = new Set(Object.values(MIME_BY_EXTENSION));

/** Mercury serves attachments from signed links on these hosts only. Anything else is not fetched. */
const ATTACHMENT_HOST = /(^|\.)(amazonaws\.com|mercury\.com|cloudfront\.net)$/;

export interface MercuryAttachment {
  fileName: string;
  url: string;
}

export interface MercuryThread {
  externalId: string;
  note: string | null;
  attachments: MercuryAttachment[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The note as Mercury holds it: trimmed, capped, null when empty. Not redacted: it is the owner's own text. */
export function mercuryNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const note = value.trim().slice(0, MERCURY_NOTE_LIMIT);
  return note.length > 0 ? note : null;
}

/** The attachments a row lists, with a usable name and an https link. A check image counts too. */
export function mercuryAttachments(value: unknown): MercuryAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: MercuryAttachment[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 20)) {
    if (!isRecord(item)) continue;
    const fileName = typeof item.fileName === "string" ? item.fileName.trim().slice(0, 200) : "";
    const url = typeof item.url === "string" ? item.url : "";
    if (fileName === "" || seen.has(fileName) || !url.startsWith("https://")) continue;
    seen.add(fileName);
    out.push({ fileName, url });
  }
  return out;
}

/** Every transaction the session fetched, with its note and attachments. */
export function mercuryThreads(session: ConnectorSession): MercuryThread[] {
  const { threads } = mercuryTransport(session);
  return [...threads.entries()].map(([externalId, raw]) => ({
    externalId,
    note: mercuryNote(raw.note),
    attachments: mercuryAttachments(raw.attachments),
  }));
}

/** The content type the bucket takes for a download, or null when it is not a picture or a PDF. */
export function attachmentMime(contentType: string | null, fileName: string): string | null {
  const declared = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (ALLOWED_MIME.has(declared)) return declared;
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXTENSION[extension] ?? null;
}

/** A storage name for an attachment: its own name, made safe, after a short hash so two never meet. */
export async function attachmentObjectName(fileName: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fileName)));
  const hash = [...digest.slice(0, 6)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(-100) || "file";
  return `m-${hash}-${safe}`;
}

/**
 * One attachment's bytes, or null when it cannot be copied (another host, too large, not a picture
 * or a PDF, or Mercury answered with an error). The signed link carries its own access: no key is sent.
 */
export async function downloadMercuryAttachment(
  session: ConnectorSession,
  attachment: MercuryAttachment,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  let url: URL;
  try {
    url = new URL(attachment.url);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !ATTACHMENT_HOST.test(url.hostname)) return null;
  const { fetch } = mercuryTransport(session);
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", redirect: "error" });
  } catch {
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MERCURY_ATTACHMENT_MAX_BYTES) {
    await response.body?.cancel();
    return null;
  }
  const mime = attachmentMime(response.headers.get("content-type"), attachment.fileName);
  if (!mime) {
    await response.body?.cancel();
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MERCURY_ATTACHMENT_MAX_BYTES) return null;
  return { bytes, mime };
}
