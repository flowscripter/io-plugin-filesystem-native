import { type IOProviderFactory, PayloadKind } from "@flowscripter/pluggable-io-framework-api";
import { parseFileLocationString } from "./location/parseFileLocationString.ts";
import { toFileProviderInputs } from "./location/toFileProviderInputs.ts";
import { NativeFilesystemIOProvider } from "./NativeFilesystemIOProvider.ts";
import {
  type NativeFilesystemConfig,
  nativeFilesystemConfigSchema,
} from "./schema/nativeFilesystemConfigSchema.ts";
import {
  type NativeFilesystemLocation,
  nativeFilesystemLocationSchema,
} from "./schema/nativeFilesystemLocationSchema.ts";
import { nativeFilesystemPropertySchema } from "./schema/nativeFilesystemPropertySchema.ts";
import { nativeFilesystemSettablePropertySchema } from "./schema/nativeFilesystemSettablePropertySchema.ts";

export const nativeFilesystemIOProviderFactory: IOProviderFactory<
  NativeFilesystemConfig,
  PayloadKind.Native,
  NativeFilesystemLocation
> = {
  protocol: "file",
  kind: PayloadKind.Native,
  domains: ["host"],
  configSchema: nativeFilesystemConfigSchema,
  locationSchema: nativeFilesystemLocationSchema,
  propertySchema: nativeFilesystemPropertySchema,
  settablePropertySchema: nativeFilesystemSettablePropertySchema,
  parseLocationString: parseFileLocationString,
  toProviderInputs: toFileProviderInputs,
  async createProvider(config) {
    return new NativeFilesystemIOProvider(config);
  },
};
