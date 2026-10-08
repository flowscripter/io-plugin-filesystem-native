import { join, resolve } from "node:path";
import {
  type EntryProperties,
  type IOProvider,
  PayloadKind,
  type ResumeToken,
} from "@flowscripter/pluggable-io-framework-api";
import type { NativeFilesystemConfig } from "./schema/nativeFilesystemConfigSchema.ts";
import { createNativeReadableHandle } from "./stream/createNativeReadableHandle.ts";
import { createNativeWritableHandle } from "./stream/createNativeWritableHandle.ts";
import { statToProperties } from "./util/statToProperties.ts";
import { getNativeWaker } from "./waker/getNativeWaker.ts";

/**
 * Local filesystem provider whose reads and writes run on native threads and
 * carry `native` `host` payloads. Only whole-entry reads and writes are
 * supported: there is no listing, so container and pattern targets are not
 * available.
 */
export class NativeFilesystemIOProvider implements IOProvider<PayloadKind.Native> {
  public readonly kind = PayloadKind.Native;

  public constructor(private readonly config: NativeFilesystemConfig) {}

  public async [Symbol.asyncDispose](): Promise<void> {}

  public joinKey(containerKey: string, name: string): string {
    return join(containerKey, name);
  }

  public async getProperties(path: string): Promise<EntryProperties> {
    return statToProperties(resolve(path));
  }

  public async getReadableStream(path: string) {
    return createNativeReadableHandle(
      resolve(path),
      this.config,
      getNativeWaker(this.config.waker),
    );
  }

  public async getWritableStream(path: string, opts?: { resume?: ResumeToken }) {
    return createNativeWritableHandle(
      resolve(path),
      this.config,
      getNativeWaker(this.config.waker),
      opts?.resume,
    );
  }
}
