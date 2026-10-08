import { dlopen, FFIType, ptr } from "bun:ffi";
import { getLibPath } from "./lib-path.ts";

const libPath = await getLibPath("flowscripter_io_plugin_filesystem_native");

export const { symbols: native } = dlopen(libPath, {
  reader_open: {
    args: [
      FFIType.ptr,
      FFIType.u64,
      FFIType.u64,
      FFIType.u64,
      FFIType.u64,
      FFIType.u64,
      FFIType.u32,
    ],
    returns: FFIType.u32,
  },
  reader_try_next: {
    args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  reader_submit_into: { args: [FFIType.u32, FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  reader_try_complete: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
  reader_close: { args: [FFIType.u32], returns: FFIType.void },
  buffer_free: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.void },
  buffer_gc_deallocator: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.void },
  writer_open: {
    args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u32],
    returns: FFIType.u32,
  },
  writer_try_acquire: { args: [FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  writer_commit: { args: [FFIType.u32, FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  writer_release: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.void },
  writer_write: { args: [FFIType.u32, FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  writer_committed: { args: [FFIType.u32], returns: FFIType.u64_fast },
  writer_close: { args: [FFIType.u32], returns: FFIType.i32 },
  writer_abort: { args: [FFIType.u32], returns: FFIType.void },
  writer_free: { args: [FFIType.u32], returns: FFIType.void },
  set_ready_callback: { args: [FFIType.ptr], returns: FFIType.void },
  wait_any: { args: [], returns: FFIType.u32 },
  waker_shutdown: { args: [], returns: FFIType.void },
  last_error: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u64_fast },
});

export { libPath };

/** Result codes shared by the non-blocking entry points. */
export const EOF = 0;
export const OK = 1;
export const WOULD_BLOCK = 2;
export const ERROR = -1;

/** Passed as the end of a read to read to the end of the file. */
export const READ_TO_END = 0xffffffffffffffffn;

const encoder = new TextEncoder();

/** A UTF-8 encoded path, kept alive alongside its length. */
export function encodePath(path: string): { bytes: Uint8Array; ptr: number; length: number } {
  const bytes = encoder.encode(path);
  return { bytes, ptr: ptr(bytes.length === 0 ? new Uint8Array(1) : bytes), length: bytes.length };
}

/** The message of the last error reported by the native library. */
export function lastError(): string {
  const length = Number(native.last_error(null, 0n));
  if (length === 0) {
    return "unknown native error";
  }
  const buffer = new Uint8Array(length);
  native.last_error(ptr(buffer), BigInt(length));
  return new TextDecoder().decode(buffer);
}
