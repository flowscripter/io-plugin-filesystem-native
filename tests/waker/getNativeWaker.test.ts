import { describe, expect, test } from "bun:test";
import { CallbackWaker } from "../../src/waker/CallbackWaker.ts";
import { getNativeWaker } from "../../src/waker/getNativeWaker.ts";
import { WorkerWaker } from "../../src/waker/WorkerWaker.ts";

describe("getNativeWaker", () => {
  test("returns the shared waker of each kind", () => {
    expect(getNativeWaker("callback")).toBeInstanceOf(CallbackWaker);
    expect(getNativeWaker("worker")).toBeInstanceOf(WorkerWaker);
    expect(getNativeWaker("callback")).toBe(getNativeWaker("callback"));
    expect(getNativeWaker("worker")).toBe(getNativeWaker("worker"));
  });
});
