import type { Composed } from "./compose";
import {
  characterCount,
  componentCount,
  maximumCharacters,
  splitComponents,
  type MessageComponent,
} from "./discord/limits.ts";

/**
 * Sending only what changed. A composed message is drawn from the world every time, so most come
 * back identical; rewriting those spends a request to change nothing, against the same rate limit
 * as a real edit. What each message last drew as is kept beside its ids and compared.
 *
 * Where those ids are kept is the caller's business — a replay holds them in a `Map` for as long
 * as it runs, a Durable Object writes them to storage as each one is captured.
 */

export type Content = { components?: unknown[]; [key: string]: unknown };

/** What a composed message holds: the Discord messages it was given, and how it last drew. */
export type Held = { ids: string[]; drawn: string };

export type Transport = {
  send(content: Content, messageId?: string, at?: string): Promise<string | undefined>;
  remove(messageId: string): Promise<void>;
  /** Fitting under a ceiling is the transport's business: Discord has one, a file does not. */
  split(components: MessageComponent[], budget?: number): MessageComponent[][];
  /** Where the webhook posts, so a continuation can point back. A file has nowhere to point. */
  where?(): Promise<{ guild_id?: string; channel_id?: string }>;
};

/** What `continued from [above](…)` costs: 114 characters measured, with room to spare. */
export const continuation = 160;

export function discordTransport(secret: string): Transport {
  const base = `https://discord.com/api/webhooks/${secret}`;
  let place: Promise<{ guild_id?: string; channel_id?: string }> | undefined;

  const send = async (content: Content, messageId?: string): Promise<string | undefined> => {
    const url = messageId
      ? `${base}/messages/${messageId}?with_components=true`
      : `${base}?with_components=true&wait=true`;

    const response = await fetch(url, {
      method: messageId ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(content),
    });

    if (response.status === 429) {
      const { retry_after: retryAfter } = (await response.json()) as { retry_after: number };
      await new Promise((resolve) => setTimeout(resolve, (retryAfter + 0.1) * 1000));

      return send(content, messageId);
    }

    // A message that will not go is left as it was rather than losing the id that holds it. What
    // it was measured at goes with the refusal: length is the reason nearly every time.
    if (!response.ok) {
      const components = (content.components ?? []) as MessageComponent[];

      console.log(
        `${response.status} ${await response.text()} ` +
          `[${componentCount(components)} components, ${characterCount(components)} characters]`,
      );

      return messageId;
    }

    const { id } = (await response.json()) as { id: string };
    return id;
  };

  return {
    send,
    async remove(messageId: string) {
      await fetch(`${base}/messages/${messageId}`, { method: "DELETE" });
    },
    split: splitComponents,
    where() {
      place ??= fetch(base)
        .then((response) => response.json() as Promise<{ guild_id?: string; channel_id?: string }>)
        .catch(() => ({}));

      return place;
    },
  };
}

/** Everything but the sending, for reading what a replay would do to a channel before it does. */
export function dryTransport(): Transport {
  let next = 0;

  return {
    async send(_content: Content, messageId?: string) {
      return messageId ?? `dry-${++next}`;
    },
    async remove() {},
    split: splitComponents,
  };
}

/** Told as each message is captured, so ids survive a crash between two sends. */
export type Capture = (key: string, held: Held | undefined) => void;

/**
 * A composed message becomes as many Discord messages as its size demands, reusing the ids it
 * already holds. A webhook cannot reply — Discord accepts `message_reference` on execute and
 * silently drops it — so a continuation links back to the message it continues.
 */
export async function deliverOne(
  key: string,
  content: Content,
  transport: Transport,
  held: Held | undefined,
  record: Capture,
  at = "",
): Promise<boolean> {
  const drawn = JSON.stringify(content);
  if (held?.drawn === drawn) return false;

  const components = (content.components ?? []) as MessageComponent[];

  // Every message after the first carries a line saying what it continues. Splitting to the very
  // limit leaves no room for it, so the message comes back rejected over the length of something
  // it was never measured with — once a split is needed at all, everything is cut to make room.
  const whole = transport.split(components);
  const parts =
    whole.length > 1 ? transport.split(components, maximumCharacters - continuation) : whole;

  const ids: string[] = [];

  for (const [index, components] of parts.entries()) {
    const continues = index > 0 ? ids[0] : undefined;
    const { guild_id: guild, channel_id: channel } =
      continues && transport.where ? await transport.where() : {};

    const link =
      continues && guild && channel
        ? `https://discord.com/channels/${guild}/${channel}/${continues}`
        : undefined;

    const body = link
      ? {
          ...content,
          components: [{ type: 10, content: `-# continued from [above](${link})` }, ...components],
        }
      : { ...content, components };

    const id = await transport.send(body, held?.ids[index], at);
    if (id) ids.push(id);

    // Written before the next send, so a failure halfway through leaves ids to reuse rather than
    // orphaned messages a webhook can never find again.
    record(key, { ids: [...ids, ...(held?.ids ?? []).slice(ids.length)], drawn: "" });
  }

  for (const spare of (held?.ids ?? []).slice(parts.length)) await transport.remove(spare);

  record(key, { ids, drawn });
  return true;
}

/**
 * The whole channel, brought to what the world says it should be: every composed message written
 * if it changed, and every message the world no longer draws taken down rather than left saying
 * something that is no longer true.
 */
export async function deliverAll(
  composed: Composed[],
  transport: Transport,
  held: Map<string, Held>,
  record: Capture = () => {},
  at = "",
): Promise<{ redrawn: number; removed: number }> {
  let redrawn = 0;
  let removed = 0;

  for (const message of composed) {
    const previous = held.get(message.key);

    const changed = await deliverOne(
      message.key,
      message.content as Content,
      transport,
      previous,
      (key, value) => {
        if (value) held.set(key, value);
        else held.delete(key);

        record(key, value);
      },
      at,
    );

    if (changed) redrawn += 1;
  }

  for (const [key, previous] of held) {
    if (composed.some((message) => message.key === key)) continue;

    for (const id of previous.ids) await transport.remove(id);

    held.delete(key);
    record(key, undefined);
    removed += 1;
  }

  return { redrawn, removed };
}
