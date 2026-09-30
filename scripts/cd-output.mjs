/**
 * Reads deploy-command output without gluing a command tag onto the value.
 * psql -At prints `SET` and then the row. The value is the last line.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ansi = /\u001b\[[0-9;]*m/g;

/** @param {string} text */
export function stripAnsi(text) {
  return text.replace(ansi, "");
}

/** @param {string} text */
export function lastNonEmptyLine(text) {
  let last = "";
  for (const line of stripAnsi(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) last = trimmed;
  }
  return last;
}

/**
 * @param {string} stdout
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function readOnlySession(stdout) {
  if (lastNonEmptyLine(stdout) === "on") return { ok: true };
  return { ok: false, reason: "read-only session did not report on" };
}

/** Column order of scripts/preflight-r23.sql. psql -At prints values in this order. */
export const preflightCountNames = [
  "backfill_240000_transactions",
  "backfill_240000_undo_priors",
  "backfill_240000_review_priors",
  "backfill_250000_transactions",
  "backfill_250000_undo_priors",
  "backfill_250000_review_priors",
  "rule_transactions_at_risk",
  "rule_undo_rows_at_risk",
  "backfill_260000_rule_restores",
  "backfill_260000_undo_priors",
  "backfill_260000_review_priors",
];

/**
 * @param {string} stdout
 * @returns {{ ok: true, counts: Record<string, number> } | { ok: false, reason: string }}
 */
export function preflightCounts(stdout) {
  const line = lastNonEmptyLine(stdout);
  // psql -At separates fields with | unless -F says otherwise. The preflight passes -F '|'.
  if (!/^[0-9]+(?:\|[0-9]+){10}$/.test(line)) {
    return { ok: false, reason: "preflight counts were not eleven integers" };
  }
  const values = line.split("|");
  /** @type {Record<string, number>} */
  const counts = {};
  preflightCountNames.forEach((name, index) => {
    counts[name] = Number(values[index]);
  });
  return { ok: true, counts };
}

/** Exact lines from Supabase CLI 2.118.0 `db push --db-url --dry-run` (output.raw, uncoloured). */
export const dryRunHeadsUp = "DRY RUN: migrations will *not* be pushed to the database.";
export const remoteUpToDate = "Remote database is up to date.";
export const wouldPushMigrations = "Would push these migrations:";

/**
 * Up to date: the DRY RUN line, then stdout `Remote database is up to date.`
 * Pending: the DRY RUN line and `Would push these migrations:`.
 * `--db-url` says "remote" even when the host is loopback.
 * @param {string} text
 * @returns {{ ok: true, kind: "up-to-date" | "pending" } | { ok: false, reason: string }}
 */
export function classifyDryRun(text) {
  const clean = stripAnsi(text);
  const headsUp = clean.includes(dryRunHeadsUp);
  const upToDate = clean.includes(remoteUpToDate);
  const pending = clean.includes(wouldPushMigrations);
  if (upToDate && pending) {
    return { ok: false, reason: "dry-run reported both up to date and pending migrations" };
  }
  if (headsUp && upToDate) return { ok: true, kind: "up-to-date" };
  if (headsUp && pending) return { ok: true, kind: "pending" };
  return { ok: false, reason: "dry-run output did not match Supabase CLI 2.118.0" };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const text = readFileSync(0, "utf8");
  const mode = process.argv[2];
  if (mode === "read-only") {
    const result = readOnlySession(text);
    if (!result.ok) {
      console.error(result.reason);
      process.exit(1);
    }
  } else if (mode === "counts") {
    const result = preflightCounts(text);
    if (!result.ok) {
      console.error(result.reason);
      process.exit(1);
    }
    for (const name of preflightCountNames) {
      console.log(`${name}=${result.counts[name]}`);
    }
  } else if (mode === "dry-run") {
    const result = classifyDryRun(text);
    if (!result.ok) {
      console.error(result.reason);
      process.exit(1);
    }
    console.log(result.kind);
  } else if (mode === "equals") {
    const expected = process.argv[3] ?? "";
    if (lastNonEmptyLine(text) !== expected) {
      console.error("output last line did not match");
      process.exit(1);
    }
  } else {
    console.error("unknown cd-output mode");
    process.exit(1);
  }
}
