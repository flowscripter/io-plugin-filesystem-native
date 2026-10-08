import { describe, expect, test } from "bun:test";
import { nativeFilesystemConfigSchema } from "../../src/schema/nativeFilesystemConfigSchema.ts";

describe("nativeFilesystemConfigSchema", () => {
  test("applies the defaults", () => {
    expect(nativeFilesystemConfigSchema.parse({})).toEqual({
      chunkSize: 1024 * 1024,
      depth: 4,
      waker: "callback",
    });
  });

  test("accepts overrides", () => {
    expect(
      nativeFilesystemConfigSchema.parse({ chunkSize: 4096, depth: 2, waker: "worker" }),
    ).toEqual({ chunkSize: 4096, depth: 2, waker: "worker" });
  });

  test("rejects a non-positive chunk size and an unknown waker", () => {
    expect(nativeFilesystemConfigSchema.safeParse({ chunkSize: 0 }).success).toBe(false);
    expect(nativeFilesystemConfigSchema.safeParse({ waker: "pipe" }).success).toBe(false);
  });
});
