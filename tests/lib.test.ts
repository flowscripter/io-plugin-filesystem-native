import { describe, expect, test } from "bun:test";
import {
  encodePath,
  EOF,
  ERROR,
  lastError,
  libPath,
  native,
  OK,
  READ_TO_END,
  WOULD_BLOCK,
} from "../src/lib.ts";

describe("lib", () => {
  test("exposes the result codes", () => {
    expect([EOF, OK, WOULD_BLOCK, ERROR]).toEqual([0, 1, 2, -1]);
    expect(READ_TO_END).toBe(2n ** 64n - 1n);
  });

  test("loads the native library", () => {
    expect(libPath).toContain("flowscripter_io_plugin_filesystem_native");
    expect(typeof native.reader_open).toBe("function");
  });

  test("encodePath encodes UTF-8 and reports the byte length", () => {
    const encoded = encodePath("/tmp/é");
    expect(encoded.length).toBe(Buffer.byteLength("/tmp/é"));
    expect(new TextDecoder().decode(encoded.bytes)).toBe("/tmp/é");
  });

  test("encodePath accepts an empty path", () => {
    expect(encodePath("").length).toBe(0);
  });

  test("lastError describes a failed open", () => {
    const path = encodePath("/nonexistent/native-test");
    expect(
      native.reader_open(path.ptr as never, BigInt(path.length), 0n, READ_TO_END, 16n, 2n, 0),
    ).toBe(0);
    expect(lastError()).toContain("/nonexistent/native-test");
  });
});
