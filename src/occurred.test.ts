import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { occurredAt } from "./occurred.ts";

const at = (value: string) => new Date(value).getTime();

describe("occurredAt", () => {
  it("indexes the object the event names", () => {
    assert.equal(
      occurredAt({
        type: "pull_request.synchronize",
        pull_request: { updated_at: "2026-08-17T16:29:56Z" },
      } as never),
      at("2026-08-17T16:29:56Z"),
    );

    assert.equal(
      occurredAt({
        type: "deployment_status.created",
        deployment_status: { updated_at: "2026-08-17T16:30:02Z" },
      } as never),
      at("2026-08-17T16:30:02Z"),
    );
  });

  it("falls through to the job's own clock when there is no updated_at", () => {
    const finished = {
      type: "check_run.completed",
      check_run: { started_at: "2026-08-17T13:05:00Z", completed_at: "2026-08-17T13:06:44Z" },
    };

    assert.equal(occurredAt(finished as never), at("2026-08-17T13:06:44Z"));

    const running = {
      type: "check_run.created",
      check_run: { started_at: "2026-08-17T13:05:00Z" },
    };
    assert.equal(occurredAt(running as never), at("2026-08-17T13:05:00Z"));
  });

  it("prefers the subject's own clock over the suite it belongs to", () => {
    const event = {
      type: "check_run.completed",
      check_run: {
        completed_at: "2026-08-17T12:45:08Z",
        check_suite: { updated_at: "2026-08-17T12:34:00Z" },
      },
    };

    assert.equal(occurredAt(event as never), at("2026-08-17T12:45:08Z"));
  });

  it("knows the names that do not match their object", () => {
    assert.equal(
      occurredAt({ type: "issues.edited", issue: { updated_at: "2026-08-17T13:00:00Z" } } as never),
      at("2026-08-17T13:00:00Z"),
    );
  });

  it("reads a push from the repository, in the epoch seconds it arrives as", () => {
    assert.equal(
      occurredAt({ type: "push", repository: { pushed_at: 1786929471 } } as never),
      1786929471 * 1000,
    );
  });

  it("finds a star by when it was starred", () => {
    assert.equal(
      occurredAt({ type: "star.created", starred_at: "2026-08-17T13:06:44Z" } as never),
      at("2026-08-17T13:06:44Z"),
    );
  });

  it("has nothing to say about an unstarring, which records no time", () => {
    assert.equal(occurredAt({ type: "star.deleted", starred_at: null } as never), undefined);
  });

  it("finds a vulnerability alert under the name it actually uses", () => {
    assert.equal(
      occurredAt({
        type: "repository_vulnerability_alert.create",
        alert: { created_at: "2026-08-17T13:06:44Z" },
      } as never),
      at("2026-08-17T13:06:44Z"),
    );
  });

  it("dates a resolved alert by when it was resolved, not raised", () => {
    assert.equal(
      occurredAt({
        type: "repository_vulnerability_alert.dismiss",
        alert: { created_at: "2026-08-01T09:00:00Z", dismissed_at: "2026-08-17T13:06:44Z" },
      } as never),
      at("2026-08-17T13:06:44Z"),
    );
  });

  it("has nothing to say about an event with no clock of its own", () => {
    assert.equal(occurredAt({ type: "create", repository: {} } as never), undefined);
    assert.equal(occurredAt({ type: "delete", repository: {} } as never), undefined);
  });

  it("ignores a timestamp that is not one", () => {
    assert.equal(occurredAt({ type: "star.created", star: { updated_at: 5 } } as never), undefined);
  });
});
