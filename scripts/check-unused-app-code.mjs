#!/usr/bin/env node
/**
 * FLOW-819: the app keeps no code that only its stories and tests use. A component the screens
 * stopped using goes in the same PR as its story, test and CSS (CONTRIBUTING "Remove what your
 * change leaves unused"); otherwise main's every-story pass keeps opening it.
 *
 * Two checks over app/src, from the app's entry (src/main.tsx):
 * - every module is reachable from the entry, unless it is a test, a story, or story and test
 *   support (its name says so: test, stories, story, sample, harness; or `supportFiles` below);
 * - every export of a reachable module is used by another reachable module, by itself, or by the
 *   Storybook setup (.storybook/); a sample module's exports are exempt. A test hook may stay: name it reset…/…ForTests, or put
 *   `@forTests` in its doc comment.
 * Usage: node scripts/check-unused-app-code.mjs   (prints each problem; exits 1 on any)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Support modules whose names don't say so, each with why it stays outside the app's graph. */
export const supportFiles = new Map([
  ["src/ui/index.ts", "the barrel the stories import"],
  ["src/demo/model.ts", "the unit tests' copy of the demo company"],
  ["src/ui/reduced-motion.tsx", "a Storybook decorator"],
  ["src/lib/supabase-unused.ts", "vite.config aliases supabase-js's realtime and storage clients to it"],
]);

const supportName = /(^|[/.-])(test|tests|stories|story|sample|harness)([/.-]|$)|\.d\.ts$/;
const testHookName = /^reset[A-Z]|ForTests$/;

/** @param {string} rel  a path relative to the app root */
export function isSupport(rel) {
  return supportName.test(rel) || supportFiles.has(rel);
}

/**
 * @param {{ appRoot: string, entry?: string }} options
 * @returns {string[]} one line per problem, paths relative to the app root
 */
export function findUnused({ appRoot, entry = "src/main.tsx" }) {
  const config = ts.getParsedCommandLineOfConfigFile(path.join(appRoot, "tsconfig.json"), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  });
  if (!config) throw new Error(`no tsconfig in ${appRoot}`);
  const src = path.join(appRoot, "src") + path.sep;
  const rel = (/** @type {string} */ file) => path.relative(appRoot, file).split(path.sep).join("/");
  const program = ts.createProgram(config.fileNames, config.options);
  const checker = program.getTypeChecker();
  const files = program.getSourceFiles().filter((file) => !file.isDeclarationFile && path.resolve(file.fileName).startsWith(appRoot + path.sep));
  const inSrc = files.filter((file) => path.resolve(file.fileName).startsWith(src));

  // Reachability from the entry, over static and dynamic imports.
  const host = ts.createCompilerHost(config.options);
  /** @type {Map<string, string[]>} */
  const graph = new Map();
  for (const file of inSrc) {
    const info = ts.preProcessFile(file.text, true, true);
    graph.set(path.resolve(file.fileName), info.importedFiles
      .map((item) => ts.resolveModuleName(item.fileName, file.fileName, config.options, host).resolvedModule?.resolvedFileName)
      .filter((name) => name != null)
      .map((name) => path.resolve(name)));
  }
  const reached = new Set();
  const stack = [path.join(appRoot, entry)];
  while (stack.length > 0) {
    const file = /** @type {string} */ (stack.pop());
    if (reached.has(file)) continue;
    reached.add(file);
    stack.push(...(graph.get(file) ?? []));
  }

  /** @type {string[]} */
  const problems = [];
  for (const file of inSrc) {
    const name = rel(file.fileName);
    if (!reached.has(path.resolve(file.fileName)) && !isSupport(name)) {
      const users = inSrc.filter((other) => graph.get(path.resolve(other.fileName))?.includes(path.resolve(file.fileName))).map((other) => rel(other.fileName));
      problems.push(`${name}: the app never imports it${users.length > 0 ? `; only ${users.join(", ")} do` : ""}.`);
    }
  }

  // Who uses each declaration: the app (a reachable module), or the Storybook setup.
  /** @type {Map<ts.Symbol, { app: boolean, others: Set<string> }>} */
  const uses = new Map();
  for (const file of files) {
    const name = rel(file.fileName);
    const app = reached.has(path.resolve(file.fileName));
    const storybook = name.startsWith(".storybook/");
    const visit = (/** @type {ts.Node} */ node) => {
      if (ts.isIdentifier(node) && !isDeclarationName(node)) {
        let symbol = destructuredExport(node) ?? checker.getSymbolAtLocation(node);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        if (symbol) {
          const entry = uses.get(symbol) ?? { app: false, others: new Set() };
          if (app || storybook) entry.app = true;
          else entry.others.add(name);
          uses.set(symbol, entry);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  // `import("./x").then(({ name }) => …)` names the export in a binding pattern.
  function destructuredExport(/** @type {ts.Identifier} */ node) {
    const element = node.parent;
    if (!ts.isBindingElement(element) || !ts.isObjectBindingPattern(element.parent)) return undefined;
    if ((element.propertyName ?? element.name) !== node) return undefined;
    return checker.getTypeAtLocation(element.parent).getProperty(node.text);
  }
  for (const file of inSrc) {
    // A sample module's exports are story and test data, even where the app's previews reach it.
    if (!reached.has(path.resolve(file.fileName)) || isSupport(rel(file.fileName))) continue;
    const moduleSymbol = checker.getSymbolAtLocation(file);
    if (!moduleSymbol) continue;
    for (let symbol of checker.getExportsOfModule(moduleSymbol)) {
      if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const declaration = symbol.declarations?.[0];
      // A re-export is checked where it is declared.
      if (!declaration || declaration.getSourceFile() !== file) continue;
      if (testHookName.test(symbol.name) || hasForTestsTag(declaration)) continue;
      const entry = uses.get(symbol);
      if (entry?.app) continue;
      const others = [...(entry?.others ?? [])].filter((other) => other !== rel(file.fileName));
      problems.push(others.length > 0
        ? `${rel(file.fileName)}: ${symbol.name} is used only by ${others.join(", ")}.`
        : `${rel(file.fileName)}: ${symbol.name} is used nowhere.`);
    }
  }
  return problems;
}

/** @param {ts.Identifier} node */
function isDeclarationName(node) {
  const parent = node.parent;
  return (
    (ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isClassDeclaration(parent)
      || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent)
      || ts.isExportSpecifier(parent) || ts.isImportSpecifier(parent) || ts.isImportClause(parent))
    && parent.name === node
  );
}

/** @param {ts.Declaration} declaration */
function hasForTestsTag(declaration) {
  /** @type {ts.Node} */
  let node = declaration;
  // A `const` carries its doc comment on the statement.
  if (ts.isVariableDeclaration(node)) node = node.parent.parent;
  return ts.getJSDocTags(node).some((tag) => tag.tagName.text === "forTests")
    || /@forTests\b/.test(node.getFullText().slice(0, node.getLeadingTriviaWidth()));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = findUnused({ appRoot: path.join(repoRoot, "app") });
  for (const problem of problems) console.error(`app/${problem}`);
  if (problems.length > 0) {
    console.error(
      `\ncheck-unused-app-code: ${String(problems.length)} part(s) of app/src only stories and tests use. ` +
        "Delete each with its stories, tests and CSS (CONTRIBUTING, \"Remove what your change leaves unused\"). " +
        "A hook a test needs stays when its doc comment says @forTests.",
    );
    process.exit(1);
  }
  console.log("check-unused-app-code: every app module and export is used by the app.");
}
