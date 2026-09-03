import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Delivery, Note } from "./state.ts";
import { apply, emptyWorld, forget, ownerOf, unswept, watching } from "./state.ts";

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
      run_started_at: "2026-08-24T01:00:00Z",
      updated_at: "2026-08-24T01:00:17Z",
      ...extra,
    },
  };
}

describe("which note a run belongs to", () => {
  const pushNote = (at: string, ref: string): Note => ({
    key: `push.:${at}`,
    at,
    seen: at,
    kind: "push",
    sha: "abc1234",
    facts: { ref },
    content: {},
  });

  // One commit reached the channel three times here: a branch, main, then a tag cut from it.
  test("belongs to the push that named the ref it ran on, not the last to arrive", () => {
    const notes = [
      pushNote("2026-08-31T06:25:10Z", "main"),
      pushNote("2026-08-31T06:26:44Z", "v1.20.9"),
    ];

    const owner = ownerOf(notes, { sha: "abc1234", cause: "push", branch: "main" });

    assert.equal(owner?.key, "push.:2026-08-31T06:25:10Z");
  });

  test("falls back to the latest when no note names the branch it ran on", () => {
    const notes = [
      pushNote("2026-08-31T06:25:10Z", "v1.0.0"),
      pushNote("2026-08-31T06:26:44Z", "v1.1.0"),
    ];

    const owner = ownerOf(notes, { sha: "abc1234", cause: "push", branch: "main" });

    assert.equal(owner?.key, "push.:2026-08-31T06:26:44Z");
  });
});

describe("a run being told what it is doing", () => {
  const workflowRun = (action: string, conclusion: string | null) => ({
    event: "workflow_run",
    action,
    delivered_at: "2026-08-29T10:51:31Z",
    payload: {
      workflow_run: {
        id: 1,
        name: "Renovate",
        run_number: 4,
        event: "schedule",
        conclusion,
        head_sha: "abc1234",
        head_branch: "main",
      },
      repository: { name: "flirtual", html_url: "https://g/f" },
    } as never,
  });

  // A run that has only been asked for has reached no verdict; that is not the same as having none.
  test("is not settled by being requested", () => {
    const world = emptyWorld();

    apply(world, workflowRun("requested", null), { runId: "1" });

    assert.equal(world.runs.get("1")!.settled, undefined);
  });

  test("keeps the verdict it reached when a later say carries none", () => {
    const world = emptyWorld();

    apply(world, workflowRun("completed", "success"), { runId: "1" });
    apply(world, workflowRun("in_progress", null), { runId: "1" });

    assert.equal(world.runs.get("1")!.settled, "success");
  });

  test("still settles when it completes", () => {
    const world = emptyWorld();

    apply(world, workflowRun("completed", "failure"), { runId: "1" });

    assert.equal(world.runs.get("1")!.settled, "failure");
  });

  test("settles with no verdict when it completes without one", () => {
    const world = emptyWorld();

    apply(world, workflowRun("completed", null), { runId: "1" });

    assert.equal(world.runs.get("1")!.settled, null);
  });
});

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
    assert.equal(entry.startedAt, "2026-08-24T01:00:00Z");
    assert.equal(entry.completedAt, "2026-08-24T01:00:17Z");
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

  // GitHub creates a `dynamic` run under a placeholder and renames it once the agent has a title.
  test("takes the name a later event carries, since GitHub renames a run under way", () => {
    const world = emptyWorld();
    apply(
      world,
      delivery(
        "workflow_run",
        "in_progress",
        workflowRun(null, { name: "dynamic", event: "dynamic" }),
      ),
      { runId: "14244" },
    );

    apply(
      world,
      delivery(
        "workflow_run",
        "completed",
        workflowRun("success", { name: "Running Copilot Code Review", event: "dynamic" }),
      ),
      { runId: "14244" },
    );

    assert.deepEqual(world.runs.get("14244")!.run, {
      name: "Running Copilot Code Review",
      runNumber: 14244,
      trigger: "dynamic",
    });
  });

  test("keeps the name it holds when a later event names nothing", () => {
    const world = emptyWorld();
    apply(world, delivery("workflow_run", "in_progress", workflowRun(null)), { runId: "14244" });

    apply(world, delivery("workflow_run", "completed", workflowRun("success", { name: "" })), {
      runId: "14244",
    });

    assert.equal(world.runs.get("14244")!.run!.name, "Bot");
  });

  test("remembers that a run went wrong once, however green it goes after", () => {
    const world = emptyWorld();
    apply(world, delivery("check_run", "completed", checkRun("build", "failure")), {
      runId: "14244",
    });

    assert.equal(world.runs.get("14244")!.alarmed, true);

    apply(world, delivery("check_run", "completed", checkRun("build", "success")), {
      runId: "14244",
    });

    assert.equal(world.runs.get("14244")!.alarmed, true);
  });

  test("leaves a run that never went wrong unmarked", () => {
    const world = emptyWorld();
    apply(world, delivery("check_run", "completed", checkRun("build", "success")), {
      runId: "14244",
    });
    apply(world, delivery("workflow_run", "completed", workflowRun("success")), { runId: "14244" });

    assert.equal(world.runs.get("14244")!.alarmed, undefined);
  });

  test("marks a run its own verdict condemns", () => {
    const world = emptyWorld();
    apply(world, delivery("workflow_run", "completed", workflowRun("timed_out")), {
      runId: "14244",
    });

    assert.equal(world.runs.get("14244")!.alarmed, true);
  });

  test("does not time a run that is still going", () => {
    const world = emptyWorld();
    apply(
      world,
      delivery("workflow_run", "in_progress", workflowRun(null, { status: "in_progress" })),
      { runId: "14244" },
    );

    const entry = world.runs.get("14244")!;

    assert.equal(entry.startedAt, "2026-08-24T01:00:00Z");
    assert.equal(entry.completedAt, undefined);
  });

  test("takes back a clock a run has outgrown", () => {
    const world = emptyWorld();
    apply(world, delivery("workflow_run", "completed", workflowRun("success")), { runId: "14244" });

    assert.equal(world.runs.get("14244")!.completedAt, "2026-08-24T01:00:17Z");

    apply(world, delivery("workflow_run", "in_progress", workflowRun(null)), { runId: "14244" });

    assert.equal(world.runs.get("14244")!.completedAt, undefined);
  });

  test("remembers which step a job is on", () => {
    const world = emptyWorld();
    apply(world, delivery("check_run", "created", checkRun("build", null)), { runId: "14244" });

    const changed = apply(
      world,
      delivery("workflow_job", "in_progress", {
        workflow_job: {
          run_id: 14244,
          name: "build",
          status: "in_progress",
          conclusion: null,
          html_url: "https://github.com/o/r/actions/runs/14244/job/1",
          started_at: "2026-08-24T01:00:00Z",
          completed_at: null,
          steps: [
            { name: "Set up job", number: 1, status: "completed", conclusion: "success" },
            { name: "Run pnpm install", number: 2, status: "in_progress", conclusion: null },
          ],
        },
      }),
      { runId: "14244" },
    );

    assert.equal(changed, "build is on Run pnpm install");
    assert.equal(world.runs.get("14244")!.jobs[0]!.step, "Run pnpm install");
  });

  test("forgets the step once the job is done with it", () => {
    const world = emptyWorld();
    apply(world, delivery("check_run", "created", checkRun("build", null)), { runId: "14244" });

    apply(
      world,
      delivery("workflow_job", "completed", {
        workflow_job: {
          run_id: 14244,
          name: "build",
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/o/r/actions/runs/14244/job/1",
          started_at: "2026-08-24T01:00:00Z",
          completed_at: "2026-08-24T01:00:20Z",
          steps: [{ name: "Set up job", number: 1, status: "completed", conclusion: "success" }],
        },
      }),
      { runId: "14244" },
    );

    assert.equal(world.runs.get("14244")!.jobs[0]!.step, undefined);
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

describe("a check no workflow owns", () => {
  const note = (key: string, kind: string, sha?: string): Note => ({
    key,
    seen: key,
    kind,
    sha,
    at: key,
    content: {},
  });

  const app = (over: object = {}) => ({
    check_run: {
      name: "CodeQL",
      html_url: "https://github.com/o/r/runs/97940500970",
      head_sha: "abc1234",
      conclusion: "neutral",
      started_at: null,
      completed_at: null,
      app: { name: "GitHub Advanced Security" },
      pull_requests: [{ number: 288 }],
      ...over,
    },
  });

  test("takes the pull request the check names as its cause", () => {
    const world = emptyWorld();
    apply(world, delivery("check_run", "completed", app()), { runId: "suite-89099420345" });

    assert.equal(world.runs.get("suite-89099420345")!.cause, "pull_request");
  });

  test("names no cause when the check names no pull request", () => {
    const world = emptyWorld();
    apply(world, delivery("check_run", "completed", app({ pull_requests: [] })), { runId: "s" });

    assert.equal(world.runs.get("s")!.cause, undefined);
  });

  test("leaves a workflow run to say what set it off", () => {
    const world = emptyWorld();
    apply(world, delivery("check_run", "completed", checkRun("build", "success")), {
      runId: "7",
      run: { name: "w", runNumber: 1, trigger: "schedule" },
    });

    assert.equal(world.runs.get("7")!.cause, undefined);
  });

  test("gives a check its pull request, once it has one to give it to", () => {
    const notes = [note("a", "pull_request", "abc1234")];

    assert.equal(ownerOf(notes, { sha: "abc1234", cause: "pull_request" })!.key, "a");
  });

  test("still gives a run with a trigger to the note that matches it", () => {
    const notes = [note("a", "push", "abc1234"), note("b", "pull_request", "abc1234")];

    assert.equal(
      ownerOf(notes, { sha: "abc1234", run: { name: "w", runNumber: 1, trigger: "push" } })!.key,
      "a",
    );
  });

  test("gives a check with no cause to nobody", () => {
    const notes = [note("a", "pull_request", "abc1234")];

    assert.equal(ownerOf(notes, { sha: "abc1234" }), undefined);
  });
});

describe("watching", () => {
  const somewhere = { name: "r", full_name: "o/r", html_url: "https://github.com/o/r" };

  test("watches a run whose job has not finished", () => {
    const world = emptyWorld();
    apply(
      world,
      delivery("check_run", "created", { ...checkRun("build", null), repository: somewhere }),
      { runId: "14244" },
    );

    assert.deepEqual(
      watching(world).map(({ id }) => id),
      ["14244"],
    );
  });

  test("stops watching once every job has a verdict, and the run has one too", () => {
    const world = emptyWorld();
    apply(
      world,
      delivery("check_run", "completed", {
        ...checkRun("build", "success"),
        repository: somewhere,
      }),
      { runId: "14244" },
    );

    apply(
      world,
      delivery("check_suite", "completed", {
        check_suite: { conclusion: "success" },
        repository: somewhere,
      }),
      { runId: "14244" },
    );

    assert.deepEqual(watching(world), []);
  });

  function finished(annotations: unknown) {
    const world = emptyWorld();
    apply(
      world,
      delivery("check_run", "completed", {
        ...checkRun("build", "failure", { id: 100504953271 }),
        repository: somewhere,
      }),
      { runId: "14244", annotations: annotations as never },
    );

    apply(
      world,
      delivery("check_suite", "completed", {
        check_suite: { conclusion: "success" },
        repository: somewhere,
      }),
      { runId: "14244" },
    );

    return world;
  }

  test("keeps a finished run in view while GitHub has filed no annotations under it", () => {
    assert.deepEqual(
      watching(finished(undefined)).map(({ id }) => id),
      ["14244"],
    );
  });

  test("keeps it in view when the ask came back empty, which a late annotation still contradicts", () => {
    assert.deepEqual(
      watching(finished([])).map(({ id }) => id),
      ["14244"],
    );
  });

  test("lets it go once something was filed", () => {
    const annotation = { path: "a.cs", startLine: 1, level: "warning", title: null, message: "m" };

    assert.deepEqual(watching(finished([annotation])), []);
  });

  test("lets it go once swept, so a job with nothing to say is asked only the once", () => {
    const world = finished([]);
    for (const entry of world.runs.values()) entry.swept = true;

    assert.deepEqual(watching(world), []);
    assert.deepEqual(unswept([...world.runs.values()][0]!), []);
  });

  test("watches a run still owed a verdict, which no job of its own will bring", () => {
    const world = emptyWorld();
    apply(
      world,
      delivery("workflow_run", "requested", { ...workflowRun(null), repository: somewhere }),
      { runId: "14244" },
    );

    assert.deepEqual(
      watching(world).map(({ id }) => id),
      ["14244"],
    );
  });

  test("keeps watching a run held for approval, which is a wait and not a verdict", () => {
    const world = emptyWorld();
    apply(
      world,
      delivery("workflow_run", "completed", {
        ...workflowRun("action_required"),
        repository: somewhere,
      }),
      { runId: "14244" },
    );

    assert.deepEqual(
      watching(world).map(({ id }) => id),
      ["14244"],
    );
  });

  test("lets a run go once it reaches a verdict of its own", () => {
    const world = emptyWorld();
    apply(
      world,
      delivery("workflow_run", "completed", { ...workflowRun("success"), repository: somewhere }),
      { runId: "14244" },
    );

    assert.deepEqual(watching(world), []);
  });

  test("does not watch a run nothing has reported a job for", () => {
    const world = emptyWorld();
    apply(
      world,
      delivery("workflow_run", "completed", { ...workflowRun(null), repository: somewhere }),
      { runId: "14244" },
    );

    assert.deepEqual(watching(world), []);
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

describe("checks that gathered under a suite of their own", () => {
  const somewhere = { name: "r", full_name: "o/r", html_url: "https://github.com/o/r" };

  function stray() {
    const world = emptyWorld();

    apply(
      world,
      delivery("check_run", "completed", {
        ...checkRun("build", "failure", { id: 7 }),
        repository: somewhere,
      }),
      { runId: "suite-5" },
    );

    return world;
  }

  test("are handed to the workflow run once GitHub owns up to one", () => {
    const world = stray();

    apply(
      world,
      delivery("workflow_run", "completed", {
        ...workflowRun("failure", { check_suite_id: 5, name: "CI", event: "push" }),
        repository: somewhere,
      }),
      { runId: "14244" },
    );

    assert.deepEqual([...world.runs.keys()], ["14244"]);
    assert.deepEqual(
      world.runs.get("14244")!.jobs.map(({ name }) => name),
      ["build"],
    );
  });

  test("keep the verdict they already reached, so the board does not go quiet", () => {
    const world = stray();

    apply(
      world,
      delivery("workflow_run", "completed", {
        ...workflowRun("success", { check_suite_id: 5, name: "CI", event: "push" }),
        repository: somewhere,
      }),
      { runId: "14244" },
    );

    assert.equal(world.runs.get("14244")!.alarmed, true);
  });

  test("are left alone by a workflow run belonging to another suite", () => {
    const world = stray();

    apply(
      world,
      delivery("workflow_run", "completed", {
        ...workflowRun("failure", { check_suite_id: 9, name: "CI", event: "push" }),
        repository: somewhere,
      }),
      { runId: "14244" },
    );

    assert.deepEqual([...world.runs.keys()].sort(), ["14244", "suite-5"]);
  });
});

describe("a run that was held for approval", () => {
  const somewhere = { name: "r", full_name: "o/r", html_url: "https://github.com/o/r" };

  test("stops being held once it is under way again", () => {
    const world = emptyWorld();

    apply(
      world,
      delivery("workflow_run", "completed", {
        ...workflowRun("action_required"),
        repository: somewhere,
      }),
      { runId: "14244" },
    );

    apply(
      world,
      delivery("workflow_run", "in_progress", { ...workflowRun(null), repository: somewhere }),
      { runId: "14244" },
    );

    assert.equal(world.runs.get("14244")!.settled, undefined);
  });

  test("keeps a verdict it already reached when it starts over", () => {
    const world = emptyWorld();

    apply(
      world,
      delivery("workflow_run", "completed", { ...workflowRun("failure"), repository: somewhere }),
      { runId: "14244" },
    );

    apply(
      world,
      delivery("workflow_run", "in_progress", { ...workflowRun(null), repository: somewhere }),
      { runId: "14244" },
    );

    assert.equal(world.runs.get("14244")!.settled, "failure");
  });
});

describe("how long a run took", () => {
  const somewhere = { name: "r", full_name: "o/r", html_url: "https://github.com/o/r" };

  const started = (
    at: string | undefined,
    action = "completed",
    conclusion: string | null = null,
  ) =>
    delivery("workflow_run", action, {
      ...workflowRun(conclusion, { run_started_at: at }),
      repository: somewhere,
    });

  test("is counted from when it got going, not from when it was first asked for", () => {
    const world = emptyWorld();

    apply(world, started("2026-09-03T07:25:22Z", "requested"), { runId: "14244" });
    apply(world, started("2026-09-03T08:23:44Z", "completed", "success"), { runId: "14244" });

    assert.equal(world.runs.get("14244")!.startedAt, "2026-09-03T08:23:44Z");
  });

  test("keeps the start it knows when a later event names none", () => {
    const world = emptyWorld();

    apply(world, started("2026-09-03T07:25:22Z", "requested"), { runId: "14244" });
    apply(world, started(undefined, "completed", "success"), { runId: "14244" });

    assert.equal(world.runs.get("14244")!.startedAt, "2026-09-03T07:25:22Z");
  });
});
