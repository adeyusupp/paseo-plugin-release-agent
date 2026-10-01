import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const row = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  cwd: z.string(),
  pid: z.number().nullable(),
  rssMb: z.number().nullable(),
  uptimeSec: z.number().nullable(),
  provider: z.string(),
  busy: z.boolean(),
  idleSec: z.number().nullable(),
});

export const listRpc = defineRpc({
  name: "release.list",
  input: z.object({}),
  output: z.object({
    agents: z.array(row),
    host: z.object({
      name: z.string(),
      memTotalMb: z.number(),
      memAvailMb: z.number(),
      swapTotalMb: z.number(),
      swapUsedMb: z.number(),
      load1: z.number(),
    }),
  }),
});

export const releaseRpc = defineRpc({
  name: "release.kill",
  input: z.object({ agentId: z.string(), force: z.boolean().optional() }),
  output: z.object({ ok: z.boolean(), message: z.string() }),
});

export const releaseAllRpc = defineRpc({
  name: "release.kill-all",
  input: z.object({}),
  output: z.object({ released: z.number(), skipped: z.number(), message: z.string() }),
});
