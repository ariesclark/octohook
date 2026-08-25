import invariant from "invariant";
import { createMiddleware } from "hono/factory";
import type { GithubEvent, GithubEventPayload } from "./github";
import type { HookScope } from "./discord/refs";
import { strangeFields, type Query } from "./policy.ts";

export function queryOf({ include, exclude }: Record<string, string | undefined>): Query {
  return { include: include || undefined, exclude: exclude || undefined };
}

/** A query naming what no subject carries is refused whole, so say which words did it. */
export function unreadable({ include, exclude }: Query): string[] {
  return [...new Set([...strangeFields(include ?? ""), ...strangeFields(exclude ?? "")])];
}

export const optionsMiddleware = createMiddleware<{
  Variables: {
    event: GithubEvent;
    hook: HookScope;
    query: Query;
  };
}>(async ({ req, set, json }, next) => {
  const name = req.header("x-github-event");
  if (!name) return json({ message: "Missing x-github-event header." }, { status: 400 });

  const body = await req.raw.clone().json<GithubEventPayload>();

  invariant(!("type" in body), 'Invalid body: "type" property is reserved for internal use.');

  const action = "action" in body ? String(body.action) : undefined;

  const event = {
    ...body,
    type: `${name}${action ? `.${action}` : ""}`,
  } as GithubEvent;

  // Absent on older deliveries and on replays.
  const target = req.header("x-github-hook-installation-target-type");

  set("event", event);
  set("hook", target === "organization" ? "organization" : "repository");
  set("query", queryOf(req.query()));

  return next();
});
