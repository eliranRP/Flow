// FLOW-957: a line's notes and files, and Mercury's note and attachments in the same thread. The app's
// own RPCs (not MCP): the session has no MCP token. The MCP tools write the same rows.
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getSupabase, supabaseApi } from "./lib/supabase";
import { useHomePreview } from "./preview";
import { assertNoError } from "./use-write";
import { waitForAccessToken } from "./wait-for-session";

/** The bucket the files live in, at <company>/<line>/<name> (the FLOW-957 migration). */
export const THREAD_BUCKET = "transaction-files";
/** The bucket's own cap. */
export const THREAD_FILE_MAX_BYTES = 20 * 1024 * 1024;
/** What the bucket takes. The file picker offers the same. */
export const THREAD_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif", "application/pdf"] as const;
export const THREAD_NOTE_MAX = 5000;
export const THREAD_KEY = "txn-thread";
export const THREAD_COUNTS_KEY = "txn-thread-counts";

const noteSchema = z.object({
  id: z.string(),
  source: z.enum(["flow", "mercury"]),
  body: z.string(),
  mine: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  edited: z.boolean(),
  edited_in_flow: z.boolean(),
});

const fileSchema = z.object({
  id: z.string(),
  note_id: z.string().nullable(),
  source: z.enum(["flow", "mercury"]),
  file_name: z.string(),
  mime: z.string(),
  bytes: z.number(),
  path: z.string(),
  mine: z.boolean(),
  created_at: z.string(),
});

export const threadSchema = z.object({
  transaction_id: z.string(),
  company_id: z.string(),
  notes: z.array(noteSchema),
  files: z.array(fileSchema),
});

export type ThreadNote = z.infer<typeof noteSchema>;
export type ThreadFile = z.infer<typeof fileSchema>;
export type Thread = z.infer<typeof threadSchema>;

const countsSchema = z.record(z.string(), z.object({ notes: z.number(), files: z.number() }));
export type ThreadCounts = z.infer<typeof countsSchema>;

/** The line's one note: Mercury's when it has one, else the owner's (the server keeps one, Mercury's first). */
export function threadNote(thread: Thread): ThreadNote | null {
  return thread.notes.find((note) => note.source === "mercury") ?? thread.notes[0] ?? null;
}

export function threadCount(counts: ThreadCounts | undefined, transactionId: string): { notes: number; files: number } {
  return counts?.[transactionId] ?? { notes: 0, files: 0 };
}

/** Why a file cannot be attached, in the sheet's words, or null when it can. */
export function threadFileProblem(file: { type: string; size: number }): string | null {
  if (!(THREAD_FILE_TYPES as readonly string[]).includes(file.type)) return "אפשר לצרף תמונה או PDF";
  if (file.size <= 0) return "הקובץ ריק";
  if (file.size > THREAD_FILE_MAX_BYTES) return "קובץ עד 20MB";
  return null;
}

/** A storage name for an upload: a fresh id and the file's own extension, nothing else of its name. */
export function threadObjectName(fileName: string, id: string = crypto.randomUUID()): string {
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(fileName)?.[1]?.toLowerCase();
  return extension ? `${id}.${extension}` : id;
}

/** "1.2MB" / "320KB": the size under a file's name. */
export function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")}MB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))}KB`;
}

function client() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  return supabase;
}

export function useThreadQuery(transactionId: string, enabled = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: [THREAD_KEY, preview, transactionId],
    enabled: enabled && preview === "off" && transactionId !== "",
    staleTime: 30_000,
    queryFn: async (): Promise<Thread | null> => {
      await waitForAccessToken(client());
      const result = await client().rpc("get_transaction_thread", { p_transaction_id: transactionId });
      assertNoError(result);
      return result.data == null ? null : threadSchema.parse(result.data);
    },
  });
}

/** How many notes and files each card has, for the approval queue's badge. A failed read shows none. */
export function useThreadCounts(transactionIds: readonly string[]) {
  const preview = useHomePreview();
  const ids = [...new Set(transactionIds)].sort();
  return useQuery({
    queryKey: [THREAD_COUNTS_KEY, preview, ids.join(",")],
    enabled: preview === "off" && ids.length > 0,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<ThreadCounts> => {
      await waitForAccessToken(client());
      const result = await client().rpc("transaction_thread_counts", { p_ids: ids });
      assertNoError(result);
      return countsSchema.parse(result.data ?? {});
    },
  });
}

export async function addThreadNote(transactionId: string, body: string): Promise<string> {
  const result = await client().rpc("add_transaction_note", { p_transaction_id: transactionId, p_body: body });
  assertNoError(result);
  if (typeof result.data !== "string") throw new Error("supabase");
  return result.data;
}

export async function editThreadNote(noteId: string, body: string): Promise<{ source: string }> {
  const result = await client().rpc("edit_transaction_note", { p_note_id: noteId, p_body: body });
  assertNoError(result);
  const source = (result.data as { source?: unknown } | null)?.source;
  return { source: typeof source === "string" ? source : "flow" };
}

export async function removeThreadNote(noteId: string): Promise<void> {
  assertNoError(await client().rpc("remove_transaction_note", { p_note_id: noteId }));
}

export async function removeThreadFile(fileId: string): Promise<void> {
  assertNoError(await client().rpc("remove_transaction_file", { p_file_id: fileId }));
}

/**
 * A picked file copied into memory. iOS Safari can lose a camera photo's file once its input is
 * cleared, and the upload then fails before any request is sent; a copy made at pick time stays.
 */
export async function readPickedFile(file: File): Promise<File> {
  return new File([await file.arrayBuffer()], file.name, { type: file.type, lastModified: file.lastModified });
}

/** Puts one file in the bucket under the line's folder and returns its path. Nothing is recorded yet. */
export async function putThreadFile(companyId: string, transactionId: string, file: File): Promise<string> {
  const problem = threadFileProblem(file);
  if (problem) throw new Error(problem);
  const path = `${companyId}/${transactionId}/${threadObjectName(file.name)}`;
  await storageCall(`object/${THREAD_BUCKET}/${objectPath(path)}`, {
    method: "POST",
    headers: { "content-type": file.type, "cache-control": "max-age=3600", "x-upsert": "false" },
    body: file,
  });
  return path;
}

/** Records a file already in the bucket on the line. */
export async function recordThreadFile(transactionId: string, path: string, file: File): Promise<void> {
  // The generated types type a nullable uuid argument as required (repo precedent: null as unknown as string).
  assertNoError(await client().rpc("add_transaction_file", {
    p_transaction_id: transactionId,
    p_note_id: null as unknown as string,
    p_path: path,
    p_file_name: file.name.slice(0, 200) || "file",
    p_mime: file.type,
    p_bytes: file.size,
  }));
}

/** A link to open a file, good for ten minutes. */
export async function threadFileUrl(path: string): Promise<string> {
  const signed = await storageCall(`object/sign/${THREAD_BUCKET}/${objectPath(path)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: 600 }),
  });
  const link = ((await signed.json()) as { signedURL?: unknown }).signedURL;
  if (typeof link !== "string") throw new Error("storage");
  return `${supabaseApi.url}/storage/v1${link}`;
}

/** Each folder and the name, URL-encoded. */
function objectPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * One Storage REST call as the signed-in user. Flow's build leaves supabase-js's storage client out
 * (FLOW-804: it stands in a stub that throws), so the two calls the thread needs go straight to the API.
 */
async function storageCall(route: string, init: RequestInit): Promise<Response> {
  const token = (await client().auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("session");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("apikey", supabaseApi.anonKey);
  const response = await fetch(`${supabaseApi.url}/storage/v1/${route}`, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(typeof body?.message === "string" ? body.message : `storage ${String(response.status)}`);
  }
  return response;
}
