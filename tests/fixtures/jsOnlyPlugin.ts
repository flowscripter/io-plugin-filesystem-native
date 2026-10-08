import type { Plugin } from "@flowscripter/dynamic-plugin-framework/plugin";
import {
  type IOProvider,
  type IOProviderFactory,
  type Item,
  PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT,
  PayloadKind,
} from "@flowscripter/pluggable-io-framework-api";
import { z } from "zod";

export const memoryStore = new Map<string, Uint8Array>();

const factory: IOProviderFactory<Record<string, never>, PayloadKind.Js, { path: string }> = {
  protocol: "mem",
  kind: PayloadKind.Js,
  configSchema: z.object({}),
  locationSchema: z.object({ path: z.string() }),
  propertySchema: z.object({}),
  settablePropertySchema: z.object({}),
  parseLocationString: (location) => ({ path: location.replace(/^mem:\/*/, "") }),
  toProviderInputs: (location) => ({ config: {}, target: { kind: "entry", key: location.path } }),
  async createProvider(): Promise<IOProvider<PayloadKind.Js>> {
    return {
      kind: PayloadKind.Js,
      async [Symbol.asyncDispose]() {},
      async getProperties() {
        return { size: 0, lastModified: new Date(0), isContainer: false, properties: {} };
      },
      async getReadableStream() {
        throw new Error("not readable");
      },
      async getWritableStream(path) {
        const chunks: Uint8Array[] = [];
        return {
          kind: PayloadKind.Js,
          stream: new WritableStream<Item<PayloadKind.Js>>({
            write(item) {
              chunks.push(item.payload.data.slice());
            },
            close() {
              memoryStore.set(path, new Uint8Array(Buffer.concat(chunks)));
            },
          }),
        };
      },
    };
  },
};

const plugin: Plugin = {
  extensionDescriptors: [
    {
      extensionPoint: PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT,
      factory: { create: () => Promise.resolve(factory) },
    },
  ],
};

export default plugin;
