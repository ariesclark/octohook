import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { wrong } from "./verdict.ts";
import type { Run } from "./state.ts";

function run(trigger: string | undefined, over: Partial<Run> = {}): Run {
  return {
    id: "14244",
    at: "2026-08-24T01:00:00Z",
    seen: "2026-08-24T01:00:00Z",
    run: trigger ? { name: "Bot", runNumber: 14244, trigger } : undefined,
    jobs: [],
    deployments: [],
    ...over,
  };
}

function job(conclusion: string | null) {
  return {
    name: conclusion ?? "running",
    url: "u",
    conclusion,
    startedAt: null,
    completedAt: null,
  };
}

describe("wrong", () => {
  test("knows a run that broke", () => {
    assert.equal(wrong(run("schedule", { jobs: [job("failure")] })), true);
    assert.equal(wrong(run("schedule", { jobs: [job("timed_out")] })), true);
    assert.equal(wrong(run("schedule", { jobs: [job("action_required")] })), true);
    assert.equal(wrong(run("schedule", { jobs: [job("startup_failure")] })), true);
  });

  test("reads a verdict no job reported", () => {
    assert.equal(wrong(run("schedule", { settled: "failure" })), true);
    assert.equal(wrong(run("schedule", { jobs: [job("success")], settled: "timed_out" })), true);
  });

  test("knows a deployment that sank", () => {
    const deployments = [{ id: 1, state: "failure", place: "production" }];

    assert.equal(wrong(run("schedule", { deployments })), true);
  });

  test("leaves work that went fine alone", () => {
    assert.equal(wrong(run("schedule", { jobs: [job("success")] })), false);
    assert.equal(wrong(run("schedule", { jobs: [job(null)] })), false);
    assert.equal(wrong(run("schedule", { settled: "success" })), false);
  });

  test("lets a superseded run go quietly", () => {
    assert.equal(wrong(run("schedule", { jobs: [job("cancelled")] })), false);
  });
});
