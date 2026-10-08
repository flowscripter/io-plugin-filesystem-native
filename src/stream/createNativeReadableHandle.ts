import { ptr } from "bun:ffi";
import {
  type BufferLease,
  type FillReadable,
  type Item,
  PayloadKind,
  type RangeReadable,
  type StreamHandle,
} from "@flowscripter/pluggable-io-framework-api";
import { encodePath, EOF, ERROR, lastError, native, OK, READ_TO_END, WOULD_BLOCK } from "../lib.ts";
import type { NativeFilesystemConfig } from "../schema/nativeFilesystemConfigSchema.ts";
import type { NativeWaker } from "../waker/NativeWaker.ts";
import { createNativePayload } from "../util/nativeBuffer.ts";

const slots = new BigUint64Array(3);
const slotsPtr = ptr(slots);
const slotPtrs = [slotsPtr, slotsPtr + 8, slotsPtr + 16] as const;

interface OpenReader {
  readonly id: number;
  close(): void;
}

function openReader(
  fullPath: string,
  start: number,
  end: bigint,
  config: NativeFilesystemConfig,
  waker: NativeWaker,
  fillMode = false,
): OpenReader {
  const path = encodePath(fullPath);
  const id = native.reader_open(
    path.ptr as never,
    BigInt(path.length),
    BigInt(start),
    end,
    BigInt(config.chunkSize),
    BigInt(config.depth),
    fillMode ? 1 : 0,
  );
  if (id === 0) {
    throw new Error(lastError());
  }
  waker.open();
  let closed = false;
  return {
    id,
    close() {
      if (!closed) {
        closed = true;
        native.reader_close(id);
        waker.close();
      }
    },
  };
}

function itemStream(
  open: () => OpenReader,
  waker: NativeWaker,
  onClose?: () => void,
): ReadableStream<Item<PayloadKind.Native>> {
  let reader: OpenReader | undefined;
  const close = () => {
    reader?.close();
    onClose?.();
  };
  return new ReadableStream<Item<PayloadKind.Native>>(
    {
      async pull(controller) {
        reader ??= open();
        for (;;) {
          const result = native.reader_try_next(
            reader.id,
            slotPtrs[0] as never,
            slotPtrs[1] as never,
            slotPtrs[2] as never,
          );
          if (result === OK) {
            controller.enqueue({
              payload: createNativePayload(Number(slots[0]), Number(slots[1]), Number(slots[2])),
            });
            return;
          }
          if (result === EOF) {
            close();
            controller.close();
            return;
          }
          if (result === ERROR) {
            const message = lastError();
            close();
            throw new Error(message);
          }
          await waker.ready(reader.id);
        }
      },
      cancel() {
        close();
      },
    },
    { highWaterMark: 0 },
  );
}

/**
 * Opens a readable handle for a file backed by a native reader thread. The
 * stream yields native `host` payloads. `readRange` opens an independent
 * reader over a byte range, and `readInto` reads straight into a
 * sink-provided buffer. No native resources are allocated until the stream
 * is first read, a range is opened, or `readInto` is called.
 */
export function createNativeReadableHandle(
  fullPath: string,
  config: NativeFilesystemConfig,
  waker: NativeWaker,
): StreamHandle<PayloadKind.Native> & RangeReadable<PayloadKind.Native> & FillReadable {
  let fillReader: OpenReader | undefined;
  const closeFill = () => {
    fillReader?.close();
    fillReader = undefined;
  };
  return {
    kind: PayloadKind.Native,
    domains: ["host"],
    stream: itemStream(() => openReader(fullPath, 0, READ_TO_END, config, waker), waker, closeFill),
    async readRange(start: number, end: number) {
      if (end <= start) {
        return new ReadableStream({
          start(controller) {
            controller.close();
          },
        });
      }
      return itemStream(
        () => openReader(fullPath, start, BigInt(Math.floor(end)), config, waker),
        waker,
      );
    },
    async readInto(lease: BufferLease): Promise<number | null> {
      fillReader ??= openReader(fullPath, 0, READ_TO_END, config, waker, true);
      const { id } = fillReader;
      try {
        if (native.reader_submit_into(id, lease.ptr as never, BigInt(lease.length)) !== OK) {
          throw new Error(lastError());
        }
        for (;;) {
          const result = native.reader_try_complete(id, slotPtrs[0] as never);
          if (result === OK) {
            return Number(slots[0]);
          }
          if (result === EOF) {
            closeFill();
            return null;
          }
          if (result === ERROR) {
            throw new Error(lastError());
          }
          if (result === WOULD_BLOCK) {
            await waker.ready(id);
          }
        }
      } catch (error) {
        closeFill();
        throw error;
      }
    },
  };
}
