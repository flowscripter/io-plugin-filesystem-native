import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { copy } from "@flowscripter/pluggable-io-framework";
import { filesystemIOProviderFactory } from "@flowscripter/io-plugin-filesystem";
import { type Item, PayloadKind } from "@flowscripter/pluggable-io-framework-api";
import { NativeFilesystemIOProvider } from "../src/NativeFilesystemIOProvider.ts";
import { nativeFilesystemConfigSchema } from "../src/schema/nativeFilesystemConfigSchema.ts";
import { nativeToJsPayloadConverter } from "../src/nativePayloadConverter.ts";
import { createTempDir, sampleBytes } from "./fixtures/files.ts";

const context = {
  resolver: { createProviderForLocation: () => Promise.reject(new Error("unused")) },
};

describe("NativeFilesystemIOProvider", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  const data = sampleBytes(3 * 1024 * 1024 + 123);

  beforeAll(async () => {
    ({ dir, cleanup } = await createTempDir());
    await writeFile(join(dir, "source.bin"), data);
  });

  afterAll(async () => {
    await cleanup();
  });

  test("reports properties and joins keys", async () => {
    const provider = new NativeFilesystemIOProvider(nativeFilesystemConfigSchema.parse({}));
    expect(provider.kind).toBe(PayloadKind.Native);
    expect((await provider.getProperties(join(dir, "source.bin"))).size).toBe(data.length);
    expect((await provider.getProperties(dir)).isContainer).toBe(true);
    expect(provider.joinKey("/a", "b")).toBe(join("/a", "b"));
    await provider[Symbol.asyncDispose]();
  });

  test("does not implement listing, deleting, setting properties or multipart", () => {
    const provider = new NativeFilesystemIOProvider(nativeFilesystemConfigSchema.parse({}));
    const optional = provider as unknown as Record<string, unknown>;
    for (const name of [
      "list",
      "delete",
      "setProperties",
      "createContainer",
      "getMultipartWriter",
      "canDirectTransfer",
    ]) {
      expect(optional[name]).toBeUndefined();
    }
  });

  for (const waker of ["callback", "worker"] as const) {
    test(`copies native to native through the lease path (waker ${waker})`, async () => {
      const provider = new NativeFilesystemIOProvider(
        nativeFilesystemConfigSchema.parse({ chunkSize: 65536, waker }),
      );
      const result = await copy(
        provider,
        { kind: "entry", key: join(dir, "source.bin") },
        provider,
        { kind: "entry", key: join(dir, `lease-${waker}.bin`) },
        { directTransfer: false },
      );
      expect(result.bytes).toBe(data.length);
      expect(result.path).toContain("lease");
      expect(new Uint8Array(await readFile(join(dir, `lease-${waker}.bin`)))).toEqual(data);
    });

    test(`copies native to native by pushing items (waker ${waker})`, async () => {
      const provider = new NativeFilesystemIOProvider(
        nativeFilesystemConfigSchema.parse({ chunkSize: 65536, waker }),
      );
      const source = await provider.getReadableStream(join(dir, "source.bin"));
      const sink = await provider.getWritableStream(join(dir, `push-${waker}.bin`));
      await (source.stream as ReadableStream<Item<PayloadKind.Native>>).pipeTo(
        sink.stream as WritableStream<Item<PayloadKind.Native>>,
      );
      expect(new Uint8Array(await readFile(join(dir, `push-${waker}.bin`)))).toEqual(data);
    });
  }

  test("copies native to js with the converter", async () => {
    const native = new NativeFilesystemIOProvider(nativeFilesystemConfigSchema.parse({}));
    const js = await filesystemIOProviderFactory.createProvider(
      filesystemIOProviderFactory.configSchema.parse({}),
      context,
    );
    const result = await copy(
      native,
      { kind: "entry", key: join(dir, "source.bin") },
      js,
      { kind: "entry", key: join(dir, "native-to-js.bin") },
      { directTransfer: false, converter: nativeToJsPayloadConverter },
    );
    expect(result.bytes).toBe(data.length);
    expect(new Uint8Array(await readFile(join(dir, "native-to-js.bin")))).toEqual(data);
  });

  test("keeps the event loop responsive during a large copy", async () => {
    const big = join(dir, "big.bin");
    await writeFile(big, new Uint8Array(128 * 1024 * 1024));
    const provider = new NativeFilesystemIOProvider(nativeFilesystemConfigSchema.parse({}));
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 5);
    const started = performance.now();
    await copy(
      provider,
      { kind: "entry", key: big },
      provider,
      { kind: "entry", key: join(dir, "big-copy.bin") },
      { directTransfer: false },
    );
    clearInterval(timer);
    const elapsed = performance.now() - started;
    expect(ticks).toBeGreaterThan(Math.min(5, elapsed / 5 / 4));
  });
});
