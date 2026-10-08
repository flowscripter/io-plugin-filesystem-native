import { describe, expect, test } from "bun:test";
import { nativeFilesystemSettablePropertySchema } from "../../src/schema/nativeFilesystemSettablePropertySchema.ts";

describe("nativeFilesystemSettablePropertySchema", () => {
  test("has no settable properties", () => {
    expect(Object.keys(nativeFilesystemSettablePropertySchema.shape)).toEqual([]);
    expect(nativeFilesystemSettablePropertySchema.parse({})).toEqual({});
  });
});
