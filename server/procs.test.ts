import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGroups, isProviderProc } from "./procs.ts";

const claudeArgs = "/usr/local/bin/claude\0--output-format\0stream-json\0--input-format\0stream-json";
const p = (pid: number, ppid: number, cmdline: string, agentId: string | null, rssKb = 1024) => ({
  pid,
  ppid,
  cmdline,
  agentId,
  rssKb,
  uptimeSec: 60,
});

test("shell that only mentions the flags is not a provider process", () => {
  assert.equal(isProviderProc("/bin/bash\0-c\0claude --output-format stream-json --input-format stream-json"), false);
  assert.equal(isProviderProc(claudeArgs), true);
  assert.equal(isProviderProc("node\0/usr/local/bin/codex\0app-server\0--enable\0goals"), true);
  assert.equal(isProviderProc("/x/vendor/bin/codex\0app-server"), true);
  assert.equal(isProviderProc("/x/vendor/bin/codex\0exec"), false);
});

test("claude: idle is not busy, a bash child makes it busy", () => {
  const idle = buildGroups([p(10, 1, claudeArgs, "a")]);
  assert.deepEqual(idle.get("a"), { pid: 10, pids: [10], rssMb: 1, uptimeSec: 60, busy: false });
  const busy = buildGroups([p(10, 1, claudeArgs, "a"), p(11, 10, "/bin/bash\0-c\0sleep 99", "a")]);
  assert.equal(busy.get("a")?.busy, true);
});

test("codex: wrapper and native binary form one group, summed memory, not busy", () => {
  const g = buildGroups([
    p(20, 1, "node\0/usr/local/bin/codex\0app-server", "c", 2048),
    p(21, 20, "/vendor/bin/codex\0app-server", "c", 4096),
  ]).get("c");
  assert.deepEqual(g?.pids, [20, 21]);
  assert.equal(g?.pid, 20);
  assert.equal(g?.rssMb, 6);
  assert.equal(g?.busy, false);
});

test("codex: tool process under the native binary makes the group busy", () => {
  const g = buildGroups([
    p(20, 1, "node\0/usr/local/bin/codex\0app-server", "c"),
    p(21, 20, "/vendor/bin/codex\0app-server", "c"),
    p(22, 21, "/bin/bash\0-c\0make", "c"),
  ]).get("c");
  assert.equal(g?.busy, true);
});
