# io-plugin-filesystem-native

[![version](https://img.shields.io/github/v/release/flowscripter/io-plugin-filesystem-native?sort=semver)](https://github.com/flowscripter/io-plugin-filesystem-native/releases)
[![build](https://img.shields.io/github/actions/workflow/status/flowscripter/io-plugin-filesystem-native/release-bun-rust-library.yml)](https://github.com/flowscripter/io-plugin-filesystem-native/actions/workflows/release-bun-rust-library.yml)
[![docs](https://img.shields.io/badge/docs-API-blue)](https://flowscripter.github.io/io-plugin-filesystem-native/index.html)
[![license: MIT](https://img.shields.io/github/license/flowscripter/io-plugin-filesystem-native)](https://github.com/flowscripter/io-plugin-filesystem-native/blob/main/LICENSE)

> Native (Rust) local filesystem source/sink plugin for
> [pluggable-io-framework](https://github.com/flowscripter/pluggable-io-framework),
> loaded via
> [dynamic-plugin-framework](https://github.com/flowscripter/dynamic-plugin-framework)

## Key Features

- A second `file` provider factory with the `native` payload kind and the
  `host` memory domain. It coexists with
  [io-plugin-filesystem](https://github.com/flowscripter/io-plugin-filesystem)
  (`file` with the `js` kind): both use the same `file:///...` locations and
  the caller picks the implementation by payload kind.
- Reads and writes run on Rust threads. Each reader or writer handle owns one
  I/O thread feeding or draining a bounded ring of buffers, and the JS side
  only calls non-blocking entry points, so the event loop is never blocked.
- Items carry `NativePayload` buffers allocated by Rust. They reach a native
  sink without being copied into the JS heap.
- Readable handles are `RangeReadable` and `FillReadable`; writable handles
  are `BufferProvider` and `ResumableWritable`, so a native to native copy
  takes the engine's lease path and the reader fills the writer's buffers
  directly.
- Registers two zero-cost payload converters, `native[host]` to `js` and
  `js` to `native[host]`, so the registry can bridge this plugin to any `js`
  provider when no common kind exists.
- Locations, `getProperties` and `joinKey` behave exactly as in
  io-plugin-filesystem. There is no listing, deleting, `setProperties`,
  container creation, multipart or direct transfer, so container and pattern
  targets are not supported.
- The reference template for native providers: the ring, waker and handle
  model is generic and independent of the filesystem.

## Usage

Install the plugin where a
[pluggable-io-framework](https://github.com/flowscripter/pluggable-io-framework)
host discovers plugins. With both filesystem plugins installed, the payload
kind selects the implementation (`registry` is a discovered
`ProviderRegistry`):

```typescript
const { source, dest, options } = await registry.createProvidersForTransfer(
  { protocol: "file", location: { path: "/data", filename: "in.bin" } },
  { protocol: "file", location: { path: "/data", filename: "out.bin" } },
  { kind: PayloadKind.Native },
);
await copy(source.provider, source.target, dest.provider, dest.target, options);
```

## Further Details

- [Configuration](./README/configuration.md)
- [Behaviour](./README/behaviour.md)
- [Development](./README/development.md)
- [API Documentation](https://flowscripter.github.io/io-plugin-filesystem-native/index.html)

## License

MIT © Flowscripter
