import { z } from "zod";

export const nativeFilesystemPropertySchema = z.object({ mode: z.number().optional() });
