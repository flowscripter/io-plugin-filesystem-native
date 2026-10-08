import { describe, expect, test } from "bun:test";
import { PayloadKind } from "@flowscripter/pluggable-io-framework-api";
import { nativeFilesystemIOProviderFactory as factory } from "../src/NativeFilesystemIOProviderFactory.ts";
import { NativeFilesystemIOProvider } from "../src/NativeFilesystemIOProvider.ts";

describe("nativeFilesystemIOProviderFactory", () => {
  test("serves the file protocol with native host payloads", () => {
    expect(factory.protocol).toBe("file");
    expect(factory.kind).toBe(PayloadKind.Native);
    expect(factory.domains).toEqual(["host"]);
  });

  test("parses locations like the filesystem plugin", () => {
    const location = factory.locationSchema.parse(
      factory.parseLocationString("file:///data/a.txt"),
    );
    expect(factory.toProviderInputs(location).target).toEqual({
      kind: "container",
      key: "/data/a.txt",
    });
  });

  test("creates a native provider from the parsed config", async () => {
    const provider = await factory.createProvider(factory.configSchema.parse({ chunkSize: 2048 }), {
      resolver: { createProviderForLocation: () => Promise.reject(new Error("unused")) },
    });
    expect(provider).toBeInstanceOf(NativeFilesystemIOProvider);
    expect(provider.kind).toBe(PayloadKind.Native);
  });
});
