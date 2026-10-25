import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../../packages/shared/src/database.types.ts";
import type { ConnectorSession } from "../_shared/connectors/types.ts";
import {
  MERCURY_ATTACHMENTS_PER_RUN,
  attachmentObjectName,
  downloadMercuryAttachment,
  mercuryThreads,
} from "../_shared/connectors/mercury/thread.ts";

type Admin = SupabaseClient<Database>;

/** The bucket the thread's files live in (FLOW-957 migration). */
export const THREAD_BUCKET = "transaction-files";

type Missing = { transaction_id: string; external_id: string; file_name: string };
/**
 * FLOW-957, after a connection's lines are saved: Mercury's notes into the threads (a note edited in
 * Flow is kept as Flow has it) and the attachments not copied yet into the bucket. Nothing is sent to
 * Mercury. Nothing here fails the sync: a step that fails is logged and runs again next time.
 */
export async function syncMercuryThreadsFor(
  admin: Admin,
  companyId: string,
  session: ConnectorSession,
): Promise<{ notes: number; files: number }> {
  const counts = { notes: 0, files: 0 };
  try {
    const threads = mercuryThreads(session);
    const byId = new Map(threads.map((thread) => [thread.externalId, thread]));
    const missing: Missing[] = [];
    for (let start = 0; start < threads.length; start += 500) {
      const items = threads.slice(start, start + 500).map((thread) => ({
        external_id: thread.externalId,
        note: thread.note,
        files: thread.attachments.map((attachment) => attachment.fileName),
      }));
      const synced = await admin.rpc("sync_mercury_threads", { p_company: companyId, p_items: items as unknown as Json });
      if (synced.error) throw new Error("threads");
      counts.notes += items.length;
      missing.push(...((synced.data ?? []) as unknown as Missing[]));
    }

    for (const item of missing.slice(0, MERCURY_ATTACHMENTS_PER_RUN)) {
      const attachment = byId.get(item.external_id)?.attachments.find((candidate) => candidate.fileName === item.file_name);
      if (!attachment) continue;
      const file = await downloadMercuryAttachment(session, attachment);
      if (!file) continue;
      const path = `${companyId}/${item.transaction_id}/${await attachmentObjectName(item.file_name)}`;
      const stored = await admin.storage.from(THREAD_BUCKET).upload(path, file.bytes, {
        contentType: file.mime,
        upsert: true,
      });
      if (stored.error) continue;
      const recorded = await admin.rpc("record_mercury_file", {
        p_company: companyId,
        p_transaction_id: item.transaction_id,
        p_path: path,
        p_file_name: item.file_name,
        p_mime: file.mime,
        p_bytes: file.bytes.byteLength,
      });
      if (!recorded.error) counts.files += 1;
    }
  } catch (error) {
    console.error("mercury threads", error instanceof Error ? error.message.slice(0, 120) : "failed");
  }
  return counts;
}
