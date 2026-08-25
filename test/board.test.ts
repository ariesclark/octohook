import { describe, expect, it } from "vitest";

import { boardMark } from "../src/discord/events/check-run/board";
import { JobRows, runSummary } from "../src/discord/events/check-run/rows";
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

describe("a job the board is watching", () => {
  const job = (over = {}) => ({
    name: "test",
    url: "https://g/o/r/actions/runs/42/job/1",
    conclusion: null as string | null,
    startedAt: null,
    completedAt: null,
    ...over,
  });

  const drawn = (jobs: ReturnType<typeof job>[]) =>
    JSON.stringify(JobRows({ jobs, repositoryUrl: "https://g/o/r" }));

  it("says the step a running job is on", () => {
    expect(drawn([job({ step: "Run pnpm install" })])).toContain("Run pnpm install");
  });

  it("keeps quiet about a running job it knows nothing about", () => {
    expect(JobRows({ jobs: [job()], repositoryUrl: "https://g/o/r" })).toHaveLength(0);
  });

  it("draws a running job once it can say where it is", () => {
    expect(JobRows({ jobs: [job({ step: "Set up job" })], repositoryUrl: "https://g/o/r" })).toHaveLength(1);
  });

  it("keeps quiet about a job that passed without a word", () => {
    expect(
      JobRows({ jobs: [job({ conclusion: "success" })], repositoryUrl: "https://g/o/r" }),
    ).toHaveLength(0);
  });

  it("drops the step once the job has a verdict", () => {
    const settled = drawn([
      job({ conclusion: "failure", step: "Run vitest", startedAt: "2026-08-25T01:00:00Z", completedAt: "2026-08-25T01:00:09Z" }),
    ]);

    expect(settled).not.toContain("Run vitest");
    expect(settled).toContain("9s");
  });
});

describe("the clock on a run", () => {
  const job = (conclusion: string | null) => ({
    name: "test",
    url: "u",
    conclusion,
    startedAt: null,
    completedAt: null,
  });

  const ran = { startedAt: "2026-08-24T01:00:00Z", completedAt: "2026-08-24T01:00:17Z" };

  it("says nothing about how long a run still going has taken", () => {
    expect(runSummary([job(null)], [], ran)).toBe("1 running");
  });

  it("times a run once every job has a verdict", () => {
    expect(runSummary([job("success")], [], ran)).toBe("1 passed in 17s");
  });
});
