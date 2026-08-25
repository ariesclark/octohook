import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { drawn, strangeFields, subjectOfNote, subjectOfRun } from "./policy.ts";
import type { Note, Run } from "./state.ts";

const repository = { name: "wiki-bot", full_name: "o/wiki-bot", html_url: "https://g/o/wiki-bot" };

function run(over: Partial<Run> = {}): Run {
  return {
    id: "14244",
    at: "2026-08-24T01:00:00Z",
    seen: "2026-08-24T01:00:00Z",
    repository,
    branch: "main",
    sha: "abc1234",
    run: { name: "Bot", runNumber: 14244, trigger: "schedule" },
    startedAt: "2026-08-24T01:00:00Z",
    completedAt: "2026-08-24T01:00:17Z",
    jobs: [
      { name: "build", url: "u", conclusion: "success", startedAt: null, completedAt: null },
      { name: "test", url: "u", conclusion: "failure", startedAt: null, completedAt: null },
    ],
    deployments: [],
    ...over,
  };
}

function note(over: Partial<Note> = {}): Note {
  return {
    key: "push.:2026-08-24T01:00:00Z",
    at: "2026-08-24T01:00:00Z",
    seen: "2026-08-24T01:00:00Z",
    kind: "push",
    repository,
    sha: "abc1234",
    content: {},
    ...over,
  };
}

describe("the subject a run presents", () => {
  test("names what the run is, not what its payload was", () => {
    const subject = subjectOfRun(run());

    assert.equal(subject.type, "run");
    assert.equal(subject.trigger, "schedule");
    assert.equal(subject.workflow, "Bot");
    assert.equal(subject.number, 14244);
    assert.equal(subject.branch, "main");
    assert.equal(subject.repository, "o/wiki-bot");
    assert.equal(subject.seconds, 17);
  });

  test("remembers the worst it has been, whatever it says now", () => {
    assert.equal(subjectOfRun(run({ jobs: [], settled: "success" })).ever, "passed");
    assert.equal(subjectOfRun(run({ jobs: [], settled: "failure" })).ever, "failed");
    assert.equal(subjectOfRun(run({ jobs: [], settled: "success", alarmed: true })).ever, "failed");
  });

  test("counts how its jobs went", () => {
    const subject = subjectOfRun(run());

    assert.deepEqual(subject.jobs, { total: 2, passed: 1, failed: 1, running: 0, skipped: 0 });
    assert.equal(subject.result, "failed");
  });

  test("calls a run nobody has finished reporting on running", () => {
    const jobs = [
      { name: "build", url: "u", conclusion: null, startedAt: null, completedAt: null },
    ];

    assert.equal(subjectOfRun(run({ jobs })).result, "running");
  });
});

describe("the subject a note presents", () => {
  test("names the event and what it was about", () => {
    const subject = subjectOfNote(note());

    assert.equal(subject.type, "push");
    assert.equal(subject.repository, "o/wiki-bot");
    assert.equal(subject.sha, "abc1234");
  });

  test("carries the facts the rendering knew and the payload no longer does", () => {
    const facts = { sender: { login: "renovate[bot]", type: "Bot" }, ref: "renovate/lock" };

    assert.equal(subjectOfNote(note({ facts })).by, "renovate[bot]");
    assert.equal(subjectOfNote(note({ facts })).bot, true);
    assert.equal(subjectOfNote(note({ facts })).branch, "renovate/lock");
  });
});

describe("drawn", () => {
  const quiet = subjectOfRun(run({ jobs: [], settled: "success" }));

  test("draws a subject no query speaks about", () => {
    assert.equal(drawn({}, quiet), true);
    assert.equal(drawn({ include: "", exclude: "" }, quiet), true);
  });

  test("keeps out what an exclude names", () => {
    assert.equal(drawn({ exclude: "trigger:schedule" }, quiet), false);
    assert.equal(drawn({ exclude: "trigger:push" }, quiet), true);
    assert.equal(drawn({ exclude: "result:passed AND trigger:schedule" }, quiet), false);
  });

  test("draws only what an include names", () => {
    assert.equal(drawn({ include: "trigger:schedule" }, quiet), true);
    assert.equal(drawn({ include: "trigger:push" }, quiet), false);
  });

  test("lets an exclude overrule an include", () => {
    assert.equal(drawn({ include: "type:run", exclude: "trigger:schedule" }, quiet), false);
  });

  test("keeps out a bot's note", () => {
    const facts = { sender: { login: "renovate[bot]", type: "Bot" } };

    assert.equal(drawn({ exclude: "bot:true" }, subjectOfNote(note({ facts }))), false);
    assert.equal(drawn({ exclude: "bot:true" }, subjectOfNote(note())), true);
  });

  test("draws everything when a query cannot be read", () => {
    assert.equal(drawn({ exclude: "trigger:(" }, quiet), true);
    assert.equal(drawn({ include: "trigger:(" }, quiet), true);
  });

  test("draws everything when a query names a field no subject has", () => {
    assert.equal(drawn({ include: "check_run.conclusion:success" }, quiet), true);
    assert.equal(drawn({ exclude: "sender.type:Bot" }, subjectOfNote(note())), true);
  });
});

describe("strangeFields", () => {
  test("names a field no subject has", () => {
    assert.deepEqual(strangeFields("check_run.conclusion:success"), ["check_run.conclusion"]);
    assert.deepEqual(strangeFields("sender.type:Bot"), ["sender.type"]);
    assert.deepEqual(strangeFields("object:run"), ["object"]);
    assert.deepEqual(strangeFields("claimed:true"), ["claimed"]);
  });

  test("says nothing about a query it understands", () => {
    assert.deepEqual(strangeFields("trigger:schedule AND result:passed"), []);
    assert.deepEqual(strangeFields("bot:true OR type:star"), []);
    assert.deepEqual(strangeFields("jobs.failed:>0"), []);
  });

  test("says a query it cannot read at all is the whole query", () => {
    assert.deepEqual(strangeFields("trigger:("), ["trigger:("]);
  });
});
