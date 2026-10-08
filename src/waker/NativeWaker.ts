/**
 * Delivers readiness notifications from the native I/O threads to the JS
 * thread. A handle that got `WOULD_BLOCK` from a non-blocking entry point
 * awaits `ready(handle)`, and the native side resolves it once that handle
 * can make progress.
 */
export interface NativeWaker {
  /** Starts the notification channel for a new handle; every `open` is paired with a `close`. */
  open(): void;
  /** Releases a handle's claim on the channel, tearing it down when none remain. */
  close(): void;
  /** Resolves when the native side next reports `handle` ready. */
  ready(handle: number): Promise<void>;
}
