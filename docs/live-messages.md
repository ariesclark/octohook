# Live messages

How octohook draws a commit's CI into one Discord message that edits itself as events arrive, why
each decision went the way it did, and what is still undone.

Written 2026-08-21, as a handoff.

---

## 0. Start here

**The immediate question.** The channel object has never run against real traffic. `last-push.jsonl`
replayed cleanly to Spidey Bot — 41 deliveries, one message, 29 edits, no refusals — but that went
through `src/live.ts`, which holds the world in memory and draws on every delivery. The object's
storage, its debounce and its alarm have only ever run under vitest. Deploying is the next thing,
and §1 says what that needs.

**Nothing is half-finished.** 262 tests pass under `node --test` and 10 under vitest, `tsc` and
lint are clean, and the worker builds. Start from the question above, not from archaeology.

**Decisions taken during the port**, all of them Aries's:

- The object is one per **channel**, not one per commit. The plan in this document said
  `repo@sha`; §8 records why that was wrong and what replaced it.
- **No queue.** It was doing four jobs and the object took three; see §8.
- Everything goes through the channel, including events that never gather into a board, so one
  webhook has one sender.
- SQLite storage, and `@cloudflare/vitest-plugin` for the tests.
- The GitHub token comes off the hook's url, not a worker secret, and is taken as given. A check
  that refused a token broader than the lookups need was built and then dropped — she asked for
  it, saw it, and said allow any. Do not put it back. See §9.

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

**Built, not deployed.** The fold/draw/deliver design is now the worker's only path, in
`src/channel.ts`. Confirmed by inspecting the built bundle: `Channel` is exported, `ownerOf`,
`forget`, `mergeAdjacent` and `deliverAll` are all present, and `WEBHOOK_QUEUE` is gone.

Nothing of this has met real traffic yet. The last thing verified against captured deliveries was
a file replay, which draws the same channel it drew before the port.

The worker builds at **816 KiB gzipped** (was 808 before the port, 741 before `messageformat`).

**Deploying it takes two things beyond `wrangler deploy`:**

1. Put a GitHub token on each hook's url — `?token=…`. Without one every board draws with no run
   names, numbers, triggers or annotations. There is no `GITHUB_TOKEN` secret any more; see §9.
   `gh auth token` works, and carries far more than the lookups use.
2. The `octohook-webhooks` queue is no longer consumed by anything. Deleting it will discard
   whatever is still in flight — a few stars and issue messages at worst.

---

## 2. The architecture

Three pieces, in a line. An event never decides what a message looks like.

```
                     src/app.ts        render a note, trim the payload, hand it over
                            │
                            ▼
delivery ──▶ resolveFor(delivery, github)        src/resolve.ts   look everything up first
                     │
                     ▼
             apply(world, delivery, resolved)    src/state.ts     fold
                     │
                     ▼
             compose(world, repository)          src/compose.tsx  draw
                     │
                     ▼
             deliverAll(composed, transport)     src/deliver.ts   send only what changed
```

- **`src/state.ts`** — the world, `apply`, and `forget`. Pure, no I/O, returns a sentence
  describing what it changed. Anything needing the network is resolved by the caller and passed
  in as `Resolved`. That purity is what lets the fold run synchronously inside a Durable Object,
  which is the whole reason two deliveries at once cannot lose each other.
- **`src/resolve.ts`** — every lookup an event needs, in front of the fold rather than inside it.
- **`src/compose.tsx`** — draws the entire channel from the world, every time. Same world, same
  messages. Each carries a stable key.
- **`src/deliver.ts`** — sends only the composed messages whose JSON changed, takes down any the
  world no longer draws, and holds the Discord and dry transports.
- **`src/channel.ts`** — the Durable Object: one per webhook, storage for the world and the
  message ids, and the alarm that draws.
- **`src/foldable.ts`** — which events belong to a commit, and what of an event travels.
- **`src/live.ts`** — the same three steps against captured deliveries, holding the world in
  memory for as long as the replay runs.
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

**Only what needs attention is drawn.** A job is drawn if it failed _or_ it said something — an
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

| file              | contents                          |
| ----------------- | --------------------------------- |
| `day.jsonl`       | 388 deliveries, one full day      |
| `tail.jsonl`      | 143, from the second-to-last push |
| `last-push.jsonl` | 41, the last push only            |
| `pr-277.jsonl`    | 158, everything touching PR #277  |

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
  crossing back up posts a new one at the _bottom_ of the channel, detached from the first.
  Observed in a dry run (`dry-78, dry-90` → `dry-78` → `dry-78, dry-97`).
- **A commit board's message moves** when a late push claims runs that were drawing on their own:
  the run message is taken down and the push message appears at the bottom.
- **Multipart messages** (an event carrying an avatar) deliver their words but drop the attachment.
  The channel object makes this worse, not better: `app.ts` now unwraps `payload_json` and throws
  the parts away.
- **`preview` reports its URL twice** on a green run — once from the deployment status, once from
  the check's own summary. Different sources, same fact.
- **Nothing paces Discord.** `discordTransport` retries a 429 and that is all. The channel object
  is now the one place that could hold a bucket; it does not yet.

---

## 8. The channel object

Built 2026-08-21 against wrangler 4.125.0, `compatibility_date` 2026-08-16. This section used to
be a plan for one object per `${repository.full_name}@${sha}`. That plan was wrong in two ways and
the reasoning is worth keeping, because both mistakes are the kind that read as good practice.

### Why not one object per commit

**It was mis-keyed.** The route is `/:secret`, so nothing stops one repository being wired to two
webhooks. `repo@sha` collides across them: one set of message ids, and the second channel never
drawn. The key had to carry the channel either way — so the atom was never "a commit", it was
"a commit in a channel".

**It threw away what only the channel can see.** `compose(world, repository)` already _is_ a
channel-level function: it draws every message from one world and orders them against each other.
Sharded per commit, each object holds a fragment, and three things stop being expressible:

- **The rate limit.** One webhook is one bucket. The old plan admitted this and bolted on "a
  singleton token-bucket DO per webhook" to compensate.
- **Resurfacing** (§7: a check finishing 34 minutes later, far up-channel). Deciding to repost
  needs to know what is below it.
- **Ordering** between boards, for the same reason.

Per-commit bought sha-based routing and free eviction, then needed a second object to hand back
what it had discarded. One object per webhook — `Channel`, named by the webhook id, not the token,
so rotating the token does not orphan the channel's messages.

The cost, and it is real: a channel's deliveries serialise through one object. At flirtual's ~388
deliveries a day that is nothing, and the per-delivery work is a fold plus a compose either way.
A genuinely hot channel would queue behind it.

### Why there is no queue

The queue predated the fold and was doing four jobs. The object took three:

- **Ordering** a batch by `occurredAt` — dead weight. Arrival order stopped mattering the moment
  compose started drawing from a world. That was the point of the rewrite.
- **Merging** nearby messages — the alarm's debounce does it, and better: it coalesces _edits_ to
  one message rather than concatenating separate ones.
- **Getting off the response path** — `waitUntil` already did that. The old "fine behind a queue,
  not inline" worry was about per-commit objects paying first-touch latency on an always-new name.
  A channel object is named by the webhook id: the same handful of names forever, created once.
- **Retry** — the only one left, and small. `fold()` in `app.ts` retries three times with backoff,
  and the alarm already retries the part that talks to Discord.

`src/queue.ts` and `src/serialize.ts` are gone, and with them the 128 KB message cap that forced
payload trimming. `foldablePayload` stayed anyway — a raw push is mostly a list of commits nothing
reads, and the trimmed payload is what gets written to storage.

Everything goes through the channel now, including events that gather into nothing. A star is a
note in the world with no runs under it, posted once and then drawn identically forever. That kept
one webhook to one sender, and it is what `mergeAdjacent` is for.

### The correctness trap, which the design still turns on

A Durable Object is _not_ safe for read-modify-write across an await:

> "Input gates block new events while synchronous JavaScript execution is in progress. Awaiting
> async operations like `fetch()` … opens the input gate, allowing other requests to interleave."
> — https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/

A naive port — resolve, apply, send — reopens exactly the race the object was meant to close. The
fix is structural, and it survived the reshaping unchanged:

1. **Resolve first.** Every GitHub lookup happens before the world is touched.
2. **Fold synchronously** with `ctx.storage.kv` (the sync API, `worker-configuration.d.ts:3478`).
   No await means the input gate never opens mid-fold. `apply()` is pure and synchronous, so the
   read, the fold and the write are one uninterruptible block. The `setAlarm` at the end is
   awaited _after_ the last write, which is safe: a delivery that interleaves there reads the
   world this one just put.
3. **Send from `alarm()`**, never inline — which also turns ten deliveries into one PATCH.

Cloudflare's own DO skill prescribes optimistic locking or `transaction()` instead. Resolve-first
was preferred because it makes interleaving impossible rather than detecting and retrying it, and
a retry around this reducer would re-issue its GitHub calls. There is a test for it:
_"loses neither of two deliveries folded at once"_.

### Storage

All via `ctx.storage.kv`, on a SQLite-backed class:

| key                       | holds                                                                     |
| ------------------------- | ------------------------------------------------------------------------- |
| `world`                   | the whole channel's world, `Map` and all — structured clone keeps it      |
| `meta`                    | the webhook secret, the hook scope, and the last repository seen          |
| `sent:<composeKey>`       | `{ ids, drawn }` for one composed message                                 |
| `flushAt`, `pendingSince` | the debounce: draw 2s after the last delivery, 15s after the first        |
| `revision`                | bumped on every fold, so the alarm knows whether it drew the latest world |

`revision` is what makes the flush safe against a delivery arriving mid-draw. The alarm draws,
compares the revision it drew against the current one, and only clears the pending flush if they
match. Do not use `getAlarm()` for this — it returns null while an alarm is running.

The world does not grow forever: `forget(world, before)` drops runs that stopped reporting more
than six hours ago, and the notes nothing surviving belongs to. It returns the composed keys it
dropped so their `sent:` entries go in the same breath — a forgotten message has to be **left
where it is** in the channel, and anything still holding its id would read the absence as "no
longer true" and take it down.

Retention is measured against when a thing _happened_, not when it arrived. An event delivered
more than six hours after the fact is folded and forgotten in the same call. That is coherent —
it is not news — but it is silent.

### Gotchas that hit this design

- **Module-level globals break in a DO.** `run.ts` used to hold the token and its caches at module
  scope; instances share an isolate, so that is one channel's credentials in another's hands. It
  is now `createGithub(token)`, one client per object, held as an instance field.
- **Hibernation discards in-memory state** after ~10s idle, eviction at 70–140s, and on every
  deploy. The world and the `sent` map live in storage; the GitHub cache does not, and losing it
  costs a request. There is a test: _"keeps the message it holds across being evicted"_.
- **Alarms are at-least-once.** Ids are written as each message is captured rather than at the end
  of the flush, so a crash between two sends leaves ids to reuse rather than orphans.
- **`ctx.waitUntil` does nothing inside a DO.**
- **An alarm fired early is harmless.** The handler used to bail if the wall clock had not reached
  `flushAt`, which made it untestable — `runDurableObjectAlarm` exists to fire early. The guard is
  gone: drawing sooner than the debounce asked for is only less patient, and the revision check
  makes it self-correcting.

### Still open

- **Discord's per-channel edit rate limit** is deliberately unpublished. Nothing paces sends yet
  beyond the 429 retry in `discordTransport` — the object is now the one place that _could_.
- Minimum useful alarm granularity, and whether a pending alarm alone incurs duration billing.
- The old `src/replay.ts` and `src/a.ts` still use `mergeRequests` and predate all of this.

---

## 9. The hook's token

The token rides on the hook's own url as `?token=…`, beside `?include=` and `?exclude=`. One
worker no longer holds one credential for everybody, so two hooks pointing here can read two
different organisations — and the token never reaches storage, because every lookup happens in
`deliver` and the alarm that draws needs no credentials at all.

Any token is accepted as it is given. What the two lookups actually need is `repo` on a private
repository, `public_repo` or no scope at all on a public one; a fine-grained token wants Actions
read and Checks read and nothing else. Nothing enforces that.

The url is now a place a GitHub token lives. The Discord webhook secret was already in the path,
so the url was always a credential, but a PAT is a broader one — and `observability.traces` is on,
so request urls reach Cloudflare's dashboard.

---

## 10. The flirtual side

Not this repo, but it shapes what the log has to show. Tracked with the `flirtual` session.

- **Double CI runs are deliberate.** `frontend.yaml`, `api.yaml` and `deploy-classification.yaml`
  trigger on both `push` and `pull_request`, and the two runs deploy _different_ previews — a SHA
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

## 11. Verifying a change

```bash
pnpm exec tsc --noEmit
pnpm test                           # 262 under node --test, then 7 under vitest
pnpm lint
pnpm exec wrangler deploy --dry-run --outdir /tmp/dist
```

`pnpm test` used to glob `src/*.test.ts` and miss every nested file. It runs both suites now.

Tests live where the logic is pure: `state.ts`, `annotations.ts`, `limits.ts`, `messages.ts`,
`run.ts`, `merge.ts`, `options.ts`. The JSX renderers have none — they are verified by replaying
real deliveries and reading the output.

`test/channel.test.ts` is the exception, and runs under vitest because `node --test` cannot fire
an alarm. Two things about it bite:

- **Give every test its own channel name.** Storage outlives a test in this pool, and a channel
  still holding the last test's world draws it again.
- **Never write a date into a fixture.** Retention is measured against when a thing happened, so a
  dated fixture is forgotten in the same call that folds it. Use `secondsAgo`, and take each
  moment _once_ — a note's identity is its timestamp, so asking twice makes two messages.

The vitest config carries one workaround worth knowing about: `discord-api-types`' module build is
a shim that reads every name off a CommonJS default import, and that default lands as `undefined`
in this pool. A resolver plugin points at the CommonJS file instead. Rewriting the pool's resolve
conditions looks like the tidier fix and is not — `photon` asks for `workerd` and gets handed
`node`, which then tries to compile WebAssembly and is refused.

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
