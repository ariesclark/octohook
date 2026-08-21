import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Delivery, Note } from "./state.ts";
import { apply, emptyWorld, ownerOf } from "./state.ts";

function delivery(event: string, action: string | null, payload: object, at = "01:00"): Delivery {
  return { event, action, delivered_at: at, payload: payload as Record<string, never> };
}

function checkRun(name: string, conclusion: string | null, extra: object = {}) {
  return {
    check_run: {
      name,
      html_url: `https://github.com/o/r/actions/runs/1/job/${name}`,
      head_sha: "abc1234",
      conclusion,
      started_at: null,
      completed_at: null,
      check_suite: { head_branch: "main" },
      app: { name: "GitHub Actions" },
      ...extra,
    },
  };
}

describe("apply", () => {
  test("adds a job to the run it belongs to", () => {
    const world = emptyWorld();
    const changed = apply(world, delivery("check_run", "created", checkRun("build", null)), {
      runId: "7",
    });

    assert.equal(changed, "added job build → running");
    assert.equal(world.runs.get("7")!.jobs.length, 1);
    assert.equal(world.runs.get("7")!.jobs[0]!.conclusion, null);
    assert.equal(world.runs.get("7")!.sha, "abc1234");
  });

  test("replaces a job rather than repeating it", () => {
    const world = emptyWorld();
    apply(world, delivery("check_run", "created", checkRun("build", null)), { runId: "7" });
    const changed = apply(world, delivery("check_run", "completed", checkRun("build", "success")), {
      runId: "7",
    });

    assert.equal(changed, "updated job build → success");
    assert.equal(world.runs.get("7")!.jobs.length, 1);
    assert.equal(world.runs.get("7")!.jobs[0]!.conclusion, "success");
  });

  // GitHub delivers `created` after `completed` for some jobs; a verdict must survive it.
  test("never takes back a verdict a later event does not have", () => {
    const world = emptyWorld();
    apply(world, delivery("check_run", "completed", checkRun("build", "failure")), { runId: "7" });
    const changed = apply(world, delivery("check_run", "created", checkRun("build", null)), {
      runId: "7",
    });

    assert.equal(changed, "");
    assert.equal(world.runs.get("7")!.jobs[0]!.conclusion, "failure");
  });

  test("keeps one row per deployment however many states it reports", () => {
    const world = emptyWorld();

    apply(
      world,
      delivery("deployment", "created", {
        deployment: { id: 5, environment: "canary", sha: "abc1234" },
      }),
      { runId: "7" },
    );

    const changed = apply(
      world,
      delivery("deployment_status", "created", {
        deployment: { id: 5, environment: "canary", sha: "abc1234" },
        deployment_status: {
          state: "success",
          environment: "canary",
          environment_url: "https://abc1234.example.dev",
        },
      }),
      { runId: "7" },
    );

    const { deployments } = world.runs.get("7")!;

    assert.equal(changed, "updated deployment 5 → success at abc1234.example.dev");
    assert.equal(deployments.length, 1);
    assert.equal(deployments[0]!.state, "success");
    assert.equal(deployments[0]!.place, "abc1234.example.dev");
  });

  test("names a deployment by its environment until it has a host", () => {
    const world = emptyWorld();
    apply(
      world,
      delivery("deployment", "created", {
        deployment: { id: 5, environment: "canary", sha: "abc1234" },
      }),
      { runId: "7" },
    );

    assert.equal(world.runs.get("7")!.deployments[0]!.place, "canary");
    assert.equal(world.runs.get("7")!.deployments[0]!.state, "pending");
  });

  test("settles a run when its suite reports", () => {
    const world = emptyWorld();
    const changed = apply(
      world,
      delivery("check_suite", "completed", {
        check_suite: { conclusion: "success", head_sha: "abc1234", head_branch: "main" },
      }),
      { runId: "7" },
    );

    assert.equal(changed, "suite settled → success");
    assert.equal(world.runs.get("7")!.settled, "success");
  });

  test("remembers a push against the commit it landed", () => {
    const world = emptyWorld();
    const changed = apply(world, delivery("push", null, { after: "abc1234" }), {
      content: { components: [] },
    });

    assert.equal(changed, "noted push");
    assert.equal(world.notes.length, 1);
    assert.equal(world.notes[0]!.sha, "abc1234");
  });

  test("changes nothing for an event with nowhere to go", () => {
    const world = emptyWorld();
    const changed = apply(world, delivery("check_run", "created", checkRun("build", null)), {});

    assert.equal(changed, "");
    assert.equal(world.runs.size, 0);
    assert.equal(world.notes.length, 0);
  });
});

describe("ownerOf", () => {
  const note = (key: string, kind: string, sha?: string): Note => ({
    key,
    kind,
    sha,
    at: key,
    content: {},
  });

  const run = (trigger: string, sha = "abc") => ({
    sha,
    run: { name: "w", runNumber: 1, trigger },
  });

  const notes = [note("a", "push", "abc"), note("b", "pull_request", "abc")];

  test("gives a push-triggered run to the push", () => {
    assert.equal(ownerOf(notes, run("push"))!.key, "a");
  });

  test("gives a pull-request-triggered run to the pull request", () => {
    assert.equal(ownerOf(notes, run("pull_request"))!.key, "b");
  });

  // Order of arrival must not decide it: a push often lands after the pull request it updated.
  test("does not let arrival order move a run to the wrong note", () => {
    const reversed = [note("b", "pull_request", "abc"), note("a", "push", "abc")];

    assert.equal(ownerOf(reversed, run("push"))!.key, "a");
    assert.equal(ownerOf(reversed, run("pull_request"))!.key, "b");
  });

  // Without this a scheduled run gathers under whatever sits at the head of the branch.
  test("gives a run nothing in the channel asked for to nobody", () => {
    assert.equal(ownerOf(notes, run("schedule")), undefined);
    assert.equal(ownerOf(notes, run("issues")), undefined);
    assert.equal(ownerOf(notes, run("dynamic")), undefined);
  });

  test("gives a run to nobody when nothing names its commit", () => {
    assert.equal(ownerOf(notes, run("push", "other")), undefined);
    assert.equal(ownerOf(notes, { sha: undefined, run: undefined }), undefined);
  });
});
