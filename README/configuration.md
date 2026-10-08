# Configuration

## Provider Config

- `chunkSize`: the size in bytes of each buffer the native reader produces and
  each lease buffer the native writer hands out. Defaults to 1 MiB.
- `depth`: the number of buffers in flight per handle, which is the size of
  the ring. Defaults to 4. It is also the writer's `maxOutstanding`.
- `waker`: how the native I/O threads notify the JS thread, `"callback"`
  (default) or `"worker"`.

Locations parsed from strings, and the CLI, use the defaults.

## Location

The location schema has exactly the fields of the io-plugin-filesystem
location, as the registry requires of every factory sharing a protocol:

- `path`: defaults to `/`.
- `filename`: addresses a single entry. Mutually exclusive with `pattern`.
- `pattern`: a glob, which this plugin cannot serve because it has no listing.

## Wakers

- `CallbackWaker` registers one thread-safe `JSCallback` per library. The Rust
  thread calls it with the handle id when a handle goes from empty or full to
  ready, but only when a JS waiter is registered for that handle. Thread-safe
  callbacks are marked experimental by Bun.
- `WorkerWaker` runs one shared Worker per library, parked in a blocking
  native `wait_any` call and posting back the id of each ready handle. It does
  not depend on experimental Bun features.

Use one waker kind at a time within a process: both share the library's single
notification channel.
