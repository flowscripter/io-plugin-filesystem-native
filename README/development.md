# Development

Install dependencies:

`bun install`

Build the native library:

`cargo build --release`

Test the native library:

`cargo test`

Test the plugin, which loads the release build of the native library:

`bun test`

Bundle for usage as a
[dynamic-plugin-framework](https://github.com/flowscripter/dynamic-plugin-framework)
plugin:

`bun run build`

Format:

`cargo fmt && bunx oxfmt`

Lint:

`bunx oxlint index.ts src/ tests/ bench/`

Generate HTML API documentation:

`bunx typedoc index.ts`

## Benchmark

`bun run bench/copy_bench.ts`

The benchmark copies generated 64 MiB and 1 GiB files between providers
created directly from each factory, in `/dev/shm` so the run is memory-bound.
Every case runs five times and reports the median throughput, the item count,
the average payload size, the waker wake-ups per item and the peak
`arrayBuffers` memory. Each destination is verified against the source with a
sha256 comparison outside the timed region.

- A: `file`/js to `file`/js.
- B: `file`/native to `file`/native by plain streaming, with each waker.
- C: `file`/native to `file`/js through the native to js converter.
- D: `file`/js to `file`/native through the js to native converter.
- F: `file`/native to `file`/native through the lease path, with each waker.
- E: `file`/js to `file`/js with `directTransfer`, as the kernel copy ceiling.

Set `BENCH_SIZES_MIB` (for example `32`) to run smaller files.
