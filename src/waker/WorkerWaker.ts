import { libPath, native } from "../lib.ts";
import type { NativeWaker } from "./NativeWaker.ts";

const WORKER_SOURCE = `
import { dlopen, FFIType } from "bun:ffi";
self.onmessage = (event) => {
  const { symbols } = dlopen(event.data, { wait_any: { args: [], returns: FFIType.u32 } });
  postMessage(-1);
  for (;;) {
    const handle = symbols.wait_any();
    if (handle === 0) break;
    postMessage(handle);
  }
  postMessage(0);
};
`;

/**
 * Wakes waiters from one shared Worker per library, parked in the blocking
 * native `wait_any` call and posting back the id of each handle that became
 * ready. Slower than `CallbackWaker` but independent of Bun's
 * experimental thread-safe callbacks.
 */
export class WorkerWaker implements NativeWaker {
  #worker?: Worker;
  #url?: string;
  #references = 0;
  #started?: Promise<void>;
  readonly #pending = new Map<number, () => void>();

  public open(): void {
    if (this.#references++ > 0) {
      return;
    }
    native.set_ready_callback(null);
    this.#url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    const worker = new Worker(this.#url);
    this.#worker = worker;
    this.#started = new Promise<void>((resolve) => {
      worker.onmessage = (event: MessageEvent<number>) => {
        const handle = event.data;
        if (handle === -1) {
          resolve();
          return;
        }
        const waiter = this.#pending.get(handle);
        this.#pending.delete(handle);
        waiter?.();
      };
    });
    worker.postMessage(libPath);
    (worker as unknown as { unref(): void }).unref();
  }

  public close(): void {
    if (this.#references === 0 || --this.#references > 0) {
      return;
    }
    native.waker_shutdown();
    const worker = this.#worker;
    const url = this.#url;
    this.#worker = undefined;
    this.#url = undefined;
    this.#started = undefined;
    setTimeout(() => {
      worker?.terminate();
      if (url) {
        URL.revokeObjectURL(url);
      }
    }, 50);
  }

  public async ready(handle: number): Promise<void> {
    const started = this.#started;
    const waiting = new Promise<void>((resolve) => this.#pending.set(handle, resolve));
    await started;
    return waiting;
  }
}
