import { describe, expect, test } from "bun:test";
import { nativeFilesystemPropertySchema } from "../../src/schema/nativeFilesystemPropertySchema.ts";

describe("nativeFilesystemPropertySchema", () => {
  test("accepts an optional numeric mode", () => {
    expect(nativeFilesystemPropertySchema.parse({ mode: 0o644 })).toEqual({ mode: 0o644 });
    expect(nativeFilesystemPropertySchema.parse({})).toEqual({});
    expect(nativeFilesystemPropertySchema.safeParse({ mode: "rw" }).success).toBe(false);
  });
});
