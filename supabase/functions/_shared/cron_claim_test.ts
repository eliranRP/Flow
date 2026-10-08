import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { runWithClaim } from "./cron_claim.ts";

type Run = { ok: boolean; lines?: number; skipped?: boolean };

Deno.test("a run that syncs keeps the release to the sync itself", async () => {
  let released = 0;
  const result = await runWithClaim(() => Promise.resolve<Run>({ ok: true, lines: 3 }), () => {
    released += 1;
    return Promise.resolve();
  });
  assertEquals(result, { ok: true, lines: 3 });
  assertEquals(released, 0);
});

Deno.test("a skipped run releases the claim", async () => {
  let released = 0;
  const result = await runWithClaim(() => Promise.resolve<Run>({ ok: true, lines: 0, skipped: true }), () => {
    released += 1;
    return Promise.resolve();
  });
  assertEquals(result.skipped, true);
  assertEquals(released, 1);
});

Deno.test("a run that throws releases the claim and rethrows", async () => {
  let released = 0;
  await assertRejects(
    () =>
      runWithClaim(() => Promise.reject<Run>(new Error("auth")), () => {
        released += 1;
        return Promise.resolve();
      }),
    Error,
    "auth",
  );
  assertEquals(released, 1);
});

Deno.test("a failed release does not hide the result or the error", async () => {
  const result = await runWithClaim(
    () => Promise.resolve<Run>({ ok: true, skipped: true }),
    () => Promise.reject(new Error("network")),
  );
  assertEquals(result.skipped, true);
  await assertRejects(
    () => runWithClaim(() => Promise.reject<Run>(new Error("sync_failed")), () => Promise.reject(new Error("network"))),
    Error,
    "sync_failed",
  );
});
