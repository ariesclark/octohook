import { describe, expect, it } from "vitest";

import { boardMark } from "../src/discord/events/check-run/board";
import { runSummary } from "../src/discord/events/check-run/rows";
import { marks } from "../src/discord/marks";

describe("boardMark", () => {
  it("reads the verdict off the run when no check reported one", () => {
    expect(boardMark([], [], "success")).toBe(marks.good);
    expect(boardMark([], [], "failure")).toBe(marks.bad);
    expect(boardMark([], [], "cancelled")).toBe(marks.dropped);
  });

  it("leaves a run nothing has reported on as quiet", () => {
    expect(boardMark([], [], null)).toBe(marks.quiet);
    expect(boardMark([], [])).toBe(marks.quiet);
  });

  it("keeps a job's verdict over the run's", () => {
    const job = { name: "build", url: "u", conclusion: "failure", startedAt: null, completedAt: null };

    expect(boardMark([job], [], "success")).toBe(marks.bad);
  });
});

describe("runSummary", () => {
  const job = (conclusion: string) => ({
    name: conclusion,
    url: "u",
    conclusion,
    startedAt: null,
    completedAt: null,
  });

  const ran = { startedAt: "2026-08-24T01:00:00Z", completedAt: "2026-08-24T01:00:17Z" };

  it("says how long the whole run took", () => {
    expect(runSummary([job("success")], [], ran)).toBe("1 passed in 17s");
  });

  it("hangs the run's clock off the last thing it says", () => {
    expect(runSummary([job("failure"), job("success")], [], ran)).toBe(
      "1 failed, 1 passed in 17s",
    );
  });

  it("says nothing about a clock it does not have", () => {
    expect(runSummary([job("success")], [])).toBe("1 passed");
    expect(runSummary([job("success")], [], { startedAt: null, completedAt: null })).toBe(
      "1 passed",
    );
  });

  it("still says a run's time when no job reported one", () => {
    expect(runSummary([], [], ran)).toBe("in 17s");
  });
});
