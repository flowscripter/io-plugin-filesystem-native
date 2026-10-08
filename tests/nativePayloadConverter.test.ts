import { describe, expect, test } from "bun:test";
import { ptr, toArrayBuffer } from "bun:ffi";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Item,
  type JsPayload,
  type NativePayload,
  PayloadKind,
} from "@flowscripter/pluggable-io-framework-api";
import {
  jsToNativePayloadConverter,
  nativePayloadConverters,
  nativeToJsPayloadConverter,
} from "../src/nativePayloadConverter.ts";
import { createNativeReadableHandle } from "../src/stream/createNativeReadableHandle.ts";
import { getNativeWaker } from "../src/waker/getNativeWaker.ts";
import { createTempDir, readAll, sampleBytes } from "./fixtures/files.ts";

async function readNativeItems(
  length: number,
): Promise<{ items: Item[]; cleanup(): Promise<void> }> {
  const { dir, cleanup } = await createTempDir();
  await writeFile(join(dir, "f.bin"), sampleBytes(length));
  const handle = createNativeReadableHandle(
    join(dir, "f.bin"),
    { chunkSize: 4096, depth: 2, waker: "callback" },
    getNativeWaker("callback"),
  );
  return { items: await readAll(handle.stream as ReadableStream<Item>), cleanup };
}

describe("nativePayloadConverter", () => {
  test("declares both zero-cost converters", () => {
    expect(nativePayloadConverters).toEqual([
      nativeToJsPayloadConverter,
      jsToNativePayloadConverter,
    ]);
    expect(nativeToJsPayloadConverter.from).toEqual({ kind: PayloadKind.Native, domain: "host" });
    expect(nativeToJsPayloadConverter.to).toEqual({ kind: PayloadKind.Js });
    expect(nativeToJsPayloadConverter.cost).toBe(0);
    expect(jsToNativePayloadConverter.from).toEqual({ kind: PayloadKind.Js });
    expect(jsToNativePayloadConverter.to).toEqual({ kind: PayloadKind.Native, domain: "host" });
    expect(jsToNativePayloadConverter.cost).toBe(0);
  });

  test("native to js gives a byte-identical view that outlives the payload release", async () => {
    const { items, cleanup } = await readNativeItems(10_000);
    const converted = items.map((item) => nativeToJsPayloadConverter.convert(item));
    for (const item of items) {
      (item.payload as NativePayload).release();
    }
    Bun.gc(true);
    const bytes = new Uint8Array(
      Buffer.concat(converted.map((item) => (item.payload as JsPayload).data)),
    );
    expect(bytes).toEqual(sampleBytes(10_000));
    for (const item of converted) {
      expect(item.payload.kind).toBe(PayloadKind.Js);
    }
    await cleanup();
  });

  test("native to js keeps the item attributes", async () => {
    const { items, cleanup } = await readNativeItems(10);
    const converted = nativeToJsPayloadConverter.convert({
      attributes: { tag: 1 },
      payload: items[0]!.payload,
    });
    expect(converted.attributes).toEqual({ tag: 1 });
    await cleanup();
  });

  test("native to js copies and releases a payload from another source", () => {
    const source = sampleBytes(64);
    let released = 0;
    const payload: NativePayload = {
      kind: PayloadKind.Native,
      domain: "host",
      ptr: ptr(source),
      length: source.length,
      release: () => (released += 1),
    };
    const converted = nativeToJsPayloadConverter.convert({ payload });
    expect(released).toBe(1);
    source.fill(0);
    expect((converted.payload as JsPayload).data).toEqual(sampleBytes(64));
  });

  test("js to native points at the same bytes and keeps them alive until release", () => {
    const data = sampleBytes(128);
    const converted = jsToNativePayloadConverter.convert({
      attributes: { n: 2 },
      payload: { kind: PayloadKind.Js, data },
    });
    const payload = converted.payload as NativePayload;
    expect(payload.kind).toBe(PayloadKind.Native);
    expect(payload.domain).toBe("host");
    expect(payload.length).toBe(128);
    expect(converted.attributes).toEqual({ n: 2 });
    expect(new Uint8Array(toArrayBuffer(payload.ptr as never, 0, payload.length))).toEqual(data);
    payload.release();
  });

  test("js to native handles an empty payload", () => {
    const converted = jsToNativePayloadConverter.convert({
      payload: { kind: PayloadKind.Js, data: new Uint8Array(0) },
    });
    expect((converted.payload as NativePayload).length).toBe(0);
  });
});
