import { describe, expect, it } from "vitest";

import { compose } from "../src/compose";
import { apply, emptyWorld, type World } from "../src/state";

const repository = { name: "wiki-bot", full_name: "o/wiki-bot", html_url: "https://g/o/wiki-bot" };

function checkRun(conclusion: string | null) {
  return {
    check_run: {
      name: "run",
      html_url: "https://g/o/wiki-bot/actions/runs/14244/job/1",
      head_sha: "abc1234",
      conclusion,
      started_at: null,
      completed_at: null,
      check_suite: { head_branch: "main" },
      app: { name: "GitHub Actions" },
    },
    repository,
  };
}

function ran(built: World, trigger: string, conclusion: string | null): World {
  apply(
    built,
    {
      event: "check_run",
      action: "completed",
      delivered_at: "2026-08-24T01:00:00Z",
      payload: checkRun(conclusion) as never,
    },
    { runId: "14244", run: { name: "Bot", runNumber: 14244, trigger } },
  );

  return built;
}

function pushed(built: World, facts?: object): World {
  apply(
    built,
    {
      event: "push",
      action: null,
      delivered_at: "2026-08-24T01:00:00Z",
      payload: { repository, after: "abc1234" } as never,
      facts,
    } as never,
    { content: { components: [{ type: 10, content: "pushed abc1234" }] } },
  );

  return built;
}

const world = (trigger: string, conclusion: string | null) =>
  ran(emptyWorld(), trigger, conclusion);

const keys = (built: World, queries?: Map<string, { include?: string; exclude?: string }>) =>
  compose(built, repository, undefined, queries).map(({ key }) => key);

describe("compose, over a run nothing claims", () => {
  it("draws every run when no query says otherwise", () => {
    expect(keys(world("schedule", "success"))).toEqual(["run:14244"]);
    expect(keys(world("schedule", "failure"))).toEqual(["run:14244"]);
  });

  it("keeps the recommended query's quiet, and its noise", () => {
    const quiet = new Map([
      ["o/wiki-bot", { exclude: "type:run AND trigger:schedule AND ever:passed" }],
    ]);

    expect(keys(world("schedule", "success"), quiet)).toEqual([]);
    expect(keys(world("schedule", "failure"), quiet)).toEqual(["run:14244"]);
    expect(keys(world("push", "success"), quiet)).toEqual(["run:14244"]);
  });

  it("draws work a person set off, however it went", () => {
    expect(keys(world("push", "success"))).toEqual(["run:14244"]);
    expect(keys(world("workflow_dispatch", "success"))).toEqual(["run:14244"]);
  });

  it("draws a run it could not name", () => {
    const built = emptyWorld();

    apply(
      built,
      {
        event: "check_run",
        action: "completed",
        delivered_at: "2026-08-24T01:00:00Z",
        payload: checkRun("success") as never,
      },
      { runId: "14244" },
    );

    expect(keys(built)).toEqual(["run:14244"]);
  });
});

describe("compose, under a repository's query", () => {
  const queries = (query: { include?: string; exclude?: string }, of = "o/wiki-bot") =>
    new Map([[of, query]]);

  it("draws everything when no query names the repository", () => {
    const built = pushed(emptyWorld());

    expect(keys(built, queries({ exclude: "type:push" }, "someone/else"))).toHaveLength(1);
  });

  it("keeps out what an exclude names", () => {
    const built = pushed(emptyWorld());

    expect(keys(built, queries({ exclude: "type:push" }))).toEqual([]);
  });

  it("leaves a hidden note's run standing on its own", () => {
    const built = ran(pushed(emptyWorld()), "push", "success");

    expect(keys(built, queries({ exclude: "type:push" }))).toEqual(["run:14244"]);
  });

  it("takes the run too when the query names it as well", () => {
    const built = ran(pushed(emptyWorld()), "push", "success");

    expect(keys(built, queries({ exclude: "type:push OR type:run" }))).toEqual([]);
  });

  it("keeps out a run an exclude names", () => {
    const built = world("workflow_dispatch", "success");

    expect(keys(built, queries({ exclude: "trigger:workflow_dispatch" }))).toEqual([]);
  });

  it("draws only what an include names", () => {
    const built = ran(pushed(emptyWorld()), "workflow_dispatch", "success");

    expect(keys(built, queries({ include: "type:run" }))).toEqual(["run:14244"]);
  });

  it("never judges a message by another repository's query", () => {
    const built = emptyWorld();

    apply(
      built,
      {
        event: "push",
        action: null,
        delivered_at: "2026-08-24T01:00:00Z",
        payload: { after: "abc1234" } as never,
      },
      { content: { components: [{ type: 10, content: "pushed abc1234" }] } },
    );

    expect(keys(built, queries({ exclude: "type:push" }))).toHaveLength(1);
  });

  it("draws everything when a query cannot be read", () => {
    const built = pushed(emptyWorld());

    expect(keys(built, queries({ exclude: "type:(" }))).toHaveLength(1);
  });

  it("draws the CI when the query asks for runs and not the events around them", () => {
    const built = ran(pushed(emptyWorld()), "push", "success");

    expect(keys(built, queries({ include: "type:run" }))).toEqual(["run:14244"]);
  });

  it("keeps a failing build a hidden note would have taken with it", () => {
    const built = ran(
      pushed(emptyWorld(), { sender: { login: "renovate[bot]", type: "Bot" } }),
      "push",
      "failure",
    );

    expect(keys(built, queries({ exclude: "bot:true" }))).toEqual(["run:14244"]);
  });

  it("judges a run its note carries by what the run is", () => {
    const built = ran(pushed(emptyWorld()), "push", "success");
    const [message] = compose(built, repository, undefined, queries({ exclude: "type:run" }));

    expect((message!.content as { components: unknown[] }).components).toHaveLength(1);
  });

  it("folds a claimed run into its note when the query wants both", () => {
    const built = ran(pushed(emptyWorld()), "push", "success");
    const asked = queries({ include: "type:push OR type:run" });
    const [message] = compose(built, repository, undefined, asked);

    expect(keys(built, asked)).toEqual(["push.:2026-08-24T01:00:00Z"]);
    expect((message!.content as { components: unknown[] }).components).toHaveLength(2);
  });

  it("draws everything when a query names what no subject has", () => {
    const built = pushed(emptyWorld());

    expect(keys(built, queries({ include: "check_run.conclusion:success" }))).toHaveLength(1);
  });
});
