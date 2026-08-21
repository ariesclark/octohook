/**
 * One vocabulary for every event. A reader learns six marks once, and a blue diamond means
 * the same thing whether it arrived from a check run, a deployment or a pull request.
 *
 * Shortcodes rather than literal emoji: Discord renders these at text size, so a line of them
 * stays a line of text instead of a row of pictures.
 */
export const marks = {
  /** It ran, and it worked: a check passed, a deployment went live, a pull request merged. */
  good: ":small_blue_diamond:",

  /** It ran, and it did not work. */
  bad: ":small_red_triangle:",

  /** It ran out of time rather than reaching a verdict. */
  expired: ":small_red_triangle_down:",

  /** In flight, or waiting on a person. */
  active: ":small_orange_diamond:",

  /** Deliberately not done: skipped, cancelled, closed unmerged, torn down. */
  dropped: ":black_small_square:",

  /** Finished with no verdict either way: neutral, stale, still a draft. */
  quiet: ":white_small_square:",
} as const;

export type Mark = (typeof marks)[keyof typeof marks];

/** A mark and the space that follows it, so no caller has to remember the space. */
export function lead(mark: Mark): string {
  return `${mark} `;
}

/** Shared by check runs and workflow runs, which report the same conclusions. */
const conclusions: Record<string, Mark> = {
  success: marks.good,
  failure: marks.bad,
  startup_failure: marks.bad,
  timed_out: marks.expired,
  action_required: marks.active,
  skipped: marks.dropped,
  cancelled: marks.dropped,
  neutral: marks.quiet,
  stale: marks.quiet,
};

export function checkMark(conclusion: string | null | undefined): Mark {
  if (!conclusion) return marks.quiet;

  return conclusions[conclusion] ?? marks.quiet;
}

/**
 * A workflow run arrives before it finishes, so no conclusion means it is still going —
 * unlike a check run, which is only rendered once it has completed.
 */
export function workflowMark(conclusion: string | null | undefined): Mark {
  if (!conclusion) return marks.active;

  return checkMark(conclusion);
}

const deploymentStates: Record<string, Mark> = {
  success: marks.good,
  failure: marks.bad,
  error: marks.bad,
  in_progress: marks.active,
  queued: marks.active,
  pending: marks.active,
  inactive: marks.dropped,
};

export function deploymentMark(state: string | null | undefined): Mark {
  if (!state) return marks.quiet;

  return deploymentStates[state] ?? marks.quiet;
}

const pullRequestActions: Record<string, Mark> = {
  merged: marks.good,
  // Closing without merging is a decision, not a failure — the work was dropped, not broken.
  closed: marks.dropped,
  opened: marks.active,
  reopened: marks.active,
  "marked ready for review": marks.active,
  // Still in flight, just moved along: new commits, a rename, a different target.
  updated: marks.active,
  renamed: marks.active,
  retargeted: marks.active,
  "converted to draft": marks.quiet,
};

export function pullRequestMark(action: string): Mark {
  return pullRequestActions[action] ?? marks.quiet;
}

export function issueMark(action: string, reason: string | null | undefined): Mark {
  if (action === "closed") return reason === "not_planned" ? marks.dropped : marks.good;
  if (action === "opened" || action === "reopened") return marks.active;

  return marks.quiet;
}

/**
 * Severity is its own scale and must never borrow {@link marks.good} — the least dangerous
 * vulnerability is still a vulnerability, and a blue diamond would read as "all clear".
 */
const severities: Record<string, Mark> = {
  critical: marks.bad,
  high: marks.bad,
  moderate: marks.active,
  medium: marks.active,
  low: marks.quiet,
};

export function severityMark(severity: string | null | undefined): Mark {
  if (!severity) return marks.quiet;

  return severities[severity.toLowerCase()] ?? marks.quiet;
}
