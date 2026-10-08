import { describe, expect, test } from "bun:test";
import { suffix } from "bun:ffi";
import { join } from "node:path";
import {
  buildLocalLibName,
  buildRemoteLibName,
  buildRemoteUrl,
  getLibPath,
} from "../src/lib-path.ts";

describe("buildLocalLibName", () => {
  test("Linux .so gets lib prefix", () => {
    expect(buildLocalLibName("foo", "so")).toBe("libfoo.so");
  });

  test("macOS .dylib gets lib prefix", () => {
    expect(buildLocalLibName("foo", "dylib")).toBe("libfoo.dylib");
  });

  test("Windows .dll has no lib prefix", () => {
    expect(buildLocalLibName("foo", "dll")).toBe("foo.dll");
  });
});

describe("buildRemoteLibName", () => {
  test("Linux x64", () => {
    expect(buildRemoteLibName("foo", "so", "x64")).toBe("x64.so");
  });

  test("Linux arm64", () => {
    expect(buildRemoteLibName("foo", "so", "arm64")).toBe("arm64.so");
  });

  test("macOS uses local naming (no arch suffix)", () => {
    expect(buildRemoteLibName("foo", "dylib", "arm64")).toBe("libfoo.dylib");
    expect(buildRemoteLibName("foo", "dylib", "x64")).toBe("libfoo.dylib");
  });

  test("Windows x64", () => {
    expect(buildRemoteLibName("foo", "dll", "x64")).toBe("foo.x64.dll");
  });

  test("Windows arm64", () => {
    expect(buildRemoteLibName("foo", "dll", "arm64")).toBe("foo.arm64.dll");
  });
});

describe("buildRemoteUrl", () => {
  test("base without trailing slash", () => {
    expect(buildRemoteUrl("https://example.com/releases/v1.0", "x64.so")).toBe(
      "https://example.com/releases/v1.0/x64.so",
    );
  });

  test("base with trailing slash", () => {
    expect(buildRemoteUrl("https://example.com/releases/v1.0/", "x64.so")).toBe(
      "https://example.com/releases/v1.0/x64.so",
    );
  });

  test("does not corrupt https:// into https:/", () => {
    const url = buildRemoteUrl("https://github.com/org/repo/releases/download/v1.0", "x64.so");
    expect(url).toBe("https://github.com/org/repo/releases/download/v1.0/x64.so");
    expect(url.startsWith("https://")).toBe(true);
  });
});

describe("getLibPath", () => {
  test("prefers the local release build", async () => {
    const libPath = await getLibPath("flowscripter_io_plugin_filesystem_native");
    expect(libPath).toBe(
      join(
        import.meta.dir,
        "..",
        "target",
        "release",
        buildLocalLibName("flowscripter_io_plugin_filesystem_native", suffix),
      ),
    );
  });
});
