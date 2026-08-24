import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { foldablePayload, isFoldable, shaOf } from "./foldable.ts";

const payload = {
  repository: { name: "wiki-bot", full_name: "o/wiki-bot", html_url: "https://github.com/o/wiki-bot" },
  workflow_run: {
    id: 14244,
    name: "Bot",
    run_number: 14244,
    event: "schedule",
    conclusion: "success",
    head_sha: "abc1234",
    head_branch: "main",
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
    });

    assert.equal(folded.repository.full_name, "o/wiki-bot");
  });
});
