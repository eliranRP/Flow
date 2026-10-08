/**
 * CLI 2.118.0 executes each migration statement on its own. A file is one
 * transaction only when its first statement is begin and its last is commit.
 * Any other transaction statement, including a commit in the middle, makes
 * the rest of the file autocommit. A later failure is then not rolled back
 * and the migration is not recorded.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase/migrations");

const transactionStart = /^(begin|commit|end|abort|start\s+transaction|prepare\s+transaction)(?:\s|$)|^(rollback)(?!\s+to\b)(?:\s|$)/i;
const indexStatement = /^(create\s+(unique\s+)?index|drop\s+index)\b/i;
const concurrentIndex = /^(create\s+(unique\s+)?index|drop\s+index)\s+concurrently\b/i;
const innerTransaction = /(?:^| )(commit|abort|prepare transaction|start transaction)(?: |$)|(?:^| )rollback(?! to\b)(?: |$)/i;
const transactionWord = /^(commit|abort|rollback|start(?:\s+transaction)?|prepare(?:\s+transaction)?)$/i;

/**
 * Indexes in these files landed before the checker. They stay unwrapped.
 * A new migration has to wrap create index and drop index in the file transaction.
 * CREATE INDEX CONCURRENTLY and DROP INDEX CONCURRENTLY stay outside that
 * transaction. They cannot run inside one.
 * @type {Set<string>}
 */
const historicalUnwrappedIndexes = new Set([
  "20260928080538_schema_v1.sql",
  "20260928140000_phase1_slice.sql",
  "20260928210000_owner_ledger.sql",
  "20260930140000_mcp_cycle1.sql",
  "20261003115300_jev_connector.sql",
  "20261003120000_mcp_cycle3a.sql",
]);

/**
 * @param {string} sql
 * @returns {{ statements: { line: number, text: string }[], bodies: { line: number, text: string, code: boolean }[] }}
 */
function sqlPieces(sql) {
  /** @type {{ line: number, text: string }[]} */
  const statements = [];
  /** @type {{ line: number, text: string, code: boolean }[]} */
  const bodies = [];
  let i = 0;
  let line = 1;
  let statementLine = 1;
  let buf = "";
  let started = false;

  const flush = () => {
    const text = buf.replace(/\s+/g, " ").trim();
    if (text.length > 0) statements.push({ line: statementLine, text });
    buf = "";
    started = false;
  };

  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const nl = rest.indexOf("\n");
      if (nl < 0) break;
      i += nl;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      const chunk = end < 0 ? rest : rest.slice(0, end + 2);
      line += (chunk.match(/\n/g) ?? []).length;
      i += chunk.length;
      continue;
    }
    if (sql[i] === "'") {
      if (!started) {
        started = true;
        statementLine = line;
      }
      const escapeString = i > 0 && (sql[i - 1] === "E" || sql[i - 1] === "e") && (i < 2 || /[^A-Za-z0-9_]/.test(sql[i - 2] ?? ""));
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "\n") line += 1;
        if (escapeString && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      buf += " ";
      continue;
    }
    const dollar = /^\$[A-Za-z0-9_]*\$/.exec(rest);
    if (dollar) {
      if (!started) {
        started = true;
        statementLine = line;
      }
      const tag = dollar[0];
      const close = rest.indexOf(tag, tag.length);
      const chunk = close < 0 ? rest : rest.slice(0, close + tag.length);
      const body = close < 0 ? rest.slice(tag.length) : rest.slice(tag.length, close);
      const before = buf.replace(/\s+/g, " ").trim();
      bodies.push({ line, text: body, code: /(?:^|\s)(?:do|as)$/i.test(before) });
      line += (chunk.match(/\n/g) ?? []).length;
      i += chunk.length;
      buf += " ";
      continue;
    }
    const ch = sql[i];
    if (ch === ";") {
      flush();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      line += 1;
      if (started) buf += " ";
      i += 1;
      continue;
    }
    if (!started && !/\s/.test(ch)) {
      started = true;
      statementLine = line;
    }
    if (started) buf += ch;
    i += 1;
  }
  if (buf.trim()) flush();
  return { statements, bodies };
}

/**
 * Transaction words in a routine body. Comments and strings are skipped, and so is a
 * nested dollar quote unless it follows `do` or `as` (a nested body, scanned the same way).
 * The line is the word itself, not the `begin` that opened the block.
 * @param {string} sql
 * @returns {{ line: number, word: string }[]}
 */
function innerTransactionHits(sql) {
  /** @type {{ line: number, word: string }[]} */
  const hits = [];
  let i = 0;
  let line = 1;
  let buf = "";
  let started = false;
  /** @type {number | null} */
  let wordLine = null;

  const flush = () => {
    const text = buf.replace(/\s+/g, " ").trim();
    buf = "";
    started = false;
    const at = wordLine;
    wordLine = null;
    if (text.length === 0 || at == null) return;
    const hit = innerTransaction.exec(text);
    if (hit == null) return;
    const word = (hit[1] ?? "rollback").toLowerCase();
    hits.push({ line: at, word });
  };

  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const nl = rest.indexOf("\n");
      if (nl < 0) break;
      i += nl;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      const chunk = end < 0 ? rest : rest.slice(0, end + 2);
      line += (chunk.match(/\n/g) ?? []).length;
      i += chunk.length;
      continue;
    }
    if (sql[i] === "'") {
      if (started) buf += " ";
      const escapeString = i > 0 && (sql[i - 1] === "E" || sql[i - 1] === "e") && (i < 2 || /[^A-Za-z0-9_]/.test(sql[i - 2] ?? ""));
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "\n") line += 1;
        if (escapeString && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    const dollar = /^\$[A-Za-z0-9_]*\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const close = rest.indexOf(tag, tag.length);
      const chunk = close < 0 ? rest : rest.slice(0, close + tag.length);
      // A nested body after `do` or `as` is code too (a DO block that creates a function,
      // or a function that runs a DO block), so its transaction words count.
      if (/(?:^|\s)(?:do|as)$/i.test(buf.replace(/\s+/g, " ").trim())) {
        const body = close < 0 ? rest.slice(tag.length) : rest.slice(tag.length, close);
        for (const hit of innerTransactionHits(body)) hits.push({ line: line + hit.line - 1, word: hit.word });
      }
      line += (chunk.match(/\n/g) ?? []).length;
      i += chunk.length;
      if (started) buf += " ";
      continue;
    }
    const ch = sql[i] ?? "";
    if (ch === ";") {
      flush();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      line += 1;
      if (started) buf += " ";
      i += 1;
      continue;
    }
    if (!started && !/\s/.test(ch)) started = true;
    const prev = i > 0 ? (sql[i - 1] ?? " ") : " ";
    if (started && wordLine == null && /[A-Za-z]/.test(ch) && !/[A-Za-z_]/.test(prev)) {
      const token = /^[A-Za-z]+(?:\s+[A-Za-z]+){0,2}/.exec(rest);
      if (token != null && transactionWord.test(token[0])) wordLine = line;
    }
    if (started) buf += ch;
    i += 1;
  }
  flush();
  return hits;
}

/**
 * @param {string} sql
 * @param {string} name
 * @returns {string[]}
 */
export function explicitTransactionProblems(sql, name) {
  const { statements, bodies } = sqlPieces(sql);
  /** @type {string[]} */
  const problems = [];
  /** @type {{ line: number, text: string }[]} */
  const control = [];
  let atomicDepth = 0;
  for (const statement of statements) {
    const opensAtomic = (statement.text.match(/\bbegin\s+atomic\b/gi) ?? []).length;
    if (opensAtomic > 0) {
      atomicDepth += opensAtomic;
      continue;
    }
    if (/^end$/i.test(statement.text) && atomicDepth > 0) {
      atomicDepth -= 1;
      continue;
    }
    if (transactionStart.test(statement.text)) control.push(statement);
  }
  const first = statements[0];
  const last = statements[statements.length - 1];
  const wrapped = control.length === 2
    && first === control[0]
    && last === control[1]
    && /^begin\b/i.test(first?.text ?? "")
    && /^commit\b/i.test(last?.text ?? "");
  if (control.length > 0 && !wrapped) {
    for (const statement of control) {
      const word = statement.text.split(" ")[0]?.toLowerCase() ?? "transaction";
      problems.push(`${name}:${statement.line} starts a transaction statement (${word}) but the file is not one begin and one final commit`);
    }
  }
  for (const body of bodies) {
    if (!body.code) continue;
    for (const hit of innerTransactionHits(body.text)) {
      problems.push(`${name}:${body.line + hit.line - 1} has a transaction statement inside a DO or function body (${hit.word})`);
    }
  }
  if (wrapped) {
    for (const statement of statements) {
      if (!concurrentIndex.test(statement.text)) continue;
      problems.push(`${name}:${statement.line} creates or drops an index concurrently inside a transaction`);
    }
  } else if (!historicalUnwrappedIndexes.has(name)) {
    for (const statement of statements) {
      if (!indexStatement.test(statement.text) || concurrentIndex.test(statement.text)) continue;
      problems.push(`${name}:${statement.line} creates or drops an index outside a file transaction`);
    }
  }
  return problems;
}

/** @returns {string[]} */
export function migrationTransactionProblems() {
  /** @type {string[]} */
  const problems = [];
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    const sql = readFileSync(path.join(migrationsDir, name), "utf8");
    problems.push(...explicitTransactionProblems(sql, name));
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const problems = migrationTransactionProblems();
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log("migration files are one transaction or none");
}
