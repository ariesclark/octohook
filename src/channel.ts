import { DurableObject } from "cloudflare:workers";

import { compose } from "./compose";
import { createGithub, type Github } from "./discord/events/check-run/run.ts";
import { deliverAll, discordTransport, type Held } from "./deliver.ts";
import type { Folded } from "./foldable.ts";
import type { HookScope } from "./discord/refs";
import { resolveFor } from "./resolve.ts";
import { apply, emptyWorld, forget, type Repository, type World } from "./state.ts";

/**
 * One Discord channel, and everything it is currently saying. Deliveries fold into a world here;
 * an alarm draws the whole channel from that world and rewrites only what changed.
 *
 * The channel is the object because the channel is what the drawing is about. `compose` reads a
 * world and returns every message in the channel, ordering them against each other; the webhook's
 * rate limit is one bucket for all of them; and a message that needs resurfacing needs to know
 * what is below it. Sharded per commit, none of those can be said at all.
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

/** A commit that has said nothing for this long is not news any more, and is let go of. */
const retention = 6 * 60 * 60 * 1000;

export class Channel extends DurableObject<CloudflareBindings> {
  /**
   * A token belongs to whoever is doing the resolving. At module scope it would be one channel's
   * credentials in the hands of every other instance sharing the isolate.
   */
  #github: Github = createGithub(this.env.GITHUB_TOKEN);

  /**
   * Folds a batch into the channel and says when it will next be drawn.
   *
   * Every lookup happens first, on purpose. A Durable Object holds its input gate only while
   * synchronous JavaScript is running — an `await` opens it and lets another delivery in — so a
   * resolve in the middle of a read-modify-write reopens exactly the race this object exists to
   * close. Once the last lookup is done the fold runs to completion with no await in it, and no
   * other delivery can see the world between the read and the write.
   */
  async deliver(secret: string, hook: HookScope, deliveries: Folded[]): Promise<number> {
    const resolved = [];

    for (const delivery of deliveries)
      resolved.push([
        delivery,
        await resolveFor(delivery, this.#github, async () => delivery.content),
      ] as const);

    const { kv } = this.ctx.storage;
    const now = Date.now();

    const world = (kv.get<World>("world") ?? emptyWorld()) as World;
    const repository = kv.get<Meta>("meta")?.repository;

    let last = repository;
    for (const [delivery, values] of resolved) {
      apply(world, delivery, values);
      last = (delivery.payload.repository as Repository | undefined) ?? last;
    }

    // Forgotten in the same breath as their ids: a message the world no longer holds must be left
    // where it is, and anything still holding its id would read the absence as "no longer true".
    for (const key of forget(world, new Date(now - retention).toISOString()))
      kv.delete(`sent:${key}`);

    const pendingSince = kv.get<number>("pendingSince") ?? now;
    const flushAt = Math.min(now + debounce, pendingSince + maximumWait);

    kv.put("world", world);
    kv.put("revision", (kv.get<number>("revision") ?? 0) + 1);
    kv.put("pendingSince", pendingSince);
    kv.put("flushAt", flushAt);
    if (last) kv.put("meta", { secret, hook, repository: last } satisfies Meta);

    // Safe to await now: everything that had to be atomic is already written, and a delivery that
    // interleaves here reads the world this one just put rather than the one it read.
    await this.ctx.storage.setAlarm(flushAt);

    return flushAt;
  }

  async alarm(): Promise<void> {
    const { kv } = this.ctx.storage;

    // Nothing is waiting to be drawn. The alarm is only ever set to a pending flush, so this is
    // one that has already happened.
    if (kv.get<number>("flushAt") === undefined) return;

    // Drawing sooner than the debounce asked for is not wrong, only less patient — the world is
    // drawn as it stands, and anything that arrives after moves the revision and asks again.
    const drawn = await this.#draw();

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
  async #draw(): Promise<number | undefined> {
    const { kv } = this.ctx.storage;

    const meta = kv.get<Meta>("meta");
    const world = kv.get<World>("world") as World | undefined;
    if (!meta || !world) return kv.get<number>("revision");

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
