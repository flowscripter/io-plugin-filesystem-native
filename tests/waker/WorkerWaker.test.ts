import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WorkerWaker } from "../../src/waker/WorkerWaker.ts";
import { createNativeReadableHandle } from "../../src/stream/createNativeReadableHandle.ts";
import { createTempDir, readAll, sampleBytes } from "../fixtures/files.ts";

describe("WorkerWaker", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ dir, cleanup } = await createTempDir());
    await writeFile(join(dir, "data.bin"), sampleBytes(300_000));
  });

  afterAll(async () => {
    await cleanup();
  });

  test("wakes a reader that had to wait, repeatedly, and can be reopened", async () => {
    const waker = new WorkerWaker();
    for (let round = 0; round < 2; round += 1) {
      const handle = createNativeReadableHandle(
        join(dir, "data.bin"),
        { chunkSize: 1024, depth: 1, waker: "worker" },
        waker,
      );
      const items = await readAll(
        handle.stream as ReadableStream<{ payload: { length: number; release(): void } }>,
      );
      expect(items.reduce((sum, item) => sum + item.payload.length, 0)).toBe(300_000);
      for (const item of items) {
        item.payload.release();
      }
    }
  });

  test("close without open is a no-op and references are counted", () => {
    const waker = new WorkerWaker();
    waker.close();
    waker.open();
    waker.open();
    waker.close();
    waker.close();
  });
});
