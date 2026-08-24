import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Delivery, Note } from "./state.ts";
import { apply, emptyWorld, forget, ownerOf } from "./state.ts";

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

function workflowRun(conclusion: string | null, extra: object = {}) {
  return {
    workflow_run: {
      id: 14244,
      name: "Bot",
      run_number: 14244,
      event: "schedule",
      conclusion,
      head_sha: "abc1234",
      head_branch: "main",
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

  test("gives a deployment nowhere to visit until a host says so", () => {
    const world = emptyWorld();
    const job = "https://github.com/o/r/actions/runs/1/job/2";

    apply(
      world,
      delivery("deployment_status", "created", {
        deployment: { id: 5, environment: "canary", sha: "abc1234" },
        deployment_status: {
          state: "success",
          environment: "canary",
          environment_url: "",
          target_url: job,
          log_url: job,
        },
      }),
      { runId: "7" },
    );

    const [deployment] = world.runs.get("7")!.deployments;

    assert.equal(deployment!.url, undefined);
    assert.equal(deployment!.place, "canary");
    assert.equal(deployment!.jobUrl, job);
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

  test("folds a workflow run into the run its checks already built", () => {
    const world = emptyWorld();
    apply(world, delivery("check_run", "completed", checkRun("build", "success")), {
      runId: "14244",
    });

    const changed = apply(world, delivery("workflow_run", "completed", workflowRun("success")), {
      runId: "14244",
    });

    const entry = world.runs.get("14244")!;

    assert.equal(changed, "run settled → success");
    assert.equal(world.runs.size, 1);
    assert.equal(world.notes.length, 0);
    assert.equal(entry.settled, "success");
    assert.equal(entry.jobs.length, 1);
  });

  test("takes a run's name, number and trigger off the event rather than a lookup", () => {
    const world = emptyWorld();
    apply(world, delivery("workflow_run", "completed", workflowRun("failure")), {
      runId: "14244",
    });

    const entry = world.runs.get("14244")!;

    assert.deepEqual(entry.run, { name: "Bot", runNumber: 14244, trigger: "schedule" });
    assert.equal(entry.sha, "abc1234");
    assert.equal(entry.branch, "main");
  });

  test("keeps the name a lookup already found when the event repeats it", () => {
    const world = emptyWorld();
    apply(world, delivery("check_run", "completed", checkRun("build", "success")), {
      runId: "14244",
      run: { name: "Bot", runNumber: 14244, trigger: "schedule" },
    });

    apply(world, delivery("workflow_run", "completed", workflowRun("success")), { runId: "14244" });

    assert.deepEqual(world.runs.get("14244")!.run, {
      name: "Bot",
      runNumber: 14244,
      trigger: "schedule",
    });
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

  test("remembers a redelivered note once", () => {
    const world = emptyWorld();
    const again = () =>
      apply(world, delivery("push", null, { after: "abc1234" }, "2026-08-21T01:00:00Z"), {
        content: { components: [{ content: "pushed" }] },
      });

    assert.equal(again(), "noted push");
    assert.equal(again(), "");
    assert.equal(world.notes.length, 1);
  });

  test("takes the newer rendering of a note it already has", () => {
    const world = emptyWorld();
    const at = "2026-08-21T01:00:00Z";

    apply(world, delivery("push", null, { after: "abc1234" }, at), { content: { components: [] } });
    apply(world, delivery("push", null, { after: "abc1234" }, at), {
      content: { components: [{ content: "now with a name" }] },
    });

    assert.deepEqual(world.notes[0]!.content, { components: [{ content: "now with a name" }] });
  });

  test("changes nothing for an event with nowhere to go", () => {
    const world = emptyWorld();
    const changed = apply(world, delivery("check_run", "created", checkRun("build", null)), {});

    assert.equal(changed, "");
    assert.equal(world.runs.size, 0);
    assert.equal(world.notes.length, 0);
  });
});

describe("apply, across repositories", () => {
  const repository = {
    name: "flirtual",
    full_name: "flirtual/flirtual",
    html_url: "https://g/f/f",
  };

  test("remembers which repository a run is from", () => {
    const world = emptyWorld();
    apply(world, delivery("check_run", "created", { ...checkRun("build", null), repository }), {
      runId: "7",
    });

    assert.deepEqual(world.runs.get("7")!.repository, repository);
  });

  test("remembers which repository a note is from", () => {
    const world = emptyWorld();
    apply(world, delivery("push", null, { after: "abc1234", repository }), {
      content: { components: [] },
    });

    assert.deepEqual(world.notes[0]!.repository, repository);
  });
});

describe("forget", () => {
  const at = (hour: string) => `2026-08-21T${hour}:00:00Z`;

  function world() {
    const built = emptyWorld();

    apply(built, delivery("push", null, { after: "old" }, at("01")), {
      content: { components: [] },
    });
    apply(built, delivery("push", null, { after: "new" }, at("09")), {
      content: { components: [] },
    });

    apply(built, delivery("check_run", "completed", checkRun("build", "success"), at("01")), {
      runId: "old-run",
    });
    apply(built, delivery("check_run", "completed", checkRun("build", "success"), at("09")), {
      runId: "new-run",
    });

    return built;
  }

  test("drops what stopped reporting before the cutoff", () => {
    const built = world();
    const dropped = forget(built, at("05"));

    assert.deepEqual(dropped.sort(), ["push.:2026-08-21T01:00:00Z", "run:old-run"]);
    assert.equal(built.runs.has("old-run"), false);
    assert.equal(built.runs.has("new-run"), true);
    assert.deepEqual(
      built.notes.map(({ sha }) => sha),
      ["new"],
    );
  });

  test("keeps a run that is still reporting, however old its first job", () => {
    const built = world();
    apply(built, delivery("check_run", "completed", checkRun("test", "success"), at("09")), {
      runId: "old-run",
    });

    assert.deepEqual(forget(built, at("05")), ["push.:2026-08-21T01:00:00Z"]);
    assert.equal(built.runs.has("old-run"), true);
  });

  test("keeps a note a surviving run still belongs to", () => {
    const built = emptyWorld();

    apply(built, delivery("push", null, { after: "abc1234" }, at("01")), {
      content: { components: [] },
    });
    apply(built, delivery("check_run", "completed", checkRun("build", "success"), at("09")), {
      runId: "7",
      run: { name: "w", runNumber: 1, trigger: "push" },
    });

    assert.deepEqual(forget(built, at("05")), []);
    assert.equal(built.notes.length, 1);
  });

  test("keeps what happened long ago but only arrived now", () => {
    const built = emptyWorld();
    const arrived = at("09");

    apply(
      built,
      { ...delivery("push", null, { after: "old" }, at("01")), received_at: arrived },
      {
        content: { components: [] },
      },
    );
    apply(
      built,
      {
        ...delivery("check_run", "completed", checkRun("build", "success"), at("01")),
        received_at: arrived,
      },
      {
        runId: "old-run",
      },
    );

    assert.deepEqual(forget(built, at("05")), []);
    assert.equal(built.runs.has("old-run"), true);
    assert.equal(built.notes.length, 1);
  });

  test("drops nothing when everything is newer than the cutoff", () => {
    const built = world();
    assert.deepEqual(forget(built, at("00")), []);
    assert.equal(built.runs.size, 2);
    assert.equal(built.notes.length, 2);
  });
});

describe("ownerOf", () => {
  const note = (key: string, kind: string, sha?: string): Note => ({
    key,
    seen: key,
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

  test("does not let arrival order move a run to the wrong note", () => {
    const reversed = [note("b", "pull_request", "abc"), note("a", "push", "abc")];

    assert.equal(ownerOf(reversed, run("push"))!.key, "a");
    assert.equal(ownerOf(reversed, run("pull_request"))!.key, "b");
  });

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
