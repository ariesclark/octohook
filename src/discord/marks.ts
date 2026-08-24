// Discord renders a shortcode at text size, where a literal emoji is a picture.
export const marks = {
  good: ":small_blue_diamond:",
  bad: ":small_red_triangle:",
  expired: ":small_red_triangle_down:",
  warning: ":small_orange_diamond:",
  dropped: ":black_small_square:",
  quiet: ":white_small_square:",
} as const;

export type Mark = (typeof marks)[keyof typeof marks];

export function lead(mark: Mark): string {
  return `${mark} `;
}

const conclusions: Record<string, Mark> = {
  success: marks.good,
  failure: marks.bad,
  startup_failure: marks.bad,
  timed_out: marks.expired,
  action_required: marks.warning,
  skipped: marks.dropped,
  cancelled: marks.dropped,
  neutral: marks.quiet,
  stale: marks.quiet,
};

export function checkMark(conclusion: string | null | undefined): Mark {
  if (!conclusion) return marks.quiet;

  return conclusions[conclusion] ?? marks.quiet;
}

const deploymentStates: Record<string, Mark> = {
  success: marks.good,
  failure: marks.bad,
  error: marks.bad,
  in_progress: marks.quiet,
  queued: marks.quiet,
  pending: marks.quiet,
  inactive: marks.dropped,
};

export function deploymentMark(state: string | null | undefined): Mark {
  if (!state) return marks.quiet;

  return deploymentStates[state] ?? marks.quiet;
}

export function issueMark(action: string, reason: string | null | undefined): Mark {
  if (action === "closed") return reason === "not_planned" ? marks.dropped : marks.good;
  if (action === "opened" || action === "reopened") return marks.quiet;

  return marks.quiet;
}

const severities: Record<string, Mark> = {
  critical: marks.bad,
  high: marks.bad,
  moderate: marks.warning,
  medium: marks.warning,
  low: marks.quiet,
};

export function severityMark(severity: string | null | undefined): Mark {
  if (!severity) return marks.quiet;

  return severities[severity.toLowerCase()] ?? marks.quiet;
}
