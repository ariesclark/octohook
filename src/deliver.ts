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
  /** Whether the message is gone. A delete that was refused keeps its record for the next draw. */
  remove(messageId: string): Promise<boolean>;
  split(components: MessageComponent[], budget?: number): MessageComponent[][];
  where?(): Promise<{ guild_id?: string; channel_id?: string }>;
};

export const continuation = 160;

/** A rate limit that will not say how long to wait is one to report rather than guess about. */
async function retryAfter(response: Response): Promise<number | undefined> {
  try {
    const { retry_after: seconds } = (await response.json()) as { retry_after?: number };
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) return undefined;

    return (seconds + 0.1) * 1000;
  } catch {
    return undefined;
  }
}

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
      const wait = await retryAfter(response);
      if (wait === undefined) return messageId;

      await new Promise((resolve) => setTimeout(resolve, wait));
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

  const remove = async (messageId: string): Promise<boolean> => {
    const response = await fetch(`${base}/messages/${messageId}`, { method: "DELETE" });

    if (response.status === 429) {
      const wait = await retryAfter(response);
      if (wait === undefined) return false;

      await new Promise((resolve) => setTimeout(resolve, wait));
      return remove(messageId);
    }

    // A message someone deleted by hand is already where we are trying to put it.
    return response.ok || response.status === 404;
  };

  return {
    send,
    remove,
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
    async remove() {
      return true;
    },
    split: splitComponents,
  };
}

export type Capture = (key: string, held: Held | undefined) => void;

/** Discord accepts `message_reference` on a webhook execute and silently drops it. */
export type Drew = { changed: boolean; sent: boolean };

export async function deliverOne(
  key: string,
  content: Content,
  transport: Transport,
  held: Held | undefined,
  record: Capture,
  at = "",
): Promise<Drew> {
  const drawn = JSON.stringify(content);

  // A record with no message id behind it is not a drawn message, whatever it says it drew.
  if (held?.drawn === drawn && held.ids.length > 0) return { changed: false, sent: true };

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

  const spares = (held?.ids ?? []).slice(parts.length);
  const kept: string[] = [];

  for (const spare of spares) if (!(await transport.remove(spare))) kept.push(spare);

  // A part Discord would not take leaves nothing to edit, so the next draw must send it again.
  const sent = ids.length === parts.length && kept.length === 0;

  record(key, { ids: [...ids, ...kept], drawn: sent ? drawn : "" });
  return { changed: true, sent };
}

export async function deliverAll(
  composed: Composed[],
  transport: Transport,
  held: Map<string, Held>,
  record: Capture = () => {},
  at = "",
  { deletionBudget = Infinity }: { deletionBudget?: number } = {},
): Promise<{ redrawn: number; removed: number; pending: number; failed: string[] }> {
  let redrawn = 0;
  let removed = 0;
  let pending = 0;

  const failed: string[] = [];

  for (const message of composed) {
    const previous = held.get(message.key);

    const { changed, sent } = await deliverOne(
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
    if (!sent) failed.push(message.key);
  }

  let tried = 0;

  const drawing = new Set(composed.map(({ key }) => key));

  for (const [key, previous] of held) {
    if (drawing.has(key)) continue;

    if (tried >= deletionBudget) {
      pending += 1;
      continue;
    }

    const left: string[] = [];
    for (const id of previous.ids) {
      tried += 1;
      if (!(await transport.remove(id))) left.push(id);
    }

    if (left.length > 0) {
      const kept = { ...previous, ids: left };

      held.set(key, kept);
      if (left.length !== previous.ids.length) record(key, kept);

      pending += 1;
      continue;
    }

    held.delete(key);
    record(key, undefined);
    removed += 1;
  }

  return { redrawn, removed, pending, failed };
}
