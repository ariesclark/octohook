import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkMark, deploymentMark, issueMark, marks, severityMark } from "./marks.ts";

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

  // Orange is a warning now, and nothing in flight wears it: a check that stopped to ask a
  // person is a warning, where a check that is simply still going is not.
  it("marks a check waiting on a person as a warning", () => {
    assert.equal(checkMark("action_required"), marks.warning);
    assert.notEqual(checkMark("action_required"), marks.quiet);
  });
});

describe("deploymentMark", () => {
  it("reads a live deployment as good", () => {
    assert.equal(deploymentMark("success"), marks.good);
  });

  it("counts queued and pending as in flight", () => {
    assert.equal(deploymentMark("queued"), marks.quiet);
    assert.equal(deploymentMark("pending"), marks.quiet);
    assert.equal(deploymentMark("in_progress"), marks.quiet);
  });

  it("reads a torn-down deployment as dropped", () => {
    assert.equal(deploymentMark("inactive"), marks.dropped);
  });

  it("reads failure and error alike", () => {
    assert.equal(deploymentMark("failure"), marks.bad);
    assert.equal(deploymentMark("error"), marks.bad);
  });
});

describe("issueMark", () => {
  it("reads a resolved issue as good and an abandoned one as dropped", () => {
    assert.equal(issueMark("closed", "completed"), marks.good);
    assert.equal(issueMark("closed", "not_planned"), marks.dropped);
  });

  it("reads an open issue as active", () => {
    assert.equal(issueMark("opened", null), marks.quiet);
    assert.equal(issueMark("reopened", null), marks.quiet);
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
    assert.equal(severityMark("moderate"), marks.warning);
    assert.equal(severityMark("low"), marks.quiet);
  });
});
