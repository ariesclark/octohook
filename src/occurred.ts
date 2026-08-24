import type { GithubEvent } from "./github";

const subjects: Record<string, string> = {
  issues: "issue",
  push: "repository",
  repository_vulnerability_alert: "alert",
};

const clocks = [
  "updated_at",
  "completed_at",
  "dismissed_at",
  "fixed_at",
  "started_at",
  "created_at",
] as const;

export function occurredAt(event: GithubEvent): number | undefined {
  const [name] = event.type.split(".");
  if (!name) return undefined;

  // A star records `starred_at` on the event itself, and records nothing when taken away.
  if (name === "star") {
    const starred = (event as unknown as { starred_at?: unknown }).starred_at;
    return typeof starred === "string" ? new Date(starred).getTime() : undefined;
  }

  const subject = (event as unknown as Record<string, unknown>)[subjects[name] ?? name];
  if (!subject || typeof subject !== "object") return undefined;

  // A repository records `pushed_at` as epoch seconds, alone among these fields.
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
