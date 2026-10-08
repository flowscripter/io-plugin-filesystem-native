import { fileURLToPath } from "node:url";

/**
 * Converts a `file:` URL (`file:///foo` or `file:/foo`) or a bare path into
 * a raw `file` location object. A `file:` URL with a non-empty host is
 * rejected.
 */
export function parseFileLocationString(location: string): { path: string } {
  if (/^file:/i.test(location)) {
    return { path: fileURLToPath(new URL(location)) };
  }
  return { path: location };
}
