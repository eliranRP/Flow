import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { assertMercuryGet } from "../../../functions/_shared/connectors/mercury/guard.ts";
import { fetchMercurySince, openMercury } from "../../../functions/_shared/connectors/mercury/client.ts";
import {
  MERCURY_NOTE_LIMIT,
  attachmentMime,
  attachmentObjectName,
  downloadMercuryAttachment,
  mercuryAttachments,
  mercuryNote,
  mercuryThreads,
} from "../../../functions/_shared/connectors/mercury/thread.ts";

// FLOW-957: Mercury's note and attachments for the thread on a line. Invented rows only.

const NOW = new Date("2026-10-25T08:00:00.000Z");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function transport(handler: (url: URL, init: RequestInit) => Response) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, init: init ?? {} });
    return Promise.resolve(handler(url, init ?? {}));
  };
  return { fetchImpl, calls };
}

const ROW = {
  id: "txn-example-1",
  amount: -1284.5,
  status: "sent",
  postedAt: "2026-10-12T15:00:00Z",
  createdAt: "2026-10-12T14:00:00Z",
  counterpartyName: "Example Lumber",
  note: "  Lumber for back deck, invoice #4471  ",
  attachments: [
    { fileName: "receipt-4471.pdf", attachmentType: "receipt", url: "https://example-bucket.s3.amazonaws.com/a?sig=1" },
    { fileName: "receipt-4471.pdf", attachmentType: "receipt", url: "https://example-bucket.s3.amazonaws.com/b?sig=2" },
    { fileName: "", attachmentType: "other", url: "https://example-bucket.s3.amazonaws.com/c" },
    { fileName: "plain.pdf", attachmentType: "other", url: "http://example-bucket.s3.amazonaws.com/d" },
  ],
};

Deno.test("the note comes in whole, trimmed, capped at Mercury's 5,000 characters, and is not masked", () => {
  assertEquals(mercuryNote("  invoice #4471  "), "invoice #4471");
  assertEquals(mercuryNote("   "), null);
  assertEquals(mercuryNote(null), null);
  assertEquals(mercuryNote("x".repeat(6000))?.length, MERCURY_NOTE_LIMIT);
});

Deno.test("attachments keep a named, https file once", () => {
  assertEquals(mercuryAttachments(ROW.attachments), [
    { fileName: "receipt-4471.pdf", url: "https://example-bucket.s3.amazonaws.com/a?sig=1" },
  ]);
  assertEquals(mercuryAttachments("nope"), []);
});

Deno.test("a sync remembers each fetched row's note and attachments", async () => {
  const { fetchImpl } = transport((url) => {
    if (url.pathname.endsWith("/treasury")) return jsonResponse({ accounts: [], page: {} });
    if (url.pathname.endsWith("/transactions") && url.searchParams.get("status") === "pending") {
      return jsonResponse({ transactions: [], page: {} });
    }
    return jsonResponse({ transactions: [ROW], page: {} });
  });
  const session = openMercury(`test-${crypto.randomUUID()}`, { fetch: fetchImpl, now: () => NOW });
  await fetchMercurySince(session, { cursor: null, importFrom: null, lookbackDays: 30 });
  assertEquals(mercuryThreads(session), [{
    externalId: "txn-example-1",
    note: "Lumber for back deck, invoice #4471",
    attachments: [{ fileName: "receipt-4471.pdf", url: "https://example-bucket.s3.amazonaws.com/a?sig=1" }],
  }]);
});

Deno.test("an attachment is a picture or a PDF, by its type or its name", () => {
  assertEquals(attachmentMime("application/pdf; charset=binary", "x"), "application/pdf");
  assertEquals(attachmentMime("application/octet-stream", "scan.JPG"), "image/jpeg");
  assertEquals(attachmentMime("application/zip", "files.zip"), null);
});

Deno.test("an attachment's storage name is safe and stable", async () => {
  const name = await attachmentObjectName("Receipt #4471 (final).pdf");
  assertEquals(/^m-[0-9a-f]{12}-[A-Za-z0-9._-]+$/.test(name), true);
  assertEquals(name, await attachmentObjectName("Receipt #4471 (final).pdf"));
  assertEquals(name === await attachmentObjectName("Receipt #4472 (final).pdf"), false);
});

Deno.test("a download takes Mercury's file hosts only, sends no key, and refuses other kinds", async () => {
  const { fetchImpl, calls } = transport((url) => {
    if (url.hostname === "example-bucket.s3.amazonaws.com") {
      return new Response(new Uint8Array([37, 80, 68, 70]), { headers: { "content-type": "application/pdf" } });
    }
    return new Response("nope", { status: 200, headers: { "content-type": "text/html" } });
  });
  const session = openMercury("secret-key-example", { fetch: fetchImpl, now: () => NOW });
  const file = await downloadMercuryAttachment(session, { fileName: "r.pdf", url: "https://example-bucket.s3.amazonaws.com/a" });
  assertEquals(file?.mime, "application/pdf");
  assertEquals(file?.bytes.byteLength, 4);
  assertEquals(new Headers(calls[0]!.init.headers).has("authorization"), false);
  assertEquals(await downloadMercuryAttachment(session, { fileName: "r.pdf", url: "https://elsewhere.example.com/a" }), null);
  assertEquals(calls.length, 1);
});

Deno.test("a download over 20 MB is not copied", async () => {
  const { fetchImpl } = transport(() =>
    new Response("x", { headers: { "content-type": "application/pdf", "content-length": String(21 * 1024 * 1024) } })
  );
  const session = openMercury("secret-key-example", { fetch: fetchImpl, now: () => NOW });
  assertEquals(await downloadMercuryAttachment(session, { fileName: "big.pdf", url: "https://example-bucket.s3.amazonaws.com/big" }), null);
});

Deno.test("nothing is written to Mercury: the guard still refuses every method but GET", () => {
  assertThrows(() => assertMercuryGet("PATCH", "/transaction/txn-example-1"), Error, "mercury_method");
  assertThrows(() => assertMercuryGet("POST", "/transaction/txn-example-1/attachments"), Error, "mercury_method");
});
