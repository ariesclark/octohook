import { describe, expect, it } from "vitest";

import { boardMark } from "../src/discord/events/check-run/board";
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
