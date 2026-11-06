# 0262 · A card named after a property decides Jev's project

**Date:** 2026-11-06
**Status:** Accepted

## Context

The owner, 2026-11-06, from the phone: a utility line paid with a card the owner named after one property ("<property street> Utilities") came to the review queue with Jev's project set to another property. FLOW-707 sends the card's and the account's names to the model as a hint to weigh, but the model followed the supplier's past filings: the same utility company serves several properties, and its earlier lines were filed to another one. The owner's ask: "Jev should infer from credit card name the property if there is a match."

## Decision

1. When the paying card's name, or else the account's name, names exactly one project, that project is Jev's project answer for the line, at confidence 1, whatever the model answered (`cardProject` in `jev_tag_plan.ts`, applied in `planTag`). The stored answer carries `source: "card_name"`.
2. A name matches a project when every word of the project's name is in it, ignoring case, numbers under two digits, words under three letters, and generic words (street kinds such as Rd, Ave, St; purposes such as Utilities, Ops; Hebrew רחוב, דרך and the like). When both carry a number, the numbers must agree, so two properties on one street are told apart. Overhead and finished projects are not candidates. No match, or more than one, leaves the model's answer.
3. The category stays the model's answer, so auto pre-fill still waits for the category's confidence (decisions 0084, 0145). A line the owner assigned, a shared or overhead line and a split line are not changed, as before.
4. A line Jev already tagged is not asked again (one tag per model pin); the rule applies to new lines.
