import { describe, expect, test } from "bun:test";
import { PayloadKind } from "@flowscripter/pluggable-io-framework-api";
import { createNativePayload, takeNativeBuffer } from "../../src/util/nativeBuffer.ts";

describe("nativeBuffer", () => {
  test("creates a host-domain native payload", () => {
    const payload = createNativePayload(0, 0, 0);
    expect(payload.kind).toBe(PayloadKind.Native);
    expect(payload.domain).toBe("host");
    payload.release();
  });

  test("release is idempotent", () => {
    const payload = createNativePayload(0, 0, 0);
    payload.release();
    payload.release();
    expect(takeNativeBuffer(payload)).toBeUndefined();
  });

  test("taking the buffer hands over ownership once", () => {
    const payload = createNativePayload(0, 16, 32);
    expect(takeNativeBuffer(payload)).toEqual({ ptr: 0, capacity: 32 });
    expect(takeNativeBuffer(payload)).toBeUndefined();
    payload.release();
  });

  test("a payload not created here has no buffer to take", () => {
    expect(
      takeNativeBuffer({
        kind: PayloadKind.Native,
        domain: "host",
        ptr: 1,
        length: 1,
        release() {},
      }),
    ).toBeUndefined();
  });
});
