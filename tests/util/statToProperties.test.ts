import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statToProperties } from "../../src/util/statToProperties.ts";

describe("statToProperties", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "native-stat-"));
    await writeFile(join(dir, "a.txt"), "hello");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("reports size, mtime and mode for a file", async () => {
    const properties = await statToProperties(join(dir, "a.txt"));
    expect(properties.isContainer).toBe(false);
    expect(properties.size).toBe(5);
    expect(properties.lastModified).toBeInstanceOf(Date);
    expect(typeof properties.properties?.mode).toBe("number");
  });

  test("reports a directory as a container without a size", async () => {
    const properties = await statToProperties(dir);
    expect(properties.isContainer).toBe(true);
    expect(properties.size).toBeUndefined();
  });

  test("rejects a missing path", async () => {
    await expect(statToProperties(join(dir, "missing"))).rejects.toThrow();
  });
});
