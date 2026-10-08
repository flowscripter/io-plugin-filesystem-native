import { describe, expect, test } from "bun:test";
import { nativeFilesystemLocationSchema } from "../../src/schema/nativeFilesystemLocationSchema.ts";

describe("nativeFilesystemLocationSchema", () => {
  test("defaults path to /", () => {
    expect(nativeFilesystemLocationSchema.parse({})).toEqual({ path: "/" });
  });

  test("rejects filename together with pattern", () => {
    expect(
      nativeFilesystemLocationSchema.safeParse({ path: "/", filename: "a", pattern: "*" }).success,
    ).toBe(false);
  });

  test("exposes path, filename and pattern as top-level fields", () => {
    expect(Object.keys(nativeFilesystemLocationSchema.shape).sort()).toEqual([
      "filename",
      "path",
      "pattern",
    ]);
  });
});
