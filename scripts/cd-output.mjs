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

/** Exact lines from Supabase CLI 2.118.0 `db push --dry-run` (output.raw, uncoloured). */
export const dryRunHeadsUp = "DRY RUN: migrations will *not* be pushed to the database.";
export const remoteUpToDate = "Remote database is up to date.";
export const localUpToDate = "Local database is up to date.";
export const wouldPushMigrations = "Would push these migrations:";

/** Versions whose backfill `scripts/preflight-r23.sql` checks. */
export const backfillVersions = ["20260929240000", "20260929250000", "20260929260000"];

/** @param {string} text */
export function trimmedLines(text) {
  return stripAnsi(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * True only when the history query returned exactly those three versions, each as a whole line.
 * @param {string} stdout
 */
export function backfillVersionsRecorded(stdout) {
  const lines = trimmedLines(stdout);
  if (lines.length !== backfillVersions.length) return false;
  return backfillVersions.every((version) => lines.includes(version));
}

/**
 * @param {Record<string, number>} counts
 */
export function ruleRiskIsZero(counts) {
  return counts.rule_transactions_at_risk === 0 && counts.rule_undo_rows_at_risk === 0;
}

/**
 * A whole trimmed line. Both preflight scripts pass `--output-format json`, so a `{` or `[`
 * line must parse. `dryRun: true` is the only accepted result object.
 * @param {string} line
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, reason: "not-json" | "malformed" | "dry-run-not-true" }}
 */
function dryRunJson(line) {
  if (!line.startsWith("{") && !line.startsWith("[")) return { ok: false, reason: "not-json" };
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.dryRun !== true) {
    return { ok: false, reason: "dry-run-not-true" };
  }
  return { ok: true, value };
}

/** @param {unknown} value */
function emptyArray(value) {
  return Array.isArray(value) && value.length === 0;
}

/**
 * @param {unknown} value
 * @returns {string[] | null}
 */
function migrationNames(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  /** @type {string[]} */
  const names = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") return null;
    names.push(item);
  }
  return names;
}

/** @param {string[]} lines */
function listedSql(lines) {
  /** @type {string[]} */
  const names = [];
  for (const line of lines) {
    const found = line.match(/[A-Za-z0-9_.-]+\.sql/g);
    if (found) names.push(...found);
  }
  return names;
}

/**
 * Fail closed. Both preflight scripts pass `--output-format json`.
 * The log must contain the DRY RUN line and exactly one JSON object with `dryRun: true`.
 * Malformed JSON fails. A parsed JSON line whose `dryRun` is not `true` fails.
 * There is no plain-text success path.
 * Up to date requires `upToDate === true` and empty `migrations`, `seeds`, and `roles`.
 * Prod mode also requires `message` to start with `Remote`. Local mode requires `Local`.
 * A pending text list next to `upToDate: true` fails. Pending JSON next to an up-to-date text line fails.
 * When the JSON `migrations` list and a text `.sql` list are both present, the names must be equal.
 * `expect` `auto` allows pending on remote only. `pending` requires that listing.
 * @param {string} text
 * @param {string} target
 * @param {"auto" | "pending"} [expect]
 * @returns {{ ok: true, kind: "up-to-date", target: "remote" | "local" } | { ok: true, kind: "pending", migrations: string[] } | { ok: false, reason: string }}
 */
export function classifyDryRun(text, target, expect = "auto") {
  if (target !== "remote" && target !== "local") {
    return { ok: false, reason: "dry-run target must be remote or local" };
  }
  if (expect !== "auto" && expect !== "pending") {
    return { ok: false, reason: "dry-run expect must be auto or pending" };
  }
  const lines = trimmedLines(text);
  let malformed = false;
  let dryRunNotTrue = false;
  /** @type {Record<string, unknown>[]} */
  const jsonValues = [];
  /** @type {string[]} */
  const textLines = [];
  for (const line of lines) {
    const parsed = dryRunJson(line);
    if (!parsed.ok && parsed.reason === "not-json") {
      textLines.push(line);
      continue;
    }
    if (!parsed.ok && parsed.reason === "malformed") {
      malformed = true;
      continue;
    }
    if (!parsed.ok) {
      dryRunNotTrue = true;
      continue;
    }
    jsonValues.push(parsed.value);
  }
  if (malformed) return { ok: false, reason: "dry-run output contained malformed JSON" };
  if (dryRunNotTrue) return { ok: false, reason: "dry-run JSON did not set dryRun to true" };
  if (jsonValues.length !== 1) {
    return { ok: false, reason: "dry-run output did not contain exactly one JSON result" };
  }
  if (!textLines.includes(dryRunHeadsUp)) {
    return { ok: false, reason: "dry-run output did not contain the DRY RUN line" };
  }

  const json = jsonValues[0];
  const message = typeof json.message === "string" ? json.message : "";
  const names = migrationNames(json.migrations);
  const upToDate = json.upToDate === true
    && emptyArray(json.migrations)
    && emptyArray(json.seeds)
    && emptyArray(json.roles);
  const wouldPush = textLines.includes(wouldPushMigrations);
  const textNames = listedSql(textLines);
  const upToDateText = textLines.includes(remoteUpToDate) || textLines.includes(localUpToDate);

  if (json.upToDate === true && wouldPush) {
    return { ok: false, reason: "dry-run listed pending migrations alongside an up-to-date result" };
  }
  if (json.upToDate === true && textNames.length > 0) {
    return { ok: false, reason: "dry-run listed a migration file alongside an up-to-date result" };
  }
  if (names && upToDateText) {
    return { ok: false, reason: "dry-run JSON listed migrations alongside an up-to-date line" };
  }
  if (names && textNames.length > 0 && names.join("\n") !== textNames.join("\n")) {
    return { ok: false, reason: "dry-run JSON migrations did not match the text list" };
  }

  if (upToDate) {
    if (target === "remote" && !message.startsWith("Remote")) {
      return { ok: false, reason: "dry-run JSON message did not start with Remote" };
    }
    if (target === "local" && !message.startsWith("Local")) {
      return { ok: false, reason: "dry-run JSON message did not start with Local" };
    }
    if (expect === "pending") {
      return { ok: false, reason: "dry-run JSON was up to date and pending was required" };
    }
    return { ok: true, kind: "up-to-date", target };
  }
  if (json.upToDate === true) {
    return { ok: false, reason: "dry-run JSON said up to date and also listed migrations, seeds, or roles" };
  }
  if (names) {
    if (target === "local" && expect !== "pending") {
      return { ok: false, reason: "dry-run listed pending migrations against a local target" };
    }
    return { ok: true, kind: "pending", migrations: names };
  }
  return { ok: false, reason: "dry-run JSON did not match Supabase CLI 2.118.0" };
}

/**
 * The local preflight is an up-to-date check. Pending belongs to the separate local dry-run.
 * Production may be up to date or list migrations that the push will apply.
 * @param {string} kind
 * @param {string} target
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function acceptPreflightKind(kind, target) {
  if (target !== "remote" && target !== "local") {
    return { ok: false, reason: "preflight target must be remote or local" };
  }
  if (target === "local" && kind === "up-to-date local") return { ok: true };
  if (target === "remote" && (kind === "up-to-date remote" || kind === "pending")) return { ok: true };
  return { ok: false, reason: "preflight dry-run kind did not match the target" };
}

/** @param {string[]} argv @param {string} name */
function flagValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return "";
  return argv[index + 1] ?? "";
}

const modesThatReadStdin = new Set([
  "read-only",
  "counts",
  "dry-run",
  "backfill-recorded",
  "rule-risk",
  "equals",
]);

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const mode = process.argv[2];
  const text = modesThatReadStdin.has(mode) ? readFileSync(0, "utf8") : "";
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
    const target = flagValue(process.argv, "--target");
    const expectFlag = flagValue(process.argv, "--expect");
    const expect = expectFlag === "" ? "auto" : expectFlag;
    const result = classifyDryRun(text, target, expect === "pending" ? "pending" : expect);
    if (!result.ok) {
      console.error(result.reason);
      process.exit(1);
    }
    if (result.kind === "pending") {
      for (const name of result.migrations) console.error(`pending migration: ${name}`);
      console.log("pending");
    } else {
      console.log(`up-to-date ${result.target}`);
    }
  } else if (mode === "backfill-recorded") {
    if (!backfillVersionsRecorded(text)) process.exit(1);
  } else if (mode === "rule-risk") {
    const result = preflightCounts(text);
    if (!result.ok) {
      console.error("preflight-r23.sql did not return eleven counts");
      process.exit(1);
    }
    if (!ruleRiskIsZero(result.counts)) {
      console.error("rule_transactions_at_risk or rule_undo_rows_at_risk is not zero");
      process.exit(1);
    }
  } else if (mode === "preflight-kind") {
    const target = flagValue(process.argv, "--target");
    const kind = process.argv.slice(3).filter((arg, index) => {
      const previous = process.argv[3 + index - 1];
      return arg !== "--target" && previous !== "--target";
    }).join(" ");
    const result = acceptPreflightKind(kind, target);
    if (!result.ok) {
      console.error(result.reason);
      process.exit(1);
    }
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
