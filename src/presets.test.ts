import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { presets, queryOf, unreadable } from "./options.ts";
import { drawn, subjectOfRun } from "./policy.ts";
import type { Run } from "./state.ts";

describe("what the recommended default keeps out", () => {
  const named = presets.recommended!;

  test("says nothing about work that never ran", () => {
    assert.match(named, /ever:skipped/);
    assert.match(named, /ever:cancelled/);
  });
});

describe("a run the recommended default has to place", () => {
  const query = queryOf({ preset: "recommended" });

  function passing(over: Partial<Run> = {}): Run {
    return {
      id: "14244",
      at: "2026-08-24T01:00:00Z",
      seen: "2026-08-24T01:00:00Z",
      run: { name: "CI", runNumber: 161, trigger: "push" },
      jobs: [
        { name: "build", url: "u", conclusion: "success", startedAt: null, completedAt: null },
      ],
      deployments: [],
      ...over,
    };
  }

  test("drops a passing run standing on its own, which says nothing a reader wanted", () => {
    assert.equal(drawn(query, subjectOfRun(passing(), false)), false);
  });

  test("keeps a passing run under the push it ran on, where it reads as that push's verdict", () => {
    assert.equal(drawn(query, subjectOfRun(passing(), true)), true);
  });

  test("still drops a failing run's silence to the same rule, wherever it sits", () => {
    const failed = passing({
      jobs: [
        { name: "build", url: "u", conclusion: "failure", startedAt: null, completedAt: null },
      ],
    });

    assert.equal(drawn(query, subjectOfRun(failed, false)), true);
    assert.equal(drawn(query, subjectOfRun(failed, true)), true);
  });
});

describe("a named default", () => {
  test("stands in for the query it spells out", () => {
    assert.deepEqual(queryOf({ preset: "recommended" }), {
      include: undefined,
      exclude: presets.recommended,
    });
  });

  test("gives way to nothing: a query of your own is kept alongside it", () => {
    const query = queryOf({ preset: "recommended", exclude: "type:star" });

    assert.equal(query.exclude, `(${presets.recommended}) OR (type:star)`);
  });

  test("is refused by name when nobody knows it", () => {
    assert.deepEqual(unreadable(queryOf({ preset: "whatever" })), ["preset"]);
    assert.equal(queryOf({ preset: "whatever" }).exclude, "preset:whatever");
  });

  test("leaves a hook with no preset alone", () => {
    assert.deepEqual(queryOf({ exclude: "type:star" }), {
      include: undefined,
      exclude: "type:star",
    });
  });
});
