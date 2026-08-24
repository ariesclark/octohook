import { DurableObject } from "cloudflare:workers";

import { compose } from "./compose";
import { createGithub, type Github } from "./discord/events/check-run/run.ts";
import { deliverAll, discordTransport, type Held } from "./deliver.ts";
import type { Folded } from "./foldable.ts";
import type { HookScope } from "./discord/refs";
import { resolveFor } from "./resolve.ts";
import { apply, forget, type Note, type Repository, type Run, type World } from "./state.ts";

type Meta = {
  secret: string;
  hook: HookScope;
  repository: Repository;
};

const debounce = 2_000;

const maximumWait = 15_000;

const retention = 48 * 60 * 60 * 1000;

export type Outcome = {
  changed: string[];
  revision: number;
  drawAt: number;
};

export type Batch = {
  secret: string;
  hook: HookScope;
  token?: string;
  deliveries: Folded[];
};

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
  async deliver({ secret, hook, token, deliveries }: Batch): Promise<Outcome> {
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
      last = (delivery.payload.repository as Repository | undefined) ?? last;
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

    return { changed, revision, drawAt: flushAt };
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

    const drawn = await this.#draw(world);

    if (kv.get<number>("revision") === drawn) {
      kv.delete("flushAt");
      kv.delete("pendingSince");
      return;
    }

    await this.ctx.storage.setAlarm(kv.get<number>("flushAt") ?? Date.now());
  }

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
      (key, value) => {
        if (value) kv.put(`sent:${key}`, value);
        else kv.delete(`sent:${key}`);
      },
    );

    return revision;
  }
}
