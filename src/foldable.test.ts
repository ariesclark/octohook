import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { foldablePayload, isFoldable, shaOf } from "./foldable.ts";

const payload = {
  repository: {
    name: "wiki-bot",
    full_name: "o/wiki-bot",
    html_url: "https://github.com/o/wiki-bot",
  },
  workflow_run: {
    id: 14244,
    name: "Bot",
    run_number: 14244,
    event: "schedule",
    conclusion: "success",
    head_sha: "abc1234",
    head_branch: "main",
    run_started_at: "2026-08-24T01:00:00Z",
    updated_at: "2026-08-24T01:00:17Z",
    actor: { login: "someone" },
  },
};

describe("a workflow run", () => {
  test("folds against the commit it ran on", () => {
    assert.equal(isFoldable("workflow_run"), true);
    assert.equal(shaOf("workflow_run", payload), "abc1234");
  });

  test("carries what the board draws it with", () => {
    const folded = foldablePayload("workflow_run", payload) as typeof payload;

    assert.deepEqual(folded.workflow_run, {
      id: 14244,
      name: "Bot",
      run_number: 14244,
      event: "schedule",
      conclusion: "success",
      head_sha: "abc1234",
      head_branch: "main",
      run_started_at: "2026-08-24T01:00:00Z",
      updated_at: "2026-08-24T01:00:17Z",
    });

    assert.equal(folded.repository.full_name, "o/wiki-bot");
  });
});

describe("what a fold keeps of a workflow run", () => {
  test("keeps the suite it ran, which is how its stray checks find their way back", () => {
    const kept = foldablePayload("workflow_run", {
      repository: { name: "r", full_name: "o/r", html_url: "https://github.com/o/r" },
      workflow_run: { id: 14244, name: "CI", check_suite_id: 5 },
    }) as { workflow_run?: { check_suite_id?: number } };

    assert.equal(kept.workflow_run?.check_suite_id, 5);
  });
});
