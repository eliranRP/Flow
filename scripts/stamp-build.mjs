/**
 * Writes the commit SHA into the hosted dist so a read-only fetch can
 * tell which build is live. The reviewers-only dist is not stamped.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string} dist
 * @param {string} sha
 */
export function stampBuild(dist, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("stamp-build: expected a 40-character git sha");
  }
  if (!existsSync(dist)) {
    throw new Error(`stamp-build: ${dist} is missing. Build the hosted app first.`);
  }
  writeFileSync(path.join(dist, "build.txt"), `${sha}\n`);
  const meta = `<meta name="flow-build" content="${sha}" />`;
  for (const name of ["index.html", "404.html"]) {
    const file = path.join(dist, name);
    if (!existsSync(file)) continue;
    const html = readFileSync(file, "utf8");
    if (html.includes(meta)) continue;
    const next = html.includes('name="flow-build"')
      ? html.replace(/<meta name="flow-build" content="[0-9a-f]{40}" \/>/, meta)
      : html.replace("</head>", `    ${meta}\n  </head>`);
    if (next === html || !next.includes(meta)) {
      throw new Error(`stamp-build: ${name} has no </head>`);
    }
    writeFileSync(file, next);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const sha = process.argv[2] ?? "";
  const dist = path.resolve(process.argv[3] ?? path.join(root, "app/dist"));
  try {
    stampBuild(dist, sha);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  console.log(`stamped ${sha}`);
}
