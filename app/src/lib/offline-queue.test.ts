import { describe, expect, it } from "vitest";
import { createOfflineQueue, type OpStore, type QueuedOp } from "./offline-queue";

function memory(): OpStore {
  let ops: QueuedOp[] = [];
  return {
    read() {
      return Promise.resolve(ops.map((op) => ({ ...op })));
    },
    write(next) {
      ops = next.map((op) => ({ ...op }));
      return Promise.resolve();
    },
  };
}

describe("offline queue", () => {
  it("replays each op once", async () => {
    const queue = createOfflineQueue(memory());
    const op: QueuedOp = {
      clientOpId: "11111111-1111-4111-8111-111111111111",
      name: "create_manual_entry",
      args: { p_description: "מלט" },
    };
    await queue.enqueue(op);
    await queue.enqueue(op);
    const seen: string[] = [];
    const sent = await queue.replay((item) => {
      seen.push(item.clientOpId);
      return Promise.resolve();
    });
    expect(sent).toBe(1);
    expect(seen).toEqual([op.clientOpId]);
    expect(await queue.pending()).toBe(0);
    const again = await queue.replay(() => {
      throw new Error("should not run");
    });
    expect(again).toBe(0);
  });
});
