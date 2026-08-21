import { GithubEvent } from "../../../github";
import { t, tOf } from "../../messages.ts";

export type CheckRunEvent = Extract<GithubEvent, { type: `check_run.${string}` }>;

export function conclusionLabel(conclusion: string | null): string {
  return tOf("check", conclusion, t("check.running"));
}

export function checkDuration(
  started: string | null,
  completed: string | null,
): string | undefined {
  if (!started || !completed) return undefined;

  const seconds = Math.round((new Date(completed).getTime() - new Date(started).getTime()) / 1000);
  if (seconds <= 0) return undefined;
  if (seconds < 60) return t("duration.seconds", { seconds });

  const minutes = Math.floor(seconds / 60);
  return t("duration.minutes", { minutes, seconds: seconds % 60 });
}

export function appAvatarUrl(
  app: { id?: number; owner?: { avatar_url?: string } } | null,
): string | undefined {
  if (!app) return undefined;
  return app.id ? `https://avatars.githubusercontent.com/in/${app.id}` : app.owner?.avatar_url;
}
