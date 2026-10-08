import { z } from "zod";

/** No properties can be set: the provider does not implement `setProperties`. */
export const nativeFilesystemSettablePropertySchema = z.object({});
