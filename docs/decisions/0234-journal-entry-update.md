# Correcting a posted journal entry in place, with its history

**Date:** 2026-10-30
**Status:** Accepted (owner, 2026-10-30, FLOW-174: the MCP/data agent's correction request, "implement that")
**Builds on:** [0228](0228-journal-entries.md) (journal entries), [0232](0232-ledger-only-books.md) (the ledger-only books), [0233](0233-prepaid-schedules.md) (`post_journal_entry` and the books-closed date)

## Context

A posted journal entry was fixed: no tool could change its legs, date or project. Two fixes existed. `undo` removes the whole entry, only for the member who wrote it and only while it is unchanged. A second, correcting entry gets the balances right, but the books then show two entries that cancel instead of one correct entry. A bookkeeper corrects the entry itself and keeps a record of what changed.

## Decision

1. **MCP `update_journal_entry`** (owner or editor, any member's entry) takes the entry's id, `expected_version`, a required `reason` (1–200), and optionally `doc_date`, `description`, `reference` (null clears it) and `legs`. `legs` replaces every leg with exactly `create_journal_entry`'s rules and messages. A field left out stays. The currency stays.
2. **Same entry.** The entry keeps its id, notes, files, thread and place in every report. Re-booking goes through `private.post_journal_entry` (the core `create_journal_entry` and the prepaid posting share) on a scratch line. Its part legs, balance-sheet legs and header then move onto the entry's own line, and the scratch line is deleted, in the same transaction. Every leg rule, refusal and the self-check stay in one place. The "journal entry is fixed" trigger lets only that move through (`flow.journal_entry_edit`); every other change of a posted entry is still refused.
3. **Versions.** `journal_entries.version` starts at 1 and goes up by one per update or undo. `expected_version` must be the current version, or the update is `entry changed`. `get_line_legs`, `get_expense` and `create_journal_entry` give it, as a string.
4. **History.** Every update saves the version it replaces in `public.journal_entry_versions`: legs, date, currency, description, reference, P&L effect, who wrote it, when and why, and who replaced it, when and why. Both names stay when the editor is not the author. MCP `get_journal_entry_history` (any member) lists the versions newest first, the current one included. The history goes with the entry when the entry is removed.
5. **Undo** kind `journal_entry_update` puts the version before back while the entry still reads as the update left it (its legs, date, description and reference); otherwise `conflict`. The undo is a version too, with the reason `undo: <reason>`. Only the member who made the update can undo it, as for every undo. Several updates undo newest first. Once every update is undone, `create_journal_entry`'s own undo removes the entry again.
6. **Refused:** a line that is not a journal entry (`not a journal entry`), a prepaid month's entry (`the entry belongs to a prepaid schedule`: the prepaid tools change it), and an update or undo whose old or new date is on or before the books-closed date (`the books are closed through YYYY-MM-DD`). Another company's entry is `transaction not found`, as everywhere, so nothing says it exists. Viewers are `forbidden`.
7. **One leg's project** (FLOW-176): `set_journal_entry_leg_project` takes the leg's `get_line_legs` ordinal and a project (or null), changes only that leg, and books the entry through `update_journal_entry` under its own key with `:leg` after it: the same rules, version check, history and undo kind.
8. **Totals follow.** The legs are posted again at once, so the ledger, the balance sheet, the account lines and the P&L show the new version. The P&L moves by the difference of the P&L legs only. The entry stays out of every cash view.

## Consequences

- The audit log shows the scratch line created and deleted inside the update; no other table keeps it.
- `set_journal_entry_leg_project` ([FLOW-176](../backlog/tasks/FLOW-176.md)) sets one leg's project through `update_journal_entry`, without sending every leg. Undoing another member's entry stays as it is: only its writer undoes it (the owner dropped that follow-up, 2026-10-30).
