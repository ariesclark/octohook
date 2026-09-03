import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Annotation } from "./run.ts";
import { createGithub, meetsAnnotationLevel, runReferenceFrom } from "./run.ts";

describe("runReferenceFrom", () => {
  test("reads the repository and run from a job url", () => {
    assert.deepEqual(
      runReferenceFrom(
        "https://github.com/flirtual/flirtual/actions/runs/32332670376/job/96316165716",
      ),
      { repository: "flirtual/flirtual", runId: "32332670376" },
    );
  });

  test("reads a run url that names no job", () => {
    assert.deepEqual(
      runReferenceFrom("https://github.com/flirtual/flirtual/actions/runs/32332670376"),
      { repository: "flirtual/flirtual", runId: "32332670376" },
    );
  });

  test("reads nothing from a url with no run in it", () => {
    assert.equal(
      runReferenceFrom("https://github.com/flirtual/flirtual/runs/96317144903"),
      undefined,
    );
    assert.equal(runReferenceFrom("https://sentry.io/issues/1234"), undefined);
  });

  test("reads nothing from a url that is not one", () => {
    assert.equal(runReferenceFrom("not a url"), undefined);
  });
});

describe("meetsAnnotationLevel", () => {
  const at = (level: string): Annotation => ({
    path: "a.ts",
    startLine: 1,
    level,
    title: null,
    message: "m",
  });

  test("keeps warnings and failures by default", () => {
    assert.equal(meetsAnnotationLevel(at("failure")), true);
    assert.equal(meetsAnnotationLevel(at("warning")), true);
  });

  test("drops a notice by default", () => {
    assert.equal(meetsAnnotationLevel(at("notice")), false);
  });

  test("keeps a level it does not know", () => {
    assert.equal(meetsAnnotationLevel(at("catastrophe")), true);
  });
});

describe("finding the run a check suite belongs to", () => {
  async function asking(answers: Array<{ workflow_runs: Array<{ id: number }> }>) {
    const asked: string[] = [];
    const inner = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(JSON.stringify(answers[asked.length - 1] ?? { workflow_runs: [] }));
    }) as typeof fetch;

    try {
      const github = createGithub("token");

      return {
        first: await github.runReferenceFromSuite("o/r", 5),
        second: await github.runReferenceFromSuite("o/r", 5),
        asked,
      };
    } finally {
      globalThis.fetch = inner;
    }
  }

  test("asks again when GitHub does not yet know of one", async () => {
    const { first, second, asked } = await asking([
      { workflow_runs: [] },
      { workflow_runs: [{ id: 14244 }] },
    ]);

    assert.equal(first, undefined);
    assert.deepEqual(second, { repository: "o/r", runId: "14244" });
    assert.equal(asked.length, 2);
  });

  test("asks only once when GitHub answers", async () => {
    const { first, second, asked } = await asking([{ workflow_runs: [{ id: 14244 }] }]);

    assert.deepEqual(first, { repository: "o/r", runId: "14244" });
    assert.deepEqual(second, first);
    assert.equal(asked.length, 1);
  });
});

describe("naming the run a check belongs to", () => {
  async function asking(answers: Array<object>) {
    const asked: string[] = [];
    const inner = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      const answer = answers[asked.length - 1];
      return answer ? new Response(JSON.stringify(answer)) : new Response("", { status: 404 });
    }) as typeof fetch;

    try {
      const github = createGithub("token");
      const reference = { repository: "o/r", runId: "14244" };

      return {
        first: await github.resolveRun(reference),
        second: await github.resolveRun(reference),
        asked,
      };
    } finally {
      globalThis.fetch = inner;
    }
  }

  test("asks again when GitHub has not caught up with the run", async () => {
    const { first, second, asked } = await asking([
      undefined as unknown as object,
      { name: "CI", run_number: 15, event: "push" },
    ]);

    assert.equal(first, undefined);
    assert.deepEqual(second, { name: "CI", runNumber: 15, trigger: "push" });
    assert.equal(asked.length, 2);
  });

  test("asks only once when GitHub names it", async () => {
    const { first, second, asked } = await asking([{ name: "CI", run_number: 15, event: "push" }]);

    assert.deepEqual(first, { name: "CI", runNumber: 15, trigger: "push" });
    assert.deepEqual(second, first);
    assert.equal(asked.length, 1);
  });
});
