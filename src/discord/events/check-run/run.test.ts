import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Annotation } from "./run.ts";
import { meetsAnnotationLevel, runReferenceFrom } from "./run.ts";

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

  // A check run posted by an app that is not Actions links wherever it likes.
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

  // A level nobody has seen before is more likely news than noise.
  test("keeps a level it does not know", () => {
    assert.equal(meetsAnnotationLevel(at("catastrophe")), true);
  });
});
