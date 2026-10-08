import { PayloadKind, type NativePayload } from "@flowscripter/pluggable-io-framework-api";
import { native } from "../lib.ts";

interface Ownership {
  readonly ptr: number;
  readonly capacity: number;
  owned: boolean;
}

const ownerships = new WeakMap<NativePayload, Ownership>();

/**
 * Wraps a buffer allocated by the native library in a host-domain payload
 * whose `release()` returns it to the allocator exactly once.
 */
export function createNativePayload(ptr: number, length: number, capacity: number): NativePayload {
  const ownership: Ownership = { ptr, capacity, owned: true };
  const payload: NativePayload = {
    kind: PayloadKind.Native,
    domain: "host",
    ptr,
    length,
    release() {
      if (ownership.owned) {
        ownership.owned = false;
        native.buffer_free(ptr, BigInt(capacity));
      }
    },
  };
  ownerships.set(payload, ownership);
  return payload;
}

/**
 * Takes over the buffer behind a payload created by `createNativePayload`,
 * making its `release()` a no-op. Returns `undefined` for any other payload or
 * one that was already released or taken.
 */
export function takeNativeBuffer(
  payload: NativePayload,
): { ptr: number; capacity: number } | undefined {
  const ownership = ownerships.get(payload);
  if (!ownership?.owned) {
    return undefined;
  }
  ownership.owned = false;
  return { ptr: ownership.ptr, capacity: ownership.capacity };
}
