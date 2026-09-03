import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { localReferenceFor, referenceFor, resolveFor } from "./resolve.ts";
import type { Annotation, Github } from "./discord/events/check-run/run.ts";
import type { Delivery } from "./state.ts";

function delivery(event: string, payload: object): Delivery {
  return { event, action: "completed", delivered_at: "01:00", payload: payload as never };
}

describe("localReferenceFor", () => {
  test("reads a check run's reference off the url it details", () => {
    const reference = localReferenceFor(
      delivery("check_run", {
        check_run: { details_url: "https://github.com/o/r/actions/runs/14244" },
      }),
    );

    assert.deepEqual(reference, { repository: "o/r", runId: "14244" });
  });

  test("gives a workflow run the id it already carries", () => {
    const reference = localReferenceFor(
      delivery("workflow_run", {
        repository: { full_name: "o/r" },
        workflow_run: { id: 14244 },
      }),
    );

    assert.deepEqual(reference, { repository: "o/r", runId: "14244" });
  });

  test("refuses a workflow run that names no repository", () => {
    assert.equal(
      localReferenceFor(delivery("workflow_run", { workflow_run: { id: 14244 } })),
      undefined,
    );
  });

  test("has nothing to say about an event that reports on no run", () => {
    assert.equal(localReferenceFor(delivery("push", { after: "abc1234" })), undefined);
  });
});

describe("what a check run resolves to", () => {
  const annotation: Annotation = {
    path: "src/a.cs",
    startLine: 1,
    level: "warning",
    title: null,
    message: "obsolete",
  };

  function github(over: Partial<Github> = {}): Github {
    return {
      resolveRun: async () => ({ name: "CI", runNumber: 161, trigger: "push" }),
      runReferenceFromSuite: async () => undefined,
      resolveAnnotations: async () => [annotation],
      watchJobs: async () => ({}),
      watchRun: async () => undefined,
      ...over,
    };
  }

  const completed = (over: object = {}) =>
    delivery("check_run", {
      check_run: {
        id: 100504953271,
        status: "completed",
        details_url: "https://github.com/o/r/actions/runs/14244",
        ...over,
      },
    });

  test("asks for annotations a finished check run's own count does not admit to", async () => {
    const resolved = await resolveFor(
      completed({ output: { annotations_count: 0 } }),
      github(),
      async () => undefined,
    );

    assert.deepEqual(resolved.annotations, [annotation]);
  });

  test("holds nothing against a check run still running out", async () => {
    const resolved = await resolveFor(
      delivery("check_run", {
        check_run: {
          id: 1,
          status: "in_progress",
          details_url: "https://github.com/o/r/actions/runs/14244",
        },
      }),
      github(),
      async () => undefined,
    );

    assert.equal(resolved.annotations, undefined);
  });

  test("leaves an ask GitHub refused open, rather than calling it nothing to say", async () => {
    const resolved = await resolveFor(
      completed(),
      github({ resolveAnnotations: async () => undefined }),
      async () => undefined,
    );

    assert.equal(resolved.annotations, undefined);
  });

  test("takes an empty answer as an answer, since GitHub was asked and said none", async () => {
    const resolved = await resolveFor(
      completed(),
      github({ resolveAnnotations: async () => [] }),
      async () => undefined,
    );

    assert.deepEqual(resolved.annotations, []);
  });
});

describe("a check whose suite names no workflow run", () => {
  function lost(): Github {
    return {
      resolveRun: async () => undefined,
      runReferenceFromSuite: async () => undefined,
      resolveAnnotations: async () => [],
      watchJobs: async () => ({}),
      watchRun: async () => undefined,
    };
  }

  test("drops the suite, which owns a verdict and none of the jobs under it", async () => {
    const reference = await referenceFor(
      delivery("check_suite", { repository: { full_name: "o/r" }, check_suite: { id: 5 } }),
      lost(),
    );

    assert.equal(reference, undefined);
  });

  test("keeps gathering checks, which is all an app posting its own ever has", async () => {
    const reference = await referenceFor(
      delivery("check_run", {
        repository: { full_name: "o/r" },
        check_run: { check_suite: { id: 5 } },
      }),
      lost(),
    );

    assert.deepEqual(reference, { repository: "o/r", runId: "suite-5" });
  });
});
