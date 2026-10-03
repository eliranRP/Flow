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

/**
 * @param {string} sql
 * @returns {{ line: number, text: string }[]}
 */
function sqlStatements(sql) {
  /** @type {{ line: number, text: string }[]} */
  const statements = [];
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
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "\n") line += 1;
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
  return statements;
}

/**
 * @param {string} sql
 * @param {string} name
 * @returns {string[]}
 */
export function explicitTransactionProblems(sql, name) {
  const statements = sqlStatements(sql);
  /** @type {{ line: number, text: string }[]} */
  const control = [];
  for (const statement of statements) {
    if (transactionStart.test(statement.text)) control.push(statement);
  }
  if (control.length === 0) return [];
  const first = statements[0];
  const last = statements[statements.length - 1];
  const wrapped = control.length === 2
    && first === control[0]
    && last === control[1]
    && /^begin\b/i.test(first.text)
    && /^commit\b/i.test(last.text);
  if (wrapped) return [];
  return control.map((statement) => {
    const word = statement.text.split(" ")[0].toLowerCase();
    return `${name}:${statement.line} starts a transaction statement (${word}) but the file is not one begin and one final commit`;
  });
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
