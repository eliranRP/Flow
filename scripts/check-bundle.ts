import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const dist = path.resolve("app/dist/assets");
const files = readdirSync(dist).filter((name) => name.endsWith(".js"));
let largest = { name: "", gzip: 0 };
for (const name of files) {
  const buf = readFileSync(path.join(dist, name));
  const gzip = gzipSync(buf).length;
  if (gzip > largest.gzip) largest = { name, gzip };
}
const ceiling = 260 * 1024;
const text = files.map((name) => readFileSync(path.join(dist, name), "utf8")).join("\n");
if (text.includes("service_role")) {
  console.error("client bundle contains service_role");
  process.exit(1);
}
console.log(`${largest.name} ${String(largest.gzip)} bytes gzip`);
if (largest.gzip > ceiling) {
  console.error(`entry gzip ${String(largest.gzip)} exceeds ${String(ceiling)}`);
  process.exit(1);
}
if (!statSync("app/public/_headers").isFile()) {
  console.error("missing app/public/_headers");
  process.exit(1);
}
