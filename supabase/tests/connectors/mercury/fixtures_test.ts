import { assertEquals } from "jsr:@std/assert@1";
import { buildFixtures } from "./generate_fixtures.ts";

// FLOW-903: every fixture is generator output. Rebuild with
// deno run --allow-read --allow-write supabase/tests/connectors/mercury/generate_fixtures.ts
Deno.test("the generator rebuilds every Mercury fixture byte for byte", () => {
  const dir = new URL("./fixtures/", import.meta.url);
  const built = buildFixtures();
  const onDisk = [...Deno.readDirSync(dir)]
    .filter((entry) => entry.isFile && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  assertEquals(onDisk, [...built.keys()].sort());
  for (const [name, body] of built) {
    assertEquals(Deno.readTextFileSync(new URL(name, dir)) === body, true, `${name} differs from generate_fixtures.ts`);
  }
});

Deno.test("the generator is deterministic", () => {
  assertEquals([...buildFixtures()], [...buildFixtures()]);
});
