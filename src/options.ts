import { highlight, parse, test } from "liqe";
import invariant from "invariant";
import { createMiddleware } from "hono/factory";
import type { GithubEvent, GithubEventPayload } from "./github";
import type { HookScope } from "./discord/refs";

type Options = {
  include?: string;
  exclude?: string;
};

const defaultOptions: Options = {
  // exclude: "type:check_run.created OR (type:check_run.completed AND check_run.conclusion:/success|skipped/)",
};

export function getQuery({ include, exclude }: Options) {
  const { include: defaultInclude, exclude: defaultExclude } = defaultOptions;

  if (defaultExclude) exclude = exclude ? `((${exclude}) OR (${defaultExclude}))` : defaultExclude;
  if (defaultInclude) include = include ? `((${include}) AND (${defaultInclude}))` : defaultInclude;

  const queryString = `${include ? `(${include})` : ""}${include && exclude ? " AND " : ""}${exclude ? `NOT (${exclude})` : ""}`;

  // An empty query parses to an EmptyExpression, which liqe cannot test: it throws
  // "Expected left to be defined." Filtering on nothing keeps everything.
  const query = queryString ? parse(queryString) : null;

  return {
    matches: (event: Record<string, unknown>) => query === null || test(query, event),
    queryString,
    include,
    exclude,
  };
}

export function formatHighlight(query?: string, data?: Record<string, unknown>) {
  if (!query || !data) return undefined;

  const highlights = highlight(parse(query), data);
  if (highlights.length === 0) return undefined;

  return Object.fromEntries(highlights.map(({ path, query }) => [path, String(query)]));
}

export function getMatches({ include, exclude }: Options, event: Record<string, unknown>) {
  return {
    include: formatHighlight(include, event),
    exclude: formatHighlight(exclude, event),
  };
}

export const optionsMiddleware = createMiddleware<{
  Variables: {
    event: GithubEvent;
    hook: HookScope;
  };
}>(async ({ req, set, json }, next) => {
  const name = req.header("x-github-event");
  if (!name) return json({ message: "Missing x-github-event header." }, { status: 400 });

  const body = await req.raw.clone().json<GithubEventPayload>();

  const { matches, queryString, include, exclude } = getQuery(req.query());

  invariant(!("type" in body), 'Invalid body: "type" property is reserved for internal use.');

  const action = "action" in body ? String(body.action) : undefined;

  const event = {
    ...body,
    type: `${name}${action ? `.${action}` : ""}`,
  } as GithubEvent;

  if (!matches(event))
    return json({
      message: "Event dropped.",
      query: queryString,
      matches: getMatches({ include, exclude }, event),
    });

  // Absent on older deliveries and on replays; a repository hook is the safer assumption,
  // since it only ever omits detail the reader can infer.
  const target = req.header("x-github-hook-installation-target-type");

  set("event", event);
  set("hook", target === "organization" ? "organization" : "repository");

  return next();
});
