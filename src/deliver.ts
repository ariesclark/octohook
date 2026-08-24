import type { Composed } from "./compose";
import {
  characterCount,
  componentCount,
  maximumCharacters,
  splitComponents,
  type MessageComponent,
} from "./discord/limits.ts";

export type Content = { components?: unknown[]; [key: string]: unknown };

export type Held = { ids: string[]; drawn: string };

export type Transport = {
  send(content: Content, messageId?: string, at?: string): Promise<string | undefined>;
  remove(messageId: string): Promise<void>;
  split(components: MessageComponent[], budget?: number): MessageComponent[][];
  where?(): Promise<{ guild_id?: string; channel_id?: string }>;
};

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

export type Capture = (key: string, held: Held | undefined) => void;

/** Discord accepts `message_reference` on a webhook execute and silently drops it. */
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

    record(key, { ids: [...ids, ...(held?.ids ?? []).slice(ids.length)], drawn: "" });
  }

  for (const spare of (held?.ids ?? []).slice(parts.length)) await transport.remove(spare);

  record(key, { ids, drawn });
  return true;
}

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
