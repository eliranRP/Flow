# A company's files go with it, and removed notes and files are kept 7 days

**Date:** 2026-10-27
**Status:** Accepted (owner, 2026-10-27, FLOW-978: "removed notes and files are kept for 7 days, then deleted")
**Amends:** [0194](0194-delete-company-danger-zone.md) (a company's files in storage are deleted with it, usually within the hour)

## Context

[0194](0194-delete-company-danger-zone.md) was written when no storage bucket existed. FLOW-957 then added the private bucket `transaction-files` (`<company>/<line>/<name>`): the owner's uploads, and Mercury's attachments that mercury-sync copies. Deleting a company deleted its `transaction_files` rows by cascade, but the objects stayed in the bucket. Deleting a line left its objects too, and a removed note or file (`removed_at`, for undo) was kept for ever.

An object's row in `storage.objects` is only its metadata. Deleting that row in SQL leaves the bytes in the storage backend, which only the Storage API deletes.

## Decision

1. **What is due.** `public.thread_files_to_purge(p_limit)` (security definer, `search_path = ''`, service role only) lists the `transaction-files` objects no `transaction_files` row names, as a JSON array, oldest first, at most 1000:
   - every object under a company folder whose company is gone, at once;
   - any other object a day after it was uploaded. That covers a deleted line, an upload the app or the sync never recorded, and an expired file (below). The day keeps an upload in flight, which is recorded seconds after it lands.
2. **How it is removed.** mercury-sync, already the function that writes to the bucket with the service role, takes `{"kind":"purge-files"}` under the cron header and removes the listed objects through the Storage API (`_shared/thread_purge.ts`, up to 10 batches of 500 a run). The pg_cron job `flow-thread-files-purge` posts it hourly at minute 23, through `flow_sync_url` and `cron_secret` like flow-push-evening, and is skipped with a notice where pg_net or the vault secrets are missing.
3. **Removed notes and files are kept 7 days.** `private.expire_removed_thread_items()` deletes `transaction_notes` and `transaction_files` rows removed more than 7 days ago. It is nightly at 02:07 UTC (`flow-thread-items-expire`) and executable by no client role. A deleted file's object then has no row, so the next purge removes its bytes. A removed note's files stay on the line, as they do when it is removed, with their `note_id` cleared.
4. **Undo after 7 days.** An app or flow-mcp undo of a removal older than 7 days finds no row and gets the conflict it gets today for a row that changed.

5. **Only thread files, only with the service role.** The list reads the `transaction-files` bucket only and is executable by the service role alone, and the function removes from that bucket only, and only a path of the form `<company uuid>/<line uuid>/<name>`; any other listed path is skipped.

**Calls for the owner** (made by the coordinator on 2026-10-27, from the owner's 7-day word): the purge runs hourly through the Storage API; an object no row names goes a day after upload; removed notes and files go after 7 days.

## Alternatives rejected

- **Delete the objects' rows in `delete_company`.** It is one statement, but the bytes would stay in the storage backend, so the files would not really be deleted.
- **A queue table filled by `delete_company`.** The objects nothing names are already a complete list, and it also covers deleted lines and companies deleted before this change.
- **A new edge function for the purge.** It needs its own deploy, secrets and config; mercury-sync already holds the bucket, the service role and the cron header.

## Consequences

A deleted company's files are usually gone within the hour (each run removes at most 5,000 objects, oldest first, so a very large backlog takes a few hours), and a deleted line's within a day. Removed notes and files can be brought back for 7 days, then they are gone for good. The privacy draft (`docs/legal/privacy-draft.md`) says so. A new feature that writes to `transaction-files` records a `transaction_files` row for each object within a day, or the purge removes it.
