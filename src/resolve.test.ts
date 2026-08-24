import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { localReferenceFor } from "./resolve.ts";
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
