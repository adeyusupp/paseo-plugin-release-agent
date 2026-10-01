export interface ProcInfo {
  pid: number;
  ppid: number;
  cmdline: string;
  agentId: string | null;
  rssKb: number;
  uptimeSec: number;
}

export interface Group {
  pid: number;
  pids: number[];
  rssMb: number;
  uptimeSec: number;
  busy: boolean;
}

const base = (s?: string) => s?.split("/").pop();

// Strict argv match: a shell whose command text merely mentions these flags must not match.
export function isProviderProc(cmdline: string): boolean {
  const a = cmdline.split("\0");
  if (base(a[0]) === "claude") return a.includes("--input-format") && a.includes("stream-json");
  const i = base(a[0]) === "node" ? 1 : 0;
  return base(a[i]) === "codex" && a[i + 1] === "app-server";
}

// One group per agent: the provider's own processes (claude; codex node wrapper + native binary).
// Any other descendant (bash tool, monitor, subagent) makes the group busy.
export function buildGroups(procs: ProcInfo[]): Map<string, Group> {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const kids = new Map<number, ProcInfo[]>();
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p]);

  const out = new Map<string, Group>();
  for (const root of procs) {
    if (!root.agentId || !isProviderProc(root.cmdline)) continue;
    const parent = byPid.get(root.ppid);
    if (parent?.agentId === root.agentId && isProviderProc(parent.cmdline)) continue;

    const own = [root];
    let busy = false;
    const walk = (p: ProcInfo) => {
      for (const k of kids.get(p.pid) ?? []) {
        if (isProviderProc(k.cmdline)) {
          own.push(k);
          walk(k);
        } else busy = true;
      }
    };
    walk(root);
    out.set(root.agentId, {
      pid: root.pid,
      pids: own.map((p) => p.pid),
      rssMb: Math.round(own.reduce((sum, p) => sum + p.rssKb, 0) / 1024),
      uptimeSec: root.uptimeSec,
      busy,
    });
  }
  return out;
}
