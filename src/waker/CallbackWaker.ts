import { FFIType, JSCallback } from "bun:ffi";
import { native } from "../lib.ts";
import type { NativeWaker } from "./NativeWaker.ts";

/**
 * Wakes waiters through one thread-safe `JSCallback` that the native I/O
 * threads call with the id of a handle that became ready. Bun marshals each
 * call onto the JS thread. Thread-safe callbacks are experimental in Bun.
 */
export class CallbackWaker implements NativeWaker {
  #callback?: JSCallback;
  #references = 0;
  readonly #pending = new Map<number, () => void>();

  public open(): void {
    if (this.#references++ > 0) {
      return;
    }
    this.#callback = new JSCallback(
      (handle: number) => {
        const resolve = this.#pending.get(handle);
        this.#pending.delete(handle);
        resolve?.();
      },
      { args: [FFIType.u32], returns: FFIType.void, threadsafe: true },
    );
    native.set_ready_callback(this.#callback.ptr);
  }

  public close(): void {
    if (this.#references === 0 || --this.#references > 0) {
      return;
    }
    native.set_ready_callback(null);
    this.#callback?.close();
    this.#callback = undefined;
  }

  public ready(handle: number): Promise<void> {
    return new Promise((resolve) => this.#pending.set(handle, resolve));
  }
}
