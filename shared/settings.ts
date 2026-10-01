import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const autoReleaseSettings = defineSettings({
  id: "auto-release",
  scope: "host",
  version: 1,
  schema: z.object({
    enabled: z.boolean().default(false),
    idleMinutes: z.number().int().min(5).max(1440).default(30),
  }),
});
