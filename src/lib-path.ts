import os from "node:os";
import { suffix } from "bun:ffi";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import packageJson from "../package.json";

export function buildLocalLibName(libName: string, libSuffix: string): string {
  const base = `${libName}.${libSuffix}`;
  return libSuffix === "dll" ? base : `lib${base}`;
}

export function buildRemoteLibName(libName: string, libSuffix: string, arch: string): string {
  if (libSuffix === "so") return `${arch}.${libSuffix}`;
  if (libSuffix === "dll") return `${libName}.${arch}.${libSuffix}`;
  return buildLocalLibName(libName, libSuffix);
}

export function buildRemoteUrl(baseUri: string, remoteLibName: string): string {
  const base = baseUri.endsWith("/") ? baseUri : baseUri + "/";
  return new URL(remoteLibName, base).href;
}

/**
 * Locates the native library: a local release build first, then the
 * installed copy in `~/.flowscripter/lib`, downloading it from the release
 * assets when neither exists.
 */
export async function getLibPath(libName: string): Promise<string> {
  const fullLibName = buildLocalLibName(libName, suffix);

  const builtLibPath = path.join(import.meta.dir, "..", "target", "release", fullLibName);
  if (await Bun.file(builtLibPath).exists()) {
    return builtLibPath;
  }

  const installedLibFolder = path.join(os.homedir(), ".flowscripter", "lib");
  const installedLibPath = path.join(installedLibFolder, fullLibName);
  if (await Bun.file(installedLibPath).exists()) {
    return installedLibPath;
  }

  const remoteLibName = buildRemoteLibName(libName, suffix, process.arch);
  const remotePath = buildRemoteUrl(packageJson.ffiLibBaseUri, remoteLibName);

  await mkdir(installedLibFolder, { recursive: true });

  try {
    const result = await fetch(remotePath);
    await Bun.write(installedLibPath, result);
  } catch (e) {
    console.error(`Failed to download ${remotePath} to ${installedLibPath}: ${e}`);
  }

  return installedLibPath;
}
