import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { listRpc, releaseAllRpc, releaseRpc } from "../shared/release";
import { autoReleaseSettings } from "../shared/settings";

const FILTERS = ["all", "live", "idle", "running", "stopped", "error"] as const;
type Filter = (typeof FILTERS)[number];

const formatDuration = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return m > 0 ? `${m}m` : `${sec}s`;
};

const shortCwd = (cwd: string) => cwd.split("/").filter(Boolean).slice(-2).join("/");

interface Confirm {
  title: string;
  body: string;
  label: string;
  run: () => void;
}

export function ReleaseSurface({ theme, layout, host }: PluginSurfaceProps) {
  const c = theme.colors;
  const compact = layout.compact;
  const list = useRpc(listRpc);
  const release = useRpc(releaseRpc);
  const releaseAll = useRpc(releaseAllRpc);
  const qc = useQueryClient();
  const agents = useQuery({ queryKey: ["release.list"], queryFn: () => list({}), refetchInterval: 5000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ["release.list"] });
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const kill = useMutation({
    mutationFn: (v: { agentId: string; force?: boolean }) => release(v),
    onSuccess: (r) => setNotice(r.message),
    onSettled: refresh,
  });
  const killAll = useMutation({
    mutationFn: () => releaseAll({}),
    onSuccess: (r) => setNotice(r.message),
    onSettled: refresh,
  });
  const busy = kill.isPending || killAll.isPending;

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const allRows = agents.data?.agents ?? [];
  const hostInfo = agents.data?.host;
  const q = query.trim().toLowerCase();
  const rows = allRows.filter(
    (a) =>
      (filter === "all" || (filter === "live" ? a.pid !== null : a.status === filter)) &&
      (!q || a.name.toLowerCase().includes(q) || a.cwd.toLowerCase().includes(q)),
  );
  const live = allRows.filter((a) => a.pid !== null);
  const totalMb = live.reduce((sum, a) => sum + (a.rssMb ?? 0), 0);
  const releasable = live.filter((a) => (a.status === "idle" || a.status === "error") && !a.busy);
  const releasableMb = releasable.reduce((sum, a) => sum + (a.rssMb ?? 0), 0);
  const statusColor = (s: string) =>
    s === "running" ? c.statusSuccess : s === "error" ? c.statusDanger : s === "idle" ? c.statusWarning : c.foregroundMuted;

  const button = (label: string, onPress: () => void, opts: { danger?: boolean; disabled?: boolean } = {}) => {
    const disabled = opts.disabled ?? busy;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={onPress}
        style={{
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: opts.danger ? c.statusDanger : c.border,
          backgroundColor: opts.danger ? "transparent" : c.surface2,
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <Text style={{ color: opts.danger ? c.statusDanger : c.foreground, fontSize: 13 }}>{label}</Text>
      </Pressable>
    );
  };

  const releaseButton = (a: (typeof allRows)[number]) => {
    if (a.pid === null) return null;
    if (a.busy)
      return button("Force", () =>
        setConfirm({
          title: `Force release "${a.name}"?`,
          body: "This session has background processes (bash, monitors or subagents). They will be killed with it.",
          label: "Force release",
          run: () => kill.mutate({ agentId: a.id, force: true }),
        }),
        { danger: true },
      );
    return button(
      "Release",
      () =>
        setConfirm({
          title: `Release "${a.name}"?`,
          body: `The ${a.provider} process (about ${a.rssMb ?? 0} MB) will be killed. The agent stays in your list and restarts on the next prompt.`,
          label: "Release",
          run: () => kill.mutate({ agentId: a.id }),
        }),
      { danger: true },
    );
  };

  const statusCell = (a: (typeof allRows)[number]) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor(a.status) }} />
      <Text style={{ color: c.foreground, fontSize: 13 }}>{a.status}{a.busy ? " · busy" : ""}</Text>
    </View>
  );
  const mem = (a: (typeof allRows)[number]) => (a.rssMb === null ? "—" : `${a.rssMb} MB`);
  const idle = (a: (typeof allRows)[number]) => (a.idleSec === null ? "—" : formatDuration(a.idleSec));
  const up = (a: (typeof allRows)[number]) => (a.uptimeSec === null ? "—" : formatDuration(a.uptimeSec));

  const cell = (flex: number, children: ReactNode, align: "left" | "right" = "left") => (
    <View style={{ flex, paddingHorizontal: 10, alignItems: align === "right" ? "flex-end" : "flex-start" }}>{children}</View>
  );
  const head = (label: string, flex: number, align: "left" | "right" = "left") =>
    cell(flex, <Text style={{ color: c.foregroundMuted, fontSize: 11, letterSpacing: 0.8 }}>{label.toUpperCase()}</Text>, align);
  const text = (value: string, muted = false) => (
    <Text style={{ color: muted ? c.foregroundMuted : c.foreground, fontSize: 13 }} numberOfLines={1}>{value}</Text>
  );

  const card = (a: (typeof allRows)[number]) => (
    <View key={a.id} style={{ padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: c.border }}>
      <View>
        <Text style={{ color: c.foreground, fontSize: 14 }} numberOfLines={2}>{a.name}</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }} numberOfLines={1}>{shortCwd(a.cwd)} · {a.provider}</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        {statusCell(a)}
        {text(`RAM ${mem(a)}`, true)}
        {text(`idle ${idle(a)}`, true)}
        {text(`up ${up(a)}`, true)}
      </View>
      {a.pid !== null && <View style={{ flexDirection: "row" }}>{releaseButton(a)}</View>}
    </View>
  );

  const row = (a: (typeof allRows)[number]) => (
    <View key={a.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border }}>
      {cell(5, <><Text style={{ color: c.foreground, fontSize: 14 }} numberOfLines={1}>{a.name}</Text>{text(shortCwd(a.cwd), true)}</>)}
      {cell(2, text(a.provider, true))}
      {cell(2, statusCell(a))}
      {cell(2, text(idle(a)), "right")}
      {cell(2, text(up(a)), "right")}
      {cell(2, text(mem(a), a.rssMb === null), "right")}
      {cell(2, releaseButton(a), "right")}
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: compact ? 12 : 24, gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <View style={{ flexShrink: 1 }}>
          <Text style={{ color: c.foreground, fontSize: 18, fontWeight: "600" }}>Release Agent Session</Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>
            {live.length} live {live.length === 1 ? "process" : "processes"} · {totalMb} MB
          </Text>
          {hostInfo && (
            <Text style={{ color: c.foregroundMuted, fontSize: 12, marginTop: 2 }}>
              {host.label} ({hostInfo.name}) · RAM {hostInfo.memTotalMb - hostInfo.memAvailMb}/{hostInfo.memTotalMb} MB used · swap {hostInfo.swapUsedMb}/{hostInfo.swapTotalMb} MB · load {hostInfo.load1}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {button(agents.isFetching ? "Refreshing…" : "Refresh", refresh, { disabled: agents.isFetching })}
          {button(
            "Release all idle",
            () =>
              setConfirm({
                title: "Release all idle sessions?",
                body: `${releasable.length} ${releasable.length === 1 ? "process" : "processes"} will be killed, freeing about ${releasableMb} MB. Agents stay in your list and restart on the next prompt. Running and busy agents are skipped.`,
                label: "Release all",
                run: () => killAll.mutate(),
              }),
            { danger: true, disabled: busy || releasable.length === 0 },
          )}
        </View>
      </View>

      <AutoRelease c={c} />

      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search name or folder"
          placeholderTextColor={c.foregroundMuted}
          style={{ minWidth: 160, flexGrow: 1, maxWidth: compact ? undefined : 320, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.border, color: c.foreground, backgroundColor: c.surface1, fontSize: 13 }}
        />
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            accessibilityRole="button"
            accessibilityLabel={`Filter ${f}`}
            onPress={() => setFilter(f)}
            style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: filter === f ? c.accent : c.border, backgroundColor: filter === f ? c.accent : "transparent" }}
          >
            <Text style={{ color: filter === f ? c.accentForeground : c.foregroundMuted, fontSize: 12 }}>
              {f} ({f === "all" ? allRows.length : f === "live" ? live.length : allRows.filter((a) => a.status === f).length})
            </Text>
          </Pressable>
        ))}
      </View>

      {notice && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notice"
          onPress={() => setNotice(null)}
          style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, padding: 10, borderRadius: 6, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border }}
        >
          <Text style={{ color: c.foreground, fontSize: 13, flexShrink: 1 }}>{notice}</Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>✕</Text>
        </Pressable>
      )}

      <Modal transparent animationType="fade" visible={confirm !== null} onRequestClose={() => setConfirm(null)}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)", padding: 16 }}>
          <View style={{ width: "100%", maxWidth: 420, padding: 20, gap: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1 }}>
            <Text style={{ color: c.foreground, fontSize: 16, fontWeight: "600" }}>{confirm?.title}</Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>{confirm?.body}</Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              {button("Cancel", () => setConfirm(null), { disabled: false })}
              {button(confirm?.label ?? "OK", () => { const run = confirm?.run; setConfirm(null); run?.(); }, { danger: true, disabled: false })}
            </View>
          </View>
        </View>
      </Modal>

      <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, overflow: "hidden", backgroundColor: c.surface1 }}>
        {!compact && (
          <View style={{ flexDirection: "row", paddingVertical: 10, backgroundColor: c.surface2 }}>
            {head("Agent", 5)}
            {head("Provider", 2)}
            {head("Status", 2)}
            {head("Idle", 2, "right")}
            {head("Uptime", 2, "right")}
            {head("Memory", 2, "right")}
            {head("", 2, "right")}
          </View>
        )}
        {rows.length === 0 && (
          <Text style={{ color: c.foregroundMuted, padding: 16, fontSize: 13 }}>
            {agents.isLoading ? "Loading…" : allRows.length ? "No agents match the filter." : "No agents."}
          </Text>
        )}
        {rows.map(compact ? card : row)}
      </View>
    </ScrollView>
  );
}

function AutoRelease({ c }: { c: PluginSurfaceProps["theme"]["colors"] }) {
  const settings = useSettings(autoReleaseSettings);
  if (settings.status !== "ready") {
    return (
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
        Auto-release: {settings.status === "loading" ? "loading…" : "unavailable"}
      </Text>
    );
  }
  const { enabled, idleMinutes } = settings.values;
  const save = (next: { enabled: boolean; idleMinutes: number }) => void settings.save(next, settings.revision);
  const small = (label: string, onPress: () => void, active = false, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || settings.saving}
      onPress={onPress}
      style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: active ? c.accent : c.border, backgroundColor: active ? c.accent : c.surface2, opacity: disabled || settings.saving ? 0.45 : 1 }}
    >
      <Text style={{ color: active ? c.accentForeground : c.foreground, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ padding: 10, gap: 6, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Text style={{ color: c.foreground, fontSize: 13 }}>Auto-release idle sessions</Text>
        {small(enabled ? "On" : "Off", () => save({ enabled: !enabled, idleMinutes }), enabled)}
        <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>after</Text>
        {small("−", () => save({ enabled, idleMinutes: Math.max(5, idleMinutes - 5) }), false, idleMinutes <= 5)}
        <Text style={{ color: c.foreground, fontSize: 13 }}>{idleMinutes} min</Text>
        {small("+", () => save({ enabled, idleMinutes: Math.min(1440, idleMinutes + 5) }), false, idleMinutes >= 1440)}
      </View>
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
        Skips running and busy agents. Idle time counts from when the plugin first saw the agent idle.
      </Text>
      {settings.saveError && <Text style={{ color: c.statusDanger, fontSize: 12 }}>{settings.saveError}</Text>}
    </View>
  );
}
