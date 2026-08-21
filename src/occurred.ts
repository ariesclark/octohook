import type { GithubEvent } from "./github";

/**
 * The event names the object it is about — `check_run.completed` describes `payload.check_run`
 * — so the moment it happened is that object's own clock. Three names do not match their
 * object: `issues` carries an `issue`, a vulnerability alert carries a bare `alert`, and a push
 * has no object of its own, only the repository it landed in.
 */
const subjects: Record<string, string> = {
  issues: "issue",
  push: "repository",
  repository_vulnerability_alert: "alert",
};

/**
 * In the order that best answers "when did this happen": what changed, else what finished or
 * was settled, else what began, else what was made. A check run has no `updated_at` at all and
 * falls through to its own completion — never to its suite's, which spans many jobs and moves
 * on its own schedule. An alert falls through to when it was dismissed or fixed, since it was
 * raised long before the event that says so.
 */
const clocks = [
  "updated_at",
  "completed_at",
  "dismissed_at",
  "fixed_at",
  "started_at",
  "created_at",
] as const;

/**
 * When the event happened, rather than when GitHub got round to delivering it. Delivery can
 * lag by hours, so this is the honest key for ordering — where the event admits to one.
 */
export function occurredAt(event: GithubEvent): number | undefined {
  const [name] = event.type.split(".");
  if (!name) return undefined;

  // A star records when it was given on the event itself, and records nothing when taken away.
  if (name === "star") {
    const starred = (event as unknown as { starred_at?: unknown }).starred_at;
    return typeof starred === "string" ? new Date(starred).getTime() : undefined;
  }

  const subject = (event as unknown as Record<string, unknown>)[subjects[name] ?? name];
  if (!subject || typeof subject !== "object") return undefined;

  // A repository records its last push as epoch seconds, alone among these fields.
  if (name === "push") {
    const pushed = (subject as { pushed_at?: unknown }).pushed_at;
    if (typeof pushed === "number") return pushed * 1000;

    return typeof pushed === "string" ? new Date(pushed).getTime() : undefined;
  }

  for (const clock of clocks) {
    const value = (subject as Record<string, unknown>)[clock];
    if (typeof value !== "string") continue;

    const moment = new Date(value).getTime();
    if (!Number.isNaN(moment)) return moment;
  }

  return undefined;
}
