import { stat } from "node:fs/promises";
import type { EntryProperties } from "@flowscripter/pluggable-io-framework-api";

export async function statToProperties(fullPath: string): Promise<EntryProperties> {
  const stats = await stat(fullPath);
  const isContainer = stats.isDirectory();
  return {
    size: isContainer ? undefined : stats.size,
    lastModified: stats.mtime,
    isContainer,
    properties: { mode: stats.mode },
  };
}
