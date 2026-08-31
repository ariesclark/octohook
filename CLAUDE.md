# Octohook

A Cloudflare Worker that folds GitHub webhook deliveries into a durable world and draws a Discord
channel from it.

## Looking at a live channel

- `GET /inspect/<secret>` — what a channel holds: revision, counts, every note (key, kind, sha,
  drawn message count) and run. Carries no rendered content; 404s when the channel holds nothing.
- `POST /replay/<secret>` — forgets what each message was last drawn as and draws them all again.

### What a replay cannot do

`/replay` draws every message again **from the event that made it**, so a change to the rendering
reaches messages already in the channel. Each delivery keeps its event beside its note under
`source:<note key>`; a replay renders that event with the code as it stands now, replaces the note's
content where it differs, and edits the message. It never duplicates — a draw edits by the ids the
note holds, and only sends afresh when there is nothing left to edit. What it cannot reach:

- **Notes made before the event was kept.** Anything delivered by an older build has no `source:`
  and is left exactly as it was drawn. Redeliver it once (below) and replays work on it thereafter.
- **Notes past the 48h `retention` in `channel.ts`**, which are forgotten along with their events.
- **Events that now render nothing** (a rename, say): `apply` with no content keeps the old note, and
  a replay skips a note whose event no longer draws, so the stale message stays.

To bring an old message back under the fold, redeliver it from GitHub:
`gh api --method POST /orgs/<org>/hooks/<id>/deliveries/<delivery>/attempts`. A note is keyed
`event.action:<the payload's own clock>` (`occurredAt`, not the delivery time), so a redelivery
normally lands on the same key and edits in place — unless the clock it reads changed since, which
moves the key and posts a second message instead (adding `submitted_at` for reviews did exactly
that). Redelivery re-runs the whole event, including any GitHub lookups it makes.

## Seeing a change before it ships

- `bun src/replay.ts <deliveries.jsonl> [preview|post]` — renders each delivery on its own, no state.
- `bun src/live.ts <deliveries.jsonl> [ms]` — folds a world and patches messages, as production does.
  Only this path shows message merging, check-run boards and anything folded into another message.
- `DISCORD_WEBHOOK=<id>/<token>` picks the channel for both. Replays go to a test channel, never a
  live one.

## Checks

- `pnpm test` runs `node --test` over `src/**/*.test.ts` then vitest over `test/**`. It does **not**
  typecheck: run `pnpm exec tsc --noEmit` separately, or a type error ships.
- `pnpm lint` (oxlint) and `pnpm format` (oxfmt) are separate again; `oxfmt --write <paths>` to fix.

## Discord's component rules, learned the hard way

Discord answers `400 {"components": ["<index>"]}` and the message silently never lands:

- a container cannot hold another container — flatten before folding one message into another;
- a section holds one to three text displays, nothing else (no separator, no container);
- a container with no children at all is invalid, so guard it;
- a message carrying an attachment is multipart, and `merge.ts` folds only `application/json`, so
  any attachment costs message merging.

Custom emoji are resolved by id, but a webhook may only use emoji from its own guild unless
`@everyone` holds Use External Emojis there. When it may not, the content is rewritten to `:name:`
at send time — a silent downgrade, not an error.

## Reading webhook deliveries

Delivery ids exceed the precision of jq's numbers: `--jq '.[].id'` rounds them and every call using
the rounded id 404s. Read the raw JSON (`gh api ... > file`, then parse) and take the id from there.
