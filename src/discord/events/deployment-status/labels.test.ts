import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deploymentVerb, namesRef } from "./labels.ts";

describe("deploymentVerb", () => {
  it("says what happened, in the voice the other events use", () => {
    assert.equal(deploymentVerb("success"), "deployed");
    assert.equal(deploymentVerb("in_progress"), "deploying");
    assert.equal(deploymentVerb("failure"), "failed to deploy");
    assert.equal(deploymentVerb("error"), "errored deploying");
  });

  it("reads queued and pending as waiting to start", () => {
    assert.equal(deploymentVerb("queued"), "queued a deploy of");
    assert.equal(deploymentVerb("pending"), "queued a deploy of");
  });

  it("describes a torn-down environment without a ref", () => {
    assert.equal(deploymentVerb("inactive"), "took down");
    assert.equal(namesRef("inactive"), false);
  });

  it("names the ref for every state that deploys one", () => {
    for (const state of ["success", "in_progress", "queued", "failure", "error"])
      assert.equal(namesRef(state), true);
  });

  it("falls back to the raw state rather than inventing one", () => {
    assert.equal(deploymentVerb("something_new"), "something_new");
  });
});
