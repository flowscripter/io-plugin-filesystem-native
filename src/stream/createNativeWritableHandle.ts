import { ptr } from "bun:ffi";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type BufferLease,
  type BufferProvider,
  type Item,
  PayloadKind,
  type ResumableWritable,
  type ResumeToken,
  type StreamHandle,
} from "@flowscripter/pluggable-io-framework-api";
import { encodePath, ERROR, lastError, native, OK, WOULD_BLOCK } from "../lib.ts";
import type { NativeFilesystemConfig } from "../schema/nativeFilesystemConfigSchema.ts";
import type { NativeWaker } from "../waker/NativeWaker.ts";

const slots = new BigUint64Array(2);
const slotsPtr = ptr(slots);

async function committedSize(fullPath: string): Promise<number> {
  try {
    return (await stat(fullPath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

/**
 * Opens a writable handle for a file backed by a native writer thread. The
 * stream accepts native `host` payloads, copying each into the writer's queue
 * and then releasing it. The handle is also a `BufferProvider`, handing out
 * the writer's own buffers for zero-copy writes, and `ResumableWritable`:
 * with `resume` the file is reopened for append and `startOffset` is its
 * current size.
 */
export async function createNativeWritableHandle(
  fullPath: string,
  config: NativeFilesystemConfig,
  waker: NativeWaker,
  resume?: ResumeToken,
): Promise<
  StreamHandle<PayloadKind.Native> &
    BufferProvider &
    ResumableWritable & { readonly startOffset: number }
> {
  await mkdir(dirname(fullPath), { recursive: true });
  const startOffset = resume ? await committedSize(fullPath) : 0;
  const path = encodePath(fullPath);
  const id = native.writer_open(
    path.ptr as never,
    BigInt(path.length),
    BigInt(config.depth),
    BigInt(config.chunkSize),
    resume ? 1 : 0,
  );
  if (id === 0) {
    throw new Error(lastError());
  }
  waker.open();

  let committed = 0;
  let finished = false;
  const snapshot = () => {
    if (!finished) {
      committed = Number(native.writer_committed(id));
    }
    return committed;
  };
  const finish = (abort: boolean) => {
    if (finished) {
      return;
    }
    if (abort) {
      native.writer_abort(id);
    }
    snapshot();
    finished = true;
    native.writer_free(id);
    waker.close();
  };

  const stream = new WritableStream<Item<PayloadKind.Native>>({
    async write(item) {
      try {
        for (;;) {
          const result = native.writer_write(
            id,
            item.payload.ptr as never,
            BigInt(item.payload.length),
          );
          if (result === OK) {
            return;
          }
          if (result === ERROR) {
            throw new Error(lastError());
          }
          await waker.ready(id);
        }
      } catch (error) {
        finish(true);
        throw error;
      } finally {
        item.payload.release();
      }
    },
    async close() {
      try {
        for (;;) {
          const result = native.writer_close(id);
          if (result === OK) {
            finish(false);
            return;
          }
          if (result === ERROR) {
            throw new Error(lastError());
          }
          await waker.ready(id);
        }
      } catch (error) {
        finish(true);
        throw error;
      }
    },
    abort() {
      finish(true);
    },
  });

  return {
    kind: PayloadKind.Native,
    stream,
    startOffset,
    domain: "host",
    maxOutstanding: config.depth,
    resumeToken: () => ({ offset: startOffset + snapshot() }),
    async acquire(): Promise<BufferLease> {
      for (;;) {
        const result = native.writer_try_acquire(id, slotsPtr as never, (slotsPtr + 8) as never);
        if (result === OK) {
          break;
        }
        if (result === ERROR) {
          throw new Error(lastError());
        }
        if (result === WOULD_BLOCK) {
          await waker.ready(id);
        }
      }
      const leasePtr = Number(slots[0]);
      let settled = false;
      return {
        ptr: leasePtr,
        length: Number(slots[1]),
        domain: "host",
        async commit(length: number) {
          if (settled) {
            return;
          }
          settled = true;
          if (native.writer_commit(id, leasePtr as never, BigInt(length)) !== OK) {
            throw new Error(lastError());
          }
        },
        release() {
          if (!settled) {
            settled = true;
            native.writer_release(id, leasePtr as never);
          }
        },
      };
    },
  };
}
