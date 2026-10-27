<a id="flow-978"></a>
# FLOW-978 · Deleting a company also deletes its attached files
- **Type:** SMALL CYCLE (data) · **Status:** ready · **Depends on:** — · **Source:** the review of the legal drafts for FLOW-979 (#840), 2026-10-27. `public.delete_company` (decision 0194, migration `20261019142844_delete_company_data.sql`) predates the private storage bucket `transaction-files` (FLOW-957): it cascades the company's rows but leaves its objects at `<company>/<transaction>/<name>`, including files copied from Mercury. The drafts in `docs/legal/` say so until this is done.
- [ ] `delete_company` (or the step that runs it) also deletes every `storage.objects` row in `transaction-files` under the company's folder, in the same confirmed action; a pgTAP test proves no object of a deleted company is left and no other company's object is touched.
- [ ] Removed notes and files are kept on purpose (`removed_at`, so undo can bring them back). With the owner's sign-off, decide how long a removed file is kept while the company lives, and whether it goes with the company (it should).
- [ ] Update `docs/legal/terms-draft.md` and `privacy-draft.md` (the "נשארים כרגע באחסון" lines) and decision 0194's consequences.
- **Acceptance:** a deleted company leaves no files in storage; the owner signed off on the retention of removed files; the legal drafts say what then happens.
