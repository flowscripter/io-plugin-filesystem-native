# io-plugin-filesystem-native notes

- Local repo created for pluggable-io-framework#18 Plan 5; Nick pushes it himself. Do not push or add remotes.
- Rust cdylib (`src/*.rs`, std only) loaded with `bun:ffi` by `src/lib.ts`; run `cargo build --release` before `bun test` (the lib is found in `target/release`).
- Checks: `bunx tsc --noEmit`, `bunx oxlint index.ts src/ tests/ bench/`, `bunx oxfmt --check`, `cargo test`, `bun test`.
- Handle ids are u32. One waker kind (callback or worker) per process: they share one native notification channel.
- A reader opened for `readInto` must be opened in fill mode, otherwise the thread prefetches a chunk first.
