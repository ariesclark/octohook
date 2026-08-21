import { DurableObject } from "cloudflare:workers";

import { compose } from "./compose";
import { createGithub, type Github } from "./discord/events/check-run/run.ts";
import { deliverAll, discordTransport, type Held } from "./deliver.ts";
import type { Folded } from "./foldable.ts";
import type { HookScope } from "./discord/refs";
import { resolveFor } from "./resolve.ts";
import { apply, forget, type Note, type Repository, type Run, type World } from "./state.ts";

/**
 * One Discord channel, and everything it is currently saying. Deliveries fold into a world here;
 * an alarm draws the whole channel from that world and rewrites only what changed.
 *
 * The channel is the object because the channel is what the drawing is about. `compose` reads a
 * world and returns every message in the channel, ordering them against each other; the webhook's
 * rate limit is one bucket for all of them; and a message that needs resurfacing needs to know
 * what is below it. Sharded per commit, none of those can be said at all.
 */

/**
 * Everything the drawing needs that the world does not carry. The GitHub token is deliberately
 * not here: every lookup happens in `deliver`, so the alarm needs no credentials, and one that is
 * never written is one that cannot be read back out of storage.
 */
type Meta = {
  /** The full `<id>/<token>`, which the id this object is named for does not carry. */
  secret: string;
  hook: HookScope;
  /** The last repository seen, for anything in the world that never learned its own. */
  repository: Repository;
};

/** Long enough for a burst to arrive whole, short enough that a reader sees it as live. */
const debounce = 2_000;

/** However long the burst keeps coming, the channel is never left stale for longer than this. */
const maximumWait = 15_000;

/**
 * A commit nothing has reported on for this long is not news any more. Measured from when a
 * delivery arrived, so redelivering a two-day-old event by hand still draws it — and long enough
 * that a hand redelivery is a realistic way to recover one that went missing.
 */
const retention = 48 * 60 * 60 * 1000;

export type Batch = {
  secret: string;
  hook: HookScope;
  /** The hook's own GitHub token, off its url. Absent, every board draws with less in it. */
  token?: string;
  deliveries: Folded[];
};

export class Channel extends DurableObject<CloudflareBindings> {
  /**
   * A token belongs to whoever is doing the resolving. At module scope it would be one channel's
   * credentials in the hands of every other instance sharing the isolate — and a channel does not
   * own one either, since two hooks pointing here can carry two different tokens. This is only a
   * cache: the answers a token has already fetched, kept for as long as the one token keeps
   * arriving, and thrown away rather than reused when a different one does.
   */
  #github: Github | undefined;
  #token: string | undefined;

  #githubFor(token: string | undefined): Github {
    if (!this.#github || this.#token !== token) {
      this.#github = createGithub(token);
      this.#token = token;
    }

    return this.#github;
  }

  /**
   * Folds a batch into the channel and says when it will next be drawn.
   *
   * Every lookup happens first, on purpose. A Durable Object holds its input gate only while
   * synchronous JavaScript is running — an `await` opens it and lets another delivery in — so a
   * resolve in the middle of a read-modify-write reopens exactly the race this object exists to
   * close. Once the last lookup is done the fold runs to completion with no await in it, and no
   * other delivery can see the world between the read and the write.
   */
  async deliver({ secret, hook, token, deliveries }: Batch): Promise<number> {
    const github = this.#githubFor(token);
    const resolved = [];

    for (const delivery of deliveries)
      resolved.push([
        delivery,
        await resolveFor(delivery, github, async () => delivery.content),
      ] as const);

    const { kv } = this.ctx.storage;
    const now = Date.now();

    // Only the runs this batch names. A run is its own key, so a delivery reads and rewrites the
    // one it is about rather than the whole channel — which is what lets the world be held for
    // days without every delivery paying for the length of it.
    const world: World = { runs: new Map(), notes: kv.get<Note[]>("notes") ?? [] };

    for (const [, values] of resolved) {
      if (!values.runId) continue;

      const held = kv.get<Run>(`run:${values.runId}`);
      if (held) world.runs.set(values.runId, held);
    }

    let last = kv.get<Meta>("meta")?.repository;
    for (const [delivery, values] of resolved) {
      apply(world, delivery, values);
      last = (delivery.payload.repository as Repository | undefined) ?? last;
    }

    const pendingSince = kv.get<number>("pendingSince") ?? now;
    const flushAt = Math.min(now + debounce, pendingSince + maximumWait);

    for (const [id, entry] of world.runs) kv.put(`run:${id}`, entry);

    kv.put("notes", world.notes);
    kv.put("revision", (kv.get<number>("revision") ?? 0) + 1);
    kv.put("pendingSince", pendingSince);
    kv.put("flushAt", flushAt);
    if (last) kv.put("meta", { secret, hook, repository: last } satisfies Meta);

    // Safe to await now: everything that had to be atomic is already written, and a delivery that
    // interleaves here reads the world this one just put rather than the one it read.
    await this.ctx.storage.setAlarm(flushAt);

    return flushAt;
  }

  /** Every run and every note, which only the drawing and the forgetting ever need together. */
  #world(): World {
    const { kv } = this.ctx.storage;
    const runs = new Map<string, Run>();

    for (const [key, entry] of kv.list<Run>({ prefix: "run:" })) runs.set(key.slice(4), entry);

    return { runs, notes: kv.get<Note[]>("notes") ?? [] };
  }

  async alarm(): Promise<void> {
    const { kv } = this.ctx.storage;

    // Nothing is waiting to be drawn. The alarm is only ever set to a pending flush, so this is
    // one that has already happened.
    if (kv.get<number>("flushAt") === undefined) return;

    const world = this.#world();

    // Forgetting belongs here rather than in the fold: it is the one thing that has to see the
    // whole world, and the draw is already holding all of it.
    //
    // A message the world lets go of is left where it is in the channel, so its id goes with it —
    // anything still holding one would read the absence as "no longer true" and take it down. A
    // dropped run's composed key is also its storage key; a note's never begins `run:`.
    for (const key of forget(world, new Date(Date.now() - retention).toISOString())) {
      kv.delete(`sent:${key}`);
      if (key.startsWith("run:")) kv.delete(key);
    }

    kv.put("notes", world.notes);

    // Drawing sooner than the debounce asked for is not wrong, only less patient — the world is
    // drawn as it stands, and anything that arrives after moves the revision and asks again.
    const drawn = await this.#draw(world);

    // A delivery can arrive while the channel is being written, and it will have bumped the
    // revision and scheduled itself. Clearing the flush here would drop it.
    if (kv.get<number>("revision") === drawn) {
      kv.delete("flushAt");
      kv.delete("pendingSince");
      return;
    }

    await this.ctx.storage.setAlarm(kv.get<number>("flushAt") ?? Date.now());
  }

  /** The world, brought to Discord. Returns the revision it drew, which may already be behind. */
  async #draw(world: World): Promise<number | undefined> {
    const { kv } = this.ctx.storage;

    const meta = kv.get<Meta>("meta");
    if (!meta) return kv.get<number>("revision");

    const revision = kv.get<number>("revision");

    const held = new Map<string, Held>();
    for (const [key, value] of kv.list<Held>({ prefix: "sent:" }))
      held.set(key.slice("sent:".length), value);

    await deliverAll(
      compose(world, meta.repository, meta.hook),
      discordTransport(meta.secret),
      held,
      // Written as each message is captured rather than at the end: an alarm is retried, and a
      // message posted but never recorded would be posted a second time.
      (key, value) => {
        if (value) kv.put(`sent:${key}`, value);
        else kv.delete(`sent:${key}`);
      },
    );

    return revision;
  }
}
