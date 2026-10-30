// MCP tools: the descriptions of FLOW-149's ledger tools (decision 0228), create_journal_entry and
// get_account_balances, FLOW-151's set_category_account (decision 0231), and FLOW-174's
// update_journal_entry and get_journal_entry_history (decision 0234), and FLOW-176's
// set_journal_entry_leg_project, listed in tools_specs.ts. Split out of it to keep it under the file-size limit.
import { PREPAID_READ_SPECS, PREPAID_WRITE_SPECS } from "./tools_prepaid_specs.ts";

function spec(name: string, description: string, properties: Record<string, unknown>, write: boolean) {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, additionalProperties: false },
    annotations: write
      ? { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
      : { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  };
}

export const LEDGER_READ_SPECS = [
  spec("get_journal_entry_history", "A journal entry's versions (FLOW-174, decision 0234; any member reads it): journal_entry_id, version (the current one), created_by, created_by_name and created_at (who booked it), and versions[] newest first, the current one with current true: version, current, doc_date, currency, description, reference, legs[] (account_id, project_id, amount_minor: signed, debit positive, as create_journal_entry takes them), pnl_minor (its P&L effect, signed), written_by, written_by_name, written_at and reason (who wrote that version, when and why; reason is null for the version booked), and for a replaced version replaced_by, replaced_by_name, replaced_at and replaced_reason (the update_journal_entry, or its undo, that replaced it). A line that is not a journal entry is refused (not a journal entry); another company's or an unknown id is not_found.", {
    journal_entry_id: { type: "string" },
  }, false),
  spec("get_account_balances", "The balance-sheet accounts' balances from the ledger legs (FLOW-149, decision 0228), as of as_of (YYYY-MM-DD, default today, by each line's date): balances[] (account_id, account_name, type asset or liability, project_id, project_name, currency, balance_minor: SIGNED, debit positive, credit negative, so an asset reads positive and Accumulated depreciation or a liability negative), every account but the bank, per project and currency, only non-zero; and book_value[] per project and currency (property_minor on Property, accumulated_depreciation_minor on Accumulated depreciation, net_book_value_minor their sum). Any member reads it.", {
    as_of: { type: ["string", "null"] },
  }, false),
  spec("get_balance_sheet", "The balance sheet from the ledger legs (FLOW-152), as of as_of (YYYY-MM-DD, default today), per currency: assets, liabilities and equity, each with total_minor and accounts[] (account_id, name, is_system, balance_minor; zero balances left out), retained_earnings_minor (the running P&L: minus the income and expense legs), total_assets_minor, total_liabilities_and_equity_minor (liabilities + equity + retained earnings), difference_minor and balanced (assets = liabilities + equity + retained earnings), and warnings[] (code suspense or uncategorized, account_id, account_name, balance_minor, message) when Suspense or an Uncategorized account is not zero. Debit is positive; liabilities and equity are shown positive (credit), so a debit balance there shows negative. Rule: a line's legs count from the line's doc_date (the bank leg too), on posted lines that are not removed; draft legs are not on the books. project_id limits it to the legs filed to one project (an entry that spans projects may then not balance on its own). Any member reads it.", {
    as_of: { type: ["string", "null"] },
    project_id: { type: ["string", "null"] },
  }, false),
  spec("get_account_lines", "One balance-sheet account's movements (FLOW-165), the reports screen's account page: account_id (an asset, liability or equity account from get_balance_sheet or list_accounts), as_of (YYYY-MM-DD, default today), from (YYYY-MM-DD, on or before as_of: the period's first day, default 1 January of as_of's year; FLOW-171), from_start (true: the period is the account's whole history, with no opening balance; not with from), project_id (only the legs filed to that project), currency (only that currency), limit (1 to 100, default 50) and offset. Output: account_id, name, type, is_system, as_of, from (the period's first day; null from the start), from_start, year_start (1 January of as_of's year whatever the period; kept for one release for older clients, read from), project_id, project_name, currency, loan_ids[] (the loans whose parts post to the account, a loan's principal), currencies[] (currency, opening_minor: the balance before from, 0 from the start, movement_minor: the period's change, balance_minor: as of as_of, the same figure as get_balance_sheet's account, count: the period's movements), rows[] (the period's movements newest first, one per line with its legs on the account summed: transaction_id, doc_date, currency, amount_minor, description, party_name, project_id, project_name, part (a loan part: principal, interest, escrow or fees), loan_id, line_amount_minor (the whole line's signed amount)) and has_more. Signed as get_balance_sheet shows them: an asset's debit is positive, a liability's and equity's credit is, so a loan's principal payment reads negative. Rule: a line's legs count from its doc_date, on posted lines that are not removed; draft legs are not on the books. Another company's account or project, an unknown one, or an income or expense account is not_found. Any member reads it.", {
    account_id: { type: "string" },
    as_of: { type: ["string", "null"] },
    from: { type: ["string", "null"] },
    from_start: { type: "boolean" },
    project_id: { type: ["string", "null"] },
    currency: { type: ["string", "null"] },
    limit: { type: "integer" },
    offset: { type: "integer" },
  }, false),
  spec("get_pnl_statement", "The P&L as a statement (FLOW-160), the one the reports screen and its PDF show. from and to (YYYY-MM-DD, both or neither; neither is all time), basis (cash or invoiced, default the company's), and either project_id (one project, a shared cost as its allocation) or by_project true (a statement per project key: each project, overhead and unassigned), not both. Output: from, to, basis, project_id, project_name, by_project, currencies[] (the company's or the project's statement per currency: currency, income_minor, expense_minor, net_minor, income[] and expense[] categories largest first, each { id, name, amount_minor, count, own_minor, children[] } where a parent holds its sub-categories (children, each { id, name, amount_minor, count }) and own_minor is its own lines, and kept_out[] { id, name, direction, amount_minor, count, account_name, account_type }, the categories kept out of the P&L and the balance-sheet account each posts to), projects[] (by_project only: { key, project_id, name, currencies[] the same shape }; key overhead and unassigned have no project_id), and review_count (open review items in the range). Amounts are minor units of their currency, income and cost both positive; currencies are never added together. The totals equal get_breakdown's for the same range and basis. Another company's project is not_found.", {
    from: { type: ["string", "null"] },
    to: { type: ["string", "null"] },
    project_id: { type: ["string", "null"] },
    by_project: { type: "boolean" },
    basis: { type: ["string", "null"] },
  }, false),
  spec("export_report", "The reports as a file to download or share (FLOW-162): the P&L, the balance sheet or both (kind pnl, balance or both, default pnl), as a PDF in Hebrew, A4, right to left, the reports screen's layout (format pdf, the default) or a CSV that opens in Excel (format csv: UTF-8 with a byte-order mark, one row per line of the report, amounts as decimals with a minus on money out). The P&L takes get_pnl_statement's from, to (both or neither; neither is all time), basis, and project_id or by_project true (a table with a column per project), and expand (default true: each category's sub-categories under it); the balance sheet takes as_of (default today; with kind both, default the P&L's to) and the same project_id. The numbers are get_pnl_statement's and get_balance_sheet's. Output: file_name, mime_type and size_bytes; the file itself comes as an embedded resource (base64 blob) in the result's content. Another company's project is not_found.", {
    kind: { type: "string", enum: ["pnl", "balance", "both"] },
    format: { type: "string", enum: ["pdf", "csv"] },
    from: { type: ["string", "null"] },
    to: { type: ["string", "null"] },
    as_of: { type: ["string", "null"] },
    project_id: { type: ["string", "null"] },
    by_project: { type: "boolean" },
    basis: { type: ["string", "null"] },
    expand: { type: "boolean" },
  }, false),
  ...PREPAID_READ_SPECS,
];

export const LEDGER_WRITE_SPECS = [
  spec("create_journal_entry", "Book an entry that moves no money (FLOW-149, decision 0228; owner or editor), such as a property's depreciation: a debit to an expense category and a credit to Accumulated depreciation, per project. legs is [{ account_id, amount_minor, project_id? }] from list_accounts, SIGNED (debit positive, credit negative), 2 to 50, summing to 0, with NO bank leg (a journal entry has no bank leg). A leg on a category counted in the P&L is booked with book_line's rules (one such leg makes a whole line of its kind, more a split; project_id files it); the others go on balance-sheet accounts (any asset, liability or equity account that is not archived, a system one or the company's own, but not Suspense or VAT control, or a kept-out category's account, which lands on its posts_to), carried per project. A kept-out category whose posts_to is Suspense is refused (the category posts to Suspense): bind it first with set_category_account, or book the balance-sheet account itself; an archived account is refused (account is archived). An entry may be on balance-sheet accounts only (FLOW-152, e.g. a reclass between two asset accounts or an owner contribution in kind): it changes no P&L and no cash figure, pnl_minor is 0, and its line has amount 0. When there are P&L legs they must not net to 0 (a journal entry must change the P&L); one expense leg credited alone is category kind must match the direction. doc_date (YYYY-MM-DD) is the month it counts in, on either basis; currency is 3 letters; description 1 to 120 characters; reference (optional, 1 to 60, e.g. the accounting system's entry number). An entry with P&L legs counts in the P&L of its projects on either basis, an income entry too (its line is an invoice_receipt; FLOW-151), stays out of every cash view (get_cash_months, get_cash_lines, cash flow), never waits for review, and is fixed: no other tool changes its category, project, amount, split or cash flag (journal entry is fixed), and a category it uses cannot be deleted; correct it with update_journal_entry (FLOW-174). get_expense names it in journal_entry with its reference and version; get_line_legs shows its legs (no bank leg); get_account_balances sums the balance-sheet legs (e.g. Accumulated depreciation) per project. Returns id, pnl_minor (its P&L effect, signed), legs, version (\"1\") and undo_kind journal_entry; undo is kind journal_entry with that id and removes it while it reads as written (after an update_journal_entry, undo the updates first).", {
    idempotency_key: { type: "string" },
    doc_date: { type: "string" },
    currency: { type: "string" },
    description: { type: "string" },
    reference: { type: ["string", "null"] },
    legs: {
      type: "array",
      items: {
        type: "object",
        properties: { account_id: { type: "string" }, amount_minor: { type: "integer" }, project_id: { type: ["string", "null"] } },
        required: ["account_id", "amount_minor"],
        additionalProperties: false,
      },
    },
  }, true),
  spec("update_journal_entry", "Correct a posted journal entry in place (FLOW-174, decision 0234; owner or editor, also for an entry another member wrote): the entry keeps its id, its notes and files, and its place in every report; only its legs and fields change. journal_entry_id is the entry's line id (get_expense, get_line_legs); expected_version is the version they give in journal_entry.version (refused with entry changed when the entry changed since); reason (required, 1 to 200 characters) says why. Optional, and kept as they are when left out: doc_date (YYYY-MM-DD), description (1 to 120), reference (1 to 60, or null to clear it) and legs, which REPLACES every leg with exactly create_journal_entry's rules: [{ account_id, amount_minor, project_id? }], signed (debit positive), 2 to 50, summing to 0, no bank leg, not Suspense or VAT control, no archived account, P&L legs that do not net to 0; the currency stays the entry's. Refused: entry changed; not a journal entry (a bank line or a manual line); the entry belongs to a prepaid schedule (change it with the prepaid tools); the books are closed through YYYY-MM-DD (when the old or the new doc_date is on or before set_books_closed_through's date); create_journal_entry's refusals for the legs; another company's or an unknown id is transaction not found; a viewer is forbidden. The ledger legs and every balance read (get_account_balances, get_balance_sheet, get_account_lines, the P&L) show the new version at once: the P&L moves by the difference of the P&L legs only, and the entry stays out of every cash view. The version replaced is kept: get_journal_entry_history lists it. Returns id, version (the new one), previous_version, doc_date, currency, description, reference, pnl_minor and previous_pnl_minor (the P&L effect after and before, signed), legs, reason and undo_kind journal_entry_update; undo is kind journal_entry_update with the entry id and puts the version before back, as a new version, while the entry still reads as this update left it (conflict once it changed since). Only the member who made the update can undo it.", {
    idempotency_key: { type: "string" },
    journal_entry_id: { type: "string" },
    expected_version: { type: "string" },
    doc_date: { type: "string" },
    description: { type: "string" },
    reference: { type: ["string", "null"] },
    legs: {
      type: "array",
      items: {
        type: "object",
        properties: { account_id: { type: "string" }, amount_minor: { type: "integer" }, project_id: { type: ["string", "null"] } },
        required: ["account_id", "amount_minor"],
        additionalProperties: false,
      },
    },
    reason: { type: "string" },
  }, true),
  spec("set_journal_entry_leg_project", "Set the project of one leg of a posted journal entry (FLOW-176, decision 0234; owner or editor), without sending every leg: a shortcut over update_journal_entry, which books it with its rules, refusals, version check and history. journal_entry_id is the entry's line id; expected_version is journal_entry.version from get_line_legs or get_expense (entry changed when it changed since); leg_ordinal is the leg's ordinal in get_line_legs (1 to 50; leg not found when the entry has no such leg); project_id is a project from list_projects, or null for none (project not found for another company's or an unknown project); reason (required, 1 to 200) says why. The leg's account and amount and every other leg stay; the P&L of the projects moves when the leg is in the P&L, and the balance per project when it is on a balance-sheet account. idempotency_key is 1 to 124 characters. Returns what update_journal_entry returns (the new version, legs, undo_kind journal_entry_update); undo is kind journal_entry_update with the entry id.", {
    idempotency_key: { type: "string" },
    journal_entry_id: { type: "string" },
    expected_version: { type: "string" },
    leg_ordinal: { type: "integer" },
    project_id: { type: ["string", "null"] },
    reason: { type: "string" },
  }, true),
  spec("set_category_account", "Bind a kept-out category to the balance-sheet account its ledger legs land on (FLOW-151, decision 0231; owner or editor): its posts_to in list_accounts. A category is bound by its name when it is created (decision 0210, English names only); any other kept-out category lands on Suspense, so bind it here, e.g. tenants' deposits to Security deposit held, owner contributions to Owner capital, renovation to Property. account_id is an open asset, liability or equity account from list_accounts (a system account or the company's own; not the bank, Suspense or VAT control; an archived one is refused: account is archived), or null for the default (its loan part's account, else Suspense). The category's lines are re-posted: their legs move to the account, and no P&L figure moves (the P&L reads the category). Refused: a category counted in the P&L (the category is counted in the P&L), a loan part category (a loan part category posts by its part), and any other account (a category posts only to a balance-sheet account). A journal entry already booked keeps its legs. Returns category_id, account_id, posts_to and posts_to_name (where its legs land now), previous_account_id and undo_kind category_account; undo is kind category_account with the category id and puts the binding back while it is still the one written.", {
    idempotency_key: { type: "string" },
    category_id: { type: "string" },
    account_id: { type: ["string", "null"] },
  }, true),
  spec("create_account", "Add a balance-sheet account to the company's chart (FLOW-152; owner or editor): name (1 to 60 characters), type asset, liability or equity, description (optional, up to 200). E.g. Deposits paid (asset). Then bind a kept-out category to it with set_category_account, or book it with book_line or create_journal_entry. Refused: a system name such as Suspense or Property (that name belongs to a system account), a name already used (account already exists). Returns id, name, type, description, is_system, archived and undo_kind account_create; undo is kind account_create with the account id and deletes it while it has no legs or categories and reads as written.", {
    idempotency_key: { type: "string" },
    name: { type: "string" },
    type: { type: "string", enum: ["asset", "liability", "equity"] },
    description: { type: ["string", "null"] },
  }, true),
  spec("update_account", "Rename or describe a company account, or change its type (FLOW-152; owner or editor). Give at least one of name, description (an empty string clears it) and type. The type changes only while the account has no legs (account has postings, so its type can't change). The 12 system accounts and the accounts of categories are refused (system account can't be changed, category account can't be changed), and so is an archived account (account is archived). Returns the account and undo_kind account_update; undo is kind account_update with the account id and puts the old values back while it reads as written.", {
    idempotency_key: { type: "string" },
    account_id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    type: { type: "string", enum: ["asset", "liability", "equity"] },
  }, true),
  spec("archive_account", "Archive a company account that is no longer used (FLOW-152; owner or editor): it leaves list_accounts (unless include_archived) and can't be booked. Refused: a system account, an account with a balance in any project and currency (account has a balance of 388.00), and one with categories bound to it (account has linked categories; hidden '· ledger' categories count). Returns the account and undo_kind account_archive; undo is kind account_archive with the account id.", {
    idempotency_key: { type: "string" },
    account_id: { type: "string" },
  }, true),
  spec("restore_account", "Open an archived company account again (FLOW-152; owner or editor). Refused when it is not archived (account is not archived). Returns the account and undo_kind account_restore; undo is kind account_restore with the account id and archives it again while it still has no balance or bound category.", {
    idempotency_key: { type: "string" },
    account_id: { type: "string" },
  }, true),
  spec("merge_account", "Merge a company account into another of the same type (FLOW-152; owner or editor): the categories bound to from_account_id (hidden '· ledger' ones too) and its journal entry legs move to into_account_id, their lines are posted again, and from_account_id is archived. The legs move between two balance-sheet accounts, so no P&L figure moves. into_account_id may be a system account (not the bank, Suspense or VAT control); from_account_id may not. Refused: the same account (pick a different account), a different type (accounts must be the same type), an archived account, a category's account. Returns from, into, categories_moved, journal_legs_moved and undo_kind account_merge; undo is kind account_merge with the FROM account id and moves everything back while it reads as written (account_merge conflict when a category or leg moved since).", {
    idempotency_key: { type: "string" },
    from_account_id: { type: "string" },
    into_account_id: { type: "string" },
  }, true),
  ...PREPAID_WRITE_SPECS,
];
