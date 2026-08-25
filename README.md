# Octohook

**One message per commit, editing itself live as CI lands.**

## Why

Discord's built-in `/github` integration loses what matters and repeats the rest. It discards every `workflow_run` ([#6203](https://github.com/discord/discord-api-docs/issues/6203)), rejects every `deployment_status` ([#5283](https://github.com/discord/discord-api-docs/issues/5283)), and declined new events outright: *"We will not be adding any new events at this time, sorry."* The events it does accept arrive one post each, none aware of the others: a push trailed by ten check runs is eleven messages. Meanwhile the cron that broke overnight never appears at all.

Octohook is a Cloudflare Worker that receives the webhook instead. It renders each Discord message itself: it shows the events Discord drops, collapses a commit's trail into one board, and its filters name what a message is: the run that failed, the cron that broke, rather than when it happened.

## Features

- **One message per commit+CI.** A push, its check runs, annotations, and deployments collapse into a single board that edits itself in place as results arrive.
- **The events Discord throws away.** `workflow_run` and `deployment_status` both appear ([discord-api-docs#6203](https://github.com/discord/discord-api-docs/issues/6203), [#5283](https://github.com/discord/discord-api-docs/issues/5283)).
- **Patient under rate limits.** On a limit it waits the seconds Discord names and sends again. Your event arrives late, not never.
- **The step a job is on.** While a run is in flight the board names the step each job is working through, and drops it once the job has a verdict.
- **Filtering that filters.** `include` and `exclude` parameters, written in [liqe](https://github.com/gajus/liqe#query-syntax) query syntax, decide what the channel draws.
- **A bad query fails loud.** Refused whole, never half-applied, reported back to GitHub where you can read it.

## Quick start

1. In your repository (Settings → Webhooks), add a webhook pointed at:

   ```
   https://octohook.aries.fyi/<secret>?token=<github-token>
   ```

2. Set the content type to `application/json`.
3. Push something. One message appears, and it keeps itself current.

## Configuration

### Token

`?token=` is required. Requests without one get `400`.

Use a fine-grained personal access token with read access to Actions and Checks. On classic tokens, the `repo` scope works.

> **Warning:** the token travels in the URL. Anyone who can see the webhook, repository admins included, can read it. Keep it fine-grained and read-only.

### Filtering

A backup job runs every hour. When it passes, nobody reads it. When it fails at 2am, someone needs to. Filters keep the channel quiet until that second case, so what is left in it is worth reading. The same goes for dependency bots opening pull requests all day, and for a workflow whose failures you already watch elsewhere.

Filters are query parameters on the same URL: `?exclude=type:star`.

Queries follow [liqe query syntax](https://github.com/gajus/liqe#query-syntax); the fields live in [`src/policy.ts`](src/policy.ts). Every message carries `repository`, `branch`, `sha` and `type`. `type` is the GitHub event's own name (`push`, `pull_request`, `issues`, `star`, `delete`), or `run` for a CI board. Events add `by` and `bot`: who did it, and whether a bot did it. Runs carry neither; a check-run payload names no actor.

| Run field | What it matches |
| --- | --- |
| `trigger` | what set the run off: push, schedule, workflow_dispatch, release, issues, issue_comment |
| `workflow` | workflow name |
| `number` | the workflow run's number, like 14244 |
| `result` | passed, failed, running, skipped, cancelled |
| `ever` | worst result held so far: a green re-run stays failed |
| `jobs.total` / `jobs.failed` / `jobs.passed` / `jobs.running` / `jobs.skipped` | job counts |
| `details` | what the board draws under the run: annotations, job summaries, deployments |
| `annotations` | how many warnings or worse a reader would see |
| `deployments` | how many environments it shipped to |
| `seconds` | how long it ran |

Four rules:

1. Each message is judged alone. Hide a push and its CI still stands there as a board, so name the run too.
2. A query belongs to the repository whose hook carried it, so several repositories can share one channel.
3. URL-encode the values, spaces as `%20`. Quote a value holding `/` or a space, as in `workflow:"Nightly backup"`, or liqe parses it as a regex.
4. A query naming an unknown field, or one liqe cannot parse, is refused whole and everything draws until you fix it. Octohook answers `202` and lists the problem under `refused`, visible in the delivery pane of your webhook settings.

#### Examples

**Silence work that went fine and said nothing.** The one to put on every hook. A run draws while it is going, stays if it fails, and takes itself down when it finishes with nothing under it.

```
?preset=recommended
```

`recommended` is a name for `exclude=type:run AND (ever:passed OR ever:skipped OR ever:cancelled) AND details:0`: the three ways a run finishes with nothing to say, and nothing written under it. `ever` rather than `result` keeps a board up after someone re-runs a failure green. A hook says the word rather than URL-encoding the sentence. Nothing is hidden in it: the `202` reports the query it resolved to under `drawing`, so GitHub's delivery pane shows what your hook is actually running, and a name spelled wrong is refused the way any unreadable query is.

Write the query out yourself when it does not fit, and keep both if you like: a preset and your own `exclude` are joined with `OR`.

```
?preset=recommended&exclude=type:star
```

**Only what failed.** The channel sits empty until something needs a person.

```
?include=result:failed
```

**Nothing from bots.** The first drops what the bot did. The second also drops the green builds its pushes set off.

```
?exclude=bot:true
?exclude=bot:true OR (type:run AND ever:passed)
```

## How it works

- Every Discord channel gets its own Durable Object (`src/channel.ts`). Events for one channel queue behind each other instead of fighting.
- GitHub is acked instantly, since it does not resend an event answered `2xx`. An alarm redraws two seconds later, fifteen during bursts, so a push trailed by ten check runs costs one edit, not eleven.
- While a run has a job without a verdict, the channel asks GitHub what step it is on every five seconds, sending the last `ETag` so an answer that has not changed costs no rate limit. It gives up after 20 minutes.
- Delivery state is retained for 48 hours.
- Cleanup tolerates Discord being difficult: up to 25 delete attempts per draw, across up to 20 rounds (`src/deliver.ts`).

## Development

```sh
pnpm install
pnpm dev          # local dev server
pnpm test         # run the tests
pnpm run deploy   # deploy to Cloudflare
```

Deploying needs your own Cloudflare route in place of `octohook.aries.fyi` (see `wrangler.jsonc`).

## License

[MIT](LICENSE)
