import { CallbackWaker } from "./CallbackWaker.ts";
import type { NativeWaker } from "./NativeWaker.ts";
import { WorkerWaker } from "./WorkerWaker.ts";

export type WakerKind = "callback" | "worker";

const wakers: Record<WakerKind, NativeWaker> = {
  callback: new CallbackWaker(),
  worker: new WorkerWaker(),
};

/** The shared waker of the given kind: one per library, not one per handle. */
export function getNativeWaker(kind: WakerKind): NativeWaker {
  return wakers[kind];
}
