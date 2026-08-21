import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkMark,
  deploymentMark,
  issueMark,
  marks,
  pullRequestMark,
  severityMark,
  workflowMark,
} from "./marks.ts";

describe("marks", () => {
  it("gives every state a distinct mark", () => {
    const used = Object.values(marks);

    assert.equal(new Set(used).size, used.length);
  });
});

describe("checkMark", () => {
  it("reads a passing check as good and a failing one as bad", () => {
    assert.equal(checkMark("success"), marks.good);
    assert.equal(checkMark("failure"), marks.bad);
    assert.equal(checkMark("startup_failure"), marks.bad);
  });

  it("separates running out of time from failing", () => {
    assert.equal(checkMark("timed_out"), marks.expired);
  });

  it("treats what never ran as dropped, not failed", () => {
    assert.equal(checkMark("skipped"), marks.dropped);
    assert.equal(checkMark("cancelled"), marks.dropped);
  });

  it("has no verdict for a check that reached none", () => {
    assert.equal(checkMark("neutral"), marks.quiet);
    assert.equal(checkMark("stale"), marks.quiet);
    assert.equal(checkMark(null), marks.quiet);
    assert.equal(checkMark("something-new"), marks.quiet);
  });

  it("marks a check waiting on a person as active", () => {
    assert.equal(checkMark("action_required"), marks.active);
  });
});

describe("workflowMark", () => {
  it("reads a run with no conclusion as still going", () => {
    assert.equal(workflowMark(null), marks.active);
    assert.notEqual(workflowMark(null), checkMark(null));
  });

  it("agrees with checkMark once there is a conclusion", () => {
    for (const conclusion of ["success", "failure", "timed_out", "skipped", "stale"])
      assert.equal(workflowMark(conclusion), checkMark(conclusion));
  });
});

describe("deploymentMark", () => {
  it("reads a live deployment as good", () => {
    assert.equal(deploymentMark("success"), marks.good);
  });

  it("counts queued and pending as in flight", () => {
    assert.equal(deploymentMark("queued"), marks.active);
    assert.equal(deploymentMark("pending"), marks.active);
    assert.equal(deploymentMark("in_progress"), marks.active);
  });

  it("reads a torn-down deployment as dropped", () => {
    assert.equal(deploymentMark("inactive"), marks.dropped);
  });

  it("reads failure and error alike", () => {
    assert.equal(deploymentMark("failure"), marks.bad);
    assert.equal(deploymentMark("error"), marks.bad);
  });
});

describe("pullRequestMark", () => {
  it("reads a merge as good", () => {
    assert.equal(pullRequestMark("merged"), marks.good);
  });

  it("reads a close without a merge as dropped rather than failed", () => {
    assert.equal(pullRequestMark("closed"), marks.dropped);
    assert.notEqual(pullRequestMark("closed"), marks.bad);
  });

  it("reads an open pull request as active", () => {
    assert.equal(pullRequestMark("opened"), marks.active);
    assert.equal(pullRequestMark("reopened"), marks.active);
    assert.equal(pullRequestMark("marked ready for review"), marks.active);
  });

  it("reads a pull request that moved along as still active", () => {
    assert.equal(pullRequestMark("updated"), marks.active);
    assert.equal(pullRequestMark("renamed"), marks.active);
    assert.equal(pullRequestMark("retargeted"), marks.active);
  });

  it("reads a draft as having no verdict yet", () => {
    assert.equal(pullRequestMark("converted to draft"), marks.quiet);
  });
});

describe("issueMark", () => {
  it("reads a resolved issue as good and an abandoned one as dropped", () => {
    assert.equal(issueMark("closed", "completed"), marks.good);
    assert.equal(issueMark("closed", "not_planned"), marks.dropped);
  });

  it("reads an open issue as active", () => {
    assert.equal(issueMark("opened", null), marks.active);
    assert.equal(issueMark("reopened", null), marks.active);
  });
});

describe("severityMark", () => {
  it("never reads a vulnerability as good news", () => {
    for (const severity of ["critical", "high", "moderate", "medium", "low", "unknown"])
      assert.notEqual(severityMark(severity), marks.good);
  });

  it("scales with how bad it is", () => {
    assert.equal(severityMark("critical"), marks.bad);
    assert.equal(severityMark("high"), marks.bad);
    assert.equal(severityMark("moderate"), marks.active);
    assert.equal(severityMark("low"), marks.quiet);
  });
});
