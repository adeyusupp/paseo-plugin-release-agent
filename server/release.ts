import { readFileSync, readdirSync } from "node:fs";
import { hostname, loadavg } from "node:os";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { listRpc, releaseAllRpc, releaseRpc } from "../shared/release";
import { autoReleaseSettings } from "../shared/settings";
import { dueForAutoRelease, releaseBlocker } from "./policy";
import { buildGroups, isProviderProc, type Group, type ProcInfo } from "./procs";

// Paseo marks a killed session as "error"; remember our own kills to show "stopped" instead.
const released = new Set<string>();
// First observation of an agent being idle with a live process; observed time underestimates real idleness.
const idleSince = new Map<string, number>();
let api: PluginHandlerContext["paseo"] | null = null;

function procsByAgent(): Map<string, Group> {
  const uptime = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
  const procs: ProcInfo[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const cmdline = readFileSync(`/proc/${name}/cmdline`, "utf8");
      // stat fields after "(comm) ": [0]=state [1]=ppid [19]=starttime in ticks (100 Hz); comm may hold spaces
      const stat = readFileSync(`/proc/${name}/stat`, "utf8").split(") ")[1].split(" ");
      const provider = isProviderProc(cmdline);
      const env = provider ? readFileSync(`/proc/${name}/environ`, "utf8").split("\0") : [];
      const status = provider ? readFileSync(`/proc/${name}/status`, "utf8") : "";
      procs.push({
        pid: Number(name),
        ppid: Number(stat[1]),
        cmdline,
        agentId: env.find((e) => e.startsWith("PASEO_AGENT_ID="))?.slice(15) ?? null,
        rssKb: Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0),
        uptimeSec: Math.max(0, Math.round(uptime - Number(stat[19]) / 100)),
      });
    } catch {
      // process exited or unreadable
    }
  }
  return buildGroups(procs);
}

export async function listAgents(_: RpcInput<typeof listRpc>, { paseo }: PluginHandlerContext) {
  api = paseo;
  const procs = procsByAgent();
  const { entries } = await paseo.agents.list();
  return {
    host: hostInfo(),
    agents: entries.map(({ agent }) => {
      const proc = procs.get(agent.id);
      if (proc || agent.status !== "error") released.delete(agent.id);
      return {
        id: agent.id,
        name: agent.title ?? agent.id.slice(0, 8),
        status: released.has(agent.id) ? "stopped" : agent.status,
        cwd: agent.cwd,
        pid: proc?.pid ?? null,
        rssMb: proc?.rssMb ?? null,
        uptimeSec: proc?.uptimeSec ?? null,
        provider: agent.provider,
        busy: proc?.busy ?? false,
        idleSec: idleSince.has(agent.id) ? Math.round((Date.now() - idleSince.get(agent.id)!) / 1000) : null,
      };
    }),
  };
}

function hostInfo() {
  const mem = readFileSync("/proc/meminfo", "utf8");
  const mb = (key: string) => Math.round(Number(new RegExp(`${key}:\\s+(\\d+)`).exec(mem)?.[1] ?? 0) / 1024);
  return {
    name: hostname(),
    memTotalMb: mb("MemTotal"),
    memAvailMb: mb("MemAvailable"),
    swapTotalMb: mb("SwapTotal"),
    swapUsedMb: mb("SwapTotal") - mb("SwapFree"),
    load1: Math.round(loadavg()[0] * 100) / 100,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const signal = (pids: number[], sig: NodeJS.Signals) =>
  pids.forEach((pid) => {
    try {
      process.kill(pid, sig);
    } catch {
      // already gone
    }
  });

async function terminate(pids: number[]): Promise<boolean> {
  signal(pids, "SIGTERM");
  for (let i = 0; i < 10; i++) {
    await sleep(200);
    if (!pids.some(isAlive)) return true;
  }
  signal(pids, "SIGKILL");
  await sleep(300);
  return !pids.some(isAlive);
}

async function killAgent(agentId: string, status: string, procs: Map<string, Group>, force = false) {
  const proc = procs.get(agentId);
  if (!proc) return { ok: false, message: "no live process" };
  const blocker = releaseBlocker(status, proc.busy, force);
  if (blocker) return { ok: false, message: `refused: ${blocker}` };
  const dead = await terminate(proc.pids);
  if (dead) {
    released.add(agentId);
    idleSince.delete(agentId);
  }
  return { ok: dead, message: dead ? `killed pid ${proc.pid} (${proc.rssMb} MB)` : `pid ${proc.pid} still alive` };
}

export async function releaseAgent({ agentId, force }: RpcInput<typeof releaseRpc>, { paseo }: PluginHandlerContext) {
  api = paseo;
  const handle = paseo.agents.ref(agentId);
  await handle.refresh();
  const snap = handle.current();
  if (!snap) return { ok: false, message: "agent not found" };
  return killAgent(agentId, snap.status, procsByAgent(), force);
}

export async function releaseAll(_: RpcInput<typeof releaseAllRpc>, { paseo }: PluginHandlerContext) {
  api = paseo;
  const procs = procsByAgent();
  const { entries } = await paseo.agents.list();
  let released = 0;
  let skipped = 0;
  for (const { agent } of entries) {
    if (!procs.has(agent.id)) continue;
    const r = await killAgent(agent.id, agent.status, procs);
    if (r.ok) released++;
    else skipped++;
  }
  return { released, skipped, message: `released ${released}, skipped ${skipped} (running, busy or failed)` };
}

const TICK_MS = 30_000;

async function tick(settings: ReturnType<PluginServerContext["registerSettings"]>) {
  if (!api) return;
  const procs = procsByAgent();
  const { entries } = await api.agents.list();
  const state = await settings.read();
  const cfg = state.status === "ready" ? (state.values as { enabled: boolean; idleMinutes: number }) : null;
  const now = Date.now();
  for (const { agent } of entries) {
    const proc = procs.get(agent.id);
    if (!proc || releaseBlocker(agent.status, proc.busy, false)) {
      idleSince.delete(agent.id);
      continue;
    }
    if (!idleSince.has(agent.id)) idleSince.set(agent.id, now);
    if (cfg?.enabled && dueForAutoRelease(idleSince.get(agent.id), now, cfg.idleMinutes)) {
      const r = await killAgent(agent.id, agent.status, procs);
      console.log(`[auto-release] ${agent.id.slice(0, 8)} ${r.message}`);
    }
  }
}

// ponytail: needs one hook/RPC call to obtain the paseo API; dormant until then. Polling every 30s.
export function startAutoRelease(server: PluginServerContext) {
  const settings = server.registerSettings(autoReleaseSettings);
  const stops = (["agent.created", "agent.turn_started", "agent.turn_ended"] as const).map((name) =>
    server.on(name, (_, { paseo }) => {
      api = paseo;
    }),
  );
  const timer = setInterval(() => void tick(settings).catch((e) => console.error("[auto-release]", e)), TICK_MS);
  return () => {
    clearInterval(timer);
    stops.forEach((stop) => stop());
  };
}
