# The recurring switch is the charge's, not the party's

**Date:** 2026-10-19
**Status:** Accepted

Amends [0185](0185-recurring-charge-per-project.md): its paragraph on the owner's switches.

## Context

[0185](0185-recurring-charge-per-project.md) split a recurring charge by project but kept the owner's switches per party and currency: "recurring" made only the party's main charge recurring, so a stray bill filed to another project did not become a monthly charge with a late alert.

The owner then hit the other side of it. One rent platform pays the rent of three properties, A, B and C, into one bank account: one customer with three charges. A recurs by the rule. B has two complete months, one short of the rule's three, and C has only this month. The owner turned "recurring" on for B's and C's rent lines, and קבועים still showed only A. The switch wrote the party's word, and the party's word reached only A, its main charge.

## Decision

The owner's word, recurring or not and the pace, is for the charge of the line it was set on: the party, the currency and the project the line's charge belongs to (`recurring_stream_lines`: the line's own project, else the party's project whose latest filed amount is closest).

- `recurring_overrides` has a `project_id`. A row with a project is that charge's word. A row with no project is the party-wide word; every row written before this decision is one, and they are kept.
- A charge reads its own row first, field by field (recurring, then pace). Without one it reads the party-wide row as 0185 did: "not recurring" ends every charge, "recurring" makes the main charge recurring, and its pace is every charge's.
- A charge marked recurring with no complete month yet takes its usual day and amount from its latest month, this month included. Before, only the main charge could.
- The switch and the pace on a line (`set_payment_recurring`, `set_payment_pace`, MCP `set_line_recurring`, `set_line_pace`) write the row of the line's charge. Each returns the charge's word before; the MCP keeps the charge's project in its undo, so `undo` puts back the same row even after the line was filed elsewhere, "no row" included.
- `get_line_recurring` and the app's switch report the word that applies to the line's charge.
- In קבועים, "הסתיים" on a charge ends that charge alone, and the toast names its project when the party has more than one. The charge page's switch and "הסתיים" write through the charge's own newest line, split or not, so a newer stray bill in another project is never the line they write to.
- A project's delete removes the words on its charges (`on delete cascade`). Set null would turn them into a party-wide word, which can clash with the party's own and would change every other charge.

The answer that two parties are the same (FLOW-430) stays per party.

## Alternatives rejected

**Keep the switch per party and make "recurring" reach every charge.** That brings back the stray bill of 0185: one bill filed once to another project becomes a monthly charge with a late alert.

**Rewrite the party-wide rows as rows for the main charge.** The main charge can change as months pass, and the owner's old "not recurring" was meant for every charge. The rows stay as they are and keep their meaning.

## Consequences

- A party whose lines go to one project reads as before; its new words are rows for that project.
- Turning "recurring" on for one property's line no longer touches the party's other properties, and "not recurring" on one ends that one.
- A party-wide word set before this stays under a charge's own: clearing a charge's word (null) hands it back to the party-wide word, if there is one, before the rule.
- A line not filed yet writes to the charge its amount places it in. Filing it to another project later leaves the word on the charge it was written to.
