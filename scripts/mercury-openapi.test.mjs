import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { embeddedSpec, mergeGetSpecs, pages } from "./mercury-openapi.mjs";

const api = readFileSync(
  new URL("../supabase/functions/_shared/connectors/mercury/api.d.ts", import.meta.url),
  "utf8",
);
const allowlist = readFileSync(
  new URL("../supabase/functions/_shared/connectors/mercury/allowlist.ts", import.meta.url),
  "utf8",
);

test("generated Mercury types are the three GET paths", () => {
  assert.match(api, /"\/accounts"/);
  assert.match(api, /"\/transactions"/);
  assert.match(api, /"\/transaction\/\{transactionId\}"/);
  assert.match(api, /post\?: never/);
  assert.doesNotMatch(api, /post: operations/);
  assert.doesNotMatch(api, /api\.mercury\.com/);
  assert.doesNotMatch(api, / \*  \* https:/);
  for (const page of pages) {
    assert.equal(api.split(page).length - 1, 1);
  }
});

test("the allowlist is GET paths plus the observed credit path", () => {
  for (const path of ["/accounts", "/credit", "/categories", "/transactions", "/transaction/{transactionId}"]) {
    assert.match(allowlist, new RegExp(path.replaceAll("/", "\\/").replace("{", "\\{").replace("}", "\\}")));
  }
  assert.doesNotMatch(allowlist, /api\.mercury\.com/);
  assert.doesNotMatch(allowlist, /secret-token:/);
});

test("mergeGetSpecs keeps GET and refuses anything else", () => {
  const merged = mergeGetSpecs([
    { paths: { "/accounts": { get: { operationId: "getAccounts" } } }, components: { schemas: { Account: { type: "object" } } } },
  ]);
  assert.deepEqual(Object.keys(merged.paths), ["/accounts"]);
  assert.equal(merged.paths["/accounts"].post, undefined);

  assert.throws(
    () => mergeGetSpecs([{ paths: { "/accounts": { post: { operationId: "no" } } } }]),
    /not GET-only|has no GET/,
  );
  assert.throws(
    () => mergeGetSpecs([
      { paths: { "/accounts": { get: { operationId: "a" } } } },
      { paths: { "/accounts": { get: { operationId: "b" } } } },
    ]),
    /duplicate path/,
  );
  assert.throws(
    () => mergeGetSpecs([
      { paths: {}, components: { schemas: { Account: { type: "object" } } } },
      { paths: {}, components: { schemas: { Account: { type: "string" } } } },
    ]),
    /differs between pages/,
  );
});

test("embeddedSpec reads the fenced JSON", () => {
  const spec = embeddedSpec("before\n```json\n{\"openapi\":\"3.0.0\"}\n```\nafter");
  assert.equal(spec.openapi, "3.0.0");
  assert.throws(() => embeddedSpec("no fence"), /OpenAPI JSON block is missing/);
});
