import {
  PLUGGABLE_IO_FRAMEWORK_PAYLOAD_CONVERTER_EXTENSION_POINT,
  PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT,
} from "@flowscripter/pluggable-io-framework-api";
import type { ExtensionDescriptor, Plugin } from "@flowscripter/dynamic-plugin-framework/plugin";
import { nativeFilesystemIOProviderFactory } from "./NativeFilesystemIOProviderFactory.ts";
import { nativePayloadConverters } from "./nativePayloadConverter.ts";

const factoryDescriptor: ExtensionDescriptor = {
  extensionPoint: PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT,
  factory: { create: () => Promise.resolve(nativeFilesystemIOProviderFactory) },
};

const converterDescriptors: ExtensionDescriptor[] = nativePayloadConverters.map((converter) => ({
  extensionPoint: PLUGGABLE_IO_FRAMEWORK_PAYLOAD_CONVERTER_EXTENSION_POINT,
  factory: { create: () => Promise.resolve(converter) },
}));

/** Registers the native `file` provider factory and its two payload converters. */
const nativeFilesystemPlugin: Plugin = {
  extensionDescriptors: [factoryDescriptor, ...converterDescriptors],
};

export default nativeFilesystemPlugin;
