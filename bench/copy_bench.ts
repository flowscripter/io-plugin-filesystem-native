import { existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { filesystemIOProviderFactory } from "@flowscripter/io-plugin-filesystem";
import { copy } from "@flowscripter/pluggable-io-framework";
import type { IOProvider, PayloadConverter } from "@flowscripter/pluggable-io-framework-api";
import { nativeFilesystemIOProviderFactory } from "../src/NativeFilesystemIOProviderFactory.ts";
import {
  jsToNativePayloadConverter,
  nativeToJsPayloadConverter,
} from "../src/nativePayloadConverter.ts";
import { getNativeWaker, type WakerKind } from "../src/waker/getNativeWaker.ts";

const MIB = 1024 * 1024;
const RUNS = 5;
const SIZES_MIB = (process.env.BENCH_SIZES_MIB ?? "64,1024").split(",").map(Number);
const CHUNK_SIZES = [64 * 1024, MIB];
const context = {
  resolver: { createProviderForLocation: () => Promise.reject(new Error("unused")) },
};

interface BenchCase {
  readonly name: string;
  readonly description: string;
  readonly source: "js" | "native";
  readonly dest: "js" | "native";
  readonly waker?: WakerKind;
  readonly converter?: PayloadConverter;
  readonly lease?: boolean;
  readonly direct?: boolean;
  readonly chunked: boolean;
}

const CASES: BenchCase[] = [
  { name: "A", description: "file/js -> file/js", source: "js", dest: "js", chunked: false },
  {
    name: "B",
    description: "file/native -> file/native",
    source: "native",
    dest: "native",
    waker: "callback",
    chunked: true,
  },
  {
    name: "B",
    description: "file/native -> file/native",
    source: "native",
    dest: "native",
    waker: "worker",
    chunked: true,
  },
  {
    name: "C",
    description: "file/native -> file/js (converter)",
    source: "native",
    dest: "js",
    waker: "callback",
    converter: nativeToJsPayloadConverter,
    chunked: true,
  },
  {
    name: "D",
    description: "file/js -> file/native (converter)",
    source: "js",
    dest: "native",
    waker: "callback",
    converter: jsToNativePayloadConverter,
    chunked: true,
  },
  {
    name: "F",
    description: "file/native -> file/native (lease)",
    source: "native",
    dest: "native",
    waker: "callback",
    lease: true,
    chunked: true,
  },
  {
    name: "F",
    description: "file/native -> file/native (lease)",
    source: "native",
    dest: "native",
    waker: "worker",
    lease: true,
    chunked: true,
  },
  {
    name: "E",
    description: "file/js -> file/js (directTransfer, ceiling)",
    source: "js",
    dest: "js",
    direct: true,
    chunked: false,
  },
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
}

async function generate(path: string, sizeMib: number): Promise<void> {
  const writer = Bun.file(path).writer();
  const block = new Uint8Array(MIB);
  for (let i = 0; i < sizeMib; i += 1) {
    for (let offset = 0; offset < MIB; offset += 65536) {
      crypto.getRandomValues(block.subarray(offset, offset + 65536));
    }
    writer.write(block);
  }
  await writer.end();
}

async function warm(path: string): Promise<void> {
  for await (const _ of Bun.file(path).stream()) {
    // Reading once brings the file into the page cache.
  }
}

async function provider(
  kind: "js" | "native",
  chunkSize: number,
  waker: WakerKind,
): Promise<IOProvider> {
  if (kind === "js") {
    return filesystemIOProviderFactory.createProvider(
      filesystemIOProviderFactory.configSchema.parse({}),
      context,
    );
  }
  return nativeFilesystemIOProviderFactory.createProvider(
    nativeFilesystemIOProviderFactory.configSchema.parse({ chunkSize, waker }),
    context,
  );
}

/** A provider whose handles expose only the plain stream, so transfers cannot take the lease path. */
function streamOnly(inner: IOProvider): IOProvider {
  return {
    kind: inner.kind,
    [Symbol.asyncDispose]: () => inner[Symbol.asyncDispose](),
    getProperties: (path) => inner.getProperties(path),
    getReadableStream: async (path) => {
      const handle = await inner.getReadableStream(path);
      return { kind: handle.kind, stream: handle.stream };
    },
    getWritableStream: async (path, opts) => {
      const handle = await inner.getWritableStream(path, opts);
      return { kind: handle.kind, stream: handle.stream };
    },
  };
}

async function main(): Promise<void> {
  const base = existsSync("/dev/shm") ? "/dev/shm" : (process.env.TMPDIR ?? "/tmp");
  const dir = join(base, `native-fs-bench-${process.pid}`);
  await mkdir(dir, { recursive: true });
  console.log(`directory: ${dir}`);
  console.log(
    "case | description | waker | size MiB | chunk | MiB/s | items | avg payload | wakes/item | peak arrayBuffers MiB",
  );
  try {
    for (const sizeMib of SIZES_MIB) {
      const source = join(dir, `source-${sizeMib}.bin`);
      await generate(source, sizeMib);
      await warm(source);
      const expected = await sha256(source);
      const dest = join(dir, `dest-${sizeMib}.bin`);
      for (const benchCase of CASES) {
        const chunkSizes = benchCase.chunked ? CHUNK_SIZES : [0];
        for (const chunkSize of chunkSizes) {
          const waker = benchCase.waker ?? "callback";
          let sourceProvider = await provider(benchCase.source, chunkSize, waker);
          let destProvider = await provider(benchCase.dest, chunkSize, waker);
          if (benchCase.source === "native" && benchCase.dest === "native" && !benchCase.lease) {
            sourceProvider = streamOnly(sourceProvider);
            destProvider = streamOnly(destProvider);
          }
          const throughputs: number[] = [];
          let items = 0;
          let averagePayload = 0;
          let wakes = 0;
          let peak = 0;
          for (let run = 0; run < RUNS; run += 1) {
            Bun.gc(true);
            const nativeWaker = getNativeWaker(waker);
            const originalReady = nativeWaker.ready.bind(nativeWaker);
            let runWakes = 0;
            nativeWaker.ready = (handle) => {
              runWakes += 1;
              return originalReady(handle);
            };
            const sampler = setInterval(() => {
              peak = Math.max(peak, process.memoryUsage().arrayBuffers);
            }, 10);
            const started = Bun.nanoseconds();
            const result = await copy(
              sourceProvider,
              { kind: "entry", key: source },
              destProvider,
              { kind: "entry", key: dest },
              {
                directTransfer: benchCase.direct === true,
                multipartThreshold: Infinity,
                converter: benchCase.converter,
              },
            );
            const seconds = (Bun.nanoseconds() - started) / 1e9;
            clearInterval(sampler);
            nativeWaker.ready = originalReady;
            throughputs.push(sizeMib / seconds);
            items = result.items;
            averagePayload = result.items > 0 ? result.bytes / result.items : 0;
            wakes = runWakes;
            if ((await stat(dest)).size !== sizeMib * MIB || (await sha256(dest)) !== expected) {
              throw new Error(
                `Destination mismatch for case ${benchCase.name} (${benchCase.description})`,
              );
            }
            await rm(dest);
          }
          await sourceProvider[Symbol.asyncDispose]();
          await destProvider[Symbol.asyncDispose]();
          const perItem = items > 0 ? (wakes / items).toFixed(3) : "n/a";
          console.log(
            [
              benchCase.name,
              benchCase.description,
              benchCase.waker ?? "-",
              sizeMib,
              benchCase.chunked ? `${chunkSize / 1024} KiB` : "n/a",
              median(throughputs).toFixed(0),
              items,
              `${Math.round(averagePayload)} B`,
              perItem,
              (peak / MIB).toFixed(1),
            ].join(" | "),
          );
        }
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await main();
process.exit(0);
