import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ptr, toArrayBuffer } from "bun:ffi";
import {
  type Item,
  isBufferProvider,
  isResumableWritable,
  PayloadKind,
} from "@flowscripter/pluggable-io-framework-api";
import { createNativeWritableHandle } from "../../src/stream/createNativeWritableHandle.ts";
import { getNativeWaker } from "../../src/waker/getNativeWaker.ts";
import { createTempDir, sampleBytes } from "../fixtures/files.ts";

function hostItem(data: Uint8Array, onRelease: () => void): Item<PayloadKind.Native> {
  return {
    payload: {
      kind: PayloadKind.Native,
      domain: "host",
      ptr: ptr(data),
      length: data.byteLength,
      release: onRelease,
    },
  };
}

describe("createNativeWritableHandle", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ dir, cleanup } = await createTempDir());
  });

  afterAll(async () => {
    await cleanup();
  });

  for (const waker of ["callback", "worker"] as const) {
    const config = { chunkSize: 1024, depth: 2, waker };

    describe(`waker ${waker}`, () => {
      test("writes pushed items, releases each, and creates parent directories", async () => {
        const path = join(dir, waker, "nested", "pushed.bin");
        const handle = await createNativeWritableHandle(path, config, getNativeWaker(waker));
        expect(handle.kind).toBe(PayloadKind.Native);
        expect(handle.startOffset).toBe(0);
        const data = sampleBytes(50_000);
        let released = 0;
        const writer = (handle.stream as WritableStream<Item<PayloadKind.Native>>).getWriter();
        for (let offset = 0; offset < data.length; offset += 700) {
          await writer.write(hostItem(data.subarray(offset, offset + 700), () => (released += 1)));
        }
        await writer.close();
        expect(released).toBe(Math.ceil(data.length / 700));
        expect(new Uint8Array(await readFile(path))).toEqual(data);
        expect(handle.resumeToken()).toEqual({ offset: data.length });
      });

      test("acquire, fill and commit leases", async () => {
        const path = join(dir, `${waker}-lease.bin`);
        const handle = await createNativeWritableHandle(path, config, getNativeWaker(waker));
        expect(isBufferProvider(handle)).toBe(true);
        expect(handle.domain).toBe("host");
        expect(handle.maxOutstanding).toBe(2);
        const data = sampleBytes(5000);
        for (let offset = 0; offset < data.length; offset += 1024) {
          const lease = await handle.acquire();
          expect(lease.length).toBe(1024);
          const chunk = data.subarray(offset, offset + 1024);
          new Uint8Array(toArrayBuffer(lease.ptr as never, 0, lease.length)).set(chunk);
          await lease.commit(chunk.length);
          lease.release();
        }
        await (handle.stream as WritableStream).close();
        expect(new Uint8Array(await readFile(path))).toEqual(data);
      });

      test("a released lease can be acquired again", async () => {
        const handle = await createNativeWritableHandle(
          join(dir, `${waker}-released.bin`),
          { ...config, depth: 1 },
          getNativeWaker(waker),
        );
        const first = await handle.acquire();
        first.release();
        const second = await handle.acquire();
        expect(second.ptr).toBe(first.ptr);
        second.release();
        await (handle.stream as WritableStream).close();
      });

      test("an exhausted pool waits until a lease is committed", async () => {
        const path = join(dir, `${waker}-wait.bin`);
        const handle = await createNativeWritableHandle(
          path,
          { ...config, depth: 1 },
          getNativeWaker(waker),
        );
        const first = await handle.acquire();
        const second = handle.acquire();
        await first.commit(0);
        const lease = await second;
        await lease.commit(0);
        await (handle.stream as WritableStream).close();
        expect((await stat(path)).size).toBe(0);
      });

      test("resume appends after the committed bytes and reports startOffset", async () => {
        const path = join(dir, `${waker}-resume.bin`);
        const data = sampleBytes(6000);
        await writeFile(path, data.subarray(0, 2500));
        const handle = await createNativeWritableHandle(path, config, getNativeWaker(waker), {
          offset: 2500,
        });
        expect(handle.startOffset).toBe(2500);
        expect(isResumableWritable(handle)).toBe(true);
        const writer = (handle.stream as WritableStream<Item<PayloadKind.Native>>).getWriter();
        const rest = data.subarray(2500);
        await writer.write(hostItem(rest, () => {}));
        await writer.close();
        expect(handle.resumeToken()).toEqual({ offset: 6000 });
        expect(new Uint8Array(await readFile(path))).toEqual(data);
      });

      test("resume of a missing file starts at zero", async () => {
        const handle = await createNativeWritableHandle(
          join(dir, `${waker}-resume-new.bin`),
          config,
          getNativeWaker(waker),
          { offset: 10 },
        );
        expect(handle.startOffset).toBe(0);
        await (handle.stream as WritableStream).close();
      });

      test("abort keeps the resume token usable", async () => {
        const handle = await createNativeWritableHandle(
          join(dir, `${waker}-abort.bin`),
          config,
          getNativeWaker(waker),
        );
        const writer = (handle.stream as WritableStream<Item<PayloadKind.Native>>).getWriter();
        await writer.write(hostItem(sampleBytes(100), () => {}));
        await writer.abort();
        expect(handle.resumeToken()?.offset).toBeLessThanOrEqual(100);
      });
    });
  }

  test("opening an unwritable path fails", async () => {
    await writeFile(join(dir, "plain-file"), "x");
    await expect(
      createNativeWritableHandle(
        join(dir, "plain-file", "child"),
        { chunkSize: 1024, depth: 2, waker: "callback" },
        getNativeWaker("callback"),
      ),
    ).rejects.toThrow();
  });
});
