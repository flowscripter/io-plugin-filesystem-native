import { z } from "zod";

/**
 * A `file` location: a `path`, plus either a `filename` (a single entry) or a
 * glob `pattern` (matching entries in the `path` container). With neither,
 * the location addresses the whole `path` container. Identical to the
 * `io-plugin-filesystem` location, as required of every factory sharing the
 * `file` protocol.
 */
export const nativeFilesystemLocationSchema = z
  .object({
    path: z.string().default("/"),
    filename: z.string().optional(),
    pattern: z.string().optional(),
  })
  .refine((location) => location.filename === undefined || location.pattern === undefined, {
    message: "filename and pattern are mutually exclusive",
  });

export type NativeFilesystemLocation = z.infer<typeof nativeFilesystemLocationSchema>;
