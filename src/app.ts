import { env } from "cloudflare:workers";
import { Hono } from "hono";

import { highlight, parse, test } from "liqe";
import { serializeRequest } from "./queue";

const app = new Hono<{ Bindings: CloudflareBindings }>();

type Options = {
  include?: string;
  exclude?: string;
};

const defaultOptions: Options = {
  exclude: "event:check_run.created",
};

function getQuery({ include, exclude }: Options) {
  const { include: defaultInclude, exclude: defaultExclude } = defaultOptions;

  if (defaultExclude) exclude = exclude ? `((${exclude}) OR (${defaultExclude}))` : defaultExclude;
  if (defaultInclude) include = include ? `((${include}) AND (${defaultInclude}))` : defaultInclude;

  const queryString = `${include ? `(${include})` : ""}${include && exclude ? " AND " : ""}${exclude ? `NOT (${exclude})` : ""}`;
  const query = parse(queryString);

  return {
    query,
    queryString,
    include,
    exclude,
  };
}

function formatHighlight(query?: string, data?: Record<string, unknown>) {
  if (!query || !data) return undefined;

  const highlights = highlight(parse(query), data);
  if (highlights.length === 0) return undefined;

  return Object.fromEntries(highlights.map(({ path, query }) => [path, String(query)]));
}

function getMatches({ include, exclude }: Options, event: Record<string, unknown>) {
  return {
    include: formatHighlight(include, event),
    exclude: formatHighlight(exclude, event),
  };
}

app.get("/", ({ redirect }) => redirect("https://github.com/ariesclark/octohook"));

app.post("/:channelId/:token", async ({ req, json }) => {
  const { channelId, token } = req.param();

  const originalRequest = req.raw.clone();

  const name = req.header("x-github-event") || "unknown";
  const body = await req.json<Record<string, unknown>>();

  const event = {
    ...body,
    event: `${name}${body.action ? `.${body.action}` : ""}`,
  };

  const { query, queryString, include, exclude } = getQuery(req.query());

  if (!test(query, event))
    return json({
      message: "Event dropped.",
      query: queryString,
      matches: getMatches({ include, exclude }, event),
    });

  const url = `https://discord.com/api/webhooks/${channelId}/${token}/github`;
  await env.WEBHOOK_QUEUE.send(await serializeRequest(new Request(url, originalRequest)), {
    contentType: "v8",
  });

  return json(
    {
      message: "Event queued.",
      query: queryString,
      matches: getMatches({ include, exclude }, event),
    },
    { status: 202 }
  );
});

export default app;
