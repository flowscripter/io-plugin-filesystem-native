import { describe, expect, test } from "bun:test";
import { parseFileLocationString } from "../../src/location/parseFileLocationString.ts";

describe("parseFileLocationString", () => {
  test("file:/// and file:/ both give the path", () => {
    expect(parseFileLocationString("file:///foo")).toEqual({ path: "/foo" });
    expect(parseFileLocationString("file:/foo")).toEqual({ path: "/foo" });
  });

  test("a bare path passes through", () => {
    expect(parseFileLocationString("/foo/bar")).toEqual({ path: "/foo/bar" });
    expect(parseFileLocationString("relative/path")).toEqual({ path: "relative/path" });
  });

  test("a file URL with a host is rejected", () => {
    expect(() => parseFileLocationString("file://host/foo")).toThrow();
  });
});
