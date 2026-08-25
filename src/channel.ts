import { DurableObject } from "cloudflare:workers";

import { compose } from "./compose";
import { createGithub, type Github } from "./discord/events/check-run/run.ts";
import { deliverAll, discordTransport, type Held } from "./deliver.ts";
import type { Folded } from "./foldable.ts";
import type { HookScope } from "./discord/refs";
import type { Query } from "./policy.ts";
import { resolveFor } from "./resolve.ts";
import {
  apply,
  applyJobs,
  forget,
  watching,
  type Note,
  type Repository,
  type Run,
  type World,
} from "./state.ts";

type Meta = {
  secret: string;
  hook: HookScope;
  repository: Repository;
};

const debounce = 2_000;

const maximumWait = 15_000;

const retention = 48 * 60 * 60 * 1000;

const deletionBudget = 25;

const drainAfter = 30_000;

/** Discord may never take a message back. Stop asking rather than ask forever. */
const maximumDrains = 20;

/** How often a run still in flight is asked what step it is on. */
const watchEvery = 5_000;

/** A run whose finish never arrives would otherwise be asked about forever. */
const maximumWatches = 240;

export type Trouble = { at: string; keys: string[] };

export type Outcome = {
  changed: string[];
  revision: number;
  drawAt: number;
  /** What the channel is holding, so a delivery's own answer says whether it landed. */
  holding: { runs: number; notes: number; drawn: number };
  /** The last draw Discord refused, kept until one goes through. */
  trouble?: Trouble;
};

export type Batch = {
  secret: string;
  hook: HookScope;
  token?: string;
  query?: Query;
  deliveries: Folded[];
};

/** Counting a prefix without spreading it, so a count does not deserialise every value it passes. */
function counted(kv: DurableObjectStorage["kv"], prefix: string): number {
  let total = 0;
  for (const _ of kv.list({ prefix })) total += 1;

  return total;
}

export class Channel extends DurableObject<CloudflareBindings> {
  #github: Github | undefined;
  #token: string | undefined;

  #githubFor(token: string | undefined): Github {
    if (!this.#github || this.#token !== token) {
      this.#github = createGithub(token);
      this.#token = token;
    }

    return this.#github;
  }

  /** A Durable Object's input gate opens on every `await`, so lookups happen before the fold. */
  async deliver({ secret, hook, token, query, deliveries }: Batch): Promise<Outcome> {
    const github = this.#githubFor(token);
    const resolved = [];

    for (const delivery of deliveries)
      resolved.push([
        delivery,
        await resolveFor(delivery, github, async () => delivery.content),
      ] as const);

    const { kv } = this.ctx.storage;
    const now = Date.now();

    this.#migrate();

    const world: World = { runs: new Map(), notes: kv.get<Note[]>("notes") ?? [] };

    for (const [, values] of resolved) {
      if (!values.runId) continue;

      const held = kv.get<Run>(`run:${values.runId}`);
      if (held) world.runs.set(values.runId, held);
    }

    let last = kv.get<Meta>("meta")?.repository;
    const changed: string[] = [];

    for (const [delivery, values] of resolved) {
      changed.push(apply(world, delivery, values));

      const where = delivery.payload.repository as Repository | undefined;
      last = where ?? last;

      // A repository's own hook says what its channel draws, so the last delivery for it wins.
      const named = where?.full_name ?? where?.name;
      if (!named) continue;

      if (query?.include || query?.exclude) kv.put(`query:${named}`, query);
      else kv.delete(`query:${named}`);
    }

    const pendingSince = kv.get<number>("pendingSince") ?? now;
    const flushAt = Math.min(now + debounce, pendingSince + maximumWait);

    for (const [id, entry] of world.runs) kv.put(`run:${id}`, entry);

    const revision = (kv.get<number>("revision") ?? 0) + 1;

    kv.put("notes", world.notes);
    kv.put("revision", revision);
    kv.put("pendingSince", pendingSince);
    kv.put("flushAt", flushAt);
    if (last) kv.put("meta", { secret, hook, repository: last } satisfies Meta);

    await this.ctx.storage.setAlarm(flushAt);

    const holding = {
      runs: counted(kv, "run:"),
      notes: world.notes.length,
      drawn: counted(kv, "sent:"),
    };

    const trouble = kv.get<Trouble>("trouble");

    return { changed, revision, drawAt: flushAt, holding, ...(trouble ? { trouble } : {}) };
  }

  /** Objects deployed before runs had keys of their own still hold one `world`. */
  #migrate(): void {
    const { kv } = this.ctx.storage;

    const whole = kv.get<World>("world");
    if (!whole) return;

    for (const [id, entry] of whole.runs) kv.put(`run:${id}`, entry);

    kv.put("notes", whole.notes);
    kv.delete("world");
  }

  #world(): World {
    const { kv } = this.ctx.storage;
    const runs = new Map<string, Run>();

    for (const [key, entry] of kv.list<Run>({ prefix: "run:" })) runs.set(key.slice(4), entry);

    return { runs, notes: kv.get<Note[]>("notes") ?? [] };
  }

  async alarm(): Promise<void> {
    const { kv } = this.ctx.storage;

    if (kv.get<number>("flushAt") === undefined) return;

    this.#migrate();

    const world = this.#world();

    for (const key of forget(world, new Date(Date.now() - retention).toISOString())) {
      kv.delete(`sent:${key}`);
      if (key.startsWith("run:")) kv.delete(key);
    }

    kv.put("notes", world.notes);

    // A query outlives nothing: once the channel holds nothing from a repository, neither does it.
    const speaking = new Set(
      [...world.runs.values(), ...world.notes]
        .map(({ repository }) => repository?.full_name ?? repository?.name)
        .filter(Boolean),
    );

    for (const [key] of kv.list({ prefix: "query:" }))
      if (!speaking.has(key.slice("query:".length))) kv.delete(key);

    const moved = await this.#watch(world);
    if (moved) for (const [id, entry] of world.runs) kv.put(`run:${id}`, entry);

    const { revision: drawn, pending } = await this.#draw(world);

    if (watching(world).length > 0 && this.#token) {
      const watches = (kv.get<number>("watches") ?? 0) + 1;

      if (watches <= maximumWatches) {
        kv.put("watches", watches);
        kv.put("flushAt", Date.now() + watchEvery);
        await this.ctx.storage.setAlarm(Date.now() + watchEvery);

        return;
      }
    }

    kv.delete("watches");

    if (pending > 0) {
      const drains = (kv.get<number>("drains") ?? 0) + 1;

      if (drains <= maximumDrains) {
        const waiting = kv.get<number>("flushAt") ?? 0;
        const drainAt =
          waiting > Date.now()
            ? Math.min(waiting, Date.now() + drainAfter)
            : Date.now() + drainAfter;

        kv.put("drains", drains);
        kv.put("flushAt", drainAt);
        kv.delete("pendingSince");

        await this.ctx.storage.setAlarm(drainAt);
        return;
      }
    }

    kv.delete("drains");

    if (kv.get<number>("revision") === drawn) {
      kv.delete("flushAt");
      kv.delete("pendingSince");
      return;
    }

    await this.ctx.storage.setAlarm(kv.get<number>("flushAt") ?? Date.now());
  }

  /** Asks GitHub what each unfinished run is doing, and folds the answer in like a delivery. */
  async #watch(world: World): Promise<boolean> {
    const runs = watching(world);
    if (runs.length === 0) return false;

    if (!this.#token) return false;

    const github = this.#githubFor(this.#token);
    let moved = false;

    // The asks are independent, so they go together; the folds share a world, so they go in turn.
    const answers = await Promise.all(
      runs.map(async (entry) => ({
        entry,
        ...(await github.watchJobs(
          { repository: entry.repository!.full_name!, runId: entry.id },
          entry.etag,
        )),
      })),
    );

    const seen = new Date().toISOString();

    for (const { entry, etag, jobs } of answers) {
      // A fresh tag is worth keeping even when nothing moved: it is what makes the next ask free.
      if (etag !== entry.etag) moved = true;
      entry.etag = etag;

      if (jobs) moved = applyJobs(world, entry.id, jobs, entry.at, seen).length > 0 || moved;
    }

    return moved;
  }

  async #draw(world: World): Promise<{ revision: number | undefined; pending: number }> {
    const { kv } = this.ctx.storage;

    const meta = kv.get<Meta>("meta");
    if (!meta) return { revision: kv.get<number>("revision"), pending: 0 };

    const revision = kv.get<number>("revision");

    const held = new Map<string, Held>();
    for (const [key, value] of kv.list<Held>({ prefix: "sent:" }))
      held.set(key.slice("sent:".length), value);

    const queries = new Map<string, Query>();
    for (const [key, value] of kv.list<Query>({ prefix: "query:" }))
      queries.set(key.slice("query:".length), value);

    const { pending, failed } = await deliverAll(
      compose(world, meta.repository, meta.hook, queries),
      discordTransport(meta.secret),
      held,
      (key, value) => {
        if (value) kv.put(`sent:${key}`, value);
        else kv.delete(`sent:${key}`);
      },
      "",
      { deletionBudget },
    );

    if (failed.length > 0)
      kv.put("trouble", { at: new Date().toISOString(), keys: failed } satisfies Trouble);
    else kv.delete("trouble");

    return { revision, pending };
  }
}
