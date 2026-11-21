// FLOW-858: the undo tool's advertised kinds are exactly the kinds its argument schema accepts.
import { assertEquals } from "jsr:@std/assert@1";
import { undoSchema } from "./tools_schemas.ts";
import { toolsFor } from "./tools_specs.ts";

Deno.test("the undo tool advertises every kind it accepts, and only those", () => {
  const undo = toolsFor(["read", "write"]).find((tool) => tool.name === "undo");
  const advertised = (undo?.inputSchema as unknown as { properties: { kind: { enum: string[] } } }).properties.kind.enum;
  const accepted = undoSchema.shape.kind.options as readonly string[];
  assertEquals([...advertised].sort(), [...accepted].sort());
  for (const kind of ["prepaid_create", "prepaid_update", "prepaid_refund", "prepaid_end", "prepaid_delete", "books_closed"]) {
    assertEquals(advertised.includes(kind), true, kind);
  }
});
