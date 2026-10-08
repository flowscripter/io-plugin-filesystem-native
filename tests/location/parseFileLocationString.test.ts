import { describe, expect, test } from "bun:test";
import { parseFileLocationString } from "../../src/location/parseFileLocationString.ts";

const windows = process.platform === "win32";
const urlPath = windows ? "/C:/foo" : "/foo";
const expectedPath = windows ? "C:\\foo" : "/foo";

describe("parseFileLocationString", () => {
  test("file:/// and file:/ both give the path", () => {
    expect(parseFileLocationString(`file://${urlPath}`)).toEqual({ path: expectedPath });
    expect(parseFileLocationString(`file:${urlPath}`)).toEqual({ path: expectedPath });
  });

  test("a bare path passes through", () => {
    expect(parseFileLocationString("/foo/bar")).toEqual({ path: "/foo/bar" });
    expect(parseFileLocationString("relative/path")).toEqual({ path: "relative/path" });
  });

  test("a file URL with a host is rejected except as a Windows UNC path", () => {
    if (windows) {
      expect(parseFileLocationString("file://host/foo")).toEqual({ path: "\\\\host\\foo" });
    } else {
      expect(() => parseFileLocationString("file://host/foo")).toThrow();
    }
  });
});
