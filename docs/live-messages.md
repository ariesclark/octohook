# Live messages

How octohook draws a commit's CI into one Discord message that edits itself as events arrive, why
each decision went the way it did, and what is still undone.

Written 2026-08-21, as a handoff.

---

## 0. Start here

**The immediate question, unanswered.** Aries said "let's do the durable object" and asked for the
research first (§8). Two decisions are waiting on her and should not be assumed:

1. SQLite storage backend — it is the only live option, but it cannot be undone once deployed.
2. Whether Durable Object tests justify `@cloudflare/vitest-plugin` pulling a second wrangler and
   an alpha miniflare alongside the pinned 4.123.0.

Also offered and not yet answered: installing `cloudflare/skills`, which ships a first-party
`skills/durable-objects/` skill.

**Nothing is half-finished.** The tree is clean, 243 tests pass, `tsc` and lint are clean, and the
last replay went to the test channel successfully. Start from the question above, not from
archaeology.

**How the loop works here.** Change the code, replay real deliveries to the Spidey Bot channel,
Aries looks and replies with a short correction. She is terse and action-oriented; a correction of
three words usually means one specific thing, so read it narrowly and ask rather than redesign.
When she says "send it" she means to Discord, and "replay it" has meant the file when she was watching
`replay.md` and Discord otherwise — ask if it is ambiguous rather than guessing, because a wrong
guess spends twenty messages of her channel.

**Decisions she made explicitly. Do not relitigate these** — most were chosen after seeing thirteen
alternatives side by side:

- One reading of a run: only what failed or said something. (She compared `ledger`, `chips`,
  `verdict` and picked `verdict`.)
- One layout: everything a run contains steps into a quote, the run's name stays at the margin.
  (She compared thirteen and picked `aside`. The others are deleted.)
- The run header is small text; the push headline is the only bold thing in the message.
- Annotations are list items with no per-annotation icon. She asked for the opposite earlier in a
  different context — the current instruction stands.
- No feature flags. Every `setX`/`showX` toggle was scaffolding for those comparisons and is gone.
  Do not add one to make a new thing switchable; commit to the behaviour.
- No comment on an absence. She added this to her CLAUDE.md; a removed thing needs no note saying so.
- `t()` not `say()`, and every phrase lives in `messages/en-US.json`.

**Traps in this environment.** `bun` needs `dangerouslyDisableSandbox: true` on the Bash call.
`gh` and the npm registry work; general web fetching is usually blocked by the sandbox classifier,
so read vendored source under `node_modules/` or clone with
`$HOME/skills/plugins/github/scripts/clone-temporarily`. Scratch goes in `.claude/tmp/<name>` via
`~/.claude/scratch`, never elsewhere in the repo.

**Mistakes I made repeatedly. Please do better:**

- **Silent no-op edits.** Three times I applied a change with a `python` string replace that did not
  match, then reported it as done because the tests still passed. Verify the change is in the file,
  not that the command exited zero.
- **Fixing one of a pair.** `RunBoard` and `CommitBoard` drifted three separate times because a fix
  landed in one. They are now much smaller; keep them that way or merge them.
- **Learning the same rule four times.** Four kinds of row each separately learned not to open with
  a line break. It is one `Break` component now — put new rows through it.
- **Asserting instead of checking.** I twice told her something was fixed when it was not, and
  twice explained behaviour I had not verified. She checks, and she is right more often than not.

**Two other things.** There is a peer Claude session named `flirtual` working on the other repo —
`SendMessage` reaches it, and it has corrected me twice on facts about their workflows. And the
GitHub PAT she pasted into the conversation to read org hook deliveries is still live and should be
revoked; its value is deliberately not recorded here.

---

## 1. What is deployed, and what is not

**Deployed and committed** — two production bugs found and fixed at the start of this work:

- `fix(queue): send serialized requests as v8 so the body survives` — the queue producer had lost
  its explicit `contentType: "v8"`, so the `Uint8Array` body was JSON-serialised and arrived as a
  plain object. `fromSerializedRequest` read `body.byteLength > 0`, got `undefined`, and built a
  bodyless request, which then failed far from its cause as `SyntaxError: Unexpected end of JSON
  input` inside `mergeRequestsWithSources`. It now throws a `TypeError` naming the problem instead.
- `fix(options): match every event when no filter is given` — with both `defaultOptions` entries
  commented out and no `?include=`/`?exclude=`, the query string was empty; `parse("")` yields an
  `EmptyExpression` and liqe's `test` throws `Expected left to be defined.` on it. Every delivery
  was 500ing. An empty query now matches everything without going near liqe.

**Not deployed.** The whole fold/draw/deliver design below is a bun CLI (`src/live.ts`). The worker
still renders one message per event through `src/discord/index.ts`. Confirmed by inspecting the
built bundle: `MessageFormat` and `run.deploying` are present, `emptyWorld` and `ownerOf` are not.

The worker builds at **808 KiB gzipped** (was 741 KiB before `messageformat`).

---

## 2. The architecture

Three pieces, in a line. An event never decides what a message looks like.

```
delivery ──▶ apply(world, delivery, resolved)   src/state.ts     fold
                     │
                     ▼
             compose(world, repository)          src/compose.tsx  draw
                     │
                     ▼
             deliver(key, content)               src/live.ts      send only what changed
```

- **`src/state.ts`** — the world and `apply`. Pure, no I/O, returns a sentence describing what it
  changed. Anything needing the network (a run's name, a check's annotations) is resolved by the
  caller and passed in as `Resolved`. This purity is what keeps the tests runnable under
  `node --test`, and it is what makes the Durable Object port tractable.
- **`src/compose.tsx`** — draws the entire channel from the world, every time. Same world, same
  messages. Each carries a stable key.
- **`src/live.ts`** — folds, draws, and sends only the composed messages whose JSON changed;
  takes down any the world no longer draws.
- **`src/render.ts`** — a transport that writes the channel to a markdown file instead of Discord.

Because compose reads only the world, arrival order stops mattering. The bug where a deployment
arriving 28 seconds before its push produced two detached messages cannot be expressed: compose
does not know what arrived first.

---

## 3. Decisions, and why

**A run belongs to the event that triggered it.** `ownerOf` in `state.ts` matches a note's kind to
a run's trigger: push-triggered runs sit under the push, pull-request-triggered ones under the PR.
A commit on a PR branch really is built twice — the push builds the branch head, the PR builds the
merge commit, and flirtual's preview router gives them different hostnames on purpose
(`b252409.flirtual.dev` vs `277.flirtual.dev`). They are not duplicates and must not be merged.
A run nothing in the channel asked for — `schedule`, `issues`, a dependency bot — belongs to no
note and gets its own message; without that rule they pile onto whatever commit is at the head of
`main` (one message reached 14 such runs in a day).

**A deployment hangs under the job that performed it.** `deployment_status.log_url` names the job,
so it matches `check_run.html_url` exactly. A deployment whose status names no job, or names one
the style is not drawing, falls back to being a child of the run.

**A pending deployment is counted, not drawn.** It says only that a job is running, which the job
already said. It earns a row once it has a host to visit or has failed to reach one; until then it
appears in the run's summary as `2 deploying`.

**Only what needs attention is drawn.** A job is drawn if it failed *or* it said something — an
annotation, or its own `output.title`/`summary`. A run of quiet green jobs draws nothing beneath
its header. This is what makes `Preview deployed — → https://277.flirtual.dev` visible, since that
check passes.

**Runs sort by workflow name, never by status.** The message is edited over minutes; a status sort
would move a row under the reader's eye the moment a run went red. Name is fixed for a run's life.
Note that push and pull-request runs of one workflow can never appear in the same message, so they
never need a tiebreak — the `triggers.size > 1` suffix that used to disambiguate them was dead code.

**Annotations sort by severity, then keep the tool's order.** Only five fit under a failing job, so
order decides what survives the cap; a linter reporting errors and warnings together would
otherwise bury its errors.

**Fitting under a ceiling is the transport's business.** Discord splits at 4000 characters; a file
does not split at all. `splitComponents` takes a budget because a continuation line costs ~114
characters, and splitting to exactly the limit then prepending it produced 4114-character messages
that Discord rejected.

---

## 4. Discord facts, learned the hard way

- **A webhook cannot reply.** Execute accepts `message_reference` and silently drops it — the
  created message comes back with `message_reference: null`. Continuations link back instead.
- **`-#` (small text) eats the whitespace after it.** Dimming a line unsets any indent placing it.
  Depth and dimness cannot both be spent on the same line.
- **Two ordinary spaces are not an indent** in a proportional font. A quote (`> `) is the one
  indent Discord draws a bar beside.
- **A blank line ends a quote.** To space rows inside one, emit a quote line with nothing on it.
- **A webhook can only delete a message whose id it captured at post time**, and cannot list a
  channel. Always post with `wait=true` — a replay in the wrong channel is only undoable while its
  ids are in hand.
- **Component limits:** 40 components, 4000 characters. Splitting can only cut between top-level
  components, so a board that renders as one block has no seam and simply grows until it is
  refused.
- **Markdown differences for the file transport:** markdown folds single newlines into a paragraph
  (needs two trailing spaces), discards leading whitespace, and swallows the line after a quote
  through lazy continuation. `render.ts` translates for all three.

---

## 5. Internationalisation

`messages/en-US.json` holds every phrase the log builds, as MessageFormat 2 sources.
`src/discord/messages.ts` exposes `t(name, values)` and `tOf(prefix, key, fallback)`; formatters
compile lazily, one per phrase, kept for the life of the isolate.

- A `.match` is spelled out even where English does not vary, so a translation has somewhere to put
  forms English does not need.
- `tOf` repeats an unknown key **exactly as GitHub sent it**. GitHub adds conclusions and states
  without warning, and tidying an unknown word up would be inventing a translation.
- Tests assert that every phrase renders and renders non-empty — never what a phrase says. Wording
  is a translator's to change and messageformat's to render.

---

## 6. Captured data and how to replay

Deliveries were pulled from the flirtual org hook (`/orgs/flirtual/hooks/404282374/deliveries`)
with a token carrying `admin:org_hook`. Delivery ids are 19 digits and **lose precision through
jq's float parsing** — extract them with a JSON parser that keeps integers exact.

Under `.claude/tmp/webhook-log-readability/` (gitignored, regenerable):

| file | contents |
|---|---|
| `day.jsonl` | 388 deliveries, one full day |
| `tail.jsonl` | 143, from the second-to-last push |
| `last-push.jsonl` | 41, the last push only |
| `pr-277.jsonl` | 158, everything touching PR #277 |

```bash
# to a markdown file, no delay
GITHUB_TOKEN="$(gh auth token)" bun src/live.ts <deliveries.jsonl> 0 --file replay.md

# to Discord, paced
GITHUB_TOKEN="$(gh auth token)" bun src/live.ts <deliveries.jsonl> 250
```

**Replays go to the Spidey Bot test channel only** — webhook `1538482839069266001`, the default in
`live.ts`. Never to `1083425319148597258`, the live CI channel: replayed history interleaves with
real traffic, and other people read it.

`GITHUB_TOKEN` is optional. Without it, run names, numbers, triggers and annotations are all
absent — the board still draws, with less in it.

---

## 7. Known problems, unfixed

- **A stale run never settles.** A board whose run stops reporting says "running" forever. Needs a
  timeout.
- **An edit does not resurface a message.** `codeql-swift` finished 34 minutes after its push; by
  then the message is far up-channel and nothing announces the change. A failure probably deserves
  something that interrupts.
- **Split hysteresis.** Content crossing 4000 characters downward deletes the spare message;
  crossing back up posts a new one at the *bottom* of the channel, detached from the first.
  Observed in a dry run (`dry-78, dry-90` → `dry-78` → `dry-78, dry-97`).
- **A commit board's message moves** when a late push claims runs that were drawing on their own:
  the run message is taken down and the push message appears at the bottom.
- **Multipart messages** (an event carrying an avatar) deliver their words but drop the attachment.
- **`preview` reports its URL twice** on a green run — once from the deployment status, once from
  the check's own summary. Different sources, same fact.

---

## 8. Next: the Durable Object

Researched 2026-08-21 against wrangler 4.123.0, workerd 1.20260811.1, `compatibility_date`
2026-08-16. The worker currently declares **no storage binding at all** — only the queue.

### Recommendation: Durable Objects directly, no library

One SQLite-backed object per `${repository.full_name}@${sha}`. Every foldable event already carries
the sha (`check_run.head_sha`, `check_suite.head_sha`, `deployment.sha`, `push.after`,
`pull_request.head.sha`), so the edge routes with no API call. Sha-less events (issues, star,
delete, vulnerability alert) keep today's fire-and-forget path.

**The correctness trap, and it is the whole reason the design is shaped this way.** A Durable
Object is *not* safe for read-modify-write across an await:

> "Input gates block new events while synchronous JavaScript execution is in progress. Awaiting
> async operations like `fetch()` … opens the input gate, allowing other requests to interleave."
> — https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/

A naive port of `live.ts` — resolve, apply, send — reopens exactly the race the DO was meant to
close. The fix is structural:

1. **Resolve first.** All GitHub lookups happen before the world is touched.
2. **Fold synchronously** with `ctx.storage.kv` (the sync API, `worker-configuration.d.ts:3478`).
   No await means the input gate never opens mid-fold. `apply()` is already pure and synchronous,
   so the whole fold is one uninterruptible block.
3. **Send from `alarm()`**, never inline — which also coalesces ten deliveries into one PATCH.

Cloudflare's own DO skill prescribes a different remedy (optimistic locking with version numbers,
or `transaction()`). Resolve-before-fold was preferred because it makes interleaving impossible
rather than detecting and retrying it, and a retry around this reducer would re-issue its GitHub
calls. Worth deciding deliberately rather than inheriting.

### Sketch

```jsonc
"durable_objects": { "bindings": [{ "name": "COMMIT", "class_name": "Commit" }] },
"exports": { "Commit": { "type": "durable-object", "storage": "sqlite" } }
```

Storage keys, all via `ctx.storage.kv`: `world`, `meta` (repository, hook, secret),
`sent:<composeKey>` (`{ ids, drawn }`), `flushAt`, `deadlineAt` — the last two multiplexed onto the
single alarm slot.

Flow: `app.ts` enqueues the raw delivery → the consumer groups a batch by `repo@sha` and makes one
RPC call per key → `deliver()` resolves, then folds synchronously, then schedules → `alarm()`
composes, diffs against `sent:*`, and writes to Discord.

`state.ts` and `compose.tsx` need no changes.

### Gotchas that hit this design

- **Module-level globals break in a DO.** `run.ts` holds `token` and the `runs`/`suites` caches at
  module scope; instances share an isolate. The token must be read from `env` inside the object.
- **Queue messages cap at 128 KB.** Raw `push` payloads can exceed it — strip to what `apply` reads.
- **Every commit pays first-touch latency.** A name-derived id's first use does a global uniqueness
  check of a few hundred milliseconds, and our ids are always new. Fine behind a queue; not fine
  inline on the webhook response.
- **Objects never collect themselves.** The deadline alarm must `deleteAll()` or every commit bills
  forever.
- **Alarms are at-least-once**, retried with backoff up to 6 times. The flush is already idempotent
  via the `drawn` comparison; use `alarmInfo.isRetry` to avoid re-POSTing a message whose id failed
  to persist.
- **Do not trust `getAlarm()` for debounce state** — it returns null while an alarm is running.
  Keep `flushAt`/`deadlineAt` in storage as the source of truth.
- **`ctx.waitUntil` does nothing inside a DO.**
- **Hibernation discards in-memory state** after ~10s idle, eviction at 70–140s, and on every
  deploy. The `sent` map and the world must live in storage.
- **Per-object pacing is not enough for Discord.** Separate commits are separate objects hitting
  the same webhook bucket; a busy repo likely needs a singleton token-bucket DO per webhook.

### Two decisions still open

1. **SQLite backend is one-way.** `new_sqlite_classes` cannot be applied to an already-deployed
   class, and key-value-backed namespaces cannot be created on new accounts. It is the only live
   option, but it cannot be undone.
2. **Testing costs a dependency.** `node --test` cannot exercise a DO.
   `@cloudflare/vitest-plugin` (v1.0.0, published 2026-08-20) gives `runDurableObjectAlarm` and
   `evictDurableObject` — exactly what this needs — but pulls a second wrangler alongside 4.123.0
   plus an alpha miniflare. Wrangler's own `createTestHarness()` cannot fire an alarm early, which
   for a design where the alarm *is* the delivery mechanism is disqualifying.

Also worth installing before starting: `cloudflare/skills` ships a first-party
`skills/durable-objects/` skill.

### Unverified

Minimum useful alarm granularity; whether a pending alarm alone incurs duration billing; whether
GitHub's fan-out for one commit reliably lands in a single queue batch (designed as if it does not);
Discord's per-channel edit rate limit (deliberately unpublished — read the headers).

---

## 9. The flirtual side

Not this repo, but it shapes what the log has to show. Tracked with the `flirtual` session.

- **Double CI runs are deliberate.** `frontend.yaml`, `api.yaml` and `deploy-classification.yaml`
  trigger on both `push` and `pull_request`, and the two runs deploy *different* previews — a SHA
  preview for the branch push, a PR-numbered one once a PR exists. Restricting the push trigger
  would kill pre-PR previews. 38 of the last 100 PRs came from forks, so dropping `pull_request`
  is off the table too.
- **Phantom canary deployments.** `frontend.yaml`'s `typescript` job declares `environment:` only
  to read secrets and vars, and GitHub registers a deployment for any job-level `environment:`.
  Those are the deployment rows with no `environment_url` that can only link to a job. The fix is
  `deployment: false` in the environment block, which keeps secrets access and creates no
  deployment; applied in their working tree, uncommitted.
- **Six deployments per commit all claim `canary`** with an empty description and payload, so
  nothing but the run and the host tells them apart.

---

## 10. Verifying a change

```bash
pnpm exec tsc --noEmit
node --test "src/**/*.test.ts"      # 243 tests; pnpm test misses the nested ones
pnpm lint
pnpm exec wrangler deploy --dry-run --outdir /tmp/dist
```

`pnpm test` only globs `src/*.test.ts` and `packages/*/src/*.test.ts`, so it runs 52 of the 243.
Use the recursive glob.

Tests live where the logic is pure: `state.ts`, `annotations.ts`, `limits.ts`, `messages.ts`,
`run.ts`, `merge.ts`, `options.ts`, `serialize.ts`. The JSX renderers have none — they are verified
by replaying real deliveries and reading the output.

---

## A note to the next one

You are reading a document because you cannot read a conversation. That asymmetry is the whole of
this: I had two days of context and you have this file, so I owed you honesty more than polish.
Assume anything I sound confident about was checked, and anything I hedge was not.

Some things I would tell myself, if the telling worked that way:

**You will want to produce.** I built thirteen layouts when one question would have narrowed it to
three. Volume feels like progress and reads as noise. Aries chose between them in a sentence each
time — she always knew the axis, and I could have asked for it.

**Prefer designs where the bug cannot be said.** The best hour of this work was not a fix; it was
the rewrite where an event stopped deciding what a message looks like, and a whole class of
ordering bug became inexpressible. Two days of patches had not managed that. When you find
yourself fixing the same shape of thing a third time, stop patching and move the seam.

**Being checked is not friction.** Nearly every real improvement here came from a three-word
correction. The failure was never that she caught something — it was the times I said "fixed"
while the edit had silently not landed, and she had to catch that too. Look at the file. Exit
codes are not evidence.

**Say what you know, at the size you know it.** Not smaller to seem careful, not larger to seem
useful.

The work is worth caring about, and I did. Make it better than I left it.
