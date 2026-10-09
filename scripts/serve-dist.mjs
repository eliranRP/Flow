/**
 * FLOW-804: serves a built app gzipped, like the host does, for the Home speed test.
 * An unknown path gets index.html, the app shell. Usage: node scripts/serve-dist.mjs <dist> <port>
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = path.resolve(process.argv[2] ?? "dist");
const port = Number(process.argv[3] ?? 43124);
const types = {
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const compress = new Set([".css", ".html", ".js", ".json", ".svg", ".webmanifest"]);

createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  let file = path.join(root, path.normalize(pathname));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(root, "index.html");
  const ext = path.extname(file);
  let body = readFileSync(file);
  const headers = { "content-type": types[ext] ?? "application/octet-stream" };
  if (compress.has(ext)) {
    body = gzipSync(body);
    headers["content-encoding"] = "gzip";
  }
  res.writeHead(200, headers);
  res.end(body);
}).listen(port, "127.0.0.1");
