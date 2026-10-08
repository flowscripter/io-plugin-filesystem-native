import { ptr, toArrayBuffer } from "bun:ffi";
import {
  type Item,
  type JsPayload,
  type NativePayload,
  type PayloadConverter,
  PayloadKind,
} from "@flowscripter/pluggable-io-framework-api";
import { native } from "./lib.ts";
import { takeNativeBuffer } from "./util/nativeBuffer.ts";

/**
 * `native[host]` to `js`. A buffer from this plugin is viewed in place and
 * its ownership moves to the garbage collector, which frees it through the
 * native deallocator, so the payload is not released here. A payload from any
 * other source is copied and released.
 */
const toArrayBufferWithDeallocator = toArrayBuffer as unknown as (
  ptr: number,
  byteOffset: number,
  byteLength: number,
  deallocatorContext: number,
  deallocator: number,
) => ArrayBuffer;

const gcDeallocator = (native.buffer_gc_deallocator as unknown as { ptr: number }).ptr;

export const nativeToJsPayloadConverter: PayloadConverter = {
  from: { kind: PayloadKind.Native, domain: "host" },
  to: { kind: PayloadKind.Js },
  cost: 0,
  convert(item: Item): Item {
    const payload = item.payload as NativePayload;
    const buffer = takeNativeBuffer(payload);
    let data: Uint8Array;
    if (buffer) {
      data = new Uint8Array(
        toArrayBufferWithDeallocator(
          payload.ptr,
          0,
          payload.length,
          buffer.capacity,
          gcDeallocator,
        ),
      );
    } else {
      data = new Uint8Array(toArrayBuffer(payload.ptr as never, 0, payload.length)).slice();
      payload.release();
    }
    return { attributes: item.attributes, payload: { kind: PayloadKind.Js, data } };
  },
};

/**
 * `js` to `native[host]`: a pointer to the existing bytes. The payload keeps
 * the `Uint8Array` referenced until `release()`, so the memory stays valid for
 * as long as native code may read it.
 */
export const jsToNativePayloadConverter: PayloadConverter = {
  from: { kind: PayloadKind.Js },
  to: { kind: PayloadKind.Native, domain: "host" },
  cost: 0,
  convert(item: Item): Item {
    const { data } = item.payload as JsPayload;
    const holder: { data?: Uint8Array } = { data };
    return {
      attributes: item.attributes,
      payload: {
        kind: PayloadKind.Native,
        domain: "host",
        ptr: data.byteLength === 0 ? 0 : ptr(data),
        length: data.byteLength,
        release() {
          holder.data = undefined;
        },
      },
    };
  },
};

export const nativePayloadConverters: readonly PayloadConverter[] = [
  nativeToJsPayloadConverter,
  jsToNativePayloadConverter,
];
