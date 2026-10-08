import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DefaultPluginManager,
  LocalFolderPluginRepository,
  NpmPluginRepository,
} from "@flowscripter/dynamic-plugin-framework";
import { copy, ProviderRegistry } from "@flowscripter/pluggable-io-framework";
import {
  PLUGGABLE_IO_FRAMEWORK_PAYLOAD_CONVERTER_EXTENSION_POINT,
  PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT,
  PayloadKind,
} from "@flowscripter/pluggable-io-framework-api";
import packageJson from "../package.json";
import nativeFilesystemPlugin from "../src/NativeFilesystemPlugin.ts";
import { nativeFilesystemIOProviderFactory } from "../src/NativeFilesystemIOProviderFactory.ts";
import { nativePayloadConverters } from "../src/nativePayloadConverter.ts";
import { memoryStore } from "./fixtures/jsOnlyPlugin.ts";
import { sampleBytes } from "./fixtures/files.ts";

const packageRoot = resolve(import.meta.dir, "..");
const PACKAGE_JSON_NAMESPACE = "pluggable-io-framework";

describe("nativeFilesystemPlugin", () => {
  test("registers the factory and both converters on their extension points", async () => {
    const descriptors = nativeFilesystemPlugin.extensionDescriptors;
    expect(descriptors.map((descriptor) => descriptor.extensionPoint)).toEqual([
      PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT,
      PLUGGABLE_IO_FRAMEWORK_PAYLOAD_CONVERTER_EXTENSION_POINT,
      PLUGGABLE_IO_FRAMEWORK_PAYLOAD_CONVERTER_EXTENSION_POINT,
    ]);
    expect(await descriptors[0]?.factory.create()).toBe(nativeFilesystemIOProviderFactory);
    expect(await descriptors[1]?.factory.create()).toBe(nativePayloadConverters[0]);
    expect(await descriptors[2]?.factory.create()).toBe(nativePayloadConverters[1]);
  });
});

describe("dynamic loading and registry negotiation", () => {
  const nativeBundle = join(packageRoot, "dist", "bundle.js");
  const jsFilesystemBundle = join(
    packageRoot,
    "node_modules",
    "@flowscripter",
    "io-plugin-filesystem",
    "dist",
    "bundle.js",
  );
  const memoryPlugin = join(packageRoot, "tests", "fixtures", "jsOnlyPlugin.ts");
  const data = sampleBytes(500_000);
  const memory = { protocol: "mem", location: { path: "target" } };
  const file = (path: string, filename: string) => ({
    protocol: "file",
    location: { path, filename },
  });
  let dataDir: string;
  let pluginFolder: string;

  async function createRegistry(plugins: string[]): Promise<ProviderRegistry> {
    const repository = new LocalFolderPluginRepository(pluginFolder, "manifest.json");
    const all: Record<string, { bundlePath: string; extensionPoints: string[] }> = {
      native: {
        bundlePath: nativeBundle,
        extensionPoints: [
          PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT,
          PLUGGABLE_IO_FRAMEWORK_PAYLOAD_CONVERTER_EXTENSION_POINT,
        ],
      },
      js: {
        bundlePath: jsFilesystemBundle,
        extensionPoints: [PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT],
      },
      mem: {
        bundlePath: memoryPlugin,
        extensionPoints: [PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT],
      },
    };
    await repository.writeManifest(
      plugins.map((id) => ({
        pluginId: id,
        ...all[id]!,
        name: id,
        version: "0.1.0",
      })),
    );
    const registry = new ProviderRegistry(new DefaultPluginManager([repository]));
    await registry.discover();
    return registry;
  }

  beforeAll(async () => {
    const build = Bun.spawnSync(
      [
        "bun",
        "build",
        "index.ts",
        "--outdir",
        "./dist",
        "--entry-naming",
        "bundle.js",
        "--target",
        "bun",
        "--minify",
        "--external",
        "@flowscripter/dynamic-plugin-framework",
      ],
      { cwd: packageRoot },
    );
    if (build.exitCode !== 0) {
      throw new Error(`Plugin bundle build failed: ${build.stderr.toString()}`);
    }
    dataDir = await mkdtemp(join(tmpdir(), "native-fs-plugin-data-"));
    pluginFolder = await mkdtemp(join(tmpdir(), "native-fs-plugin-repo-"));
    await writeFile(join(dataDir, "source.bin"), data);
  });

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(pluginFolder, { recursive: true, force: true });
  });

  test("the loaded bundle registers the native factory and converters", async () => {
    const registry = await createRegistry(["native"]);
    expect(registry.getKinds("file")).toEqual([PayloadKind.Native]);
    expect(registry.getConverters().length).toBe(2);
  });

  test("with both file factories installed, auto picks js and native picks this plugin", async () => {
    const registry = await createRegistry(["js", "native"]);
    expect(registry.getKinds("file").sort()).toEqual([PayloadKind.Js, PayloadKind.Native]);

    const auto = await registry.createProvidersForTransfer(
      file(dataDir, "source.bin"),
      file(dataDir, "auto.bin"),
    );
    expect(auto.source.provider.kind).toBe(PayloadKind.Js);
    await auto.source.provider[Symbol.asyncDispose]();
    await auto.dest.provider[Symbol.asyncDispose]();

    const native = await registry.createProvidersForTransfer(
      file(dataDir, "source.bin"),
      file(dataDir, "native.bin"),
      { kind: PayloadKind.Native },
    );
    expect(native.source.provider.kind).toBe(PayloadKind.Native);
    expect(native.dest.provider.kind).toBe(PayloadKind.Native);
    const result = await copy(
      native.source.provider,
      native.source.target,
      native.dest.provider,
      native.dest.target,
      { ...native.options, directTransfer: false },
    );
    expect(result.bytes).toBe(data.length);
    expect(new Uint8Array(await readFile(join(dataDir, "native.bin")))).toEqual(data);
  });

  test("an explicit native kind with a protocol that has no native factory fails", async () => {
    const registry = await createRegistry(["native", "mem"]);
    await expect(
      registry.createProvidersForTransfer(file(dataDir, "source.bin"), memory, {
        kind: PayloadKind.Native,
      }),
    ).rejects.toThrow();
  });

  test("with only this plugin native, the registered converter bridges to a js protocol", async () => {
    const registry = await createRegistry(["native", "mem"]);
    const transfer = await registry.createProvidersForTransfer(file(dataDir, "source.bin"), memory);
    expect(transfer.source.provider.kind).toBe(PayloadKind.Native);
    expect(transfer.dest.provider.kind).toBe(PayloadKind.Js);
    expect(transfer.options.converter).toBeDefined();
    const result = await copy(
      transfer.source.provider,
      transfer.source.target,
      transfer.dest.provider,
      transfer.dest.target,
      { ...transfer.options, directTransfer: false },
    );
    expect(result.bytes).toBe(data.length);
    expect(memoryStore.get("target")).toEqual(data);
  });
});

describe("NpmPluginRepository discovery", () => {
  let nodeModulesPath: string;

  beforeAll(async () => {
    nodeModulesPath = await mkdtemp(join(tmpdir(), "io-plugin-filesystem-native-npm-repo-"));
    await mkdir(join(nodeModulesPath, "@flowscripter"), { recursive: true });
    await symlink(
      packageRoot,
      join(nodeModulesPath, "@flowscripter", "io-plugin-filesystem-native"),
      "junction",
    );
  });

  afterAll(async () => {
    await rm(nodeModulesPath, { recursive: true, force: true });
  });

  test("finds the factory and converters via the packageJsonNamespace field", async () => {
    const repository = new NpmPluginRepository({
      nodeModulesPath,
      packageJsonNamespace: PACKAGE_JSON_NAMESPACE,
    });
    const registry = new ProviderRegistry(new DefaultPluginManager([repository]));
    await registry.discover();
    expect(registry.getKinds("file")).toEqual([PayloadKind.Native]);
    expect(registry.getConverters().length).toBe(2);
  });
});

describe("package.json plugin discovery metadata", () => {
  test("keywords includes the packageJsonNamespace", () => {
    expect(packageJson.keywords).toContain(PACKAGE_JSON_NAMESPACE);
  });

  test("declares both extension points under the packageJsonNamespace field", () => {
    const namespaceData = (
      packageJson as unknown as Record<string, { extensionPoints?: string[] }>
    )[PACKAGE_JSON_NAMESPACE];
    expect(namespaceData?.extensionPoints).toEqual([
      PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT,
      PLUGGABLE_IO_FRAMEWORK_PAYLOAD_CONVERTER_EXTENSION_POINT,
    ]);
  });
});
