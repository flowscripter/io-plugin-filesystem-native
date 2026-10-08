import { z } from "zod";

/**
 * Provider config. `chunkSize` is the size in bytes of each buffer the native
 * reader produces and each lease buffer the native writer hands out, `depth`
 * the number of buffers in flight per handle, and `waker` how the native I/O
 * threads notify the JS thread.
 */
export const nativeFilesystemConfigSchema = z.object({
  chunkSize: z
    .number()
    .int()
    .positive()
    .default(1024 * 1024),
  depth: z.number().int().positive().default(4),
  waker: z.enum(["callback", "worker"]).default("callback"),
});

export type NativeFilesystemConfig = z.infer<typeof nativeFilesystemConfigSchema>;
