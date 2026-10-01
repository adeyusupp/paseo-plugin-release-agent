const RELEASABLE = new Set(["idle", "error"]);

// Returns why the session must not be killed, or null. Status is never overridable by force.
export function releaseBlocker(status: string, busy: boolean, force: boolean): string | null {
  if (!RELEASABLE.has(status)) return `status is ${status}`;
  if (busy && !force) return "has background processes";
  return null;
}

export function dueForAutoRelease(idleSince: number | undefined, now: number, idleMinutes: number): boolean {
  return idleSince !== undefined && now - idleSince >= idleMinutes * 60_000;
}
