import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function sampleBytes(length: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    data[i] = (i * 31 + (i >> 8)) & 0xff;
  }
  return data;
}

export async function createTempDir(): Promise<{ dir: string; cleanup(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "native-fs-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export async function readAll<T>(stream: ReadableStream<T>): Promise<T[]> {
  const items: T[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return items;
    }
    items.push(value);
  }
}
