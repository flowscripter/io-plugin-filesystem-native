import { join } from "node:path";
import type { LocationTarget } from "@flowscripter/pluggable-io-framework-api";
import {
  type NativeFilesystemConfig,
  nativeFilesystemConfigSchema,
} from "../schema/nativeFilesystemConfigSchema.ts";
import type { NativeFilesystemLocation } from "../schema/nativeFilesystemLocationSchema.ts";

/**
 * Splits a validated `file` location into a `LocationTarget`, joining `path`
 * and `filename` with the OS path separator. The config is the default
 * provider config.
 */
export function toFileProviderInputs(location: NativeFilesystemLocation): {
  config: NativeFilesystemConfig;
  target: LocationTarget;
} {
  const config = nativeFilesystemConfigSchema.parse({});
  if (location.filename !== undefined) {
    return { config, target: { kind: "entry", key: join(location.path, location.filename) } };
  }
  if (location.pattern !== undefined) {
    return {
      config,
      target: { kind: "pattern", containerKey: location.path, pattern: location.pattern },
    };
  }
  return { config, target: { kind: "container", key: location.path } };
}
