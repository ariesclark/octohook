# octohook

Filterable proxy for GitHub webhooks headed to Discord, running on Cloudflare Workers.

## Why

Discord's built-in GitHub webhook endpoint has problems Discord doesn't intend to fix:

- **Discord renders only 18 event types.** It silently discards `workflow_run` events ([discord-api-docs#6203](https://github.com/discord/discord-api-docs/issues/6203)) and rejects `deployment_status` events ([discord-api-docs#5283](https://github.com/discord/discord-api-docs/issues/5283)). Discord's response: **["We will not be adding any new events at this time, sorry."](https://github.com/discord/discord-api-docs/issues/6203#issuecomment-1650544855)**
- **Rate limits silently drop events.** A burst of activity (a push triggering a dozen check runs) exceeds the limit, and the events you care about vanish without an error.
- **No narrowing.** GitHub lets you pick event *types*, but not "check runs, except the successful ones": it's all or nothing per type.

This worker sits in between: GitHub sends events to the worker, which filters them with a [Lucene-like query](https://github.com/gajus/liqe) against the full payload, queues the matches, and delivers them to Discord.

- Filter on any payload field: event type, action, branch, sender, check conclusion.
- The worker retries on rate limits (honoring `retry-after`) and server errors instead of dropping events. Filtering also keeps you under the limit.

The worker still delivers through Discord's `/github` endpoint, so events Discord ignores still don't render. Planned: the worker will render them (`workflow_run`, `deployment_status`, and the rest) as its own embeds.

## Usage

Take your Discord webhook URL:

```
https://discord.com/api/webhooks/<secret>
```

and point your GitHub repository webhook (content type `application/json`) at:

```
https://octohook.aries.fyi/<secret>
```

### Filtering

The worker adds an `event` field of the form `<event>` or `<event>.<action>` (e.g. `push`, `issues.opened`) to each payload. The `include` and `exclude` query parameters match against the whole payload using [liqe syntax](https://github.com/gajus/liqe#query-syntax):

```
# only pushes and merged pull requests
?include=event:push OR (event:pull_request.closed AND pull_request.merged:true)

# everything except bot activity
?exclude=sender.type:Bot

# drop successful check runs, keep the failures
?exclude=event:check_run.completed AND check_run.conclusion:success

# only events for the main branch
?include=ref:"refs/heads/main"
```

Queries live in the webhook URL, so URL-encode them (spaces as `%20`); GitHub's webhook form won't encode for you. Values containing `/` need quotes, as in the branch example, or liqe reads them as regex delimiters.

The response says whether the event was queued or dropped, which query ran, and which fields matched.

## Development

```bash
pnpm install
pnpm dev
pnpm test
pnpm run deploy
```

Deploying needs a [Cloudflare Queue](https://developers.cloudflare.com/queues/) named `octohook-webhooks` (see `wrangler.jsonc`) and your own route in place of `octohook.aries.fyi`.
