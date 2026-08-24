# Octohook

GitHub webhooks rendered for Discord, running on Cloudflare Workers.

## Why

Discord's built-in GitHub webhook endpoint has problems Discord doesn't intend to fix:

- **Discord renders only 18 event types.** It silently discards `workflow_run` events ([discord-api-docs#6203](https://github.com/discord/discord-api-docs/issues/6203)) and rejects `deployment_status` events ([discord-api-docs#5283](https://github.com/discord/discord-api-docs/issues/5283)). Discord's response: **["We will not be adding any new events at this time, sorry."](https://github.com/discord/discord-api-docs/issues/6203#issuecomment-1650544855)**
- **Rate limits silently drop events.** A burst of activity (a push triggering a dozen check runs) exceeds the limit, and the events you care about vanish without an error.
- **No narrowing.** GitHub lets you pick event *types*, but not "check runs, except the successful ones": it's all or nothing per type.
- **One event, one message.** A push and the CI it sets off scatter down the channel as a dozen messages, none of which knows about the others.

Octohook renders every message itself instead of handing the event to Discord, so an event Discord has no drawing for still appears. A commit's CI folds into one message that edits itself as check runs, annotations and deployments arrive. A [Lucene-like query](https://github.com/gajus/liqe) against the full payload decides what gets through.

## Usage

Take your Discord webhook URL:

```
https://discord.com/api/webhooks/<secret>
```

and point your GitHub repository webhook (content type `application/json`) at:

```
https://octohook.aries.fyi/<secret>?token=<github-token>
```

### The token

`?token=` is required, and a hook without one is refused with a 400. Three lookups run under it, and no webhook payload carries what they return:

- `GET /repos/{owner}/{repo}/actions/runs/{id}` for a run's name, its number, and what triggered it.
- `GET /repos/{owner}/{repo}/actions/runs?check_suite_id={id}` to find the run behind a check created through the Checks API, which names no run of its own.
- `GET /repos/{owner}/{repo}/check-runs/{id}/annotations` for the failure messages a board quotes under a job.

A fine-grained personal access token needs read access to Actions and Checks on the repositories the hook covers; a classic token needs `repo`. Make one under Settings, Developer settings, Personal access tokens. A token that can't read one of those endpoints costs you what it would have said: the board draws the run as the payload describes it, with no name, no annotations, and no trigger.

Filters go in the same URL:

```
https://octohook.aries.fyi/<secret>?token=<github-token>&exclude=sender.type:Bot
```

> [!WARNING]
> The token rides in the webhook URL, and GitHub shows that URL in full to anyone with admin on the repository. Use a fine-grained token, read-only, Actions and Checks alone, listing only the repositories that hook here, and one token per hook so revoking it costs one channel. The worker never stores it: it arrives with each delivery and lives in memory only.

### What it draws

Pushes, pull requests, issues, stars, branch and tag deletions, vulnerability alerts, deployment statuses, and the CI board: check runs, workflow runs, their annotations, and the deployments hanging off them.

A run belongs to the event that set it off, so a push and its build are one message. A run nothing in the channel asked for, such as a schedule, a dependency bot, or an issue comment, gets a board of its own. A commit nothing has reported on for 48 hours is let go, measured from when the delivery arrived, so redelivering an old event by hand still draws it.

### Filtering

The worker adds a `type` field of the form `<event>` or `<event>.<action>` (e.g. `push`, `issues.opened`) to each payload. The `include` and `exclude` query parameters match against the whole payload using [liqe syntax](https://github.com/gajus/liqe#query-syntax):

```
# only pushes and merged pull requests
?include=type:push OR (type:pull_request.closed AND pull_request.merged:true)

# everything except bot activity
?exclude=sender.type:Bot

# drop successful check runs, keep the failures
?exclude=type:check_run.completed AND check_run.conclusion:success

# only events for the main branch
?include=ref:"refs/heads/main"
```

Queries live in the webhook URL, so URL-encode them (spaces as `%20`); GitHub's webhook form won't encode for you. Values containing `/` need quotes, as in the branch example, or liqe reads them as regex delimiters.

The response says whether the event was accepted or dropped, which query ran, and which fields matched.

## How it works

One [Durable Object](https://developers.cloudflare.com/durable-objects/) holds each Discord channel. A delivery folds into that channel's world, and the object answers GitHub as soon as it has it, since GitHub won't send an event twice once it has a 2xx. An alarm fires 2 seconds later, or 15 seconds into a burst that keeps coming, draws every message the world implies, and rewrites only the ones that changed. On a rate limit the worker waits out `retry-after` and sends again rather than dropping the message.

The worker builds its messages as JSX and renders them to Discord's components with [`@ariesclark/discord-jsx`](packages/discord-jsx), translating GitHub-flavoured Markdown with [`@ariesclark/markdown-jsx`](packages/markdown-jsx). Every phrase lives in `messages/en-US.json`.

## Development

```bash
pnpm install
pnpm dev
pnpm test
pnpm run deploy
```

Deploying needs your own route in place of `octohook.aries.fyi` (see `wrangler.jsonc`).

## License

[MIT](LICENSE)
