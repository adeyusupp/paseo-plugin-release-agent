import assert from "node:assert/strict";
import { test } from "node:test";
import { dueForAutoRelease, releaseBlocker } from "./policy.ts";

test("running agents are never releasable, even forced", () => {
  assert.match(releaseBlocker("running", false, true) ?? "", /running/);
  assert.match(releaseBlocker("initializing", false, false) ?? "", /initializing/);
});

test("idle agent with background processes needs force", () => {
  assert.match(releaseBlocker("idle", true, false) ?? "", /background/);
  assert.equal(releaseBlocker("idle", true, true), null);
  assert.equal(releaseBlocker("error", false, false), null);
});

test("auto-release waits for the full idle threshold", () => {
  const now = 10 * 60_000;
  assert.equal(dueForAutoRelease(undefined, now, 5), false);
  assert.equal(dueForAutoRelease(now - 4 * 60_000, now, 5), false);
  assert.equal(dueForAutoRelease(now - 5 * 60_000, now, 5), true);
});
