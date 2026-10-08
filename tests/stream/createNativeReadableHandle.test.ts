import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ptr, toArrayBuffer } from "bun:ffi";
import {
  type BufferLease,
  type Item,
  isFillReadable,
  isRangeReadable,
  PayloadKind,
} from "@flowscripter/pluggable-io-framework-api";
import { createNativeReadableHandle } from "../../src/stream/createNativeReadableHandle.ts";
import { getNativeWaker } from "../../src/waker/getNativeWaker.ts";
import { createTempDir, readAll, sampleBytes } from "../fixtures/files.ts";

const DATA = sampleBytes(100_000);

function concat(items: Item<PayloadKind.Native>[]): Uint8Array {
  const out = new Uint8Array(items.reduce((sum, item) => sum + item.payload.length, 0));
  let offset = 0;
  for (const item of items) {
    out.set(
      new Uint8Array(toArrayBuffer(item.payload.ptr as never, 0, item.payload.length)),
      offset,
    );
    offset += item.payload.length;
  }
  return out;
}

describe("createNativeReadableHandle", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ dir, cleanup } = await createTempDir());
    await writeFile(join(dir, "data.bin"), DATA);
    await writeFile(join(dir, "empty.bin"), "");
  });

  afterAll(async () => {
    await cleanup();
  });

  for (const waker of ["callback", "worker"] as const) {
    const open = (name = "data.bin", chunkSize = 4096) =>
      createNativeReadableHandle(
        join(dir, name),
        { chunkSize, depth: 2, waker },
        getNativeWaker(waker),
      );

    describe(`waker ${waker}`, () => {
      test("yields host native items whose bytes match the file", async () => {
        const handle = open();
        expect(handle.kind).toBe(PayloadKind.Native);
        const items = await readAll(handle.stream as ReadableStream<Item<PayloadKind.Native>>);
        expect(items.length).toBe(Math.ceil(DATA.length / 4096));
        for (const item of items) {
          expect(item.payload.kind).toBe(PayloadKind.Native);
          expect(item.payload.domain).toBe("host");
        }
        expect(concat(items)).toEqual(DATA);
        for (const item of items) {
          item.payload.release();
          item.payload.release();
        }
      });

      test("an empty file ends immediately", async () => {
        const items = await readAll(open("empty.bin").stream as ReadableStream);
        expect(items).toEqual([]);
      });

      test("readRange reads an exclusive range clamped to the end", async () => {
        const handle = open();
        const middle = await readAll(await handle.readRange(1000, 9000));
        expect(concat(middle)).toEqual(DATA.slice(1000, 9000));
        const tail = await readAll(await handle.readRange(90_000, Number.MAX_SAFE_INTEGER));
        expect(concat(tail)).toEqual(DATA.slice(90_000));
        for (const item of [...middle, ...tail]) {
          item.payload.release();
        }
      });

      test("readRange is empty when start >= end or start is past the end", async () => {
        const handle = open();
        expect(await readAll(await handle.readRange(10, 10))).toEqual([]);
        expect(await readAll(await handle.readRange(20, 10))).toEqual([]);
        expect(await readAll(await handle.readRange(500_000, 600_000))).toEqual([]);
      });

      test("readInto fills sink-provided buffers until end of stream", async () => {
        const handle = open();
        expect(isRangeReadable(handle)).toBe(true);
        expect(isFillReadable(handle)).toBe(true);
        expect(handle.domains).toEqual(["host"]);
        const target = new Uint8Array(DATA.length + 10_000);
        let offset = 0;
        for (;;) {
          const slice = target.subarray(offset);
          const lease = { ptr: ptr(slice), length: 3000 } as unknown as BufferLease;
          const filled = await handle.readInto(lease);
          if (filled === null) break;
          offset += filled;
        }
        expect(target.subarray(0, offset)).toEqual(DATA);
      });

      test("cancelling the stream releases the reader", async () => {
        const handle = open();
        const reader = (handle.stream as ReadableStream<Item<PayloadKind.Native>>).getReader();
        const { value } = await reader.read();
        value?.payload.release();
        await reader.cancel();
      });
    });
  }

  test("a missing file fails when first read", async () => {
    const handle = createNativeReadableHandle(
      join(dir, "missing.bin"),
      { chunkSize: 4096, depth: 2, waker: "callback" },
      getNativeWaker("callback"),
    );
    await expect(readAll(handle.stream as ReadableStream)).rejects.toThrow("missing.bin");
  });

  test("readInto on a missing file rejects", async () => {
    const handle = createNativeReadableHandle(
      join(dir, "missing.bin"),
      { chunkSize: 4096, depth: 2, waker: "callback" },
      getNativeWaker("callback"),
    );
    const lease = { ptr: 1, length: 1 } as unknown as BufferLease;
    await expect(handle.readInto(lease)).rejects.toThrow("missing.bin");
  });
});
